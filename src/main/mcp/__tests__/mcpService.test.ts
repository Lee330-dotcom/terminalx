import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'net'
import { McpService, truncateExecOutput } from '../mcpService'
import { ExecCommandResult } from '@shared/types'

async function getFreePort(): Promise<number> {
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

const TOKEN = 'mcp-test-token-123'
const CONNECTION = {
  id: 'c1',
  name: 'web01',
  groupId: null,
  host: '10.0.0.1',
  port: 22,
  username: 'deploy',
  authType: 'password' as const,
  remark: '',
  color: '',
  createdAt: 0,
  updatedAt: 0
}

function makeCtx(port: number): unknown {
  return {
    settings: {
      get: async () => ({ mcpEnabled: true, mcpPort: port, mcpToken: TOKEN })
    },
    connections: {
      listConnectionsWithStatus: async (isOnline: (id: string) => boolean) => [
        { ...CONNECTION, online: isOnline('c1') }
      ]
    },
    ssh: {
      isOnline: () => true,
      exec: async (_id: string, command: string): Promise<ExecCommandResult> => ({
        stdout: command === 'big' ? 'A'.repeat(60 * 1024) : `stdout:${command}`,
        stderr: command === 'big' ? 'B'.repeat(8 * 1024) : '',
        exitCode: 0,
        truncated: false,
        durationMs: 12
      })
    },
    sessions: {
      list: () => [
        { id: 's1', connectionId: 'c1', title: 'web01 终端', status: 'connected' as const }
      ],
      readLines: (_id: string, n: number) => ({
        lines: ['line-1', 'line-2', 'line-3'].slice(-n),
        totalLines: 3
      })
    },
    sftp: {
      list: async (_id: string, path: string) => ({
        path,
        entries: [
          { name: 'app.log', path: `${path}/app.log`, isDirectory: false, size: 10, mode: 0o100644, mtime: 1 }
        ]
      }),
      uploadAndWait: async () => ({ ok: true, message: '上传完成', bytesTransferred: 10 }),
      downloadAndWait: async () => ({ ok: true, message: '下载完成', bytesTransferred: 10 })
    }
  }
}

describe('truncateExecOutput 50KB 截断', () => {
  it('小输出原样返回', () => {
    const r = truncateExecOutput('hello', '')
    expect(r).toEqual({ stdout: 'hello', stderr: '', truncated: false })
  })

  it('超过 50KB 时截断并标注', () => {
    const r = truncateExecOutput('A'.repeat(60 * 1024), 'B'.repeat(8 * 1024))
    expect(r.truncated).toBe(true)
    expect(r.stdout).toContain('[中间省略')
    expect(r.stderr).toContain('[中间省略')
    expect(Buffer.byteLength(r.stdout)).toBeLessThan(50 * 1024)
    expect(Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr)).toBeLessThan(51 * 1024)
    // 头部与尾部内容保留
    expect(r.stdout.startsWith('A'.repeat(100))).toBe(true)
    expect(r.stdout.endsWith('A'.repeat(100))).toBe(true)
  })

  it('stdout 未超限但 stderr 超限时不截断 stdout', () => {
    const r = truncateExecOutput('small', 'C'.repeat(60 * 1024))
    expect(r.truncated).toBe(true)
    expect(r.stdout).toBe('small')
    expect(r.stderr).toContain('[中间省略')
  })
})

