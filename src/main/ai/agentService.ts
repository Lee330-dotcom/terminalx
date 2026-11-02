import { randomUUID } from 'crypto'
import { AiChatEvent, AiChatStartRequest, AiChatToolResult, ExecCommandResult } from '@shared/types'
import { ConnectionStore } from '../store/connectionStore'
import { CredentialVault } from '../store/credentialVault'
import { SettingsStore } from '../store/settingsStore'
import { SessionManager } from '../ssh/sessionManager'
import { truncateExecOutput } from '../mcp/mcpService'
import { AI_KEY_ID } from './aiService'
import { evaluateCommand } from './commandPolicy'
import { agentSystemPrompt } from './prompts'

export const MAX_TOOL_STEPS = 8
export const AGENT_EXEC_TIMEOUT_MS = 60_000
export const MODEL_TIMEOUT_MS = 120_000

const MAX_HISTORY_MESSAGES = 60
const MAX_ERROR_BODY = 500
const APPROVAL_POLL_MS = 1_500

export interface AgentToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: AgentToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface AgentTurn {
  content: string
  toolCalls: AgentToolCall[]
  finishReason: string | null
}

export interface AgentServiceDeps {
  settings: SettingsStore
  vault: CredentialVault
  sessions: SessionManager
  connections: ConnectionStore
  exec(connectionId: string, command: string, timeoutMs: number): Promise<ExecCommandResult>
}

export interface AgentEventSink {
  emit(ev: AiChatEvent): void
}

interface ResolvedConfig {
  baseUrl: string
  model: string
  apiKey: string
}

type AbortKind = 'cancel' | 'replaced' | 'timeout' | 'disconnect'

interface RunState {
  requestId: string
  sessionId: string
  connectionId: string
  controller: AbortController
  abort: { kind: AbortKind; message?: string } | null
  pending: Map<string, (approved: boolean) => void>
  doneEmitted: boolean
}

class AgentAbortError extends Error {}

const DONE_MARKER = Symbol('sse-done')

interface ToolCallBuffer {
  id: string
  name: string
  args: string
}

/** 解析流式 Chat Completions：累积 content 增量与 tool_calls 分片。 */
export class AgentSseParser {
  private buffer = ''
  private finished = false
  private content = ''
  private finishReason: string | null = null
  private calls = new Map<number, ToolCallBuffer>()

  push(chunk: string): { deltas: string[]; done: boolean } {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    const deltas: string[] = []
    for (const line of lines) {
      const result = this.parseLine(line)
      if (result === DONE_MARKER) {
        this.finished = true
        break
      }
      deltas.push(...result)
    }
    return { deltas, done: this.finished }
  }

  flush(): string[] {
    if (this.finished || !this.buffer) return []
    const result = this.parseLine(this.buffer)
    this.buffer = ''
    if (result === DONE_MARKER) {
      this.finished = true
      return []
    }
    return result
  }

  result(): AgentTurn {
    const toolCalls = [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, call]) => ({
        id: call.id || `call_${index}_${randomUUID().slice(0, 8)}`,
        type: 'function' as const,
        function: { name: call.name, arguments: call.args }
      }))
      .filter((call) => call.function.name)
    return { content: this.content, toolCalls, finishReason: this.finishReason }
  }

  private parseLine(line: string): string[] | typeof DONE_MARKER {
    if (!line.startsWith('data:')) return []
    const payload = line.slice(5).trim()
    if (!payload) return []
    if (payload === '[DONE]') return DONE_MARKER
    try {
      const parsed = JSON.parse(payload) as {
        choices?: {
          delta?: {
            content?: string | null
            tool_calls?: {
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }[]
          }
          finish_reason?: string | null
        }[]
      }
      const choice = parsed.choices?.[0]
      const delta = choice?.delta
      if (choice?.finish_reason) this.finishReason = choice.finish_reason
      const out: string[] = []
      if (typeof delta?.content === 'string' && delta.content) {
        this.content += delta.content
        out.push(delta.content)
      }
      for (const part of delta?.tool_calls ?? []) {
        const index = part.index ?? this.calls.size
        const call = this.calls.get(index) ?? { id: '', name: '', args: '' }
        if (part.id) call.id = part.id
        if (part.function?.name) call.name += part.function.name
        if (part.function?.arguments) call.args += part.function.arguments
        this.calls.set(index, call)
      }
      return out
    } catch {
      // 部分网关会插入非 JSON 的调试行，忽略即可
      return []
    }
  }
}

