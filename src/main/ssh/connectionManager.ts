import { Client, ClientChannel } from 'ssh2'
import { ExecCommandResult } from '@shared/types'
import { SshConnectConfig } from './config'

interface ManagedClient {
  client: Client
  refCount: number
  destroyTimer?: NodeJS.Timeout
}

const IDLE_DESTROY_MS = 60_000
const EXEC_TIMEOUT_MS = 120_000
/** 单路输出最多保留的字节数，避免大文件/刷屏命令撑爆主进程内存 */
const MAX_EXEC_OUTPUT_BYTES = 1024 * 1024

/** 将 ssh2 连接错误翻译为用户可读的分类消息。 */
export function describeSshError(err: Error & { level?: string; code?: string }): string {
  if (err.level === 'client-authentication') {
    return '认证失败：请检查用户名、密码或私钥是否正确'
  }
  switch (err.code) {
    case 'ECONNREFUSED':
      return '网络不可达：目标主机拒绝连接（端口未开放？）'
    case 'ENOTFOUND':
      return '网络不可达：无法解析主机名'
    case 'ETIMEDOUT':
      return '网络不可达：连接超时'
    case 'EHOSTUNREACH':
      return '网络不可达：主机不可达'
    default:
      return err.message || '连接失败'
  }
}

/**
 * 连接句柄：绑定到池中某一个具体连接实例。即使该连接后来被销毁、
 * 被新连接替换，迟到的 release/drop 也不会误伤新连接。
 */
export interface ClientHandle {
  client: Client
  /** 释放引用；引用归零后延迟空闲销毁，可被后续操作复用 */
  release(): void
  /**
   * 放弃引用：归还引用计数，仅当该连接已无其它持有者时才立即销毁底层连接。
   * 同一连接可能被多个会话共用（如同一主机的多个标签/分屏），
   * 此时销毁会连带杀死其它会话的通道，因此必须先看引用计数。
   */
  drop(): void
}

/**
 * 按连接 ID 维护 ssh2 Client 池：引用计数 + 60s 空闲延迟销毁。
 * shell / exec / sftp 通道共享同一底层连接。
 */
export class ConnectionManager {
  private clients = new Map<string, ManagedClient>()
  private readonly idleDestroyMs: number

  constructor(
    private readonly buildConfig: (connectionId: string) => Promise<SshConnectConfig>,
    opts: { idleDestroyMs?: number } = {}
  ) {
    this.idleDestroyMs = opts.idleDestroyMs ?? IDLE_DESTROY_MS
  }

  private connect(config: SshConnectConfig): Promise<Client> {
    return new Promise((resolvePromise, reject) => {
      const client = new Client()
      const onError = (err: Error): void => {
        // 主机指纹被拒时 ssh2 只给通用握手错误，这里换成具体原因
        reject(config.hostKeyFailure?.() ?? err)
      }
      client.once('error', onError)
      client.once('ready', () => {
        client.removeListener('error', onError)
        resolvePromise(client)
      })
      client.connect(config)
    })
  }

  private destroy(connectionId: string, managed: ManagedClient): void {
    if (this.clients.get(connectionId) !== managed) return
    if (managed.destroyTimer) {
      clearTimeout(managed.destroyTimer)
      managed.destroyTimer = undefined
    }
    this.clients.delete(connectionId)
    managed.client.end()
  }

  private handleFor(connectionId: string, managed: ManagedClient): ClientHandle {
    return {
      client: managed.client,
      release: () => {
        if (this.clients.get(connectionId) !== managed) return
        managed.refCount = Math.max(0, managed.refCount - 1)
        if (managed.refCount === 0 && !managed.destroyTimer) {
          managed.destroyTimer = setTimeout(
            () => this.destroy(connectionId, managed),
            this.idleDestroyMs
          )
        }
      },
      drop: () => {
        if (this.clients.get(connectionId) !== managed) return
        managed.refCount = Math.max(0, managed.refCount - 1)
        // 同一连接仍被其它会话持有（如同一主机开了多个标签/分屏）：
        // 只销毁自己的通道语义，不动底层连接，否则会连带杀死其它会话
        if (managed.refCount > 0) return
        this.destroy(connectionId, managed)
      }
    }
  }

