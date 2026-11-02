import { describe, it, expect, vi, afterEach } from 'vitest'
import { AiChatEvent, ConnectionMeta, ExecCommandResult } from '@shared/types'
import {
  AGENT_EXEC_TIMEOUT_MS,
  AgentService,
  AgentSseParser,
  MAX_TOOL_STEPS,
  parseToolArguments
} from '../agentService'

const META: ConnectionMeta = {
  id: 'c1',
  name: 'demo-server',
  groupId: null,
  host: '10.0.0.8',
  port: 22,
  username: 'ops',
  authType: 'password',
  remark: '',
  color: '#409eff',
  favorite: false,
  createdAt: 0,
  updatedAt: 0,
  timeoutMs: null
}

const EXEC_OK: ExecCommandResult = {
  stdout: 'exec-out',
  stderr: '',
  exitCode: 0,
  truncated: false,
  durationMs: 5
}

interface Harness {
  ai: AgentService
  events: AiChatEvent[]
  exec: ReturnType<typeof vi.fn>
}

interface MakeOptions {
  autoExecute?: boolean
  apiKey?: string | null
  sessionStatus?: string
  execError?: Error
}

function makeHarness(opts: MakeOptions = {}): Harness {
  const events: AiChatEvent[] = []
  const settings = {
    get: async () => ({
      aiBaseUrl: 'http://ai.local/v1/',
      aiModel: 'test-model',
      aiAutoExecute: opts.autoExecute ?? true
    })
  }
  const vault = {
    get: async () => (opts.apiKey === null ? null : { apiKey: 'sk-test' }),
    set: vi.fn(),
    delete: vi.fn()
  }
  const sessions = {
    list: () =>
      opts.sessionStatus === 'missing'
        ? []
        : [
            {
              id: 's1',
              connectionId: 'c1',
              title: 'demo-server',
              status: opts.sessionStatus ?? 'connected'
            }
          ]
  }
  const exec = vi.fn(async () => {
    if (opts.execError) throw opts.execError
    return EXEC_OK
  })
  const connections = { listConnections: async () => [META] }
  const ai = new AgentService({ settings, vault, sessions, connections, exec } as never, {
    emit: (ev) => events.push(ev)
  })
  return { ai, events, exec }
}

function sse(payloadLines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of payloadLines) controller.enqueue(encoder.encode(line))
        controller.close()
      }
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  )
}

