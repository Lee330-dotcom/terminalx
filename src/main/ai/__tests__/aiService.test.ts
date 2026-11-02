import { describe, it, expect, vi, afterEach } from 'vitest'
import { AiChunkEvent, AiDoneEvent, ConnectionMeta } from '@shared/types'
import {
  AiService,
  COMMAND_CONTEXT_LINE_LIMIT,
  SseDeltaParser,
  SUMMARY_LINE_LIMIT
} from '../aiService'

const META: ConnectionMeta = {
  id: 'c1',
  name: 'helink-pro',
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

interface Harness {
  ai: AiService
  chunks: AiChunkEvent[]
  dones: AiDoneEvent[]
  readLines: ReturnType<typeof vi.fn>
}

function makeService(
  opts: { apiKey?: string | null; lines?: string[]; sessionExists?: boolean } = {}
): Harness {
  const chunks: AiChunkEvent[] = []
  const dones: AiDoneEvent[] = []
  const settings = {
    get: async () => ({ aiBaseUrl: 'http://ai.local/v1/', aiModel: 'test-model' })
  }
  const vault = {
    get: async () => (opts.apiKey === null ? null : { apiKey: opts.apiKey ?? 'sk-test' }),
    set: vi.fn(),
    delete: vi.fn()
  }
  const connections = { listConnections: async () => [META] }
  const readLines = vi.fn(() => ({
    lines: opts.lines ?? ['line-a', 'line-b'],
    totalLines: (opts.lines ?? []).length
  }))
  const sessions = { has: () => opts.sessionExists ?? true, readLines }
  const ai = new AiService({ settings, vault, connections, sessions } as never, {
    emitChunk: (ev) => chunks.push(ev),
    emitDone: (ev) => dones.push(ev)
  })
  return { ai, chunks, dones, readLines }
}

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c))
        controller.close()
      }
    }),
    { status, headers: { 'Content-Type': 'text/event-stream' } }
  )
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitUntil timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SseDeltaParser', () => {
  it('跨分片解析增量并识别 [DONE]', () => {
    const parser = new SseDeltaParser()
    const first = parser.push('data: {"choices":[{"delta":{"content":"你')
    expect(first.deltas).toEqual([])
    const second = parser.push('好"}}]}\n\ndata: {"choices":[{"delta":{"content":"世界"}}]}\n\n')
    expect(second.deltas).toEqual(['你好', '世界'])
    const third = parser.push('data: [DONE]\n\n')
    expect(third.done).toBe(true)
  })

  it('忽略非 data 行与非法 JSON，flush 处理无换行结尾', () => {
    const parser = new SseDeltaParser()
    expect(parser.push(': ping\n\nnot-json\n').deltas).toEqual([])
    expect(parser.push('data: {"choices":[{"delta":{"content":"尾"}}]}').deltas).toEqual([])
    expect(parser.flush()).toEqual(['尾'])
  })
})

describe('AiService', () => {
  it('未配置密钥时 analyze 直接报错且不发请求', async () => {
    const { ai } = makeService({ apiKey: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      ai.analyze({ requestId: 'r1', kind: 'selection-explanation', selection: 'x' })
    ).rejects.toThrow('缺少：API Key')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('流式返回选段解释结果', async () => {
    const harness = makeService()
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"结论："}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"正常"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    )
    vi.stubGlobal('fetch', fetchMock)
    await harness.ai.analyze({
      requestId: 'r1',
      kind: 'selection-explanation',
      selection: 'hello',
      connectionId: 'c1'
    })
    await waitUntil(() => harness.dones.length > 0)
    expect(harness.chunks.map((c) => c.delta).join('')).toBe('结论：正常')
    expect(harness.dones[0]).toEqual({ requestId: 'r1' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://ai.local/v1/chat/completions')
  })

  it('摘要读取最近 300 行并写入请求体', async () => {
    const harness = makeService({ lines: ['ERROR boom'] })
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      sseResponse(['data: [DONE]\n\n'])
    )
    vi.stubGlobal('fetch', fetchMock)
    await harness.ai.analyze({
      requestId: 'r2',
      kind: 'session-summary',
      sessionId: 's1',
      connectionId: 'c1'
    })
    await waitUntil(() => harness.dones.length > 0)
    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body)
    expect(body).toContain('ERROR boom')
    expect(body).toContain('helink-pro')
    expect(harness.readLines).toHaveBeenCalledWith('s1', SUMMARY_LINE_LIMIT)
  })

  it('命令建议读取最近 120 行并携带指令', async () => {
    const harness = makeService({ lines: ['ERROR boom'] })
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      sseResponse(['data: [DONE]\n\n'])
    )
    vi.stubGlobal('fetch', fetchMock)
    await harness.ai.analyze({
      requestId: 'r6',
      kind: 'command-suggestion',
      sessionId: 's1',
      connectionId: 'c1',
      instruction: '查看最近一小时 ERROR 日志'
    })
    await waitUntil(() => harness.dones.length > 0)
    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body)
    expect(body).toContain('查看最近一小时 ERROR 日志')
    expect(body).toContain('ERROR boom')
    expect(body).toContain('helink-pro')
    expect(harness.readLines).toHaveBeenCalledWith('s1', COMMAND_CONTEXT_LINE_LIMIT)
  })

  it('命令建议缺少指令或会话时直接报错', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      makeService().ai.analyze({
        requestId: 'r7',
        kind: 'command-suggestion',
        sessionId: 's1',
        instruction: '   '
      })
    ).rejects.toThrow('请先描述要做什么')
    await expect(
      makeService({ sessionExists: false }).ai.analyze({
        requestId: 'r8',
        kind: 'command-suggestion',
        sessionId: 'gone',
        instruction: '看日志'
      })
    ).rejects.toThrow('会话不可用')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('会话不存在时拒绝摘要请求', async () => {
    const harness = makeService({ sessionExists: false })
    await expect(
      harness.ai.analyze({ requestId: 'r3', kind: 'session-summary', sessionId: 'gone' })
    ).rejects.toThrow('会话不可用')
  })

  it('诊断请求不携带密码或私钥内容', async () => {
    const harness = makeService()
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      sseResponse(['data: [DONE]\n\n'])
    )
    vi.stubGlobal('fetch', fetchMock)
    await harness.ai.analyze({
      requestId: 'r4',
      kind: 'connection-diagnosis',
      connectionId: 'c1',
      errorMessage: '认证失败'
    })
    await waitUntil(() => harness.dones.length > 0)
    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body)
    expect(body).toContain('10.0.0.8')
    expect(body).not.toContain('sk-test')
    expect(body).not.toMatch(/password|passphrase|privateKey/i)
  })

  it('HTTP 错误通过 done 事件返回', async () => {
    const harness = makeService()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 }))
    )
    await harness.ai.analyze({
      requestId: 'r5',
      kind: 'selection-explanation',
      selection: 'x'
    })
    await waitUntil(() => harness.dones.length > 0)
    expect(harness.dones[0].error).toContain('500')
  })

  it('取消请求后 done 事件标记 cancelled', async () => {
    const harness = makeService()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal
      const stream = new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () =>
            controller.error(new DOMException('Aborted', 'AbortError'))
          )
        }
      })
      return Promise.resolve(new Response(stream, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await harness.ai.analyze({
      requestId: 'r6',
      kind: 'selection-explanation',
      selection: 'x'
    })
    harness.ai.cancel('r6')
    await waitUntil(() => harness.dones.length > 0)
    expect(harness.dones[0]).toEqual({ requestId: 'r6', cancelled: true })
  })
})
