import { randomUUID } from 'crypto'
import { StringDecoder } from 'string_decoder'
import { ClientChannel } from 'ssh2'
import { SessionInfo, SessionStatus } from '@shared/types'
import { ClientHandle, ConnectionManager, describeSshError, openShell } from './connectionManager'

const MAX_SCROLLBACK_LINES = 10_000
/** 单行未结束时的最大保留长度，避免 cat 大文件/二进制输出撑爆内存 */
const MAX_LINE_CARRY = 4096
const FLUSH_INTERVAL_MS = 16

/** shell 输出静默多久视为提示符就绪，此时再写入自动 cd 命令 */
const AUTO_CD_IDLE_MS = 400

interface AutoCdRule {
  /** 连接名包含该关键字（不区分大小写）时生效 */
  nameIncludes: string
  directory: string
}

const AUTO_CD_RULES: AutoCdRule[] = [
  { nameIncludes: 'helink', directory: '/data/apps/helink-pro/logs/app/helink-pro/' }
]

export type ConnectionNameLookup = (connectionId: string) => Promise<{ name: string } | null>

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
  /** 上一条尚未换行的行尾：跨 chunk 拼接，避免一行被拆成多条记录 */
  lineCarry: string
  decoder: StringDecoder
  /** 待推送的字节缓冲（16ms 合并窗口） */
  pending: Buffer[]
  flushTimer?: NodeJS.Timeout
  closedByUser: boolean
  /** 每次附加/重连递增；异步建连返回后据此判断本次附加是否已过期 */
  attachId: number
  /** 最近一次窗口尺寸：连接建立前即可记录，重连时用于新 shell，避免回落到 80x24 */
  size?: { cols: number; rows: number }
  /** 用户是否已经开始输入：一旦输入，取消尚未执行的自动 cd，避免与手输交错 */
  userInput?: boolean
  /** 尚未发送的自动 cd（等待提示符就绪） */
  autoCd?: { directory: string; idleTimer?: NodeJS.Timeout }
}

export class SessionManager {
  private sessions = new Map<string, TerminalSession>()

