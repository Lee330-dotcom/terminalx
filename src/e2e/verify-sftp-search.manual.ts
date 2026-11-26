/**
 * 手动验证：文件工作区的「按文件名搜索」。
 *
 * 用真实 Electron + 用户默认 userData（连接真实堡垒机）跑一遍：
 * 打开连接 → 文件工作区出现 → 搜索文件名 → 结果渐进出现。
 *
 * 运行：node src/e2e/verify-sftp-search.manual.ts [关键字]
 */
import { spawn, ChildProcess, execFileSync } from 'child_process'
import { resolve } from 'path'
import puppeteer, { Browser, Page } from 'puppeteer-core'

const DEBUG_PORT = 9337
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')
const KEYWORD = process.argv[2] ?? 'docx'

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

async function getPage(browser: Browser, pid: number): Promise<Page> {
  const pages = await browser.pages()
  const page = pages[0]
  await page.bringToFront()
  focusWindow(pid)
  return page
}

async function main(): Promise<void> {
  const electron: ChildProcess = spawn(
    ELECTRON_BIN,
    [APP_ROOT, `--remote-debugging-port=${DEBUG_PORT}`],
    { env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' } }
  )
  electron.stdout?.on('data', (d: Buffer) => (electronLog += d.toString()))
  electron.stderr?.on('data', (d: Buffer) => (electronLog += d.toString()))

  let browser: Browser | null = null
  try {
    await waitForPage()
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
    const page = await getPage(browser, electron.pid ?? 0)

    const conns = await page.evaluate(() =>
      window.api.listConnections().then((list) =>
        list.map((c) => ({ id: c.id, name: c.name, host: c.host, port: c.port }))
      )
    )
    console.log('[verify] 连接列表:', conns.map((c) => `${c.name}(${c.host}:${c.port})`).join(', '))

    const target = conns.find((c) => c.name.includes('data-asset-prod')) ?? conns[0]
    if (!target) throw new Error('没有可用连接')

    // 双击连接行 → 建连 → 打开终端
    await page.evaluate((name) => {
      const names = Array.from(document.querySelectorAll('.conn-name'))
      const hit = names.find((el) => el.textContent?.trim() === name)
      const row = hit?.closest('.row') ?? hit
      if (!row) throw new Error(`未找到连接行: ${name}`)
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    }, target.name)

    // 文件工作区在会话 connected 后出现
    await page.waitForSelector('.sftp-panel', { timeout: 60000 })
    console.log('[verify] 文件工作区已出现')

    // 目录树加载完成
    await page.waitForFunction(
      () => document.querySelectorAll('.sftp-tree .tree-item').length > 0,
      { timeout: 60000 }
    )
    const treeTop = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.sftp-tree .tree-item .tree-name'))
        .slice(0, 8)
        .map((el) => el.textContent?.trim())
    )
    console.log('[verify] 目录树首屏:', treeTop.join(' | '))

    // 1. 默认收起搜索框，点放大镜才拉出
    const beforeOpen = await page.evaluate(() => {
      const box = document.querySelector('.sftp-search') as HTMLElement | null
      return {
        exists: !!box,
        visible: box ? getComputedStyle(box).display !== 'none' : false,
        toggle: !!document.querySelector('.search-toggle')
      }
    })
    console.log('[verify] 初始搜索框:', JSON.stringify(beforeOpen))
    await page.click('.search-toggle')
    await page.waitForFunction(
      () => {
        const box = document.querySelector('.sftp-search') as HTMLElement | null
        return !!box && getComputedStyle(box).display !== 'none'
      },
      { timeout: 10000 }
    )
    console.log('[verify] 放大镜已拉出搜索框')

    // 2. 输入即搜索：只输入，不按回车
    await page.click('.sftp-search .search-input')
    await page.type('.sftp-search .search-input', KEYWORD)
    console.log(
      '[verify] 输入框状态:',
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('.search-input'))
        return JSON.stringify({
          count: inputs.length,
          value: inputs.map((i) => (i as HTMLInputElement).value),
          active: document.activeElement?.className
        })
      })
    )

    // 3. 范围标识：分段控件，当前选中项高亮
    console.log(
      '[verify] 范围控件:',
      await page.evaluate(() =>
        JSON.stringify(
          Array.from(document.querySelectorAll('.search-scope .scope-opt')).map((el) => ({
            text: el.textContent?.trim(),
            active: el.classList.contains('active')
          }))
        )
      )
    )

    // 轮询观察搜索过程
    const deadline = Date.now() + 120000
    let last = ''
    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(() => ({
        status: document.querySelector('.search-status')?.textContent?.trim() ?? '',
        count: document.querySelectorAll('.search-result').length,
        toast: document.querySelector('.el-message')?.textContent?.trim() ?? ''
      }))
      const line = `${snapshot.status} | 结果 ${snapshot.count} ${snapshot.toast}`
      if (line !== last) {
        console.log('[verify]', line)
        last = line
      }
      if (snapshot.count > 0) break
      await new Promise((r) => setTimeout(r, 2000))
    }

    const status = await page.evaluate(
      () => document.querySelector('.search-status')?.textContent?.trim()
    )
    console.log('[verify] 状态行:', status)

    const results = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.search-result')).map((el) => ({
        name: el.querySelector('.tree-name')?.textContent?.trim(),
        dir: el.querySelector('.search-result-dir')?.textContent?.trim(),
        hit: el.querySelector('.search-hit')?.textContent?.trim()
      }))
    )
    console.log(`[verify] 命中 ${results.length} 条，前 10 条:`)
    for (const r of results.slice(0, 10)) {
      console.log(`   ${r.name}  ←  ${r.dir}   [高亮: ${r.hit}]`)
    }
    await page.screenshot({ path: '/tmp/terminalx-sftp-search.png' })

    // 等搜索结束，确认状态行收尾
    await page
      .waitForFunction(
        () => !document.querySelector('.search-status-running'),
        { timeout: 90000 }
      )
      .catch(() => console.log('[verify] 搜索仍在进行中'))
    console.log(
      '[verify] 结束状态:',
      await page.evaluate(() => document.querySelector('.search-status')?.textContent?.trim())
    )

    // 点击结果 → 定位到所在目录并选中该文件
    await page.evaluate(() => {
      const first = document.querySelector('.search-result') as HTMLElement | null
      first?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await page.waitForFunction(
      () => (document.querySelector('.sftp-breadcrumb')?.textContent ?? '').length > 0,
      { timeout: 30000 }
    )
    // 等目录树加载完，命中文件应处于选中态
    const selectedName = await page
      .waitForFunction(
        () => document.querySelector('.tree-item.selected .tree-name')?.textContent?.trim() ?? '',
        { timeout: 30000 }
      )
      .then((handle) => handle.jsonValue())
      .catch(() => '(未选中)')
    const located = await page.evaluate(() => ({
      breadcrumb: document.querySelector('.sftp-breadcrumb')?.textContent?.trim()
    }))
    console.log('[verify] 定位结果:', JSON.stringify(located), '选中:', selectedName)

    // 在当前目录内再次搜索（验证范围跟随导航）
    await page.click('.sftp-search .search-input')
    await page.type('.sftp-search .search-input', '协议')
    await page.keyboard.press('Enter')
    await new Promise((r) => setTimeout(r, 3000))
    console.log(
      '[verify] 当前目录内搜索:',
      await page.evaluate(() => document.querySelector('.search-status')?.textContent?.trim()),
      '结果数',
      await page.evaluate(() => document.querySelectorAll('.search-result').length)
    )

    // 4. 切到「全盘」应立即按新范围重搜
    await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll('.search-scope .scope-opt'))
      const root = opts.find((el) => el.textContent?.trim() === '全盘')
      root?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await new Promise((r) => setTimeout(r, 2500))
    console.log(
      '[verify] 切到全盘:',
      await page.evaluate(() =>
        JSON.stringify({
          active: Array.from(document.querySelectorAll('.search-scope .scope-opt.active')).map(
            (el) => el.textContent?.trim()
          ),
          status: document.querySelector('.search-status')?.textContent?.trim(),
          count: document.querySelectorAll('.search-result').length
        })
      )
    )

    // 5. 再点放大镜应收起搜索框
    await page.click('.search-toggle')
    const collapsed = await page.evaluate(() => {
      const box = document.querySelector('.sftp-search') as HTMLElement | null
      return box ? getComputedStyle(box).display !== 'none' : false
    })
    console.log('[verify] 收起后搜索框可见:', collapsed)
    await page.click('.search-toggle')

    // 6. 连续输入：后一次搜索必须取消前一次，且不能出现通道冲突
    await page.click('.sftp-search .search-clear').catch(() => {})
    await page.evaluate(() => {
      const input = document.querySelector('.sftp-search .search-input') as HTMLInputElement | null
      if (input) {
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await page.click('.sftp-search .search-input')
    await page.type('.sftp-search .search-input', '协')
    await new Promise((r) => setTimeout(r, 900))
    await page.type('.sftp-search .search-input', '议')
    await new Promise((r) => setTimeout(r, 4000))
    console.log(
      '[verify] 连续输入后:',
      await page.evaluate(() => ({
        status: document.querySelector('.search-status')?.textContent?.trim(),
        count: document.querySelectorAll('.search-result').length
      }))
    )
    const logLines = electronLog
      .split('\n')
      .filter((l) => l.includes('搜索') || l.includes('Channel') || l.includes('失败'))
      .slice(-12)
    console.log('[verify] 主进程搜索日志:')
    for (const l of logLines) console.log('   ' + l.trim())

    console.log('[verify] OK')
    console.log('[verify] electron 日志尾部:\n', electronLog.slice(-2000))
  } catch (err) {
    console.error('[verify] 失败:', err)
    console.error('[verify] electron 日志尾部:\n', electronLog.slice(-3000))
    process.exitCode = 1
  } finally {
    await browser?.disconnect()
    electron.kill()
  }
}

void main()