describe('McpService Streamable HTTP + Bearer 鉴权', () => {
  let service: McpService
  let port: number

  beforeEach(async () => {
    port = await getFreePort()
    service = new McpService(makeCtx(port) as never)
    await service.start()
  })

  afterEach(async () => {
    await service.stop()
  })

  async function post(body: unknown, token?: string): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    }
    if (token !== undefined) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
    const text = await res.text()
    let json: unknown
    if (text.startsWith('event:') || text.startsWith('data:')) {
      // SSE 响应：取最后一条 data 行
      const dataLines = text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
      json = JSON.parse(dataLines[dataLines.length - 1] ?? 'null')
    } else {
      json = JSON.parse(text)
    }
    return { status: res.status, json }
  }

  it('无 token 返回 401', async () => {
    const { status } = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(status).toBe(401)
  })

  it('错误 token 返回 401，正确 token 完成 initialize 握手', async () => {
    const bad = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, 'wrong')
    expect(bad.status).toBe(401)

    const ok = await post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0' }
        }
      },
      TOKEN
    )
    expect(ok.status).toBe(200)
    const result = (ok.json as { result?: { serverInfo?: { name: string } } }).result
    expect(result?.serverInfo?.name).toBe('ssh-tool')
  })

  it('tools/list 暴露 7 个工具', async () => {
    const { json } = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, TOKEN)
    const tools = (json as { result?: { tools?: { name: string }[] } }).result?.tools ?? []
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'list_connections',
        'list_sessions',
        'exec_command',
        'read_terminal',
        'sftp_list',
        'sftp_upload',
        'sftp_download'
      ].sort()
    )
  })

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { json } = await post(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } },
      TOKEN
    )
    return json
  }

  it('list_connections 不含凭据字段', async () => {
    const json = (await callTool('list_connections', {})) as {
      result?: { content?: { text: string }[] }
    }
    const text = json.result?.content?.[0].text ?? ''
    expect(text).toContain('web01')
    expect(text).toContain('"online": true')
    const parsed = JSON.parse(text) as { connections?: Record<string, unknown>[] }
    const conn = parsed.connections?.[0] ?? {}
    expect(conn).toHaveProperty('name', 'web01')
    expect(conn).toHaveProperty('authType', 'password')
    for (const key of ['password', 'privateKeyFile', 'privateKeyContent', 'passphrase']) {
      expect(conn).not.toHaveProperty(key)
    }
  })

  it('list_sessions 返回会话标签标题', async () => {
    const json = (await callTool('list_sessions', {})) as {
      result?: { content?: { text: string }[] }
    }
    const text = json.result?.content?.[0].text ?? ''
    expect(text).toContain('web01 终端')
  })

  it('exec_command 返回 stdout/stderr/exit_code，超限输出被截断', async () => {
    const small = (await callTool('exec_command', {
      connection_id: 'c1',
      command: 'echo hi'
    })) as { result?: { content?: { text: string }[] } }
    const smallText = small.result?.content?.[0].text ?? ''
    expect(smallText).toContain('stdout:echo hi')
    expect(smallText).toContain('"exit_code": 0')
    expect(smallText).toContain('"truncated": false')

    const big = (await callTool('exec_command', {
      connection_id: 'c1',
      command: 'big'
    })) as { result?: { content?: { text: string }[] } }
    const bigText = big.result?.content?.[0].text ?? ''
    expect(bigText).toContain('"truncated": true')
    expect(bigText).toContain('[中间省略')
  })

  it('read_terminal 返回最近 N 行', async () => {
    const json = (await callTool('read_terminal', { session_id: 's1', lines: 2 })) as {
      result?: { content?: { text: string }[] }
    }
    const text = json.result?.content?.[0].text ?? ''
    expect(text).toContain('line-2')
    expect(text).toContain('line-3')
    expect(text).toContain('"total_lines": 3')
  })

  it('sftp_list / sftp_upload / sftp_download 调用成功', async () => {
    const list = (await callTool('sftp_list', {
      connection_id: 'c1',
      path: '/var/log'
    })) as { result?: { content?: { text: string }[] } }
    expect(list.result?.content?.[0].text).toContain('app.log')

    const up = (await callTool('sftp_upload', {
      connection_id: 'c1',
      local_path: '/tmp/a.txt',
      remote_path: '/data/a.txt'
    })) as { result?: { content?: { text: string }[] } }
    expect(up.result?.content?.[0].text).toContain('"ok":true')

    const down = (await callTool('sftp_download', {
      connection_id: 'c1',
      remote_path: '/data/a.txt',
      local_path: '/tmp/b.txt'
    })) as { result?: { content?: { text: string }[] } }
    expect(down.result?.content?.[0].text).toContain('"ok":true')
  })

  it('exec_command 缺参数被 zod schema 拒绝', async () => {
    const json = (await callTool('exec_command', { command: 'ls' })) as {
      result?: { isError?: boolean; content?: { text: string }[] }
    }
    expect(json.result?.isError).toBe(true)
    const text = json.result?.content?.[0].text ?? ''
    expect(text).toContain('connection_id')
  })

  it('未知路径返回 404，错误 JSON body 返回 400', async () => {
    const res404 = await fetch(`http://127.0.0.1:${port}/other`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    })
    expect(res404.status).toBe(404)

    const res400 = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: 'not-json'
    })
    expect(res400.status).toBe(400)
  })

  it('mcpEnabled=false 时不启动服务', async () => {
    await service.stop()
    const port2 = await getFreePort()
    const disabled = new McpService(
      {
        ...(makeCtx(port2) as Record<string, unknown>),
        settings: { get: async () => ({ mcpEnabled: false, mcpPort: port2, mcpToken: TOKEN }) }
      } as never
    )
    await disabled.start()
    await expect(
      fetch(`http://127.0.0.1:${port2}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: '{}'
      })
    ).rejects.toThrow()
  })
})
