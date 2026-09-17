/**
 * 任务 8.2 手动验证脚本（不进入默认 e2e include）：
 * 真实 Electron 应用 + 本地临时 sshd（/tmp/ssh-e2e，端口 22222，含 internal-sftp）
 * 用 MCP SDK 客户端走完整协议：initialize → tools/list → 7 个工具逐一调用
 * 前置：/usr/sbin/sshd -f /tmp/ssh-e2e/sshd_config -E /tmp/ssh-e2e/sshd.log
 * 运行：npx vitest run --config vitest.manual.config.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess, execSync } from 'child_process'
import { createServer } from 'net'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import puppeteer, { Browser } from 'puppeteer-core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const DEBUG_PORT = 9444
const ELECTRON_BIN = resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const APP_ROOT = resolve('.')
const SSHD_PORT = 22222
const CLIENT_KEY = '/tmp/ssh-e2e/client_key'

let electron: ChildProcess | null = null
let browser: Browser | null = null
let userDataDir: string

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

beforeAll(async () => {
  if (!(await sshdReady())) {
    throw new Error('临时 sshd 未运行，请先执行 /usr/sbin/sshd -f /tmp/ssh-e2e/sshd_config -E /tmp/ssh-e2e/sshd.log')
  }
  userDataDir = await fs.mkdtemp(join(tmpdir(), 'ssh-tool-verify-'))
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
  // 清理远端测试文件
  try {
    execSync(
      `ssh -p ${SSHD_PORT} -i ${CLIENT_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@127.0.0.1 'rm -f /tmp/mcp_verify_upload.txt'`,
      { stdio: 'pipe' }
    )
  } catch {
    /* 忽略 */
  }
})

