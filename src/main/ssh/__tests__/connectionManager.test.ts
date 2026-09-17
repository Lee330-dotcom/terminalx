import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { ConnectConfig } from 'ssh2'
import { ConnectionManager, describeSshError } from '../connectionManager'
import { SessionManager } from '../sessionManager'
import { startTestSshServer, TestSshServer } from './testSshServer'

let server: TestSshServer

beforeAll(async () => {
  server = await startTestSshServer()
})

afterAll(() => {
  server.close()
})

function makeManager(password: string): ConnectionManager {
  return new ConnectionManager(
    async () =>
      ({
        host: '127.0.0.1',
        port: server.port,
        username: 'tester',
        password,
        readyTimeout: 5000
      }) as ConnectConfig,
    { idleDestroyMs: 200 }
  )
}

interface CapturedEvent {
  type: 'status' | 'data'
  sessionId: string
  status?: string
  errorMessage?: string
  data?: string
}

describe('describeSshError', () => {
  it('区分认证失败与网络错误', () => {
    expect(describeSshError(Object.assign(new Error('x'), { level: 'client-authentication' }))).toContain(
      '认证失败'
    )
    expect(describeSshError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toContain(
      '拒绝连接'
    )
    expect(describeSshError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toContain('解析')
  })
})

describe('ConnectionManager 集成', () => {
  afterEach(() => {
    /* 各用例自建 manager，空闲销毁由计时器兜底 */
  })

  it('连接成功后 exec 执行命令并返回输出与退出码', async () => {
    const manager = makeManager('test-pass')
    const result = await manager.exec('conn-1', 'ls -la')
    expect(result.stdout).toBe('exec:ls -la')
    expect(result.exitCode).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('密码错误时抛认证失败', async () => {
    const manager = makeManager('wrong-pass')
    await expect(manager.exec('conn-1', 'ls')).rejects.toThrow()
  })

  it('连接复用：同一连接两次 exec 仅一次握手', async () => {
    const manager = makeManager('test-pass')
    const client1 = await manager.acquire('conn-1')
    const client2 = await manager.acquire('conn-1')
    expect(client1).toBe(client2)
    manager.release('conn-1')
    manager.release('conn-1')
    expect(manager.isOnline('conn-1')).toBe(false)
  })

  it('空闲超时后底层连接销毁', async () => {
    const manager = makeManager('test-pass')
    await manager.acquire('conn-1')
    manager.release('conn-1')
    await new Promise((r) => setTimeout(r, 400))
    expect(manager.isOnline('conn-1')).toBe(false)
  })
})

describe('SessionManager 集成', () => {
  function collect(): { events: CapturedEvent[]; manager: SessionManager } {
    const events: CapturedEvent[] = []
    const sink = {
      emitData: (sessionId: string, data: Uint8Array) =>
        events.push({ type: 'data', sessionId, data: Buffer.from(data).toString('utf8') }),
      emitStatus: (sessionId: string, status: string, errorMessage?: string) =>
        events.push({ type: 'status', sessionId, status, errorMessage })
    }
    const connManager = makeManager('test-pass')
    const manager = new SessionManager(connManager, sink as never)
    return { events, manager }
  }

  it('打开会话后收到欢迎输出并变为 connected', async () => {
    const { events, manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 300))
    const statusEvents = events.filter((e) => e.type === 'status')
    expect(statusEvents[0]?.status).toBe('connecting')
    expect(statusEvents.some((e) => e.status === 'connected')).toBe(true)
    const dataText = events
      .filter((e) => e.type === 'data')
      .map((e) => e.data)
      .join('')
    expect(dataText).toContain('welcome to test server')
    await manager.close(sessionId)
  })

  it('输入回显：写入的数据被服务器回传', async () => {
    const { events, manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 200))
    manager.input(sessionId, new TextEncoder().encode('echo-test'))
    await new Promise((r) => setTimeout(r, 300))
    const dataText = events
      .filter((e) => e.type === 'data')
      .map((e) => e.data)
      .join('')
    expect(dataText).toContain('echo-test')
    await manager.close(sessionId)
  })

  it('readLines 返回滚动缓冲最近行', async () => {
    const { manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 300))
    const result = manager.readLines(sessionId, 1)
    expect(result.totalLines).toBeGreaterThan(0)
    expect(result.lines.length).toBe(1)
    await manager.close(sessionId)
  })

  it('关闭会话后 has() 为 false', async () => {
    const { manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 200))
    expect(manager.has(sessionId)).toBe(true)
    await manager.close(sessionId)
    expect(manager.has(sessionId)).toBe(false)
  })
})
