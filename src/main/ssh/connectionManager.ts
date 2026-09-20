import { Client, ConnectConfig, ClientChannel } from 'ssh2'
import { ExecCommandResult } from '@shared/types'

interface ManagedClient {
  client: Client
  refCount: number
  destroyTimer?: NodeJS.Timeout
}

const IDLE_DESTROY_MS = 60_000
const EXEC_TIMEOUT_MS = 120_000

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
  /** 立即销毁并移出连接池（远端会话已终止时使用，防止复用濒死连接） */
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
    private readonly buildConfig: (connectionId: string) => Promise<ConnectConfig>,
    opts: { idleDestroyMs?: number } = {}
  ) {
    this.idleDestroyMs = opts.idleDestroyMs ?? IDLE_DESTROY_MS
  }

  private connect(config: ConnectConfig): Promise<Client> {
    return new Promise((resolvePromise, reject) => {
      const client = new Client()
      client.once('error', reject)
      client.once('ready', () => {
        client.removeListener('error', reject)
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
      drop: () => this.destroy(connectionId, managed)
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
          let exitCode: number | null = null
          const timer = setTimeout(() => {
            stream.close()
            reject(new Error(`命令执行超时（${timeoutMs}ms）`))
          }, timeoutMs)
          stream.on('data', (d: Buffer) => out.push(d))
          stream.stderr.on('data', (d: Buffer) => errOut.push(d))
          stream.on('close', (code: number | null) => {
            clearTimeout(timer)
            exitCode = code
            resolvePromise({
              stdout: Buffer.concat(out).toString('utf8'),
              stderr: Buffer.concat(errOut).toString('utf8'),
              exitCode,
              truncated: false,
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
export async function testConnect(config: ConnectConfig): Promise<void> {
  const client = new Client()
  await new Promise<void>((resolvePromise, reject) => {
    client.once('error', reject)
    client.once('ready', () => {
      client.removeListener('error', reject)
      resolvePromise()
    })
    client.connect(config)
  })
  client.on('error', () => {})
  client.end()
}
