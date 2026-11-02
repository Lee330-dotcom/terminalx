import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import puppeteer, { Browser, Page } from 'puppeteer-core'
import { startTestSshServer, TestSshServer } from '../main/ssh/__tests__/testSshServer'

const DEBUG_PORT = 9334
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')
const MOCK_REPLY = '这是 一段 流式 回答'
const MOCK_DELTAS = ['这是 ', '一段 ', '流式 ', '回答']
const COMMAND_DELTAS = [
  '### 1. 统计最近一小时 ERROR 数量\n',
  '风险：低\n',
  '```bash\n',
  'grep -c ERROR app.log\n',
  '```\n'
]
const AGENT_FINAL_DELTAS = ['检查完成：', '系统运行正常。']

interface MockMessage {
  role: string
  content?: string | null
  tool_calls?: unknown[]
}

interface MockRequest {
  url: string
  authorization?: string
  body: { model?: string; messages?: MockMessage[]; tools?: unknown[] }
}

function agentCommandFor(text: string): { command: string; purpose: string } {
  if (text.includes('创建标记文件')) {
    return { command: 'touch /tmp/terminalx-ai-e2e', purpose: '创建标记文件' }
  }
  if (text.includes('删除')) {
    return { command: 'rm -rf /tmp/terminalx-ai-e2e', purpose: '清理标记文件' }
  }
  return { command: 'uptime', purpose: '查看系统运行时间' }
}

