import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess, execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import puppeteer, { Browser, Page } from 'puppeteer-core'
import { startTestSshServer, TestSshServer } from '../main/ssh/__tests__/testSshServer'

const DEBUG_PORT = 9341
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')

let server: TestSshServer
let electron: ChildProcess | null = null
let browser: Browser | null = null
let userDataDir: string
let electronLog = ''
const consoleBuffer: string[] = []

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
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
    await sleep(300)
  }
  throw new Error('timeout waiting for electron page')
}

/**
 * 把 Electron 窗口置前：窗口被遮挡时 xterm 不渲染（rows 为空），
 * 截图与基于渲染结果的等待都会超时。
 */
function focusWindow(pid: number): void {
  if (!pid) return
  try {
    execFileSync('osascript', [
      '-e',
      `tell application "System Events" to tell (first process whose unix id is ${pid})
         set frontmost to true
         set value of attribute "AXMinimized" to false
       end tell`
    ])
  } catch {
    /* 无辅助功能权限时忽略 */
  }
}

beforeAll(async () => {
  server = await startTestSshServer()
  userDataDir = await fs.mkdtemp(join(tmpdir(), 'terminalx-ws-e2e-'))
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
  const pages = await browser.pages()
  pages[0]?.on('console', (msg) => consoleBuffer.push(`[${msg.type()}] ${msg.text()}`))
  pages[0]?.on('pageerror', (e: unknown) => {
    const err = e as Error
    consoleBuffer.push(`[pageerror] ${err?.message ?? String(e)}`)
  })
  focusWindow(electron.pid ?? 0)
}, 60000)

afterAll(async () => {
  await browser?.disconnect()
  const proc = electron
  electron = null
  proc?.kill()
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
}

async function reload(page: Page): Promise<void> {
  await page.reload()
  await page.waitForFunction(() => Boolean(document.querySelector('#app')), { timeout: 15000 })
  await sleep(800)
}

/** 切回连接中心（打开连接后工作区会盖住连接列表） */
async function showConnectionCenter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sw = document.querySelector('.view-switch') as HTMLElement | null
    sw?.click()
  })
  await sleep(500)
}

/** 双击连接行打开会话（与用户在连接中心双击一致） */
async function openConnectionByDoubleClick(page: Page, name: string): Promise<void> {
  await showConnectionCenter(page)
  await page.evaluate((n) => {
    const rows = Array.from(document.querySelectorAll('.conn-table .row'))
    const target = rows.find((el) => el.querySelector('.conn-name')?.textContent?.trim() === n)
    if (!target) throw new Error(`connection row not found: ${n}`)
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  }, name)
}

/** 激活标签里的窗格（未激活的标签仍挂载在 DOM 里，需要按可见性过滤） */
async function activePaneTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const panel = Array.from(document.querySelectorAll('.tab-panel')).find(
      (el) => getComputedStyle(el).display !== 'none'
    )
    return panel ? Array.from(panel.querySelectorAll('.pane')).map((p) => p.textContent ?? '') : []
  })
}

async function activePaneCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const panel = Array.from(document.querySelectorAll('.tab-panel')).find(
      (el) => getComputedStyle(el).display !== 'none'
    )
    return panel ? panel.querySelectorAll('.pane').length : 0
  })
}

/** 等待激活标签里第 idx 个窗格的终端出现欢迎语 */
async function waitWelcome(page: Page, idx = 0): Promise<void> {
  try {
    await page.waitForFunction(
      (i) => {
        const panel = Array.from(document.querySelectorAll('.tab-panel')).find(
          (el) => getComputedStyle(el).display !== 'none'
        )
        const pane = panel ? Array.from(panel.querySelectorAll('.pane'))[i] : null
        return (
          pane?.querySelector('.xterm-rows')?.textContent?.includes('welcome to test server') ?? false
        )
      },
      { timeout: 20000, polling: 300 },
      idx
    )
  } catch (err) {
    const diag = await page.evaluate(async () => {
      const panel = Array.from(document.querySelectorAll('.tab-panel')).find(
        (el) => getComputedStyle(el).display !== 'none'
      )
      const panes = panel ? Array.from(panel.querySelectorAll('.pane')) : []
      const sessions = await window.api.listSessions()
      return {
        panes: panes.map((p) => ({
          text: (p.textContent ?? '').slice(0, 160),
          rows: p.querySelector('.xterm-rows')?.textContent?.slice(0, 160) ?? null
        })),
        sessions
      }
    })
    console.error('[e2e] waitWelcome 失败，诊断：', JSON.stringify(diag, null, 2))
    console.error('[e2e] 控制台日志：', consoleBuffer.slice(-4000))
    throw err
  }
}

