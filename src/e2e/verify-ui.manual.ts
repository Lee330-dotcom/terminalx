/**
 * 任务 8.1 手动验证脚本（不进入默认 e2e include）：
 * 真实 Electron 应用 UI + 本地临时 sshd（/tmp/ssh-e2e，端口 22222，含 internal-sftp）
 * 清单：建连接 → 开终端 → SFTP 面板浏览/上传/下载 → 关闭标签断开 → 重新连接
 * 前置：/usr/sbin/sshd -f /tmp/ssh-e2e/sshd_config -E /tmp/ssh-e2e/sshd.log
 * 运行：npx vitest run --config vitest.manual.config.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess, execSync } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import puppeteer, { Browser } from 'puppeteer-core'

const DEBUG_PORT = 9555
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')
const SSHD_PORT = 22222
const CLIENT_KEY = '/tmp/ssh-e2e/client_key'

let electron: ChildProcess | null = null
let browser: Browser | null = null
let userDataDir: string

async function sshdReady(): Promise<boolean> {
  try {
    execSync(
      `ssh -p ${SSHD_PORT} -i ${CLIENT_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=3 $USER@127.0.0.1 'exit 0'`,
      { stdio: 'pipe' }
    )
    return true
  } catch {
    return false
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

async function doubleClickTreeNode(page: import('puppeteer-core').Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    const nodes = Array.from(document.querySelectorAll('.tree-node'))
    const target = nodes.find((el) => el.textContent?.trim() === n)
    if (!target) throw new Error(`tree node not found: ${n}`)
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  }, name)
}

beforeAll(async () => {
  if (!(await sshdReady())) {
    throw new Error('临时 sshd 未运行，请先执行 /usr/sbin/sshd -f /tmp/ssh-e2e/sshd_config -E /tmp/ssh-e2e/sshd.log')
  }
  userDataDir = await fs.mkdtemp(join(tmpdir(), 'ssh-tool-ui-verify-'))
  electron = spawn(
    ELECTRON_BIN,
    [APP_ROOT, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`],
    { stdio: 'ignore', env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' } }
  )
  await waitForPage()
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
}, 60000)

afterAll(async () => {
  await browser?.disconnect()
  electron?.kill()
  try {
    execSync(
      `ssh -p ${SSHD_PORT} -i ${CLIENT_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@127.0.0.1 'rm -f /Users/$USER/ui_verify_upload.txt'`,
      { stdio: 'pipe' }
    )
  } catch {
    /* 忽略 */
  }
})