function writeAgentToolTurn(res: ServerResponse, call: { command: string; purpose: string }): void {
  const args = JSON.stringify(call)
  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content: '先执行一条命令确认。' } }] })}\n\n`
  )
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_e2e',
                type: 'function',
                function: { name: 'execute_command', arguments: args }
              }
            ]
          }
        }
      ]
    })}\n\n`
  )
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }]
    })}\n\n`
  )
}

interface MockOpenAI {
  port: number
  requests: MockRequest[]
  close(): Promise<void>
}

function startMockOpenAI(): Promise<MockOpenAI> {
  const requests: MockRequest[] = []
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk.toString()))
    req.on('end', () => {
      let body: MockRequest['body'] = {}
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        /* 忽略非法请求体 */
      }
      requests.push({
        url: req.url ?? '',
        authorization: req.headers.authorization,
        body
      })
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const messages = body.messages ?? []
      const isAgent = Array.isArray(body.tools) && body.tools.length > 0
      if (isAgent) {
        const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user')
        const hasToolResult = messages.slice(lastUserIndex + 1).some((m) => m.role === 'tool')
        if (hasToolResult) {
          for (const delta of AGENT_FINAL_DELTAS) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
          }
        } else {
          const lastUser = [...messages].reverse().find((m) => m.role === 'user')
          writeAgentToolTurn(res, agentCommandFor(lastUser?.content ?? ''))
        }
      } else {
        const isCommand = Boolean(messages[0]?.content?.includes('命令助手'))
        for (const delta of isCommand ? COMMAND_DELTAS : MOCK_DELTAS) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
        }
      }
      res.write('data: [DONE]\n\n')
      res.end()
    })
  }
  const server: Server = createServer(handler)
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('mock server 未拿到端口'))
        return
      }
      resolvePromise({
        port: addr.port,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      })
    })
  })
}

let ssh: TestSshServer
let mock: MockOpenAI
let electron: ChildProcess | null = null
let browser: Browser | null = null
let userDataDir: string
let electronLog = ''

async function waitForPage(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`, {
        signal: AbortSignal.timeout(2000)
      })
      const targets = (await res.json()) as { type: string }[]
      if (targets.some((t) => t.type === 'page')) return
    } catch {
      /* electron 尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`timeout waiting for electron page\n${electronLog.slice(-3000)}`)
}

beforeAll(async () => {
  ssh = await startTestSshServer()
  mock = await startMockOpenAI()
  userDataDir = await fs.mkdtemp(join(tmpdir(), 'terminalx-ai-e2e-'))
  // 某些终端环境会设置 ELECTRON_RUN_AS_NODE=1，那会让 Electron 退化成 Node 而不开窗口
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_TLS_REJECT_UNAUTHORIZED: '0'
  }
  delete env.ELECTRON_RUN_AS_NODE
  electron = spawn(
    ELECTRON_BIN,
    [APP_ROOT, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`],
    { env }
  )
  electron.stdout?.on('data', (d) => (electronLog += d.toString()))
  electron.stderr?.on('data', (d) => (electronLog += d.toString()))
  await waitForPage()
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
}, 60000)

afterAll(async () => {
  await browser?.disconnect()
  const proc = electron
  electron = null
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 5000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      proc.kill()
    })
  }
  ssh.close()
  await mock.close()
})

async function getPage(): Promise<Page> {
  const pages = await browser!.pages()
  const page = pages[0]
  await page.bringToFront()
  return page
}

type AiProbe = {
  text: Record<string, string>
  done: Record<string, { requestId: string; error?: string; cancelled?: boolean }>
  sessionDataEvents: number
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __aiProbe?: AiProbe }
    // @ts-ignore window.api 由 preload 注入
    const api = window.api as import('@shared/types').RendererApi
    const probe: AiProbe = { text: {}, done: {}, sessionDataEvents: 0 }
    api.onAiChunk((ev) => {
      probe.text[ev.requestId] = (probe.text[ev.requestId] ?? '') + ev.delta
    })
    api.onAiDone((ev) => {
      probe.done[ev.requestId] = ev
    })
    api.onSessionData(() => {
      probe.sessionDataEvents++
    })
    w.__aiProbe = probe
  })
}

async function runAnalysis(
  page: Page,
  request: {
    requestId: string
    kind: string
    sessionId?: string
    selection?: string
    connectionId?: string
    errorMessage?: string
    instruction?: string
  }
): Promise<{ text: string; done: { error?: string; cancelled?: boolean } }> {
  return page.evaluate(async (req) => {
    // @ts-ignore window.api 由 preload 注入
    const api = window.api as import('@shared/types').RendererApi
    const probe = (window as unknown as { __aiProbe: AiProbe }).__aiProbe
    await api.aiAnalyze(req as import('@shared/types').AiAnalysisRequest)
    const deadline = Date.now() + 30000
    while (!probe.done[req.requestId]) {
      if (Date.now() > deadline) throw new Error(`AI 请求超时：${req.requestId}`)
      await new Promise((r) => setTimeout(r, 50))
    }
    return { text: probe.text[req.requestId] ?? '', done: probe.done[req.requestId] }
  }, request)
}

function lastRequest(): MockRequest {
  const req = mock.requests.at(-1)
  if (!req) throw new Error('mock 服务没有收到请求')
  return req
}

function allMessageText(req: MockRequest): string {
  return (req.body.messages ?? []).map((m) => m.content).join('\n')
}

describe('AI 只读分析（真实 Electron + mock OpenAI 兼容服务）', () => {
  it('三种分析均流式返回，且不向终端写入任何数据', async () => {
    const page = await getPage()
    await installProbe(page)

    // 建立真实 SSH 会话（用于摘要的滚动缓冲）
    const ids = await page.evaluate(
      async ({ port }) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        const conn = await api.createConnection({
          name: 'ai-e2e-测试机',
          groupId: null,
          host: '127.0.0.1',
          port,
          username: 'tester',
          authType: 'password',
          password: 'test-pass'
        })
        const { sessionId } = await api.openSession(conn.id)
        return { connectionId: conn.id, sessionId }
      },
      { port: ssh.port }
    )

    // 等待会话连上并产生欢迎输出
    await page.waitForFunction(
      async (sessionId) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        const sessions = await api.listSessions()
        return sessions.some((s) => s.id === sessionId && s.status === 'connected')
      },
      { timeout: 20000 },
      ids.sessionId
    )
    // 给滚动缓冲留出写入欢迎行的时间
    await new Promise((r) => setTimeout(r, 500))
    // 从这里开始计量终端输出，用于验证后续 AI 分析不会写入终端
    await page.evaluate(() => {
      ;(window as unknown as { __aiProbe: AiProbe }).__aiProbe.sessionDataEvents = 0
    })

    // 配置 AI 服务并写入密钥（仅存凭据库，不经 IPC 回传）
    const status = await page.evaluate(
      async ({ baseUrl }) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        await api.updateSettings({ aiBaseUrl: baseUrl, aiModel: 'mock-model' })
        return api.setAiKey('sk-e2e-key')
      },
      { baseUrl: `http://127.0.0.1:${mock.port}/v1` }
    )
    expect(status.configured).toBe(true)
    expect(status.keySet).toBe(true)

    const testResult = await page.evaluate(() => {
      // @ts-ignore window.api 由 preload 注入
      return (window.api as import('@shared/types').RendererApi).testAi()
    })
    expect(testResult.ok).toBe(true)

    // ---- 1. 选段解释 ----
    const explain = await runAnalysis(page, {
      requestId: 'req-explain',
      kind: 'selection-explanation',
      sessionId: ids.sessionId,
      connectionId: ids.connectionId,
      selection: 'ERR_CONNECTION_REFUSED 127.0.0.1:8080'
    })
    expect(explain.done.error).toBeUndefined()
    expect(explain.text).toBe(MOCK_REPLY)
    const explainReq = lastRequest()
    expect(explainReq.url).toBe('/v1/chat/completions')
    expect(explainReq.authorization).toBe('Bearer sk-e2e-key')
    expect(explainReq.body.model).toBe('mock-model')
    expect(allMessageText(explainReq)).toContain('ERR_CONNECTION_REFUSED 127.0.0.1:8080')
    expect(allMessageText(explainReq)).toContain('ai-e2e-测试机')

    // ---- 2. 会话摘要（读取滚动缓冲） ----
    const summary = await runAnalysis(page, {
      requestId: 'req-summary',
      kind: 'session-summary',
      sessionId: ids.sessionId,
      connectionId: ids.connectionId
    })
    expect(summary.done.error).toBeUndefined()
    expect(summary.text).toBe(MOCK_REPLY)
    const summaryReq = lastRequest()
    expect(allMessageText(summaryReq)).toContain('welcome to test server')

    // ---- 3. 连接诊断（只含非敏感元数据） ----
    const diagnosis = await runAnalysis(page, {
      requestId: 'req-diagnosis',
      kind: 'connection-diagnosis',
      connectionId: ids.connectionId,
      errorMessage: 'connect ECONNREFUSED 10.0.0.9:22'
    })
    expect(diagnosis.done.error).toBeUndefined()
    expect(diagnosis.text).toBe(MOCK_REPLY)
    const diagnosisReq = lastRequest()
    const diagnosisText = allMessageText(diagnosisReq)
    expect(diagnosisText).toContain('ECONNREFUSED 10.0.0.9:22')
    expect(diagnosisText).toContain('127.0.0.1')
    expect(diagnosisText).not.toContain('test-pass')
    expect(diagnosisText).not.toContain('ai-e2e-key')

    // 三轮分析都没有触发任何终端输出（只读约束）
    await new Promise((r) => setTimeout(r, 500))
    const probe = await page.evaluate(() => (window as unknown as { __aiProbe: AiProbe }).__aiProbe)
    expect(probe.sessionDataEvents).toBe(0)

    const stillConnected = await page.evaluate(async (sessionId) => {
      // @ts-ignore window.api 由 preload 注入
      const api = window.api as import('@shared/types').RendererApi
      const sessions = await api.listSessions()
      return sessions.some((s) => s.id === sessionId && s.status === 'connected')
    }, ids.sessionId)
    expect(stillConnected).toBe(true)
  })

  it('取消分析会以 cancelled 结束且不再追加文本', async () => {
    const page = await getPage()
    const text = await page.evaluate(
      async ({ baseUrl }) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        await api.updateSettings({ aiBaseUrl: baseUrl, aiModel: 'mock-model' })
        const chunks: string[] = []
        let done: { cancelled?: boolean } | null = null
        const requestId = 'req-cancel'
        api.onAiChunk((ev) => {
          if (ev.requestId === requestId) chunks.push(ev.delta)
        })
        api.onAiDone((ev) => {
          if (ev.requestId === requestId) done = ev
        })
        await api.aiAnalyze({
          requestId,
          kind: 'selection-explanation',
          selection: '随便一段输出'
        })
        api.cancelAi(requestId)
        const deadline = Date.now() + 10000
        while (!done) {
          if (Date.now() > deadline) throw new Error('取消后没有收到 done')
          await new Promise((r) => setTimeout(r, 50))
        }
        await new Promise((r) => setTimeout(r, 200))
        return { text: chunks.join(''), done: done as { cancelled?: boolean; error?: string } }
      },
      { baseUrl: `http://127.0.0.1:${mock.port}/v1` }
    )
    expect(text.done.cancelled).toBe(true)
    expect(text.done.error).toBeUndefined()
    // mock 响应极短，取消可能先于首个分片到达；关键是收尾为 cancelled 且无错误
    expect(text.text.length).toBeLessThanOrEqual(MOCK_REPLY.length)
  })

  it('命令建议：流式返回命令块，且全程不向终端写入', async () => {
    const page = await getPage()
    await installProbe(page)

    const ids = await page.evaluate(
      async ({ port }) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        const conn = await api.createConnection({
          name: 'ai-e2e-命令',
          groupId: null,
          host: '127.0.0.1',
          port,
          username: 'tester',
          authType: 'password',
          password: 'test-pass'
        })
        const { sessionId } = await api.openSession(conn.id)
        return { connectionId: conn.id, sessionId }
      },
      { port: ssh.port }
    )

    await page.waitForFunction(
      async (sessionId) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        const sessions = await api.listSessions()
        return sessions.some((s) => s.id === sessionId && s.status === 'connected')
      },
      { timeout: 20000 },
      ids.sessionId
    )
    await new Promise((r) => setTimeout(r, 500))
    await page.evaluate(() => {
      ;(window as unknown as { __aiProbe: AiProbe }).__aiProbe.sessionDataEvents = 0
    })

    const result = await runAnalysis(page, {
      requestId: 'req-command',
      kind: 'command-suggestion',
      sessionId: ids.sessionId,
      connectionId: ids.connectionId,
      instruction: '查看最近一小时 ERROR 日志'
    })
    expect(result.done.error).toBeUndefined()
    expect(result.text).toContain('```bash')
    expect(result.text).toContain('grep -c ERROR app.log')

    const request = lastRequest()
    const context = allMessageText(request)
    expect(context).toContain('查看最近一小时 ERROR 日志')
    expect(context).toContain('ai-e2e-命令')
    expect(context).not.toContain('test-pass')
    expect(context).not.toContain('sk-e2e-key')

    await new Promise((r) => setTimeout(r, 300))
    const probe = await page.evaluate(() => (window as unknown as { __aiProbe: AiProbe }).__aiProbe)
    expect(probe.sessionDataEvents).toBe(0)
  })

  it('界面：命令卡片插入终端但不发送回车', async () => {
    const page = await getPage()
    await page.evaluate(
      ({ port }) =>
        // @ts-ignore window.api 由 preload 注入
        (window.api as import('@shared/types').RendererApi).createConnection({
          name: 'ai-e2e-ui',
          groupId: null,
          host: '127.0.0.1',
          port,
          username: 'tester',
          authType: 'password',
          password: 'test-pass'
        }),
      { port: ssh.port }
    )
    await page.reload()
    await page.waitForFunction(() => document.body.textContent?.includes('ai-e2e-ui'), {
      timeout: 15000
    })
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.conn-table .row'))
      const target = rows.find(
        (el) => el.querySelector('.conn-name')?.textContent?.trim() === 'ai-e2e-ui'
      )
      if (!target) throw new Error('connection row not found')
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })
    await page.waitForFunction(
      () => document.querySelector('.xterm-rows')?.textContent?.includes('welcome to test server'),
      { timeout: 15000 }
    )

    await page.click('.ai-entry-btn')
    await page.waitForSelector('.ai-composer input:not([disabled])', { timeout: 15000 })
    await page.type('.ai-composer input', '查看最近一小时 ERROR 日志')
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('.ai-composer button')).find((b) =>
        b.textContent?.includes('生成')
      )
      if (!button) throw new Error('生成 button not found')
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    await page.waitForSelector('.ai-command-card', { timeout: 20000 })
    const card = await page.$eval('.ai-command-card', (el) => ({
      text: el.textContent ?? '',
      risk: el.querySelector('.ai-risk-badge')?.textContent?.trim() ?? ''
    }))
    expect(card.text).toContain('grep -c ERROR app.log')
    expect(card.risk).toBe('低风险')

    const inputBefore = ssh.shellInput().length
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('.ai-command-card button')).find((b) =>
        b.textContent?.includes('插入终端')
      )
      if (!button) throw new Error('插入终端 button not found')
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    const deadline = Date.now() + 5000
    while (!ssh.shellInput().slice(inputBefore).includes('grep -c ERROR app.log')) {
      if (Date.now() > deadline) throw new Error('命令没有写入终端')
      await new Promise((r) => setTimeout(r, 50))
    }
    await new Promise((r) => setTimeout(r, 400))
    const received = ssh.shellInput().slice(inputBefore)
    expect(received).toContain('grep -c ERROR app.log')
    expect(received).not.toMatch(/[\r\n]/)

    await page.waitForFunction(
      () => document.querySelector('.xterm-rows')?.textContent?.includes('grep -c ERROR app.log'),
      { timeout: 5000 }
    )
  })
})

async function prepareAssistantSession(
  page: Page,
  name: string
): Promise<{ connectionId: string; sessionId: string }> {
  const ids = await page.evaluate(
    async ({ port, name: connName }) => {
      // @ts-ignore window.api 由 preload 注入
      const api = window.api as import('@shared/types').RendererApi
      const conn = await api.createConnection({
        name: connName,
        groupId: null,
        host: '127.0.0.1',
        port,
        username: 'tester',
        authType: 'password',
        password: 'test-pass'
      })
      const { sessionId } = await api.openSession(conn.id)
      return { connectionId: conn.id, sessionId }
    },
    { port: ssh.port, name }
  )
  await page.evaluate(async (sessionId) => {
    // @ts-ignore window.api 由 preload 注入
    const api = window.api as import('@shared/types').RendererApi
    const deadline = Date.now() + 20000
    while (true) {
      const session = (await api.listSessions()).find((s) => s.id === sessionId)
      if (session?.status === 'connected') return
      if (session?.status === 'error') {
        throw new Error(`会话建立失败：${session.errorMessage}`)
      }
      if (Date.now() > deadline) {
        throw new Error(`会话连接超时：${JSON.stringify(session)}`)
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }, ids.sessionId)
  await page.evaluate(
    async ({ baseUrl }) => {
      // @ts-ignore window.api 由 preload 注入
      const api = window.api as import('@shared/types').RendererApi
      await api.updateSettings({
        aiBaseUrl: baseUrl,
        aiModel: 'mock-model',
        aiAutoExecute: true
      })
      await api.setAiKey('sk-e2e-key')
    },
    { baseUrl: `http://127.0.0.1:${mock.port}/v1` }
  )
  return ids
}

async function installChatProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    // @ts-ignore window.api 由 preload 注入
    const api = window.api as import('@shared/types').RendererApi
    const probe: { events: import('@shared/types').AiChatEvent[] } = { events: [] }
    api.onAiChatEvent((ev) => probe.events.push(ev))
    ;(window as unknown as { __chatProbe: typeof probe }).__chatProbe = probe
  })
}

async function resetChatProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as unknown as { __chatProbe?: { events: unknown[] } }).__chatProbe
    if (probe) probe.events = []
  })
}

async function chatEvents(
  page: Page
): Promise<{ type: string; requestId: string; [key: string]: unknown }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __chatProbe: { events: unknown[] } }).__chatProbe.events as {
        type: string
        requestId: string
        [key: string]: unknown
      }[]
  )
}

async function waitChatEvent(
  page: Page,
  requestId: string,
  type: string,
  timeoutMs = 30000
): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ requestId: rid, type: evType, timeout }) => {
      const probe = (window as unknown as { __chatProbe: { events: Record<string, unknown>[] } })
        .__chatProbe
      const deadline = Date.now() + timeout
      while (true) {
        const hit = probe.events.find((e) => e.type === evType && e.requestId === rid)
        if (hit) return hit
        if (Date.now() > deadline) throw new Error(`等待 AI 助手事件超时：${evType}`)
        await new Promise((r) => setTimeout(r, 50))
      }
    },
    { requestId, type, timeout: timeoutMs }
  )
}

async function startChat(
  page: Page,
  request: { requestId: string; sessionId: string; connectionId: string; text: string }
): Promise<void> {
  await page.evaluate(async (req) => {
    // @ts-ignore window.api 由 preload 注入
    const api = window.api as import('@shared/types').RendererApi
    await api.aiChatStart(req)
  }, request)
}

describe('AI 全自动助手（真实 Electron + mock OpenAI tools）', () => {
  it('只读命令自动执行，结果回填并给出结论，且不写入终端', async () => {
    const page = await getPage()
    await installChatProbe(page)
    await resetChatProbe(page)
    const ids = await prepareAssistantSession(page, 'ai-agent-只读')

    const before = ssh.shellInput().length
    const execBefore = ssh.lastExec.length
    const requestId = 'chat-ro'
    await startChat(page, {
      requestId,
      ...ids,
      text: '看看系统运行了多久'
    })
    const toolCall = await waitChatEvent(page, requestId, 'tool-call')
    expect(toolCall.command).toBe('uptime')
    expect(toolCall.requiresApproval).toBe(false)
    const toolResult = await waitChatEvent(page, requestId, 'tool-result')
    expect(toolResult.ok).toBe(true)
    expect((toolResult.result as { stdout: string }).stdout).toBe('exec:uptime')
    const done = await waitChatEvent(page, requestId, 'done')
    expect(done.error).toBeUndefined()
    expect(done.cancelled).toBeUndefined()

    const events = await chatEvents(page)
    const text = events
      .filter((e) => e.type === 'delta' && e.requestId === requestId)
      .map((e) => e.delta)
      .join('')
    expect(text).toContain('检查完成：系统运行正常。')

    const exec = ssh.lastExec.slice(execBefore).map((e) => e.command)
    expect(exec).toContain('uptime')
    await new Promise((r) => setTimeout(r, 300))
    expect(ssh.shellInput().length).toBe(before)
  })

  it('写命令需审批：批准后执行，拒绝后回填且不执行', async () => {
    const page = await getPage()
    await resetChatProbe(page)
    const ids = await prepareAssistantSession(page, 'ai-agent-审批')

    // 批准
    const approveId = 'chat-write-approve'
    const execBefore = ssh.lastExec.length
    await startChat(page, {
      requestId: approveId,
      ...ids,
      text: '请创建标记文件'
    })
    const call = await waitChatEvent(page, approveId, 'tool-call')
    expect(call.command).toBe('touch /tmp/terminalx-ai-e2e')
    expect(call.requiresApproval).toBe(true)
    await page.evaluate(
      ({ requestId, callId }) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        api.aiChatApprove(requestId, callId, true)
      },
      { requestId: approveId, callId: String(call.callId) }
    )
    const approved = await waitChatEvent(page, approveId, 'tool-result')
    expect(approved.ok).toBe(true)
    await waitChatEvent(page, approveId, 'done')
    expect(ssh.lastExec.slice(execBefore).map((e) => e.command)).toContain(
      'touch /tmp/terminalx-ai-e2e'
    )

    // 拒绝
    const rejectId = 'chat-write-reject'
    const execBeforeReject = ssh.lastExec.length
    await startChat(page, {
      requestId: rejectId,
      ...ids,
      text: '请删除标记文件'
    })
    const rmCall = await waitChatEvent(page, rejectId, 'tool-call')
    expect(rmCall.command).toBe('rm -rf /tmp/terminalx-ai-e2e')
    expect(rmCall.risk).toBe('high')
    expect(rmCall.requiresApproval).toBe(true)
    await page.evaluate(
      ({ requestId, callId }) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        api.aiChatApprove(requestId, callId, false)
      },
      { requestId: rejectId, callId: String(rmCall.callId) }
    )
    const rejected = await waitChatEvent(page, rejectId, 'tool-result')
    expect(rejected.ok).toBe(false)
    expect(rejected.rejected).toBe(true)
    await waitChatEvent(page, rejectId, 'done')
    expect(ssh.lastExec.length).toBe(execBeforeReject)
  })

  it('等待审批时取消立即收尾，迟到的批准不会再执行命令', async () => {
    const page = await getPage()
    await resetChatProbe(page)
    const ids = await prepareAssistantSession(page, 'ai-agent-取消')

    const requestId = 'chat-cancel'
    const execBefore = ssh.lastExec.length
    await startChat(page, {
      requestId,
      ...ids,
      text: '请创建标记文件'
    })
    const call = await waitChatEvent(page, requestId, 'tool-call')
    expect(call.requiresApproval).toBe(true)
    const cancelledAt = Date.now()
    await page.evaluate((rid) => {
      // @ts-ignore window.api 由 preload 注入
      const api = window.api as import('@shared/types').RendererApi
      api.aiChatCancel(rid)
    }, requestId)
    const done = await waitChatEvent(page, requestId, 'done')
    expect(done.cancelled).toBe(true)
    expect(Date.now() - cancelledAt).toBeLessThan(3000)

    await page.evaluate(
      ({ requestId: rid, callId }) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        api.aiChatApprove(rid, callId, true)
      },
      { requestId, callId: String(call.callId) }
    )
    await new Promise((r) => setTimeout(r, 800))
    expect(ssh.lastExec.length).toBe(execBefore)
  })

  it('界面：助手页签展示审批卡片，批准后执行并显示输出，终端无输入', async () => {
    const page = await getPage()
    await page.evaluate(
      ({ port }) =>
        // @ts-ignore window.api 由 preload 注入
        (window.api as import('@shared/types').RendererApi).createConnection({
          name: 'ai-agent-ui',
          groupId: null,
          host: '127.0.0.1',
          port,
          username: 'tester',
          authType: 'password',
          password: 'test-pass'
        }),
      { port: ssh.port }
    )
    await page.evaluate(
      async ({ baseUrl }) => {
        // @ts-ignore window.api 由 preload 注入
        const api = window.api as import('@shared/types').RendererApi
        await api.updateSettings({
          aiBaseUrl: baseUrl,
          aiModel: 'mock-model',
          aiAutoExecute: true
        })
        await api.setAiKey('sk-e2e-key')
      },
      { baseUrl: `http://127.0.0.1:${mock.port}/v1` }
    )
    await page.reload()
    await page.waitForFunction(() => document.body.textContent?.includes('ai-agent-ui'), {
      timeout: 15000
    })
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.conn-table .row'))
      const target = rows.find(
        (el) => el.querySelector('.conn-name')?.textContent?.trim() === 'ai-agent-ui'
      )
      if (!target) throw new Error('connection row not found')
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })
    await page.waitForFunction(
      () => document.querySelector('.xterm-rows')?.textContent?.includes('welcome to test server'),
      { timeout: 15000 }
    )

    const execBefore = ssh.lastExec.length
    const inputBefore = ssh.shellInput().length
    await page.click('.ai-entry-btn')
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('.ai-tab')).find(
        (el) => el.textContent?.trim() === '助手'
      )
      if (!tab || (tab as HTMLButtonElement).disabled) throw new Error('助手页签不可用')
      ;(tab as HTMLElement).click()
    })
    await page.waitForSelector('.chat-composer textarea:not([disabled])', { timeout: 15000 })
    await page.type('.chat-composer textarea', '请创建标记文件验证审批')
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('.chat-composer button')).find((b) =>
        b.textContent?.includes('发送')
      )
      if (!button) throw new Error('发送 button not found')
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    await page.waitForSelector(
      '.chat-tool.risk-medium, .chat-tool.risk-high, .chat-tool.risk-low',
      {
        timeout: 20000
      }
    )
    await page.waitForFunction(
      () => document.querySelector('.chat-tool-status')?.textContent?.trim() === '等待确认',
      { timeout: 10000 }
    )
    const card = await page.$eval('.chat-tool', (el) => ({
      text: el.textContent ?? '',
      purpose: el.querySelector('.chat-tool-purpose')?.textContent?.trim() ?? '',
      code: el.querySelector('.chat-tool-code')?.textContent?.trim() ?? ''
    }))
    expect(card.purpose).toBe('创建标记文件')
    expect(card.code).toBe('touch /tmp/terminalx-ai-e2e')
    expect(card.text).toContain('执行')

    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('.chat-tool-actions button')).find((b) =>
        b.textContent?.includes('执行')
      )
      if (!button) throw new Error('执行 button not found')
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    await page.waitForFunction(
      () => document.querySelector('.chat-tool-status')?.textContent?.trim() === '已执行',
      { timeout: 15000 }
    )
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll('.chat-msg.assistant')
        return (items[items.length - 1]?.textContent ?? '').includes('系统运行正常。')
      },
      { timeout: 15000 }
    )
    expect(ssh.lastExec.slice(execBefore).map((e) => e.command)).toContain(
      'touch /tmp/terminalx-ai-e2e'
    )
    await page.evaluate(() => {
      const toggle = document.querySelector<HTMLButtonElement>('.chat-output-toggle')
      toggle?.click()
    })
    await page.waitForSelector('.chat-output', { timeout: 5000 })
    const output = await page.$eval('.chat-output', (el) => el.textContent ?? '')
    expect(output).toContain('exec:touch /tmp/terminalx-ai-e2e')
    expect(ssh.shellInput().length).toBe(inputBefore)
  })
})