describe('任务 8.2：真实 sshd + 应用 MCP 全链路（SDK 客户端协议）', () => {
  it('initialize → tools/list → 7 个工具全部真实调用', async () => {
    const page = (await browser!.pages())[0]

    // 1. 建密钥认证连接（真实 sshd）
    const keyContent = await fs.readFile(CLIENT_KEY, 'utf8')
    await page.evaluate(
      ({ key, username }) =>
        window.api.createConnection({
          name: 'verify-sshd',
          groupId: null,
          host: '127.0.0.1',
          port: 22222,
          username,
          authType: 'privateKey',
          privateKeyContent: key
        }),
      { key: keyContent, username: process.env.USER ?? '' }
    )
    const conns = await page.evaluate(() => window.api.listConnections())
    const conn = conns.find((c) => c.name === 'verify-sshd')
    expect(conn).toBeTruthy()
    // 重新加载让连接树拿到最新数据
    await page.reload()
    await page.waitForFunction(
      () => document.body.textContent?.includes('verify-sshd'),
      { timeout: 15000 }
    )

    // 2. 设置 MCP 端口为随机空闲端口（默认 8080 可能被占用）
    const mcpPort = await getFreePort()
    await page.evaluate((port) => window.api.updateSettings({ mcpPort: port }), mcpPort)
    await new Promise((r) => setTimeout(r, 500))
    const settings = await page.evaluate(() => window.api.getSettings())
    expect(settings.mcpEnabled).toBe(true)
    expect(settings.mcpPort).toBe(mcpPort)
    const url = `http://127.0.0.1:${settings.mcpPort}/mcp`

    // 3. SDK 客户端完整协议
    const client = new Client({ name: 'verify-client', version: '1.0' })
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${settings.mcpToken}` } }
    })
    await client.connect(transport)

    const tools = await client.listTools()
    const names = tools.tools.map((t) => t.name).sort()
    console.log('[verify] tools:', names.join(', '))
    expect(names).toEqual(
      ['list_connections', 'list_sessions', 'exec_command', 'read_terminal', 'sftp_list', 'sftp_upload', 'sftp_download'].sort()
    )

    // list_connections：不含凭据
    const lc = await client.callTool({ name: 'list_connections', arguments: {} })
    const lcText = (lc.content as { text: string }[])[0].text
    expect(lcText).toContain('verify-sshd')
    for (const k of ['password', 'privateKeyContent', 'privateKeyFile', 'passphrase']) {
      expect(lcText).not.toContain(`"${k}"`)
    }
    console.log('[verify] list_connections OK（无凭据字段）')

    // list_sessions（此时无会话）
    const ls = await client.callTool({ name: 'list_sessions', arguments: {} })
    console.log('[verify] list_sessions OK:', (ls.content as { text: string }[])[0].text.slice(0, 80))

    // exec_command：真实执行
    const exec = await client.callTool({
      name: 'exec_command',
      arguments: { connection_id: conn!.id, command: 'whoami && echo hello-from-mcp' }
    })
    const execText = (exec.content as { text: string }[])[0].text
    expect(execText).toContain('hello-from-mcp')
    console.log('[verify] exec_command OK:', execText.slice(0, 120).replace(/\n/g, ' '))

    // 开一个真实终端会话（走 UI 双击流程），键盘输入命令供 read_terminal 读取
    await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.tree-node'))
      const target = nodes.find((el) => el.textContent?.trim() === 'verify-sshd')
      if (!target) throw new Error('tree node not found: verify-sshd')
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    })
    await page.waitForFunction(() => document.querySelector('.terminal-container'), {
      timeout: 15000
    })
    // 等真实 sshd 的 shell（zsh）就绪：提示符出现
    await page
      .waitForFunction(
        () => /~ % |\$ |# /.test(document.querySelector('.xterm-rows')?.textContent ?? ''),
        { timeout: 20000 }
      )
      .catch(() => {
        /* bash 提示符样式可能不同，继续尝试输入 */
      })
    await page.click('.terminal-container')
    await page.keyboard.type('echo terminal-read-check')
    await page.keyboard.press('Enter')
    await new Promise((r) => setTimeout(r, 2000))
    const sessions = await page.evaluate(() => window.api.listSessions())
    expect(sessions.length).toBeGreaterThan(0)

    // read_terminal：在含输入回显的会话上读取（防御可能存在的多余会话）
    let rtParsed: { lines: string[]; total_lines: number } = { lines: [], total_lines: 0 }
    for (const s of sessions) {
      const rt = await client.callTool({
        name: 'read_terminal',
        arguments: { session_id: s.id, lines: 50 }
      })
      const parsed = JSON.parse((rt.content as { text: string }[])[0].text) as {
        lines: string[]
        total_lines: number
      }
      if (parsed.lines.join('\n').includes('terminal-read-check')) {
        rtParsed = parsed
        break
      }
    }
    expect(rtParsed.lines.join('\n')).toContain('terminal-read-check')
    console.log('[verify] read_terminal OK（读到终端输入回显，共', rtParsed.total_lines, '行）')

    // sftp_list：真实目录
    const sl = await client.callTool({
      name: 'sftp_list',
      arguments: { connection_id: conn!.id, path: '/tmp' }
    })
    console.log('[verify] sftp_list /tmp OK:', (sl.content as { text: string }[])[0].text.slice(0, 100).replace(/\n/g, ' '))

    // sftp_upload：真实上传（内容含随机标记）
    const marker = `verify-${Date.now()}`
    const localFile = join(tmpdir(), 'mcp-verify-local.txt')
    await fs.writeFile(localFile, `mcp upload content ${marker}\n`)
    const up = await client.callTool({
      name: 'sftp_upload',
      arguments: {
        connection_id: conn!.id,
        local_path: localFile,
        remote_path: '/tmp/mcp_verify_upload.txt'
      }
    })
    expect((up.content as { text: string }[])[0].text).toContain('"ok":true')
    console.log('[verify] sftp_upload OK')

    // 远端文件确实存在且内容一致（ssh cat 验证）
    const remoteCheck = execSync(
      `ssh -p ${SSHD_PORT} -i ${CLIENT_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@127.0.0.1 'cat /tmp/mcp_verify_upload.txt'`,
      { encoding: 'utf8' }
    )
    expect(remoteCheck).toContain(marker)

    // sftp_download：真实下载并比对
    const downloadPath = join(tmpdir(), 'mcp-verify-downloaded.txt')
    const down = await client.callTool({
      name: 'sftp_download',
      arguments: {
        connection_id: conn!.id,
        remote_path: '/tmp/mcp_verify_upload.txt',
        local_path: downloadPath
      }
    })
    expect((down.content as { text: string }[])[0].text).toContain('"ok":true')
    const downloaded = await fs.readFile(downloadPath, 'utf8')
    expect(downloaded).toContain(marker)
    console.log('[verify] sftp_download OK（内容比对一致）')

    // 关闭会话
    await page.evaluate((id) => window.api.closeSession(id), sessions[0].id)
    await client.close()
  }, 120000)
})
