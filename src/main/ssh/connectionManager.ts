import { Client, ConnectConfig, ClientChannel } from 'ssh2'
import { ExecCommandResult } from '@shared/types'

interface ManagedClient {
  client: Client
  refCount: number
  destroyTimer?: NodeJS.Timeout
  lastError?: Error
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

  async acquire(connectionId: string): Promise<Client> {
    const existing = this.clients.get(connectionId)
    if (existing) {
      existing.refCount++
      if (existing.destroyTimer) {
        clearTimeout(existing.destroyTimer)
        existing.destroyTimer = undefined
      }
      return existing.client
    }
    const config = await this.buildConfig(connectionId)
    const client = await this.connect(config)
    const managed: ManagedClient = { client, refCount: 1 }
    client.on('close', () => this.clients.delete(connectionId))
    this.clients.set(connectionId, managed)
    return client
  }

  release(connectionId: string): void {
    const managed = this.clients.get(connectionId)
    if (!managed) return
    managed.refCount = Math.max(0, managed.refCount - 1)
    if (managed.refCount === 0) {
      managed.destroyTimer = setTimeout(() => {
        managed.client.end()
        this.clients.delete(connectionId)
      }, this.idleDestroyMs)
    }
  }

  isOnline(connectionId: string): boolean {
    const managed = this.clients.get(connectionId)
    return managed != null && managed.refCount > 0
  }

  async exec(connectionId: string, command: string, timeoutMs = EXEC_TIMEOUT_MS): Promise<ExecCommandResult> {
    const client = await this.acquire(connectionId)
    const started = Date.now()
    try {
      return await new Promise<ExecCommandResult>((resolvePromise, reject) => {
        client.exec(command, (err, stream) => {
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
      this.release(connectionId)
    }
  }
}

/** 独立的 shell 通道句柄，由 SessionManager 管理。 */
export interface ShellHandle {
  stream: ClientChannel
}

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