describe('任务 8.1：真实 sshd 上的 UI 手工清单（CDP 驱动）', () => {
  it('建连接 → 开终端 → SFTP 浏览/上传/下载 → 断开 → 重连', async () => {
    const page = (await browser!.pages())[0]

    // 1. 建连接
    const keyContent = await fs.readFile(CLIENT_KEY, 'utf8')
    await page.evaluate(
      ({ key, username, port }) =>
        window.api.createConnection({
          name: 'ui-verify',
          groupId: null,
          host: '127.0.0.1',
          port,
          username,
          authType: 'privateKey',
          privateKeyContent: key
        }),
      { key: keyContent, username: process.env.USER ?? '', port: SSHD_PORT }
    )
    const conns = await page.evaluate(() => window.api.listConnections())
    const conn = conns.find((c) => c.name === 'ui-verify')
    expect(conn).toBeTruthy()
    await page.reload()
    await page.waitForFunction(() => document.body.textContent?.includes('ui-verify'), {
      timeout: 15000
    })
    console.log('[verify] 1. 建连接 OK')

    // 2. 双击开终端，等真实 sshd 的 shell 提示符
    await doubleClickTreeNode(page, 'ui-verify')
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
    const promptText = await page.evaluate(
      () => document.querySelector('.xterm-rows')?.textContent ?? ''
    )
    expect(promptText).toContain(process.env.USER ?? '')
    console.log('[verify] 2. 开终端 OK（真实 sshd 提示符）')

    // 3. 打开文件面板，浏览 /tmp 目录
    await page.click('.sftp-toggle')
    await page.waitForFunction(() => document.querySelector('.sftp-panel'), { timeout: 15000 })
    // 等目录加载
    await page.waitForFunction(
      () =>
        document.querySelector('.sftp-list')?.textContent?.includes('ssh-e2e') ||
        document.querySelector('.sftp-list .entry-name'),
      { timeout: 20000 }
    )
    const listText = await page.evaluate(() => document.querySelector('.sftp-list')?.textContent)
    console.log('[verify] 3. SFTP 面板初始目录:', String(listText).slice(0, 150).replace(/\s+/g, ' '))
    const pathBar = await page.evaluate(() => document.querySelector('.path-bar')?.textContent)
    console.log('[verify] 3. 路径栏:', String(pathBar).slice(0, 80))

    // 双击 Users 目录行进入（/tmp 是 symlink，lstat 不跟随，避开）
    const clicked = await page.evaluate(() => {
      const names = Array.from(document.querySelectorAll('.sftp-list .entry-name'))
      const target = names.find(
        (el) => (el.textContent ?? '').replace(/[^\x00-\x7f]/g, '').trim() === 'Users'
      )
      const row = target?.closest('tr')
      if (!row) return false
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      return true
    })
    expect(clicked).toBe(true)
    // 面包屑路径栏出现 Users 即进入成功
    await page.waitForFunction(
      () => document.querySelector('.path-bar')?.textContent?.includes('Users'),
      { timeout: 20000 }
    )
    console.log('[verify] 3b. 双击目录进入 /Users OK')

    // 进入当前用户目录，上传/下载都在此目录进行（等列表异步加载出用户名再点）
    const username = process.env.USER ?? ''
    await page.waitForFunction(
      (u) => document.querySelector('.sftp-list')?.textContent?.includes(u),
      { timeout: 20000 },
      username
    )
    console.log('[verify] 3c. /Users 列表已加载')
    const entered = await page.evaluate((u) => {
      const names = Array.from(document.querySelectorAll('.sftp-list .entry-name'))
      const target = names.find(
        (el) => (el.textContent ?? '').replace(/[^\x00-\x7f]/g, '').trim() === u
      )
      const row = target?.closest('tr')
      if (!row) return false
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      return true
    }, username)
    expect(entered).toBe(true)
    await page.waitForFunction(
      (u) => document.querySelector('.path-bar')?.textContent?.includes(u),
      { timeout: 20000 },
      username
    )
    console.log('[verify] 3d. 进入用户目录 OK')

    // 4. 上传：真实 IPC 传输 1MB 文件（文件对话框无法自动化，拖拽/进度条留人工验证）
    const marker = `ui-verify-${Date.now()}`
    const localFile = join(tmpdir(), 'ui-verify-local.txt')
    const bigContent = `ui upload content ${marker}\n` + 'x'.repeat(1024 * 1024)
    await fs.writeFile(localFile, bigContent)
    const remoteUploadPath = `/Users/${username}/ui_verify_upload.txt`
    await page.evaluate(
      ({ id, local, remote }) => window.api.sftpUpload(id, local, remote),
      { id: conn!.id, local: localFile, remote: remoteUploadPath }
    )
    // 等远端文件出现（传输完成）
    const deadline = Date.now() + 30000
    let remoteCheck = ''
    while (Date.now() < deadline) {
      try {
        remoteCheck = execSync(
          `ssh -p ${SSHD_PORT} -i ${CLIENT_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@127.0.0.1 'wc -c ${remoteUploadPath}'`,
          { encoding: 'utf8' }
        )
        if (remoteCheck.includes(String(bigContent.length))) break
      } catch {
        /* 文件还没出现 */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(remoteCheck).toContain(String(bigContent.length))
    console.log('[verify] 4. 上传完成，远端字节数一致（', bigContent.length, '字节）')

    // 面包屑往返（回 /Users 再进入用户目录）触发列表刷新，应看到新文件
    await page.evaluate(() => {
      const parts = Array.from(document.querySelectorAll('.path-part'))
      const users = parts.find((el) => el.textContent?.trim() === 'Users')
      users?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForFunction(
      (u) => document.querySelector('.sftp-list')?.textContent?.includes(u),
      { timeout: 20000 },
      username
    )
    await page.evaluate((u) => {
      const names = Array.from(document.querySelectorAll('.sftp-list .entry-name'))
      const target = names.find(
        (el) => (el.textContent ?? '').replace(/[^\x00-\x7f]/g, '').trim() === u
      )
      const row = target?.closest('tr')
      row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    }, username)
    await page.waitForFunction(
      () => document.querySelector('.sftp-list')?.textContent?.includes('ui_verify_upload.txt'),
      { timeout: 20000 }
    )
    console.log('[verify] 4b. 刷新后面板列表显示新上传文件')

    // 5. 下载并比对
    const downloadPath = join(tmpdir(), 'ui-verify-downloaded.txt')
    await page.evaluate(
      ({ id, remote, local }) => window.api.sftpDownload(id, remote, local),
      { id: conn!.id, remote: remoteUploadPath, local: downloadPath }
    )
    const dlDeadline = Date.now() + 30000
    while (Date.now() < dlDeadline) {
      try {
        const st = await fs.stat(downloadPath)
        if (st.size === bigContent.length) break
      } catch {
        /* 还没写完 */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    const downloaded = await fs.readFile(downloadPath, 'utf8')
    expect(downloaded).toContain(marker)
    expect(downloaded.length).toBe(bigContent.length)
    console.log('[verify] 5. 下载完成，内容一致')

    // 6. 关闭标签（断开）→ 重新双击连接
    await page.click('.tab-close')
    await page.waitForFunction(() => document.querySelectorAll('.xterm-rows').length === 0, {
      timeout: 15000
    })
    await doubleClickTreeNode(page, 'ui-verify')
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
    console.log('[verify] 6. 断开重连 OK')
  }, 120000)
})