export function parseToolArguments(raw: string): { command?: string; purpose?: string } {
  try {
    const value = JSON.parse(raw || '{}') as unknown
    if (!value || typeof value !== 'object') return {}
    const obj = value as Record<string, unknown>
    return {
      command: typeof obj.command === 'string' ? obj.command : undefined,
      purpose: typeof obj.purpose === 'string' ? obj.purpose : undefined
    }
  } catch {
    return {}
  }
}

const EXEC_TOOL = {
  type: 'function',
  function: {
    name: 'execute_command',
    description:
      '在用户当前 SSH 连接上执行一条单行命令并返回输出。只读命令可直接执行；写入或变更类命令会先请用户确认。该通道独立于用户终端。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的单行 shell 命令' },
        purpose: { type: 'string', description: '一句话说明执行目的' }
      },
      required: ['command', 'purpose'],
      additionalProperties: false
    }
  }
} as const

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function formatToolResult(result: AiChatToolResult): string {
  return JSON.stringify(
    {
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exitCode,
      truncated: result.truncated,
      duration_ms: result.durationMs
    },
    null,
    2
  )
}

/**
 * 全自动助手：模型通过 execute_command 工具收集信息，主进程负责
 * 白名单判定、审批挂起、步数上限与取消。执行复用独立 exec 通道，
 * 不向用户终端写入任何内容。
 */
export class AgentService {
  private histories = new Map<string, AgentMessage[]>()
  private runs = new Map<string, RunState>()
  private sessionRuns = new Map<string, string>()

  constructor(
    private readonly deps: AgentServiceDeps,
    private readonly sink: AgentEventSink
  ) {}

  async start(request: AiChatStartRequest): Promise<void> {
    const text = request.text.trim()
    if (!text) throw new Error('请输入要处理的问题或指令')
    const config = await this.resolveConfig()
    const session = this.deps.sessions.list().find((s) => s.id === request.sessionId)
    if (!session || session.status !== 'connected') {
      throw new Error('会话不可用，请先连接后再使用助手')
    }
    if (request.connectionId && request.connectionId !== session.connectionId) {
      throw new Error('会话与连接不匹配，请刷新后重试')
    }
    this.abortSessionRun(request.sessionId, { kind: 'replaced' })
    const meta = (await this.deps.connections.listConnections()).find(
      (c) => c.id === session.connectionId
    )
    let history = this.histories.get(request.sessionId)
    if (!history) {
      history = [
        {
          role: 'system',
          content: agentSystemPrompt({
            connectionName: meta?.name,
            host: meta?.host,
            port: meta?.port,
            username: meta?.username,
            maxSteps: MAX_TOOL_STEPS
          })
        }
      ]
      this.histories.set(request.sessionId, history)
    }
    history.push({ role: 'user', content: text })
    const run: RunState = {
      requestId: request.requestId,
      sessionId: request.sessionId,
      connectionId: session.connectionId,
      controller: new AbortController(),
      abort: null,
      pending: new Map(),
      doneEmitted: false
    }
    this.runs.set(request.requestId, run)
    this.sessionRuns.set(request.sessionId, request.requestId)
    void this.runLoop(run, config, history)
  }

  approve(requestId: string, callId: string, approved: boolean): void {
    this.runs.get(requestId)?.pending.get(callId)?.(approved)
  }

  cancel(requestId: string): void {
    const run = this.runs.get(requestId)
    if (run) this.abortRun(run, { kind: 'cancel' })
  }

  reset(sessionId: string): void {
    this.abortSessionRun(sessionId, { kind: 'cancel' })
    this.histories.delete(sessionId)
  }

