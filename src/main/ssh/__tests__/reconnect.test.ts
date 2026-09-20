import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import { Server, Connection, ServerChannel } from 'ssh2'
import { ConnectionManager } from '../connectionManager'
import { SessionManager, SessionEventSink } from '../sessionManager'
import { ConnectConfig } from 'ssh2'

interface Captured {
  status: string
  errorMessage?: string
}

/** 支持三种断开方式的测试服务器：仅关通道 / SSH 断开 / 直接摧毁 socket */
function startKillableServer(): Promise<{
  port: number
  close(): void
  killShells(): void
  disconnectClients(): void
  destroyClients(): void
  clients: Connection[]
}> {
  return new Promise((resolvePromise, reject) => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const clients: Connection[] = []
    const shells: ServerChannel[] = []
    const server = new Server({ hostKeys: [privateKey] }, (client: Connection) => {
      clients.push(client)
      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'test-pass') {
          ctx.accept()
        } else {
          ctx.reject()
        }
      })
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept()
          session.on('pty', (acceptPty) => acceptPty?.())
          session.on('shell', (acceptShell) => {
            const stream = acceptShell()
            shells.push(stream)
            stream.write('welcome\r\n$ ')
            stream.on('data', (d: Buffer) => stream.write(d))
          })
        })
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string' || !address) {
        reject(new Error('failed to bind'))
        return
      }
      resolvePromise({
        port: address.port,
        close: () => server.close(),
        clients,
        killShells: () => {
          for (const s of shells) {
            s.exit(0)
            s.end()
          }
        },
        disconnectClients: () => {
          for (const c of clients) c.end()
        },
        destroyClients: () => {
          for (const c of clients) (c as unknown as { _sock?: { destroy(): void } })._sock?.destroy()
        }
      })
    })
  })
}

function makeManager(port: number, idleMs: number): ConnectionManager {
  return new ConnectionManager(
    async () =>
      ({
        host: '127.0.0.1',
        port,
        username: 'tester',
        password: 'test-pass',
        readyTimeout: 5000,
        keepaliveInterval: 0
      }) as ConnectConfig,
    { idleDestroyMs: idleMs }
  )
}

/** 堡垒机行为：shell 通道关闭后 600ms 拆除整个 SSH 会话；期间新通道会被接受，随后随会话一起死亡。 */
function startFortressServer(): Promise<{
  port: number
  close(): void
  killShells(): void
  clients: Connection[]
}> {
  return new Promise((resolvePromise, reject) => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const clients: Connection[] = []
    const shells: ServerChannel[] = []
    const server = new Server({ hostKeys: [privateKey] }, (client: Connection) => {
      clients.push(client)
      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'test-pass') {
          ctx.accept()
        } else {
          ctx.reject()
        }
      })
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept()
          session.on('pty', (acceptPty) => acceptPty?.())
          session.on('shell', (acceptShell) => {
            const stream = acceptShell()
            shells.push(stream)
            stream.write('welcome\r\n$ ')
            stream.on('data', (d: Buffer) => stream.write(d))
            stream.on('close', () => {
              setTimeout(() => client.end(), 600)
            })
          })
        })
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string' || !address) {
        reject(new Error('failed to bind'))
        return
      }
      resolvePromise({
        port: address.port,
        close: () => server.close(),
        clients,
        killShells: () => {
          for (const s of shells) {
            s.exit(0)
            s.end()
          }
        }
      })
    })
  })
}

/** 收到 exit 输入后延迟 300ms 才关闭通道，模拟旧通道 close 事件迟到。 */
function startDelayedExitServer(): Promise<{ port: number; close(): void }> {
  return new Promise((resolvePromise, reject) => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const server = new Server({ hostKeys: [privateKey] }, (client: Connection) => {
      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'test-pass') {
          ctx.accept()
        } else {
          ctx.reject()
        }
      })
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept()
          session.on('pty', (acceptPty) => acceptPty?.())
          session.on('shell', (acceptShell) => {
            const stream = acceptShell()
            stream.write('welcome\r\n$ ')
            stream.on('data', (d: Buffer) => {
              if (d.toString('utf8').includes('exit')) {
                setTimeout(() => {
                  stream.exit(0)
                  stream.end()
                }, 300)
              } else {
                stream.write(d)
              }
            })
          })
        })
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string' || !address) {
        reject(new Error('failed to bind'))
        return
      }
      resolvePromise({
        port: address.port,
        close: () => server.close()
      })
    })
  })
}

function waitFor(captured: () => Captured | null, expectStatus: string, timeoutMs = 10000): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      const cur = captured()
      if (cur?.status === expectStatus) {
        clearInterval(timer)
        resolvePromise()
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error(`timeout waiting status ${expectStatus}, got ${cur?.status}`))
      }
    }, 20)
  })
}

function waitEvent(events: Captured[], n: number, timeoutMs = 10000): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      if (events.length >= n) {
        clearInterval(timer)
        resolvePromise()
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error(`timeout waiting ${n} events, got ${events.length}`))
      }
    }, 20)
  })
}

async function setup(port: number, idleMs = 60000): Promise<{
  sessions: SessionManager
  events: Captured[]
  dataText(): string
  status(): Captured | null
}> {
  const events: Captured[] = []
  const dataChunks: string[] = []
  const sink: SessionEventSink = {
    emitData: (_sessionId, data) => {
      dataChunks.push(Buffer.from(data).toString('utf8'))
    },
    emitStatus: (_sessionId, status, errorMessage) => {
      events.push({ status, errorMessage })
    }
  }
  const sessions = new SessionManager(makeManager(port, idleMs), sink)
  return {
    sessions,
    events,
    dataText: () => dataChunks.join(''),
    status: () => events[events.length - 1] ?? null
  }
}

