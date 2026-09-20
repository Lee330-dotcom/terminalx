import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import puppeteer, { Browser, Page } from 'puppeteer-core'
import { startTestSshServer, TestSshServer } from '../main/ssh/__tests__/testSshServer'

const DEBUG_PORT = 9333
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')

let server: TestSshServer
let electron: ChildProcess | null = null
let browser: Browser | null = null
let userDataDir: string
let electronLog = ''

async function waitForPage(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)
      const targets = (await res.json()) as { type: string }[]
      if (targets.some((t) => t.type === 'page')) return
    } catch {
      /* electron 尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('timeout waiting for electron page')
}

beforeAll(async () => {
  server = await startTestSshServer()
  userDataDir = await fs.mkdtemp(join(tmpdir(), 'terminalx-e2e-'))
  electron = spawn(
    ELECTRON_BIN,
    [APP_ROOT, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`],
    { env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' } }
  )
  electron.stdout?.on('data', (d) => (electronLog += d.toString()))
  electron.stderr?.on('data', (d) => (electronLog += d.toString()))
  await waitForPage()
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
}, 60000)

afterAll(async () => {
  await browser?.disconnect()
  electron?.kill()
  server.close()
})

async function getPage(): Promise<Page> {
  const pages = await browser!.pages()
  const page = pages[0]
  await page.bringToFront()
  return page
}

async function createConnection(page: Page, name: string, password: string): Promise<void> {
  await page.evaluate(
    ({ port, name: n, password: p }) =>
      window.api.createConnection({
        name: n,
        groupId: null,
        host: '127.0.0.1',
        port,
        username: 'tester',
        authType: 'password',
        password: p
      }),
    { port: server.port, name, password }
  )
  // 重新加载让连接树拿到最新数据
  await page.reload()
  await page.waitForFunction(
    (n) => document.body.textContent?.includes(n),
    { timeout: 15000 },
    name
  )
}

async function doubleClickRow(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    const rows = Array.from(document.querySelectorAll('.conn-table .row'))
    const target = rows.find(
      (el) => el.querySelector('.conn-name')?.textContent?.trim() === n
    )
    if (!target) throw new Error(`connection row not found: ${n}`)
    const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true })
    target.dispatchEvent(ev)
  }, name)
}

async function waitWelcome(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => document.querySelector('.xterm-rows')?.textContent?.includes('welcome to test server'),
      { timeout: 15000 }
    )
  } catch (err) {
    const state = await page.evaluate(() => document.body.textContent?.slice(0, 3000))
    console.error('[e2e] waitWelcome failed, body:', state)
    if (electronLog) console.error('[e2e] electron log tail:', electronLog.slice(-5000))
    throw err
  }
}

async function clickCloseTab(page: Page): Promise<void> {
  // 标签重渲染瞬间元素可能短暂失去布局框，失败时退化为手动鼠标点击
  try {
    await page.waitForSelector('.tab-close', { timeout: 5000 })
    await Promise.race([
      page.click('.tab-close'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('click timeout')), 5000))
    ])
    return
  } catch {
    /* fall through */
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const box = await page.$eval('.tab-close', (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
    })
    if (box) {
      await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2)
      return
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('tab-close never became clickable')
}

describe('应用端到端（真实 Electron + 本地测试 SSH 服务器）', () => {
  it('双击连接打开终端，显示欢迎输出并支持键盘输入', async () => {
    const page = await getPage()
    await createConnection(page, 'e2e-测试机', 'test-pass')

    await doubleClickRow(page, 'e2e-测试机')

    // xterm 渲染出服务器欢迎输出
    await waitWelcome(page)

    // 键盘输入回显（走 xterm onData → IPC → SSH 输入流）
    await page.click('.terminal-container')
    await page.keyboard.type('hello-e2e')
    await page.waitForFunction(
      () => document.querySelector('.xterm-rows')?.textContent?.includes('hello-e2e'),
      { timeout: 15000 }
    )

    // 关闭标签页
    await clickCloseTab(page)
    await page.waitForFunction(
      () => document.querySelectorAll('.xterm-rows').length === 0,
      { timeout: 15000 }
    )
  })

  it('错误密码连接显示认证失败提示', async () => {
    const page = await getPage()
    await createConnection(page, 'e2e-坏密码', 'wrong')

    await doubleClickRow(page, 'e2e-坏密码')

    await page.waitForFunction(
      () => document.querySelector('.state-panel.error')?.textContent?.includes('认证失败'),
      { timeout: 15000 }
    )
    const errText = await page.evaluate(
      () => document.querySelector('.state-panel.error')?.textContent
    )
    expect(errText).toContain('认证失败')
    expect(errText).toContain('重新连接')
  })

  it('服务器断开会话后，点击重新连接可恢复且保持连接', async () => {
    const page = await getPage()
    await createConnection(page, 'e2e-重连', 'test-pass')

    await doubleClickRow(page, 'e2e-重连')
    await waitWelcome(page)

    // 输入 exit：服务器关闭通道 → 应用显示「连接已断开」面板
    await page.click('.terminal-container')
    await page.keyboard.type('exit')
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => document.querySelector('.state-panel')?.textContent?.includes('连接已断开'),
      { timeout: 15000 }
    )

    // 点击「重新连接」
    await page.click('.state-panel button')
    await waitWelcome(page)

    // 稳定观察 2s：不应再次掉线（回归：重连复用濒死连接会再次断开）
    await new Promise((r) => setTimeout(r, 2000))
    const panelVisible = await page.evaluate(() => !!document.querySelector('.state-panel'))
    expect(panelVisible).toBe(false)

    // 关闭标签页
    await clickCloseTab(page)
    await page.waitForFunction(
      () => document.querySelectorAll('.xterm-rows').length === 0,
      { timeout: 15000 }
    )
  })

  it('文件面板可打开；测试服务器不支持 SFTP 时优雅报错', async () => {
    const page = await getPage()
    await createConnection(page, 'e2e-sftp', 'test-pass')
    await doubleClickRow(page, 'e2e-sftp')
    await waitWelcome(page)

    await page.click('.sftp-toggle')

    // 面板渲染，路径栏显示根目录
    await page.waitForFunction(
      () => document.querySelector('.sftp-panel')?.textContent?.includes('/'),
      { timeout: 15000 }
    )
    const panelText = await page.evaluate(() => document.querySelector('.sftp-panel')?.textContent)
    expect(panelText).toContain('上传')
    expect(panelText).toContain('新建文件夹')

    // 本地测试服务器未实现 sftp 子系统，列表失败应有提示
    await page.waitForFunction(
      () => document.querySelector('.el-message')?.textContent?.includes('读取目录失败'),
      { timeout: 15000 }
    )
  })
})