  private abortSessionRun(sessionId: string, abort: { kind: AbortKind; message?: string }): void {
    for (const run of this.runs.values()) {
      if (run.sessionId === sessionId) this.abortRun(run, abort)
    }
  }

  private abortRun(run: RunState, abort: { kind: AbortKind; message?: string }): void {
    if (run.abort) return
    run.abort = abort
    run.controller.abort()
    for (const [callId, resolve] of run.pending) {
      run.pending.delete(callId)
      resolve(false)
    }
    // 执行中的 exec 无法中断，先立即结束界面上的任务，迟到结果会被忽略
    if (abort.kind === 'cancel' || abort.kind === 'replaced') {
      this.finish(run, { type: 'done', requestId: run.requestId, cancelled: true })
    } else {
      this.finish(run, {
        type: 'done',
        requestId: run.requestId,
        error: abort.message ?? '任务已中断'
      })
    }
  }

  private finish(run: RunState, ev: Extract<AiChatEvent, { type: 'done' }>): void {
    if (run.doneEmitted) return
    run.doneEmitted = true
    this.sink.emit(ev)
  }

  private throwIfAborted(run: RunState): void {
    if (run.abort) throw new AgentAbortError()
  }

  private async runLoop(
    run: RunState,
    config: ResolvedConfig,
    history: AgentMessage[]
  ): Promise<void> {
    try {
      let steps = 0
      let limitAnnounced = false
      while (true) {
        this.throwIfAborted(run)
        this.assertSessionConnected(run)
        const toolsEnabled = steps < MAX_TOOL_STEPS
        const turn = await this.requestModel(run, config, history, toolsEnabled)
        this.throwIfAborted(run)
        history.push({
          role: 'assistant',
          content: turn.content || null,
          ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {})
        })
        if (turn.toolCalls.length === 0) {
          if (!turn.content.trim()) {
            throw new Error(
              turn.finishReason === 'length' ? '模型输出被截断，请重试' : '模型没有返回内容'
            )
          }
          break
        }
        for (const call of turn.toolCalls) {
          this.throwIfAborted(run)
          if (!toolsEnabled || steps >= MAX_TOOL_STEPS) {
            const reason = `已达到本次任务 ${MAX_TOOL_STEPS} 次命令上限，未执行`
            const args = parseToolArguments(call.function.arguments)
            this.sink.emit({
              type: 'tool-call',
              requestId: run.requestId,
              callId: call.id,
              command: args.command ?? '',
              purpose: args.purpose ?? '',
              risk: 'unknown',
              requiresApproval: false,
              reason
            })
            this.sink.emit({
              type: 'tool-result',
              requestId: run.requestId,
              callId: call.id,
              ok: false,
              error: reason
            })
            history.push({ role: 'tool', tool_call_id: call.id, content: `${reason}。` })
            continue
          }
          steps++
          await this.handleToolCall(run, call, history)
        }
        if (!toolsEnabled) break
        if (steps >= MAX_TOOL_STEPS && !limitAnnounced) {
          limitAnnounced = true
          this.sink.emit({
            type: 'step-limit',
            requestId: run.requestId,
            limit: MAX_TOOL_STEPS
          })
          history.push({
            role: 'user',
            content: `[系统] 已达到本次任务最多 ${MAX_TOOL_STEPS} 次命令执行上限。不要再调用工具，请基于已有结果给出总结，并说明还需要用户确认的内容。`
          })
        }
        this.trimHistory(history)
      }
      this.trimHistory(history)
      this.finish(run, { type: 'done', requestId: run.requestId })
    } catch (err) {
      if (err instanceof AgentAbortError) {
        const abort = run.abort
        if (abort?.kind === 'cancel' || abort?.kind === 'replaced' || !abort) {
          this.finish(run, { type: 'done', requestId: run.requestId, cancelled: true })
        } else {
          this.finish(run, { type: 'done', requestId: run.requestId, error: abort.message })
        }
      } else {
        this.finish(run, { type: 'done', requestId: run.requestId, error: errorMessage(err) })
      }
    } finally {
      for (const resolve of run.pending.values()) resolve(false)
      run.pending.clear()
      this.runs.delete(run.requestId)
      if (this.sessionRuns.get(run.sessionId) === run.requestId) {
        this.sessionRuns.delete(run.sessionId)
      }
    }
  }

  private async handleToolCall(
    run: RunState,
    call: AgentToolCall,
    history: AgentMessage[]
  ): Promise<void> {
    const args = parseToolArguments(call.function.arguments)
    const command = args.command?.trim() ?? ''
    const purpose = args.purpose?.trim() || '未说明目的'
    if (call.function.name !== 'execute_command') {
      await this.rejectToolCall(
        run,
        call.id,
        command,
        purpose,
        history,
        [`不支持的工具：${call.function.name || '未知'}。`, '请只使用 execute_command。'].join('')
      )
      return
    }
    if (!command) {
      await this.rejectToolCall(run, call.id, command, purpose, history, '工具参数缺少 command。')
      return
    }
    const decision = evaluateCommand(command)
    if (decision.verdict === 'reject') {
      this.sink.emit({
        type: 'tool-call',
        requestId: run.requestId,
        callId: call.id,
        command,
        purpose,
        risk: decision.risk,
        requiresApproval: false,
        reason: decision.reason
      })
      this.emitToolFailure(run, call.id, decision.reason)
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: `本地策略拒绝执行：${decision.reason}。请不要重试该命令。`
      })
      return
    }
    const settings = await this.deps.settings.get()
    const requiresApproval = decision.verdict === 'confirm' || !settings.aiAutoExecute
    const reason = !settings.aiAutoExecute
      ? '自动执行已关闭，所有命令都需要确认'
      : decision.verdict === 'confirm'
        ? decision.reason
        : undefined
    this.sink.emit({
      type: 'tool-call',
      requestId: run.requestId,
      callId: call.id,
      command,
      purpose,
      risk: decision.risk,
      requiresApproval,
      reason
    })
    if (requiresApproval) {
      const approved = await this.waitForApproval(run, call.id)
      this.throwIfAborted(run)
      if (!approved) {
        this.sink.emit({
          type: 'tool-result',
          requestId: run.requestId,
          callId: call.id,
          ok: false,
          rejected: true
        })
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          content: '用户拒绝执行该命令。不要重复提交同一条命令；请说明原因或改用只读方式。'
        })
        return
      }
    }
    await this.executeTool(run, call.id, command, history)
  }

  private async rejectToolCall(
    run: RunState,
    callId: string,
    command: string,
    purpose: string,
    history: AgentMessage[],
    reason: string
  ): Promise<void> {
    this.sink.emit({
      type: 'tool-call',
      requestId: run.requestId,
      callId,
      command,
      purpose,
      risk: 'unknown',
      requiresApproval: false,
      reason
    })
    this.emitToolFailure(run, callId, reason)
    history.push({ role: 'tool', tool_call_id: callId, content: `未执行：${reason}` })
  }

  private emitToolFailure(run: RunState, callId: string, reason: string): void {
    this.sink.emit({
      type: 'tool-result',
      requestId: run.requestId,
      callId,
      ok: false,
      error: reason
    })
  }

  private waitForApproval(run: RunState, callId: string): Promise<boolean> {
    if (run.abort) return Promise.resolve(false)
    return new Promise((resolve) => {
      const finish = (approved: boolean): void => {
        clearInterval(timer)
        run.pending.delete(callId)
        resolve(approved)
      }
      const timer = setInterval(() => {
        if (run.abort) {
          finish(false)
          return
        }
        if (!this.isSessionConnected(run.sessionId)) {
          this.abortRun(run, { kind: 'disconnect', message: '连接已断开，请重新连接后再试' })
        }
      }, APPROVAL_POLL_MS)
      run.pending.set(callId, finish)
      // abort 可能发生在首次检查与注册 resolver 之间，补一次检查
      if (run.abort) finish(false)
    })
  }

  private async executeTool(
    run: RunState,
    callId: string,
    command: string,
    history: AgentMessage[]
  ): Promise<void> {
    try {
      const raw = await this.deps.exec(run.connectionId, command, AGENT_EXEC_TIMEOUT_MS)
      this.throwIfAborted(run)
      const cut = truncateExecOutput(raw.stdout, raw.stderr)
      const result: AiChatToolResult = {
        stdout: cut.stdout,
        stderr: cut.stderr,
        exitCode: raw.exitCode,
        truncated: cut.truncated,
        durationMs: raw.durationMs
      }
      this.sink.emit({
        type: 'tool-result',
        requestId: run.requestId,
        callId,
        ok: true,
        result
      })
      history.push({ role: 'tool', tool_call_id: callId, content: formatToolResult(result) })
    } catch (err) {
      this.throwIfAborted(run)
      const message = errorMessage(err)
      this.sink.emit({
        type: 'tool-result',
        requestId: run.requestId,
        callId,
        ok: false,
        error: message
      })
      history.push({ role: 'tool', tool_call_id: callId, content: `命令执行失败：${message}` })
    }
  }

  private async requestModel(
    run: RunState,
    config: ResolvedConfig,
    messages: AgentMessage[],
    toolsEnabled: boolean
  ): Promise<AgentTurn> {
    const timer = setTimeout(() => {
      this.abortRun(run, {
        kind: 'timeout',
        message: `模型响应超时（${MODEL_TIMEOUT_MS / 1000} 秒）`
      })
    }, MODEL_TIMEOUT_MS)
    try {
      const base = config.baseUrl.replace(/\/+$/, '')
      const body: Record<string, unknown> = {
        model: config.model,
        messages,
        stream: true,
        temperature: 0.2
      }
      if (toolsEnabled) {
        body.tools = [EXEC_TOOL]
        body.tool_choice = 'auto'
      }
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body),
        signal: run.controller.signal
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(
          `模型服务返回 ${res.status}${text ? `：${text.slice(0, MAX_ERROR_BODY)}` : ''}`
        )
      }
      return await this.consume(res, run)
    } catch (err) {
      if (run.abort) throw new AgentAbortError()
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  private async consume(res: Response, run: RunState): Promise<AgentTurn> {
    if (!res.body) throw new Error('模型响应为空')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const parser = new AgentSseParser()
    let doneMarker = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const parsed = parser.push(decoder.decode(value, { stream: true }))
        for (const delta of parsed.deltas) {
          this.sink.emit({ type: 'delta', requestId: run.requestId, delta })
        }
        if (parsed.done) {
          doneMarker = true
          break
        }
      }
      if (!doneMarker) {
        for (const delta of parser.flush()) {
          this.sink.emit({ type: 'delta', requestId: run.requestId, delta })
        }
      }
      return parser.result()
    } catch (err) {
      if (run.abort) throw new AgentAbortError()
      throw err
    } finally {
      if (run.abort || doneMarker) await reader.cancel().catch(() => {})
    }
  }

  private isSessionConnected(sessionId: string): boolean {
    return this.deps.sessions
      .list()
      .some((session) => session.id === sessionId && session.status === 'connected')
  }

  private assertSessionConnected(run: RunState): void {
    if (!this.isSessionConnected(run.sessionId)) {
      throw new Error('会话已断开，请重新连接后再试')
    }
  }

  private trimHistory(history: AgentMessage[]): void {
    if (history.length <= MAX_HISTORY_MESSAGES) return
    let start = history.length - MAX_HISTORY_MESSAGES
    while (start < history.length && history[start].role !== 'user') start++
    if (start < history.length) history.splice(1, start - 1)
  }

  private async resolveConfig(): Promise<ResolvedConfig> {
    const settings = await this.deps.settings.get()
    const secret = await this.deps.vault.get(AI_KEY_ID)
    const apiKey = secret?.apiKey ?? ''
    const baseUrl = settings.aiBaseUrl.trim()
    const model = settings.aiModel.trim()
    const missing: string[] = []
    if (!baseUrl) missing.push('服务地址')
    if (!model) missing.push('模型名')
    if (!apiKey) missing.push('API Key（输入后需点击保存）')
    if (missing.length > 0) {
      throw new Error(`AI 配置不完整，缺少：${missing.join('、')}`)
    }
    return { baseUrl, model, apiKey }
  }
}