describe('重连回归', () => {
  let server: Awaited<ReturnType<typeof startKillableServer>>
  let fortress: Awaited<ReturnType<typeof startFortressServer>>
  let delayedExit: Awaited<ReturnType<typeof startDelayedExitServer>>
  beforeAll(async () => {
    server = await startKillableServer()
    fortress = await startFortressServer()
    delayedExit = await startDelayedExitServer()
  })
  afterAll(() => {
    server.close()
    fortress.close()
    delayedExit.close()
  })

  it('A. 服务器只关 shell 通道（TMOUT 场景）→ 重连成功', async () => {
    const { sessions, events, status } = await setup(server.port)
    const { sessionId } = await sessions.open('conn-a')
    await waitFor(status, 'connected')
    server.killShells()
    await waitFor(status, 'disconnected')
    const n = events.length
    await sessions.reconnect(sessionId)
    await waitEvent(events, n + 1)
    expect(status()?.status).toBe('connected')
    await sessions.close(sessionId)
  })

  it('B. 服务器断开 SSH 连接 → 重连成功', async () => {
    const { sessions, events, status } = await setup(server.port)
    const { sessionId } = await sessions.open('conn-b')
    await waitFor(status, 'connected')
    server.disconnectClients()
    await waitFor(status, 'disconnected')
    const n = events.length
    await sessions.reconnect(sessionId)
    await waitEvent(events, n + 1)
    expect(status()?.status).toBe('connected')
    await sessions.close(sessionId)
  })

  it('C. 服务器直接摧毁 socket → 重连成功', async () => {
    const { sessions, events, status } = await setup(server.port)
    const { sessionId } = await sessions.open('conn-c')
    await waitFor(status, 'connected')
    server.destroyClients()
    await waitFor(status, 'disconnected')
    const n = events.length
    await sessions.reconnect(sessionId)
    await waitEvent(events, n + 1)
    expect(status()?.status).toBe('connected')
    await sessions.close(sessionId)
  })

  it('D. 关闭会话后立刻重开新会话，旧连接销毁不影响新会话', async () => {
    const { sessions, status } = await setup(server.port, 200)
    const { sessionId } = await sessions.open('conn-d')
    await waitFor(status, 'connected')
    await sessions.close(sessionId)
    const { sessionId: sessionId2 } = await sessions.open('conn-d')
    await waitFor(status, 'connected')
    await new Promise((r) => setTimeout(r, 400))
    expect(status()?.status).toBe('connected')
    await sessions.close(sessionId2)
  })

  it('E. 堡垒机式拆除：通道关闭后远端拆除会话，重连必须用新连接并保持不断', async () => {
    const { sessions, events, status } = await setup(fortress.port)
    const { sessionId } = await sessions.open('conn-e')
    await waitFor(status, 'connected')
    fortress.killShells()
    await waitFor(status, 'disconnected')
    const clientCount = fortress.clients.length
    const n = events.length
    await sessions.reconnect(sessionId)
    await waitEvent(events, n + 1)
    expect(status()?.status).toBe('connected')
    // 超过堡垒机拆除延迟（600ms）后必须仍处于 connected
    await new Promise((r) => setTimeout(r, 1000))
    expect(status()?.status).toBe('connected')
    // 必须建立了新的底层连接，而不是复用濒死连接
    expect(fortress.clients.length).toBe(clientCount + 1)
    await sessions.close(sessionId)
  })

  it('F. 旧通道 close 迟到于重连时，不得覆盖新通道状态或断开新连接', async () => {
    const { sessions, events, status, dataText } = await setup(delayedExit.port)
    const { sessionId } = await sessions.open('conn-f')
    await waitFor(status, 'connected')
    sessions.input(sessionId, new TextEncoder().encode('exit\r'))
    // 立即重连：此时旧通道的 close 尚未发生（服务器延迟 300ms 才关闭）
    const n = events.length
    await sessions.reconnect(sessionId)
    await waitEvent(events, n + 1)
    expect(status()?.status).toBe('connected')
    // 旧通道 close 迟到发生后，状态仍为 connected，新通道可正常输入回显
    await new Promise((r) => setTimeout(r, 800))
    expect(status()?.status).toBe('connected')
    sessions.input(sessionId, new TextEncoder().encode('hello-after-reconnect'))
    await new Promise((r) => setTimeout(r, 300))
    expect(dataText()).toContain('hello-after-reconnect')
    await sessions.close(sessionId)
  })

  it('G. 池化连接的 error（keepalive 超时等）被捕获，连接移出池且不崩溃', async () => {
    const manager = makeManager(server.port, 60000)
    const handle = await manager.acquire('conn-g')
    expect(manager.isOnline('conn-g')).toBe(true)
    // 模拟 ssh2 keepalive 超时：无监听器时该 emit 会直接抛出未处理异常
    handle.client.emit(
      'error',
      Object.assign(new Error('Keepalive timeout'), { level: 'client-timeout' })
    )
    const deadline = Date.now() + 3000
    while (manager.isOnline('conn-g') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(manager.isOnline('conn-g')).toBe(false)
  })
})
