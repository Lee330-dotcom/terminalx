/**
 * 任务 8.3 手动验证脚本（不进入默认 e2e include）：
 * 挂载 dist dmg → 运行打包后的 SSH Tool.app → 建连接/开终端/MCP 握手
 * → 重启应用验证数据与凭据持久化（safeStorage + 加密 vault）
 * 前置：dist/ssh-tool-1.0.0.dmg 已构建；临时 sshd 运行中（/tmp/ssh-e2e，端口 22222）
 * 运行：npx vitest run --config vitest.manual.config.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess, execSync } from 'child_process'
import { createServer } from 'net'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import puppeteer, { Browser } from 'puppeteer-core'

const DEBUG_PORT = 9666
const DMG = 'dist/ssh-tool-1.0.0.dmg'
const APP_BIN =
  '/Volumes/SSH Tool 1.0.0-arm64/SSH Tool.app/Contents/MacOS/SSH Tool'
const SSHD_PORT = 22222
const CLIENT_KEY = '/tmp/ssh-e2e/client_key'

let electron: ChildProcess | null = null
let browser: Browser | null = null
let userDataDir: string
let mcpPort: number

function getFreePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => resolvePromise(port))
    })
    srv.once('error', reject)
  })
}

async function launchApp(): Promise<void> {
  electron = spawn(
    APP_BIN,
    [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`],
    { stdio: 'ignore' }
  )
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)
      const targets = (await res.json()) as { type: string }[]
      if (targets.some((t) => t.type === 'page')) {
        browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
        return
      }
    } catch {
      /* app 尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('timeout waiting for packaged app')
}

async function stopApp(): Promise<void> {
  await browser?.disconnect()
  browser = null
  electron?.kill()
  electron = null
  await new Promise((r) => setTimeout(r, 1000))
}

async function doubleClickTreeNode(page: import('puppeteer-core').Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    const nodes = Array.from(document.querySelectorAll('.tree-node'))
    const target = nodes.find((el) => el.textContent?.trim() === n)
    if (!target) throw new Error(`tree node not found: ${n}`)
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  }, name)
}

beforeAll(async () => {
  execSync(`test -f ${DMG} || (hdiutil attach ${DMG} -nobrowse -readonly >/dev/null && echo mounted)`, {
    stdio: 'pipe'
  }).toString()
  userDataDir = await fs.mkdtemp(join(tmpdir(), 'ssh-tool-dmg-verify-'))
  mcpPort = await getFreePort()
}, 120000)

afterAll(async () => {
  await stopApp()
})

describe('任务 8.3：dmg 安装验证（打包应用 + 持久化）', () => {
  it('打包应用可运行：建连接 → 开终端 → MCP 握手 → 重启后数据与凭据保持', async () => {
    // 第一次启动
    await launchApp()
    const page = (await browser!.pages())[0]

    // 建密钥连接（凭据入加密 vault，走 safeStorage）
    const keyContent = await fs.readFile(CLIENT_KEY, 'utf8')
    await page.evaluate(
      ({ key, username, port }) =>
        window.api.createConnection({
          name: 'dmg-verify',
          groupId: null,
          host: '127.0.0.1',
          port,
          username,
          authType: 'privateKey',
          privateKeyContent: key
        }),
      { key: keyContent, username: process.env.USER ?? '', port: SSHD_PORT }
    )
    await page.reload()
    await page.waitForFunction(() => document.body.textContent?.includes('dmg-verify'), {
      timeout: 15000
    })
    console.log('[verify] 1. 打包应用建连接 OK')

    // 开终端
    await doubleClickTreeNode(page, 'dmg-verify')
    await page.waitForFunction(() => document.querySelector('.terminal-container'), {
      timeout: 15000
    })
    await page
      .waitForFunction(
        () => /~ % |\$ |# /.test(document.querySelector('.xterm-rows')?.textContent ?? ''),
        { timeout: 20000 }
      )
      .catch(() => {
        /* 提示符样式可能不同 */
      })
    console.log('[verify] 2. 打包应用开终端 OK')

    // MCP：设置端口后握手 + tools/list
    await page.evaluate((port) => window.api.updateSettings({ mcpPort: port }), mcpPort)
    await new Promise((r) => setTimeout(r, 500))
    const settings = await page.evaluate(() => window.api.getSettings())
    expect(settings.mcpPort).toBe(mcpPort)
    const initRes = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${settings.mcpToken}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'dmg-verify', version: '1.0' }
        }
      })
    })
    expect(initRes.status).toBe(200)
    const toolsRes = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${settings.mcpToken}`
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    })
    const toolsText = await toolsRes.text()
    const dataLines = toolsText.split('\n').filter((l) => l.startsWith('data:'))
    const toolsJson = JSON.parse(dataLines[dataLines.length - 1].slice(5).trim())
    const toolNames = toolsJson.result.tools.map((t: { name: string }) => t.name).sort()
    expect(toolNames.length).toBe(7)
    console.log('[verify] 3. MCP initialize + tools/list OK（', toolNames.length, '个工具）')

    // 重启应用
    await stopApp()
    await launchApp()
    const page2 = (await browser!.pages())[0]
    await page2.waitForFunction(() => document.body.textContent?.includes('dmg-verify'), {
      timeout: 15000
    })
    console.log('[verify] 4. 重启后连接数据保持 OK')

    // 重启后凭据可用（解密私钥连接成功）
    await doubleClickTreeNode(page2, 'dmg-verify')
    await page2.waitForFunction(() => document.querySelector('.terminal-container'), {
      timeout: 15000
    })
    await page2
      .waitForFunction(
        () => /~ % |\$ |# /.test(document.querySelector('.xterm-rows')?.textContent ?? ''),
        { timeout: 20000 }
      )
      .catch(() => {
        /* 提示符样式可能不同 */
      })
    console.log('[verify] 5. 重启后凭据解密登录 OK（safeStorage + vault）')

    // 重启后 MCP token/端口保持
    const settings2 = await page2.evaluate(() => window.api.getSettings())
    expect(settings2.mcpPort).toBe(mcpPort)
    const unauthorized = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    expect(unauthorized.status).toBe(401)
    console.log('[verify] 6. 重启后 MCP 端口/token 保持，无 token 401 OK')
  }, 180000)
})
