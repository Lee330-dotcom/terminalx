/**
 * 手动验证：快捷命令（Snippet）全链路。
 *
 * 复用正在跑的 Vite dev server，再起一个独立 Electron 实例（临时 userData），
 * 避免打扰用户正在看的窗口：
 *   1. 建分组 + 两条快捷命令（含参数模板）
 *   2. 设置面板「快捷命令」区块能看到列表与分组
 *   3. 命令面板（⌘K）能搜到快捷命令并显示分组角标
 *   4. 含参数的快捷命令 → 填参弹窗 → 预览替换结果 → 确认后写入当前会话
 *   5. 终端右键菜单能列出快捷命令
 *
 * 运行：node src/e2e/verify-snippet.manual.ts
 */
import { spawn, ChildProcess, execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import puppeteer, { Browser, Page } from 'puppeteer-core'

const DEBUG_PORT = 9345
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')
const RENDERER_URL = 'http://localhost:5173'

let electronLog = ''
let userDataDir = ''

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

async function main(): Promise<void> {
  userDataDir = mkdtempSync(join(tmpdir(), 'tx-snippet-'))
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RENDERER_URL: RENDERER_URL }
  delete env.ELECTRON_RUN_AS_NODE

  const electron: ChildProcess = spawn(
    ELECTRON_BIN,
    [APP_ROOT, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`],
    { env }
  )
  electron.stdout?.on('data', (d: Buffer) => (electronLog += d.toString()))
  electron.stderr?.on('data', (d: Buffer) => (electronLog += d.toString()))

  let browser: Browser | null = null
  try {
    await waitForPage()
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
    const pages = await browser.pages()
    const page: Page = pages[0]
    await page.bringToFront()
    focusWindow(electron.pid ?? 0)

    // 等 Vue 应用挂载
    await page.waitForFunction(
      () => !!(document.querySelector('#app') as { __vue_app__?: unknown })?.__vue_app__,
      { timeout: 30000 }
    )

    // 1. 建分组与两条快捷命令
    const created = await page.evaluate(async () => {
      const group = await window.api.createSnippetGroup('服务运维')
      const withParam = await window.api.upsertSnippet({
        name: '重启服务',
        command: 'systemctl restart {service}',
        description: '重启指定服务',
        groupId: group.id
      })
      const plain = await window.api.upsertSnippet({
        name: '查看磁盘',
        command: 'df -h',
        description: '磁盘使用情况',
        autoEnter: true
      })
      return { group: group.name, withParam: withParam.name, plain: plain.name }
    })
    console.log('[verify] 已创建:', JSON.stringify(created))

    // 刷新渲染层缓存，并注入一个假窗格（提供"当前会话"）
    await page.evaluate(() => {
      const app = (
        document.querySelector('#app') as unknown as {
          __vue_app__: {
            config: { globalProperties: { $pinia: { _s: Map<string, unknown> } } }
          }
        }
      ).__vue_app__
      const pinia = app.config.globalProperties.$pinia
      const snippetStore = pinia._s.get('snippets') as { load(): Promise<void> }
      void snippetStore.load()
      const workspace = pinia._s.get('workspace') as {
        createTab(title: string): { id: string; focusedPaneId: string }
        panes: Record<string, { sessionId: string | null; status: string }>
      }
      const tab = workspace.createTab('验证')
      const pane = workspace.panes[tab.focusedPaneId]
      pane.sessionId = 'fake-session-for-snippet'
      pane.status = 'connected'
    })

    // 记录下发内容（拦截 TextEncoder，contextBridge 的 api 对象不可改写）
    await page.evaluate(() => {
      const w = window as unknown as { __sent?: string[] }
      w.__sent = []
      const Orig = window.TextEncoder
      class SpyEncoder extends Orig {
        override encode(input?: string): ReturnType<typeof Orig.prototype.encode> {
          w.__sent?.push(String(input))
          return super.encode(input)
        }
      }
      window.TextEncoder = SpyEncoder as unknown as typeof TextEncoder
    })

    await new Promise((r) => setTimeout(r, 800))

    // 2. 设置面板「快捷命令」区块
    await page.evaluate(() => {
      const btn = document.querySelector('.settings-entry-btn') as HTMLElement | null
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForSelector('.settings-window', { timeout: 10000 })
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.nav-item'))
      const hit = items.find((el) => el.textContent?.trim() === '快捷命令')
      hit?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForSelector('.snippet-manager', { timeout: 10000 })
    const manager = await page.evaluate(() => ({
      sections: Array.from(document.querySelectorAll('.snippet-section-name')).map((el) =>
        el.textContent?.trim()
      ),
      rows: Array.from(document.querySelectorAll('.snippet-row-name')).map((el) =>
        el.textContent?.trim()
      ),
      commands: Array.from(document.querySelectorAll('.snippet-row-command')).map((el) =>
        el.textContent?.trim()
      )
    }))
    console.log('[verify] 管理界面:', JSON.stringify(manager))
    await page.screenshot({ path: '/tmp/terminalx-snippet-manager.png' })

    // 关闭设置
    await page.evaluate(() => {
      const btn = document.querySelector('.settings-window .close-btn') as HTMLElement | null
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 500))

    // 3. 命令面板搜索
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })
      )
    })
    await page.waitForSelector('.cmd-palette', { timeout: 10000 })
    await page.evaluate(() => {
      const input = document.querySelector('.cmd-input') as HTMLInputElement | null
      if (!input) return
      input.value = '重启'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 400))
    const palette = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.cmd-item')).map((el) => ({
        label: el.querySelector('.cmd-label')?.textContent?.trim(),
        desc: el.querySelector('.cmd-desc')?.textContent?.trim(),
        category: el.querySelector('.cmd-category')?.textContent?.trim()
      }))
    )
    console.log('[verify] 命令面板结果:', JSON.stringify(palette))

    // 4. 选中含参数的快捷命令 → 填参确认
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.cmd-item'))
      const hit = items.find(
        (el) => el.querySelector('.cmd-label')?.textContent?.trim() === '重启服务'
      )
      hit?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await page.waitForSelector('.el-dialog', { timeout: 10000 })
    await new Promise((r) => setTimeout(r, 400))
    const dialogVisible = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('.el-dialog'))
      return dialogs.some((el) => el.getClientRects().length > 0)
    })
    console.log('[verify] 填参弹窗可见:', dialogVisible)

    await page.evaluate(() => {
      const input = document.querySelector(
        '.el-dialog .snippet-run-field input'
      ) as HTMLInputElement | null
      if (!input) return
      input.value = 'nginx'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 300))
    const preview = await page.evaluate(() =>
      document.querySelector('.snippet-run-preview')?.textContent?.trim()
    )
    console.log('[verify] 命令预览:', preview)
    await page.screenshot({ path: '/tmp/terminalx-snippet-dialog.png' })

    await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('.el-dialog .el-dialog__footer .el-button')
      )
      const run = buttons.find((el) => el.textContent?.trim() === '执行')
      run?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await new Promise((r) => setTimeout(r, 600))
    const sent = await page.evaluate(
      () => (window as unknown as { __sent?: string[] }).__sent ?? []
    )
    console.log('[verify] 下发记录(含参数):', JSON.stringify(sent))

    // 5. 无参数且开启自动回车的快捷命令：应带 \r 一次下发
    // （上一步执行成功后命令面板已关闭，这里重新打开）
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })
      )
    })
    await page.waitForSelector('.cmd-palette', { timeout: 10000 })
    await page.evaluate(() => {
      const input = document.querySelector('.cmd-input') as HTMLInputElement | null
      if (!input) return
      input.value = '查看磁盘'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 400))
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.cmd-item'))
      const hit = items.find(
        (el) => el.querySelector('.cmd-label')?.textContent?.trim() === '查看磁盘'
      )
      hit?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await new Promise((r) => setTimeout(r, 600))
    const sentAll = await page.evaluate(
      () => (window as unknown as { __sent?: string[] }).__sent ?? []
    )
    console.log('[verify] 下发记录(全部):', JSON.stringify(sentAll))

    // 5. 终端右键菜单
    await page.evaluate(() => {
      const shell = document.querySelector('.terminal-container') as HTMLElement | null
      shell?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 220,
          clientY: 160
        })
      )
    })
    await new Promise((r) => setTimeout(r, 400))
    const menu = await page.evaluate(() => ({
      visible: !!document.querySelector('.terminal-menu'),
      groups: Array.from(document.querySelectorAll('.terminal-menu-group')).map((el) =>
        el.textContent?.trim()
      ),
      items: Array.from(document.querySelectorAll('.terminal-menu-item-name')).map((el) =>
        el.textContent?.trim()
      )
    }))
    console.log('[verify] 右键菜单:', JSON.stringify(menu))
    await page.screenshot({ path: '/tmp/terminalx-snippet.png' })

    console.log('[verify] OK')
  } catch (err) {
    console.error('[verify] 失败:', err)
    console.error('[verify] electron 日志尾部:\n', electronLog.slice(-2000))
    process.exitCode = 1
  } finally {
    await browser?.disconnect()
    electron.kill()
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
  }
}

void main()