  async acquire(connectionId: string): Promise<ClientHandle> {
    const existing = this.clients.get(connectionId)
    if (existing) {
      existing.refCount++
      if (existing.destroyTimer) {
        clearTimeout(existing.destroyTimer)
        existing.destroyTimer = undefined
      }
      return this.handleFor(connectionId, existing)
    }
    const config = await this.buildConfig(connectionId)
    const client = await this.connect(config)
    // 并发 acquire 可能各自完成建连：后完成的复用先入池的连接，
    // 销毁自己的多余 client，避免池被覆盖、旧连接泄漏
    const raced = this.clients.get(connectionId)
    if (raced) {
      client.on('error', () => {
        /* end() 期间的错误无需处理 */
      })
      client.end()
      raced.refCount++
      if (raced.destroyTimer) {
        clearTimeout(raced.destroyTimer)
        raced.destroyTimer = undefined
      }
      return this.handleFor(connectionId, raced)
    }
    const managed: ManagedClient = { client, refCount: 1 }
    // 池化连接常驻 error 监听：keepalive 超时（client-timeout）等错误
    // 没有监听器会变成未处理异常导致主进程崩溃
    client.on('error', () => this.destroy(connectionId, managed))
    client.on('close', () => {
      if (this.clients.get(connectionId) === managed) {
        this.clients.delete(connectionId)
      }
    })
    this.clients.set(connectionId, managed)
    return this.handleFor(connectionId, managed)
  }

  /**
   * 创建不进入连接池的独立 client，供 SFTP 等可能受服务端 channel
   * 限制影响的功能使用，避免与交互式 shell 共用 session 通道。
   */
  async acquireIsolated(connectionId: string): Promise<ClientHandle> {
    const config = await this.buildConfig(connectionId)
    const client = await this.connect(config)
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true
      client.end()
    }
    client.on('error', () => {
      // 独立 client 的错误由当前 SFTP 操作接收，避免成为未处理异常。
    })
    return { client, release: close, drop: close }
  }

  isOnline(connectionId: string): boolean {
    const managed = this.clients.get(connectionId)
    return managed != null && managed.refCount > 0
  }

  async exec(
    connectionId: string,
    command: string,
    timeoutMs = EXEC_TIMEOUT_MS
  ): Promise<ExecCommandResult> {
    const handle = await this.acquire(connectionId)
    const started = Date.now()
    try {
      return await new Promise<ExecCommandResult>((resolvePromise, reject) => {
        handle.client.exec(command, (err, stream) => {
          if (err) {
            reject(err)
            return
          }
          const out: Buffer[] = []
          const errOut: Buffer[] = []
          let outBytes = 0
          let errBytes = 0
          let truncated = false
          let exitCode: number | null = null
          const collect = (buffers: Buffer[], chunk: Buffer, used: number): number => {
            const remain = MAX_EXEC_OUTPUT_BYTES - used
            if (remain <= 0) {
              truncated = true
              return used
            }
            if (chunk.length > remain) {
              buffers.push(chunk.subarray(0, remain))
              truncated = true
              return MAX_EXEC_OUTPUT_BYTES
            }
            buffers.push(chunk)
            return used + chunk.length
          }
          const timer = setTimeout(() => {
            stream.close()
            reject(new Error(`命令执行超时（${timeoutMs}ms）`))
          }, timeoutMs)
          stream.on('data', (d: Buffer) => {
            outBytes = collect(out, d, outBytes)
          })
          stream.stderr.on('data', (d: Buffer) => {
            errBytes = collect(errOut, d, errBytes)
          })
          stream.on('close', (code: number | null) => {
            clearTimeout(timer)
            exitCode = code
            resolvePromise({
              stdout: Buffer.concat(out).toString('utf8'),
              stderr: Buffer.concat(errOut).toString('utf8'),
              exitCode,
              truncated,
              durationMs: Date.now() - started
            })
          })
        })
      })
    } finally {
      handle.release()
    }
  }
}

/** 在已连接的 client 上打开交互 shell 通道。 */
export async function openShell(
  client: Client,
  cols: number,
  rows: number
): Promise<ClientChannel> {
  return new Promise((resolvePromise, reject) => {
    client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
      if (err) reject(err)
      else resolvePromise(stream)
    })
  })
}

/** 一次性连接测试：成功即断开并 resolve，失败 reject（由调用方翻译错误）。 */
export async function testConnect(config: SshConnectConfig): Promise<void> {
  const client = new Client()
  await new Promise<void>((resolvePromise, reject) => {
    const onError = (err: Error): void => {
      reject(config.hostKeyFailure?.() ?? err)
    }
    client.once('error', onError)
    client.once('ready', () => {
      client.removeListener('error', onError)
      resolvePromise()
    })
    client.connect(config)
  })
  client.on('error', () => {})
  client.end()
}
