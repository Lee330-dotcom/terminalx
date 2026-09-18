/**
 * 设置面板手动验证脚本（不进入默认 e2e include）：
 * 真实 Electron 应用 + 临时 userData，CDP 驱动：
 * 打开设置 → 四个页面截图 → 主题色/背景色切换生效 → MCP 工具禁用实测
 * 运行：npx vitest run --config vitest.manual.config.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import { promises as fs, openSync, closeSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import puppeteer, { Browser, Page } from 'puppeteer-core'

const DEBUG_PORT = 9556
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')

let electron: ChildProcess | null = null
let browser: Browser | null = null
let userDataDir: string
let logFd: number | null = null

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

async function shot(page: Page, name: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 600))
  await page.screenshot({ path: `/tmp/tx-settings-${name}.png` })
  console.log(`[shot] /tmp/tx-settings-${name}.png`)
}

async function clickNav(page: Page, label: string): Promise<void> {
  await page.evaluate((n) => {
    const items = Array.from(document.querySelectorAll('.nav-item'))
    const target = items.find((el) => el.textContent?.trim() === n)
    if (!target) throw new Error(`nav item not found: ${n}`)
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, label)
  await new Promise((r) => setTimeout(r, 500))
}

beforeAll(async () => {
  userDataDir = await fs.mkdtemp(join(tmpdir(), 'terminalx-settings-verify-'))
  logFd = openSync('/tmp/tx-settings-electron.log', 'a')
  const proc = spawn(
    ELECTRON_BIN,
    [APP_ROOT, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`],
    {
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
    }
  )
  electron = proc
  proc.on('exit', (code, sig) => console.log('[dbg] electron exited', code, sig))
  await waitForPage()
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
}, 60000)

afterAll(async () => {
  await browser?.disconnect()
  electron?.kill()
  if (logFd !== null) closeSync(logFd)
})

describe('设置面板：四页截图 + 主题切换 + MCP 工具禁用', () => {
  it('打开设置，四页截图，主题生效，工具禁用生效', async () => {
    const page = (await browser!.pages())[0]
    await page.setViewport({ width: 1200, height: 760 })

    // 播种一条连接，保证主界面不空
    await page.evaluate(() =>
      window.api.createConnection({
        name: 'demo-01',
        groupId: null,
        host: '10.132.0.70',
        port: 22,
        username: 'root',
        authType: 'password',
        password: 'x'
      })
    )
    await page.reload()
    await page.waitForFunction(() => document.body.textContent?.includes('demo-01'), {
      timeout: 15000
    })

    // 打开设置
    await page.click('.gear-btn')
    await page.waitForFunction(() => document.querySelector('.settings-overlay'), {
      timeout: 15000
    })
    page.on('console', (msg) => console.log('[renderer]', msg.type(), msg.text()))
    await shot(page, '1-theme')

    // 主题色切换为蓝色，验证 CSS 变量与按钮颜色（前 6 个 swatch 为主题色预设）
    const swatches = await page.$$('.swatch')
    for (let i = 0; i < swatches.length; i++) {
      const bg = await swatches[i].evaluate((el) => (el as HTMLElement).style.background)
      console.log(`[swatch ${i}]`, bg)
    }
    await swatches[1].click()
    await new Promise((r) => setTimeout(r, 800))
    const primaryVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--el-color-primary').trim()
    )
    expect(primaryVar).toBe('#409eff')
    console.log('[verify] 主题色切换生效:', primaryVar)

    // 背景色切换为深蓝预设（前 6 个为主题色 swatch，背景色从索引 6 开始，#0b1526 是第 3 个）
    await swatches[8].click()
    await new Promise((r) => setTimeout(r, 800))
    const bgVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--tx-bg').trim()
    )
    expect(bgVar).toBe('#0b1526')
    console.log('[verify] 背景色切换生效:', bgVar)
    await shot(page, '2-theme-changed')

    // 背景预设：点「朱红」三件套（主题色/背景/导航栏）一次生效
    await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.preset-tile'))
      const tile = tiles.find((el) => el.textContent?.includes('朱红'))
      tile?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 800))
    const sPreset = JSON.parse(await fs.readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      themeColor?: string
      backgroundColor?: string
      navColor?: string
    }
    expect(sPreset.themeColor).toBe('#dc2626')
    expect(sPreset.backgroundColor).toBe('#1a0e0e')
    expect(sPreset.navColor).toBe('#241414')
    const navVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--tx-nav').trim()
    )
    expect(navVar).toBe('#241414')
    console.log('[verify] 背景预设三件套生效, 导航栏 --tx-nav:', navVar)
    await shot(page, '2b-preset-crimson')

    // 恢复默认外观
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.settings-header .el-button'))
      const btn = btns.find((el) => el.textContent?.includes('恢复默认外观'))
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 800))
    const sRestored = JSON.parse(await fs.readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      themeColor?: string
      backgroundColor?: string
      navColor?: string
    }
    expect(sRestored.themeColor).toBe('#10b981')
    expect(sRestored.backgroundColor).toBe('#0d0d0d')
    expect(sRestored.navColor).toBe('#151515')
    console.log('[verify] 恢复默认外观生效')
    await shot(page, '2c-restored')

    // 浅色主题（明亮预设）：html.dark 移除，面板/文字变量切换，验证可读性
    await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.preset-tile'))
      const tile = tiles.find((el) => el.textContent?.includes('明亮'))
      tile?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 800))
    const isDarkAfterBright = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    )
    expect(isDarkAfterBright).toBe(false)
    const lightText = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--tx-text').trim()
    )
    expect(lightText).toContain('0, 0, 0')
    const lightPanel = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--tx-card').trim()
    )
    expect(lightPanel).toBe('#ffffff')
    console.log('[verify] 浅色主题变量切换生效, --tx-text:', lightText)
    await shot(page, '2d-light-preset')

    // 回到暗夜预设（跟随系统暗色路径）
    await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.preset-tile'))
      const tile = tiles.find((el) => el.textContent?.includes('暗夜'))
      tile?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 800))
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
      true
    )
    console.log('[verify] 暗夜预设恢复 html.dark')

    // 软件更新
    await clickNav(page, '软件更新')
    const versionText = await page.evaluate(
      () => document.querySelector('.settings-scroll')?.textContent ?? ''
    )
    expect(versionText).toContain('terminalX v1.0.0')
    expect(versionText).toContain('更新日志')
    await shot(page, '3-update')

    // MCP 服务（避开本机 dev 实例占用的 8080，改用 8090 触发 MCP 重启）
    await page.evaluate(() => window.api.updateSettings({ mcpPort: 8090 }))
    await new Promise((r) => setTimeout(r, 1500))
    await clickNav(page, 'MCP 服务')
    const countBefore = await page.evaluate(
      () => document.querySelector('.tool-count')?.textContent ?? ''
    )
    expect(countBefore).toContain('7 / 7')
    console.log('[verify] 工具启用计数:', countBefore.trim())
    await shot(page, '4-mcp')

    // 禁用 exec_command，验证 tools/list 不再返回
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.tool-row'))
      const row = rows.find((el) => el.textContent?.includes('exec_command'))
      const sw = row?.querySelector('.el-switch')
      sw?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 1500))
    const settings = JSON.parse(await fs.readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      mcpDisabledTools?: string[]
      mcpToken?: string
      mcpPort?: number
      themeColor?: string
      backgroundColor?: string
    }
    expect(settings.mcpDisabledTools).toContain('exec_command')
    // 恢复默认外观后主题回到默认值
    expect(settings.themeColor).toBe('#10b981')
    expect(settings.backgroundColor).toBe('#0d0d0d')
    const countAfter = await page.evaluate(
      () => document.querySelector('.tool-count')?.textContent ?? ''
    )
    expect(countAfter).toContain('6 / 7')
    console.log('[verify] 禁用后工具计数:', countAfter.trim())

    // 通过真实 HTTP 请求验证工具列表
    const port = settings.mcpPort ?? 8080
    const token = settings.mcpToken ?? ''
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })
    const text = await res.text()
    let payload: { result?: { tools?: { name: string }[] } }
    if (text.trimStart().startsWith('{')) {
      payload = JSON.parse(text) as typeof payload
    } else {
      const lines = text.split('\n').filter((l) => l.startsWith('data:'))
      payload = JSON.parse(lines[lines.length - 1].slice(5).trim()) as typeof payload
    }
    const toolNames = (payload.result?.tools ?? []).map((t) => t.name)
    expect(toolNames).not.toContain('exec_command')
    expect(toolNames).toContain('sftp_list')
    expect(toolNames.length).toBe(6)
    console.log('[verify] MCP 工具禁用生效，剩余工具:', toolNames.join(', '))
    await shot(page, '5-mcp-tool-disabled')

    // 备份恢复
    await clickNav(page, '备份恢复')
    const backupText = await page.evaluate(
      () => document.querySelector('.settings-scroll')?.textContent ?? ''
    )
    expect(backupText).toContain('导出设置')
    expect(backupText).toContain('导入设置')
    console.log('[verify] 备份恢复页 OK')
    await shot(page, '6b-backup')

    // 系统配置
    await clickNav(page, '系统配置')
    await shot(page, '6-system')

    // 语言切换 English：立即生效（documentElement.lang + 侧栏文案）
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('.el-select'))
      selects[selects.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 500))
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.el-select-dropdown__item'))
      const item = items.find((el) => el.textContent?.trim() === 'English')
      item?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 800))
    const docLang = await page.evaluate(() => document.documentElement.lang)
    expect(docLang).toBe('en-US')
    const sideText = await page.evaluate(
      () => document.querySelector('.settings-sidebar')?.textContent ?? ''
    )
    expect(sideText).toContain('Settings')
    expect(sideText).toContain('Backup')
    const sLang = JSON.parse(await fs.readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      language?: string
    }
    expect(sLang.language).toBe('en-US')
    console.log('[verify] 语言切换生效: en-US')
    await shot(page, '6c-system-en')

    // 切回中文
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('.el-select'))
      selects[selects.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 500))
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.el-select-dropdown__item'))
      const item = items.find((el) => el.textContent?.trim() === '中文')
      item?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 800))
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-CN')
    console.log('[verify] 语言切回中文 OK')

    // 主界面浅色截图：切明亮 → 关设置看主界面 → 重开设置切回暗夜
    await clickNav(page, '主题界面')
    await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.preset-tile'))
      tiles
        .find((el) => el.textContent?.includes('明亮'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 800))
    await page.evaluate(() => {
      const btn = document.querySelector('.settings-overlay .close-btn')
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForFunction(() => !document.querySelector('.settings-overlay'), {
      timeout: 10000
    })
    await shot(page, '7-main-light')

    await page.click('.gear-btn')
    await page.waitForFunction(() => document.querySelector('.settings-overlay'), {
      timeout: 10000
    })
    await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.preset-tile'))
      tiles
        .find((el) => el.textContent?.includes('暗夜'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 800))

    // 关闭设置（点击关闭按钮，避免下拉框残留拦截 ESC）
    await page.evaluate(() => {
      const btn = document.querySelector('.settings-overlay .close-btn')
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForFunction(() => !document.querySelector('.settings-overlay'), {
      timeout: 10000
    })
    console.log('[verify] 主界面浅色/暗夜切换与关闭设置 OK')
  }, 120000)
})
