/**
 * 手动验证：SFTP 传输框状态可见 + 「下载记录」入口。
 *
 * 跑法：本地 dev server（npm run dev）起着的情况下执行
 *   npx tsx src/e2e/verify-transfer-history.manual.ts
 *
 * 流程：起本地测试 SSH 服务器 → 起第二个 Electron 实例连 dev server →
 * 连上测试机打开文件工作区 → 注入一条已完成的下载条目 →
 * 断言传输框仍显示该条目（回归：完成后「闪一下就没了」）→
 * 打开「下载记录」抽屉并截图。
 */
import { spawn, ChildProcess, execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import puppeteer, { Browser } from 'puppeteer-core'
import { startTestSshServer, TestSshServer } from '../main/ssh/__tests__/testSshServer'
import { autoTrustHostKeys, waitNoHostKeyDialog } from './hostKeyHelper'

const DEBUG_PORT = 9347
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')
const RENDERER_URL = 'http://localhost:5173'

let electronLog = ''

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
  let server: TestSshServer | null = null
  let electron: ChildProcess | null = null
  let browser: Browser | null = null
  const userDataDir = await fs.mkdtemp(join(tmpdir(), 'terminalx-transfer-'))
  try {
    server = await startTestSshServer()

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RENDERER_URL: RENDERER_URL,
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    }
    // ELECTRON_RUN_AS_NODE 会让 Electron 以纯 Node 模式启动（连不上渲染进程）
    delete env.ELECTRON_RUN_AS_NODE

    electron = spawn(
      ELECTRON_BIN,
      [
        APP_ROOT,
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${userDataDir}`
      ],
      { env }
    )
    electron.stdout?.on('data', (d: Buffer) => (electronLog += d.toString()))
    electron.stderr?.on('data', (d: Buffer) => (electronLog += d.toString()))

    await waitForPage()
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
    const pages = await browser.pages()
    const page = pages[0]
    await page.bringToFront()
    focusWindow(electron.pid ?? 0)
    await autoTrustHostKeys(page)

    // 等 Vue 应用挂载
    await page.waitForFunction(
      () => !!(document.querySelector('#app') as unknown as { __vue_app__?: unknown })?.__vue_app__,
      { timeout: 20000 }
    )

    // 建一个指向本地测试服务器的连接并连上，文件工作区会自动出现
    await page.evaluate(
      (port) =>
        window.api.createConnection({
          name: 'verify-transfer',
          groupId: null,
          host: '127.0.0.1',
          port,
          username: 'tester',
          authType: 'password',
          password: 'test-pass'
        }),
      server.port
    )
    await page.reload()
    await page.waitForFunction(
      () => document.body.textContent?.includes('verify-transfer'),
      { timeout: 15000 }
    )
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.conn-table .row'))
      const target = rows.find(
        (el) => el.querySelector('.conn-name')?.textContent?.trim() === 'verify-transfer'
      )
      if (!target) throw new Error('connection row not found')
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })
    await page.waitForSelector('.sftp-panel', { timeout: 20000 })
    await waitNoHostKeyDialog(page)
    focusWindow(electron.pid ?? 0)

    // 注入两条传输：一条已完成、一条失败
    await page.evaluate(() => {
      const app = (
        document.querySelector('#app') as unknown as {
          __vue_app__: {
            config: { globalProperties: { $pinia: { _s: Map<string, unknown> } } }
          }
        }
      ).__vue_app__
      const store = app.config.globalProperties.$pinia._s.get('transfers') as {
        transfers: Record<string, unknown>[]
      }
      const now = Date.now()
      store.transfers.push({
        id: 'v-done',
        direction: 'download',
        name: 'access.log',
        remotePath: '/var/log/access.log',
        localPath: '/tmp/access.log',
        transferred: 1048576,
        total: 1048576,
        status: 'done',
        startedAt: now - 5000
      })
      store.transfers.push({
        id: 'v-error',
        direction: 'download',
        name: 'error.log',
        remotePath: '/var/log/error.log',
        localPath: '/tmp/error.log',
        transferred: 0,
        total: 0,
        status: 'error',
        error: '连接中断',
        startedAt: now
      })
    })

    await page.waitForFunction(
      () => document.querySelector('.transfer-list')?.textContent?.includes('access.log'),
      { timeout: 10000 }
    )
    const transferText = await page.evaluate(
      () => document.querySelector('.transfer-list')?.textContent ?? ''
    )
    console.log('[verify] 传输框文本:', transferText.replace(/\s+/g, ' ').trim())
    if (!transferText.includes('已完成')) throw new Error('传输框未显示已完成状态')
    if (!transferText.includes('access.log')) throw new Error('传输框未保留已完成条目')

    await page.screenshot({ path: '/tmp/terminalx-transfer-panel.png' })

    // 打开「下载记录」
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.sftp-panel .tool-btn')).find(
        (b) => b.getAttribute('title') === '下载记录'
      ) as HTMLElement
      if (!btn) throw new Error('未找到下载记录入口')
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForFunction(
      () => !!document.querySelector('.el-drawer'),
      { timeout: 10000 }
    )
    await new Promise((r) => setTimeout(r, 600))
    const drawerText = await page.evaluate(
      () => document.querySelector('.el-drawer')?.textContent ?? ''
    )
    console.log('[verify] 记录抽屉文本:', drawerText.replace(/\s+/g, ' ').trim().slice(0, 200))
    await page.screenshot({ path: '/tmp/terminalx-transfer-records.png' })

    console.log('[verify] OK：传输条目完成后仍保留，「下载记录」抽屉可打开')
  } catch (err) {
    console.error('[verify] 失败:', err)
    if (electronLog) console.error('[verify] electron 日志尾部:', electronLog.slice(-3000))
    throw err
  } finally {
    await browser?.disconnect()
    electron?.kill()
    server?.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
}

void main()