function data(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`
}

function textTurn(text: string): Response {
  return sse([
    data({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }),
    'data: [DONE]\n\n'
  ])
}

interface ToolTurnOptions {
  content?: string
  callId?: string
  splitAt?: number
}

function toolTurn(command: string, purpose: string, opts: ToolTurnOptions = {}): Response {
  const args = JSON.stringify({ command, purpose })
  const split = opts.splitAt ?? Math.floor(args.length / 2)
  return sse([
    data({ choices: [{ delta: { content: opts.content ?? '' } }] }),
    data({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: opts.callId ?? 'call_1',
                type: 'function',
                function: { name: 'execute_command', arguments: args.slice(0, split) }
              }
            ]
          }
        }
      ]
    }),
    data({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: args.slice(split) } }]
          },
          finish_reason: 'tool_calls'
        }
      ]
    }),
    'data: [DONE]\n\n'
  ])
}

function stubFetch(responses: Response[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    return responses.shift() ?? textTurn('完成')
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function requestBody(
  mock: ReturnType<typeof vi.fn>,
  index: number
): { messages: { role: string; content: string }[]; tools?: unknown } {
  const init = mock.mock.calls[index][1] as RequestInit
  return JSON.parse(String(init.body)) as {
    messages: { role: string; content: string }[]
    tools?: unknown
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitUntil timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

function doneEvent(events: AiChatEvent[]): Extract<AiChatEvent, { type: 'done' }> {
  const done = events.find((e) => e.type === 'done')
  if (!done || done.type !== 'done') throw new Error('done event not found')
  return done
}

function toolCallEvent(events: AiChatEvent[]): Extract<AiChatEvent, { type: 'tool-call' }> {
  const call = events.find((e) => e.type === 'tool-call')
  if (!call || call.type !== 'tool-call') throw new Error('tool-call event not found')
  return call
}

function toolResultEvent(events: AiChatEvent[]): Extract<AiChatEvent, { type: 'tool-result' }> {
  const result = events.find((e) => e.type === 'tool-result')
  if (!result || result.type !== 'tool-result') throw new Error('tool-result event not found')
  return result
}

const REQUEST = { requestId: 'r1', sessionId: 's1', connectionId: 'c1', text: '检查磁盘' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AgentSseParser', () => {
  it('跨分片累积文本与工具调用参数', () => {
    const parser = new AgentSseParser()
    const args = JSON.stringify({ command: 'df -h', purpose: '查看磁盘' })
    const line1 = data({ choices: [{ delta: { content: '检查' } }] })
    const line2 = data({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_a',
                type: 'function',
                function: { name: 'execute_command', arguments: args.slice(0, 5) }
              }
            ]
          }
        }
      ]
    })
    const line3 = data({
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] },
          finish_reason: 'tool_calls'
        }
      ]
    })
    const cut = line1.length + 18
    const all = line1 + line2 + line3 + 'data: [DONE]\n\n'
    const first = parser.push(all.slice(0, cut))
    expect(first.deltas).toEqual(['检查'])
    const second = parser.push(all.slice(cut))
    expect(second.done).toBe(true)
    const result = parser.result()
    expect(result.content).toBe('检查')
    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].id).toBe('call_a')
    expect(result.toolCalls[0].function.name).toBe('execute_command')
    expect(result.toolCalls[0].function.arguments).toBe(args)
  })

  it('忽略非法 JSON 行', () => {
    const parser = new AgentSseParser()
    expect(parser.push(': ping\ndata: not-json\n').deltas).toEqual([])
  })
})

describe('parseToolArguments', () => {
  it('解析合法参数并容忍非法输入', () => {
    expect(parseToolArguments('{"command":"ls","purpose":"列目录"}')).toEqual({
      command: 'ls',
      purpose: '列目录'
    })
    expect(parseToolArguments('')).toEqual({})
    expect(parseToolArguments('not-json')).toEqual({})
    expect(parseToolArguments('{"command":1}')).toEqual({ command: undefined, purpose: undefined })
  })
})

describe('AgentService', () => {
  it('只读白名单命令自动执行并回填结果', async () => {
    const harness = makeHarness()
    const fetchMock = stubFetch([
      toolTurn('df -h', '查看磁盘', { content: '先看磁盘' }),
      textTurn('结论：磁盘正常')
    ])
    await harness.ai.start(REQUEST)
    await waitUntil(() => harness.events.some((e) => e.type === 'done'))
    expect(harness.exec).toHaveBeenCalledTimes(1)
    expect(harness.exec).toHaveBeenCalledWith('c1', 'df -h', AGENT_EXEC_TIMEOUT_MS)
    const call = toolCallEvent(harness.events)
    expect(call.requiresApproval).toBe(false)
    expect(call.risk).toBe('low')
    const result = toolResultEvent(harness.events)
    expect(result.ok).toBe(true)
    expect(result.result?.stdout).toBe('exec-out')
    expect(
      harness.events
        .filter((e) => e.type === 'delta')
        .map((e) => (e.type === 'delta' ? e.delta : ''))
        .join('')
    ).toBe('先看磁盘结论：磁盘正常')
    expect(doneEvent(harness.events)).toEqual({ type: 'done', requestId: 'r1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = requestBody(fetchMock, 1)
    expect(second.messages.at(-1)?.role).toBe('tool')
    expect(second.messages.at(-1)?.content).toContain('exec-out')
    expect(JSON.stringify(harness.events)).not.toContain('sk-test')
  })

  it('关闭自动执行时只读命令也需审批，批准后执行', async () => {
    const harness = makeHarness({ autoExecute: false })
    stubFetch([toolTurn('ls -la', '查看目录'), textTurn('完成')])
    await harness.ai.start(REQUEST)
    await waitUntil(() => harness.events.some((e) => e.type === 'tool-call'))
    const call = toolCallEvent(harness.events)
    expect(call.requiresApproval).toBe(true)
    expect(call.reason).toContain('自动执行已关闭')
    expect(harness.exec).not.toHaveBeenCalled()
    harness.ai.approve('r1', call.callId, true)
    await waitUntil(() => harness.events.some((e) => e.type === 'done'))
    expect(harness.exec).toHaveBeenCalledTimes(1)
    expect(toolResultEvent(harness.events).ok).toBe(true)
  })

  it('用户拒绝后不执行，并把拒绝结果回填给模型', async () => {
    const harness = makeHarness({ autoExecute: false })
    const fetchMock = stubFetch([
      toolTurn('rm -rf /tmp/x', '清理临时文件'),
      textTurn('已改为只读方案')
    ])
    await harness.ai.start({ ...REQUEST, text: '清理一下' })
    await waitUntil(() => harness.events.some((e) => e.type === 'tool-call'))
    const call = toolCallEvent(harness.events)
    expect(call.requiresApproval).toBe(true)
    harness.ai.approve('r1', call.callId, false)
    await waitUntil(() => harness.events.some((e) => e.type === 'done'))
    expect(harness.exec).not.toHaveBeenCalled()
    const result = toolResultEvent(harness.events)
    expect(result.rejected).toBe(true)
    expect(result.ok).toBe(false)
    const second = requestBody(fetchMock, 1)
    expect(second.messages.at(-1)?.role).toBe('tool')
    expect(second.messages.at(-1)?.content).toContain('用户拒绝执行')
  })

  it('策略拒绝多行命令且不触发审批', async () => {
    const harness = makeHarness()
    const fetchMock = stubFetch([
      toolTurn('ls\ncat /etc/hosts', '组合命令'),
      textTurn('已改用单行命令')
    ])
    await harness.ai.start(REQUEST)
    await waitUntil(() => harness.events.some((e) => e.type === 'done'))
    expect(harness.exec).not.toHaveBeenCalled()
    const call = toolCallEvent(harness.events)
    expect(call.requiresApproval).toBe(false)
    const result = toolResultEvent(harness.events)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('多行')
    const second = requestBody(fetchMock, 1)
    expect(second.messages.at(-1)?.content).toContain('本地策略拒绝执行')
  })

  it(`达到 ${MAX_TOOL_STEPS} 步后禁用工具并要求总结`, async () => {
    const harness = makeHarness()
    const responses: Response[] = []
    for (let i = 1; i <= MAX_TOOL_STEPS; i++) {
      responses.push(toolTurn('ls', `第 ${i} 步`, { callId: `call_${i}` }))
    }
    responses.push(textTurn('总结：已收集完毕'))
    const fetchMock = stubFetch(responses)
    await harness.ai.start(REQUEST)
    await waitUntil(() => harness.events.some((e) => e.type === 'done'), 5000)
    expect(harness.exec).toHaveBeenCalledTimes(MAX_TOOL_STEPS)
    expect(harness.events.some((e) => e.type === 'step-limit')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(MAX_TOOL_STEPS + 1)
    const last = requestBody(fetchMock, MAX_TOOL_STEPS)
    expect(last.tools).toBeUndefined()
    expect(last.messages.at(-1)?.content).toContain('上限')
    expect(doneEvent(harness.events).error).toBeUndefined()
  })

  it('审批期间取消立即结束且忽略迟到的批准', async () => {
    const harness = makeHarness({ autoExecute: false })
    stubFetch([toolTurn('ls', '查看目录'), textTurn('不会执行')])
    await harness.ai.start(REQUEST)
    await waitUntil(() => harness.events.some((e) => e.type === 'tool-call'))
    const call = toolCallEvent(harness.events)
    harness.ai.cancel('r1')
    await waitUntil(() => harness.events.some((e) => e.type === 'done'))
    expect(doneEvent(harness.events).cancelled).toBe(true)
    harness.ai.approve('r1', call.callId, true)
    await new Promise((r) => setTimeout(r, 50))
    expect(harness.exec).not.toHaveBeenCalled()
    expect(harness.events.filter((e) => e.type === 'done')).toHaveLength(1)
  })

  it('执行失败作为工具错误回填，不中断对话', async () => {
    const harness = makeHarness({ execError: new Error('命令执行超时（60000ms）') })
    const fetchMock = stubFetch([toolTurn('df -h', '查看磁盘'), textTurn('执行失败，请稍后再试')])
    await harness.ai.start(REQUEST)
    await waitUntil(() => harness.events.some((e) => e.type === 'done'))
    const result = toolResultEvent(harness.events)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('超时')
    const second = requestBody(fetchMock, 1)
    expect(second.messages.at(-1)?.content).toContain('命令执行失败')
    expect(doneEvent(harness.events).error).toBeUndefined()
  })

  it('模型 HTTP 错误通过 done 事件返回', async () => {
    const harness = makeHarness()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 }))
    )
    await harness.ai.start(REQUEST)
    await waitUntil(() => harness.events.some((e) => e.type === 'done'))
    expect(doneEvent(harness.events).error).toContain('500')
    expect(harness.exec).not.toHaveBeenCalled()
  })

  it('缺少密钥或会话不可用时直接拒绝启动', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(makeHarness({ apiKey: null }).ai.start(REQUEST)).rejects.toThrow('缺少：API Key')
    await expect(makeHarness({ sessionStatus: 'missing' }).ai.start(REQUEST)).rejects.toThrow(
      '会话不可用'
    )
    await expect(makeHarness({ sessionStatus: 'disconnected' }).ai.start(REQUEST)).rejects.toThrow(
      '会话不可用'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