async function tabTitles(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.tab-bar .tab .tab-title')).map(
      (el) => el.textContent?.trim() ?? ''
    )
  )
}

async function activeTabTitle(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('.tab-bar .tab.active .tab-title')?.textContent?.trim() ?? ''
  )
}

async function pressKey(page: Page, key: string, mods: string[] = []): Promise<void> {
  await page.evaluate(
    ({ k, m }) => {
      const init: KeyboardEventInit = { key: k, bubbles: true, cancelable: true }
      if (m.includes('meta')) init.metaKey = true
      if (m.includes('shift')) init.shiftKey = true
      if (m.includes('alt')) init.altKey = true
      document.dispatchEvent(new KeyboardEvent('keydown', init))
    },
    { k: key, m: mods }
  )
  await sleep(400)
}

describe('A1 多标签 + 分屏', () => {
  it('两个连接各开一个标签，切换标签后终端内容保留', async () => {
    const page = await getPage()
    await createConnection(page, '主机A')
    await createConnection(page, '主机B')
    await reload(page)

    await openConnectionByDoubleClick(page, '主机A')
    await waitWelcome(page, 0)
    await openConnectionByDoubleClick(page, '主机B')
    await waitWelcome(page, 0)

    const titles = await tabTitles(page)
    expect(titles).toContain('主机A')
    expect(titles).toContain('主机B')
    expect(titles).toHaveLength(2)

    // 切回第一个标签，其终端仍保留输出
    await pressKey(page, '1', ['meta'])
    expect(await activeTabTitle(page)).toBe('主机A')
    await waitWelcome(page, 0)
  })

  it('拆分窗格：新窗格为空态，选连接后可与原窗格并行', async () => {
    const page = await getPage()
    await pressKey(page, '1', ['meta'])

    // 点击窗格标题栏的「左右分屏」
    await page.evaluate(() => {
      const pane = document.querySelector('.pane')
      const btn = pane?.querySelector('.pane-btn')
      if (!btn) throw new Error('split button not found')
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await sleep(600)

    expect(await activePaneCount(page)).toBe(2)

    // 新窗格是空态
    const paneTexts = await activePaneTexts(page)
    expect(paneTexts[1] ?? '').toContain('空窗格')

    // 在空窗格里选连接（与原窗格同一台主机，验证会话互相独立）
    await page.evaluate(() => {
      const panel = Array.from(document.querySelectorAll('.tab-panel')).find(
        (el) => getComputedStyle(el).display !== 'none'
      )
      const panes = panel ? Array.from(panel.querySelectorAll('.pane')) : []
      const btn = Array.from(panes[1]?.querySelectorAll('.el-button') ?? []).find((b) =>
        b.textContent?.includes('选择连接')
      )
      if (!btn) throw new Error('picker button not found')
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await sleep(500)
    await page.evaluate(() => {
      const item = Array.from(document.querySelectorAll('.pane-picker-item')).find((el) =>
        el.textContent?.includes('主机A')
      )
      if (!item) throw new Error('picker item not found')
      item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await waitWelcome(page, 1)

    // 两个窗格各自跑着独立会话
    await waitWelcome(page, 0)
  })

  it('拖拽分隔条可调整两窗格比例', async () => {
    const page = await getPage()
    /** 首个窗格宽度百分比（平铺布局用百分比定位） */
    const readWidth = (): Promise<number> =>
      page.evaluate(() => {
        const panel = Array.from(document.querySelectorAll('.tab-panel')).find(
          (el) => getComputedStyle(el).display !== 'none'
        )
        const cell = panel?.querySelector('.grid-cell') as HTMLElement | null
        if (!cell) return -1
        return Number.parseFloat(cell.style.width)
      })
    const before = await readWidth()
    expect(before).toBeGreaterThan(0)

    await page.evaluate(() => {
      const divider = document.querySelector('.grid-divider')
      if (!divider) throw new Error('divider not found')
      const grid = (divider.parentElement as HTMLElement).getBoundingClientRect()
      divider.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: grid.left + grid.width * 0.5,
          clientY: grid.top + 10
        })
      )
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: grid.left + grid.width * 0.75,
          clientY: grid.top + 10
        })
      )
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    })
    await sleep(600)

    const after = await readWidth()
    expect(after).not.toBe(before)
    expect(after).toBeGreaterThan(60)
    expect(after).toBeLessThan(85)
  })

  it('关闭一个窗格后，另一个窗格的会话仍在运行', async () => {
    const page = await getPage()
    await page.evaluate(() => {
      const panel = Array.from(document.querySelectorAll('.tab-panel')).find(
        (el) => getComputedStyle(el).display !== 'none'
      )
      const panes = panel ? Array.from(panel.querySelectorAll('.pane')) : []
      const btns = panes[1]?.querySelectorAll('.pane-btn')
      const close = btns?.[btns.length - 1]
      if (!close) throw new Error('close button not found')
      close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await sleep(900)

    expect(await activePaneCount(page)).toBe(1)
    // 剩余窗格的会话没有被连带关闭
    await waitWelcome(page, 0)
  })

  it('⌘T 新建标签，⌘W 关闭焦点窗格', async () => {
    const page = await getPage()
    const before = (await tabTitles(page)).length

    await pressKey(page, 't', ['meta'])
    expect(await tabTitles(page)).toHaveLength(before + 1)
    // 新标签是空标签
    expect(await activeTabTitle(page)).toContain('新建标签')

    await pressKey(page, 'w', ['meta'])
    expect(await tabTitles(page)).toHaveLength(before)
  })
})

describe('M0 设计令牌与双主题', () => {
  it('外观模式切到浅色后根节点去掉 dark 类并换背景，切回深色再变回', async () => {
    const page = await getPage()
    // 打开设置面板
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.title-bar-right .gear-btn'))
      const gear = btns[btns.length - 1]
      if (!gear) throw new Error('settings button not found')
      gear.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await sleep(700)

    // 选择「浅色」
    const pickMode = async (label: string): Promise<void> => {
      await page.evaluate((text) => {
        const radios = Array.from(document.querySelectorAll('.el-radio-button'))
        const target = radios.find((r) => r.textContent?.includes(text))
        if (!target) throw new Error(`radio not found: ${text}`)
        ;(target as HTMLElement).click()
      }, label)
      await sleep(900)
    }

    await pickMode('浅色')
    const light = await page.evaluate(() => ({
      hasDark: document.documentElement.classList.contains('dark'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--tx-bg').trim(),
      bodyBg: document.body.style.background
    }))
    expect(light.hasDark).toBe(false)
    expect(light.bg).toMatch(/^#/)
    expect(light.bodyBg).not.toBe('')

    await pickMode('深色')
    const dark = await page.evaluate(() => ({
      hasDark: document.documentElement.classList.contains('dark'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--tx-bg').trim(),
      bodyBg: document.body.style.background
    }))
    expect(dark.hasDark).toBe(true)
    expect(dark.bg).not.toBe(light.bg)
    expect(dark.bodyBg).not.toBe(light.bodyBg)

    // 关闭设置面板
    await page.evaluate(() => {
      const close = document.querySelector('.settings-header .close-btn') as HTMLElement | null
      close?.click()
    })
    await sleep(400)
  })

  it('主题变量由设计令牌提供：分屏区域取色自 CSS 变量', async () => {
    const page = await getPage()
    const vars = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      return {
        bg: root.getPropertyValue('--tx-bg').trim(),
        accent: root.getPropertyValue('--tx-accent').trim(),
        border: root.getPropertyValue('--tx-border').trim()
      }
    })
    expect(vars.bg).toMatch(/^#/)
    expect(vars.accent).toMatch(/^#/)
    expect(vars.border).toMatch(/^#/)
  })
})