  constructor(
    private readonly connections: ConnectionManager,
    private readonly sink: SessionEventSink,
    private readonly lookupConnection?: ConnectionNameLookup
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
    // 滚动缓冲：解码后按行拆分（与终端显示共用同一字节流）。
    // 没有换行符的尾段留到下次拼接，避免 cat/tail 的同一行被拆成多条；
    // 超长行只保留尾部，防止无换行的大文件输出撑爆内存。
    session.lineCarry += session.decoder.write(chunk)
    const lines = session.lineCarry.split('\n')
    session.lineCarry = (lines.pop() ?? '').slice(-MAX_LINE_CARRY)
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
      lineCarry: '',
      decoder: new StringDecoder('utf8'),
      pending: [],
      closedByUser: false,
      attachId: 0
    }
    this.sessions.set(session.id, session)
    this.setStatus(session, 'connecting')
    void this.attachShell(session)
    return { sessionId: session.id }
  }

  private async attachShell(session: TerminalSession): Promise<void> {
    const attachId = ++session.attachId
    const started = Date.now()
    let handle: ClientHandle | null = null
    /** 本次附加是否仍然是会话当前的有效附加 */
    const stale = (): boolean => session.attachId !== attachId || !this.sessions.has(session.id)
    try {
      handle = await this.connections.acquire(session.connectionId)
      if (stale()) {
        // 会话已关闭，或期间又发起了重连：放弃本次连接，避免覆盖新通道。
        // 用 release 而非 drop：池中 client 可能正被后发起的那次附加复用。
        handle.release()
        return
      }
      // 若渲染层在连接建立前已上报过窗口尺寸，直接用真实尺寸打开新 shell；
      // 否则先按 80x24 打开，随后的 resize 会立即通过 setWindow 补上
      const { cols, rows } = session.size ?? { cols: 80, rows: 24 }
      const stream = await openShell(handle.client, cols, rows)
      console.log(
        `[timing] 会话 ${session.id} 建连 ${Date.now() - started}ms，开 shell ${Date.now() - started}ms`
      )
      if (stale()) {
        stream.close()
        if (this.sessions.has(session.id)) handle.release()
        else handle.drop()
        return
      }
      session.handle = handle
      session.stream = stream
      this.setStatus(session, 'connected')
      void this.armAutoCd(session, stream)
      stream.on('data', (d: Buffer) => {
        // 重连后旧通道可能还会吐出迟到的数据，不能混进新终端的缓冲
        if (session.stream !== stream) return
        session.pending.push(d)
        this.scheduleFlush(session)
        this.touchAutoCd(session)
      })
      stream.on('close', () => {
        this.flush(session)
        // 通道已被重连或用户关闭替换过：那条路径已经结算过句柄，不能重复计数
        if (session.stream !== stream) return
        this.clearAutoCd(session)
        session.stream = null
        session.handle = null
        if (!session.closedByUser) {
          // 远端主动断开说明会话已终止（堡垒机会整体拆除 SSH 会话），
          // 放弃引用；若该连接仍被其它会话（如同主机的其它分屏）持有则保留连接
          handle?.drop()
          this.setStatus(session, 'disconnected')
        }
      })
      stream.on('error', () => {
        /* close 事件会跟随触发，统一在 close 中处理 */
      })
    } catch (err) {
      handle?.release()
      // 过期的附加失败不得改写已被重连接管的状态
      if (stale()) return
      session.stream = null
      session.handle = null
      this.setStatus(session, 'error', describeSshError(err as Error))
    }
  }

  /**
   * 连接名命中 AUTO_CD_RULES 时，等 shell 输出静默（提示符就绪）后写入 cd 命令。
   * 等待静默是为了避开横幅与堡垒机握手期，避免命令被吞掉或与输出交叉。
   */
  private async armAutoCd(session: TerminalSession, stream: ClientChannel): Promise<void> {
    if (!this.lookupConnection) return
    let name: string
    try {
      const meta = await this.lookupConnection(session.connectionId)
      if (!meta) return
      name = meta.name.toLowerCase()
    } catch {
      return
    }
    const rule = AUTO_CD_RULES.find((r) => name.includes(r.nameIncludes))
    // 查询期间会话可能已关闭、通道已被重连替换，或用户已经开始输入
    if (!rule || !this.sessions.has(session.id) || session.stream !== stream || session.userInput)
      return
    session.autoCd = { directory: rule.directory }
    session.autoCd.idleTimer = setTimeout(() => this.runAutoCd(session), AUTO_CD_IDLE_MS)
  }

  private touchAutoCd(session: TerminalSession): void {
    const autoCd = session.autoCd
    if (!autoCd) return
    clearTimeout(autoCd.idleTimer)
    autoCd.idleTimer = setTimeout(() => this.runAutoCd(session), AUTO_CD_IDLE_MS)
  }

  private runAutoCd(session: TerminalSession): void {
    const autoCd = session.autoCd
    if (!autoCd) return
    this.clearAutoCd(session)
    if (!this.sessions.has(session.id) || !session.stream || session.userInput) return
    session.stream.write(`cd ${autoCd.directory}\r`)
  }

  private clearAutoCd(session: TerminalSession): void {
    const autoCd = session.autoCd
    if (!autoCd) return
    session.autoCd = undefined
    clearTimeout(autoCd.idleTimer)
  }

  input(sessionId: string, data: Uint8Array): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // 用户一旦开始手输，就不再自动注入 cd，避免命令与输入交错
    session.userInput = true
    this.clearAutoCd(session)
    if (session.stream) session.stream.write(Buffer.from(data))
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // 连接建立前也记住尺寸，供 openShell / 重连使用
    session.size = { cols, rows }
    if (session.stream) session.stream.setWindow(rows, cols, 0, 0)
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.closedByUser = true
    this.flush(session)
    this.clearAutoCd(session)
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
    // 让仍在建立中的旧附加立即过期，避免其晚到的连接覆盖本次重连
    session.attachId++
    this.clearAutoCd(session)
    // 先推完旧通道的残余输出；解码器可能停在半个多字节字符上，重连后重置
    this.flush(session)
    session.decoder = new StringDecoder('utf8')
    session.lineCarry = ''
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
    // 未换行的行尾（通常是当前提示符）也要返回，否则 AI 分析看不到最新状态
    const all = session.lineCarry ? [...session.scrollback, session.lineCarry] : session.scrollback
    return {
      lines: all.slice(-n),
      totalLines: all.length
    }
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }
}
