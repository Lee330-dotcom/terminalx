import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess, execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import puppeteer, { Browser, Page } from 'puppeteer-core'
import { startTestSshServer, TestSshServer } from '../main/ssh/__tests__/testSshServer'
import { clickTrustHostKey, waitHostKeyDialog } from './hostKeyHelper'

const DEBUG_PORT = 9345
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')

let server: TestSshServer
let electron: ChildProcess | null = null
let browser: Browser | null = null
let userDataDir: string
let electronLog = ''

/** 把 Electron 窗口置前：窗口被遮挡时 xterm 不渲染，用例会假失败 */
function focusWindow(pid: number): void {
  if (!pid) return
  try {
    execFileSync('osascript', [
      '-e',
      `tell application "System Events" to tell (first process whose unix id is ${pid})
         set frontmost to true
       end tell`
    ])
  } catch {
    /* 无辅助功能权限时忽略 */
  }
}

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
  userDataDir = await fs.mkdtemp(join(tmpdir(), 'terminalx-e2e-hostkey-'))
  electron = spawn(
    ELECTRON_BIN,
    [APP_ROOT, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`],
    { env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' } }
  )
  electron.stdout?.on('data', (d) => (electronLog += d.toString()))
  electron.stderr?.on('data', (d) => (electronLog += d.toString()))
  await waitForPage()
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
  focusWindow(electron.pid ?? 0)
}, 60000)

afterAll(async () => {
  await browser?.disconnect()
  electron?.kill()
  server.close()
  if (userDataDir) await fs.rm(userDataDir, { recursive: true, force: true })
})

async function getPage(): Promise<Page> {
  const pages = await browser!.pages()
  const page = pages[0]
  await page.bringToFront()
  focusWindow(electron?.pid ?? 0)
  return page
}

async function createConnection(page: Page, name: string): Promise<void> {
  await page.evaluate(
    ({ port, name: n }) =>
      window.api.createConnection({
        name: n,
        groupId: null,
        host: '127.0.0.1',
        port,
        username: 'tester',
        authType: 'password',
        password: 'test-pass'
      }),
    { port: server.port, name }
  )
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
    const target = rows.find((el) => el.querySelector('.conn-name')?.textContent?.trim() === n)
    if (!target) throw new Error(`connection row not found: ${n}`)
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  }, name)
}

async function waitWelcome(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('.xterm-rows')?.textContent?.includes('welcome to test server'),
    { timeout: 20000 }
  )
}

/** 当前是否显示指纹确认弹窗。 */
async function hasHostKeyDialog(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('.host-key-dialog'))
    return dialogs.some((d) => {
      // 弹窗关闭后仍留在 DOM 里（只是隐藏），必须判可见性
      if (d.getClientRects().length === 0) return false
      const title = d.querySelector('.el-dialog__title')?.textContent?.trim() ?? ''
      return title.includes('确认主机身份') || title.includes('Confirm Host Identity')
    })
  })
}

/** 关闭当前活动标签（让连接树侧栏回来）。 */
async function closeActiveTab(page: Page): Promise<void> {
  const selector = '.tab.active .tab-close'
  await page.waitForSelector(selector, { timeout: 10000 })
  const before = await page.evaluate(() => document.querySelectorAll('.tab').length)
  for (let attempt = 0; attempt < 10; attempt++) {
    const box = await page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
    })
    if (box) {
      await page.mouse.click(box.x, box.y)
      await new Promise((r) => setTimeout(r, 300))
      const after = await page.evaluate(() => document.querySelectorAll('.tab').length)
      if (after < before) return
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('tab-close click did not close the tab')
}

/** 打开设置面板并切到「主机指纹」分区。 */
async function openHostKeySection(page: Page): Promise<void> {
  // 标题栏可能是拖拽区域，用 JS 派发点击更稳
  await page.evaluate(() => {
    const btn = document.querySelector('.settings-entry-btn') as HTMLElement | null
    if (!btn) throw new Error('settings entry button not found')
    btn.click()
  })
  await page.waitForSelector('.settings-window', { timeout: 10000 })
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.settings-sidebar .nav-item'))
    const target = items.find((el) => el.textContent?.includes('主机指纹'))
    if (!target) throw new Error('host key section not found in settings sidebar')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(
    () => document.querySelector('.settings-window')?.textContent?.includes('已信任的主机公钥指纹'),
    { timeout: 10000 }
  )
}

describe('主机指纹校验（known_hosts）', () => {
  it('首次连接弹出指纹确认；信任后连接成功并写入指纹库', async () => {
    const page = await getPage()
    await createConnection(page, 'e2e-指纹机')

    await doubleClickRow(page, 'e2e-指纹机')

    // 第一次连接必须先确认主机身份
    await waitHostKeyDialog(page)
    const fingerprint = await page.evaluate(() => {
      const dialog = document.querySelector('.host-key-dialog')
      const text = dialog?.textContent ?? ''
      const match = text.match(/SHA256:[A-Za-z0-9+/]+/)
      return match ? match[0] : ''
    })
    expect(fingerprint).toMatch(/^SHA256:/)

    // 信任后握手继续，终端出现欢迎输出
    expect(await clickTrustHostKey(page)).toBe(true)
    await waitWelcome(page)

    // 设置面板里能看到已信任的主机与指纹
    await openHostKeySection(page)
    const sectionText = await page.evaluate(
      () => document.querySelector('.settings-window')?.textContent ?? ''
    )
    expect(sectionText).toContain('127.0.0.1')
    expect(sectionText).toContain(fingerprint)

    // 关闭设置面板与标签页，让连接树侧栏回到初始状态
    await page.keyboard.press('Escape')
    await closeActiveTab(page)
  }, 90000)

  it('指纹未变时再次连接不再弹窗', async () => {
    const page = await getPage()
    // 复用上一条用例已信任的指纹，直接再连一次
    await doubleClickRow(page, 'e2e-指纹机')
    await waitWelcome(page)
    expect(await hasHostKeyDialog(page)).toBe(false)

    // 关闭标签，让连接树侧栏回到初始状态
    await closeActiveTab(page)
  }, 90000)

  it('忘记指纹后再次连接重新弹窗；拒绝后连接失败', async () => {
    const page = await getPage()

    // 设置面板里忘记该主机指纹
    await openHostKeySection(page)
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.settings-window .setting-row'))
      const target = rows.find((el) => el.textContent?.includes('127.0.0.1'))
      if (!target) throw new Error('trusted host row not found')
      const btn = Array.from(target.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('忘记')
      )
      if (!btn) throw new Error('forget button not found')
      btn.click()
    })
    // 二次确认
    await page.waitForSelector('.el-message-box', { timeout: 10000 })
    await page.evaluate(() => {
      const btn = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.el-message-box button')
      ).find((b) => b.textContent?.includes('忘记'))
      btn?.click()
    })
    await page.waitForFunction(
      () => document.querySelector('.settings-window')?.textContent?.includes('尚未信任任何主机'),      { timeout: 10000 }
    )
    // 关闭设置面板
    await page.keyboard.press('Escape')

    // 指纹被忘记后，重新连接必须再次确认
    await doubleClickRow(page, 'e2e-指纹机')
    await waitHostKeyDialog(page)

    // 拒绝并断开 → 会话进入失败状态
    await page.evaluate(() => {
      const dialog = document.querySelector('.host-key-dialog')
      const btn = Array.from(dialog?.querySelectorAll('button') ?? []).find((b) =>
        b.textContent?.includes('拒绝并断开')
      )
      if (!btn) throw new Error('reject button not found')
      ;(btn as HTMLButtonElement).click()
    })
    await page.waitForFunction(
      () => {
        const text = document.querySelector('.pane-state')?.textContent ?? ''
        return text.includes('指纹') || text.includes('拒绝')
      },
      { timeout: 15000 }
    )
    const errText = await page.evaluate(() => document.querySelector('.pane-state')?.textContent ?? '')
    expect(errText).toContain('指纹')
  }, 90000)
})
