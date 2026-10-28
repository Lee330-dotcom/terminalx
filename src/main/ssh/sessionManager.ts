import { randomUUID } from 'crypto'
import { StringDecoder } from 'string_decoder'
import { ClientChannel } from 'ssh2'
import { SessionInfo, SessionStatus } from '@shared/types'
import { ClientHandle, ConnectionManager, describeSshError, openShell } from './connectionManager'

const MAX_SCROLLBACK_LINES = 10_000
const FLUSH_INTERVAL_MS = 16

export interface SessionEventSink {
  emitData(sessionId: string, data: Uint8Array): void
  emitStatus(sessionId: string, status: SessionStatus, errorMessage?: string): void
}

interface TerminalSession {
  id: string
  connectionId: string
  status: SessionStatus
  errorMessage?: string
  stream: ClientChannel | null
  handle: ClientHandle | null
  scrollback: string[]
  decoder: StringDecoder
  /** 待推送的字节缓冲（16ms 合并窗口） */
  pending: Buffer[]
  flushTimer?: NodeJS.Timeout
  closedByUser: boolean
}

export class SessionManager {
  private sessions = new Map<string, TerminalSession>()

  constructor(
    private readonly connections: ConnectionManager,
    private readonly sink: SessionEventSink
  ) {}

  private flush(session: TerminalSession): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
      session.flushTimer = undefined
    }
    if (session.pending.length === 0) return
    const chunk = Buffer.concat(session.pending)
    session.pending = []
    this.sink.emitData(session.id, new Uint8Array(chunk))
    // 滚动缓冲：解码后按行拆分（与终端显示共用同一字节流）
    const text = session.decoder.write(chunk)
    const lines = text.split('\n')
    session.scrollback.push(...lines)
    if (session.scrollback.length > MAX_SCROLLBACK_LINES) {
      session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK_LINES)
    }
  }

  private scheduleFlush(session: TerminalSession): void {
    if (session.flushTimer) return
    session.flushTimer = setTimeout(() => this.flush(session), FLUSH_INTERVAL_MS)
  }

  private setStatus(session: TerminalSession, status: SessionStatus, errorMessage?: string): void {
    session.status = status
    session.errorMessage = errorMessage
    this.sink.emitStatus(session.id, status, errorMessage)
  }

  async open(connectionId: string): Promise<{ sessionId: string }> {
    const session: TerminalSession = {
      id: randomUUID(),
      connectionId,
      status: 'connecting',
      stream: null,
      handle: null,
      scrollback: [],
      decoder: new StringDecoder('utf8'),
      pending: [],
      closedByUser: false
    }
    this.sessions.set(session.id, session)
    this.setStatus(session, 'connecting')
    void this.attachShell(session)
    return { sessionId: session.id }
  }

  private async attachShell(session: TerminalSession): Promise<void> {
    let handle: ClientHandle | null = null
    try {
      handle = await this.connections.acquire(session.connectionId)
      if (!this.sessions.has(session.id)) {
        // 会话在连接建立期间被用户关闭
        handle.drop()
        return
      }
      const stream = await openShell(handle.client, 80, 24)
      if (!this.sessions.has(session.id)) {
        // 会话在通道打开期间被用户关闭
        stream.close()
        handle.drop()
        return
      }
      session.handle = handle
      session.stream = stream
      this.setStatus(session, 'connected')
      stream.on('data', (d: Buffer) => {
        session.pending.push(d)
        this.scheduleFlush(session)
      })
      stream.on('close', () => {
        this.flush(session)
        handle?.release()
        // 迟到的旧通道 close（重连后旧 stream 才关闭）：
        // session.stream 已被新通道替换，此时不得清理新通道、也不得改状态
        if (session.stream !== stream) return
        session.stream = null
        session.handle = null
        if (!session.closedByUser) {
          // 远端主动断开说明会话已终止（堡垒机会整体拆除 SSH 会话），
          // 立即销毁底层连接，避免重连时复用濒死连接
          handle?.drop()
          this.setStatus(session, 'disconnected')
        }
      })
      stream.on('error', () => {
        /* close 事件会跟随触发，统一在 close 中处理 */
      })
    } catch (err) {
      handle?.release()
      session.stream = null
      session.handle = null
      this.setStatus(session, 'error', describeSshError(err as Error))
    }
  }

  input(sessionId: string, data: Uint8Array): void {
    const session = this.sessions.get(sessionId)
    if (session?.stream) session.stream.write(Buffer.from(data))
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (session?.stream) session.stream.setWindow(rows, cols, 0, 0)
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.closedByUser = true
    this.flush(session)
    session.stream?.end()
    session.stream = null
    // 用户明确关闭会话时立即销毁底层 client，避免旧 shell 通道
    // 在服务端尚未释放时被下一次连接复用。
    session.handle?.drop()
    session.handle = null
    this.sessions.delete(sessionId)
  }

  async reconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    if (session.stream) {
      session.closedByUser = true
      session.stream.end()
      session.stream = null
    }
    // 旧连接立即销毁：远端（堡垒机）会在通道关闭后拆除整个 SSH 会话，
    // 复用旧 client 重开通道会得到「先连通、随后被远端关闭」的假连接
    session.handle?.drop()
    session.handle = null
    session.closedByUser = false
    this.setStatus(session, 'connecting')
    await this.attachShell(session)
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      connectionId: s.connectionId,
      title: s.connectionId,
      status: s.status,
      errorMessage: s.errorMessage
    }))
  }

  readLines(sessionId: string, n: number): { lines: string[]; totalLines: number } {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    return {
      lines: session.scrollback.slice(-n),
      totalLines: session.scrollback.length
    }
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }
}
