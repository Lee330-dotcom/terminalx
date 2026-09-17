import { timingSafeEqual } from 'crypto'
import { readFileSync } from 'fs'
import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { join } from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { ExecCommandResult } from '@shared/types'
import type { AppContext } from '../appContext'

const APP_VERSION = ((): string => {
  try {
    return (JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as {
      version: string
    }).version
  } catch {
    return '0.0.0'
  }
})()

const MAX_BODY_BYTES = 1024 * 1024
const MAX_OUTPUT_BYTES = 50 * 1024

/** 单流截断：保留头尾，中间标注被截掉的字节数。 */
function truncateStream(buf: Buffer, headBytes: number, tailBytes: number): string {
  if (buf.length <= headBytes + tailBytes) return buf.toString('utf8')
  const head = buf.subarray(0, headBytes).toString('utf8')
  const tail = buf.subarray(buf.length - tailBytes).toString('utf8')
  const cut = buf.length - headBytes - tailBytes
  return `${head}\n...[中间省略 ${cut} 字节]...\n${tail}`
}

/** 总输出 50KB 预算：stdout 头尾各 24KB，stderr 头尾各 1KB。 */
export function truncateExecOutput(
  stdout: string,
  stderr: string,
  maxBytes = MAX_OUTPUT_BYTES
): { stdout: string; stderr: string; truncated: boolean } {
  const outBuf = Buffer.from(stdout, 'utf8')
  const errBuf = Buffer.from(stderr, 'utf8')
  if (outBuf.length + errBuf.length <= maxBytes) {
    return { stdout, stderr, truncated: false }
  }
  return {
    stdout: truncateStream(outBuf, 24 * 1024, 24 * 1024),
    stderr: truncateStream(errBuf, 1024, 1024),
    truncated: true
  }
}

function toolError(err: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
  const message = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: `错误：${message}` }], isError: true }
}

function registerTools(mcp: McpServer, ctx: AppContext): void {
  mcp.registerTool(
    'list_connections',
    { description: '列出所有已保存的 SSH 连接及其在线状态（不含任何凭据）' },
    async () => {
      const connections = await ctx.connections.listConnectionsWithStatus((id) =>
        ctx.ssh.isOnline(id)
      )
      return { content: [{ type: 'text' as const, text: JSON.stringify({ connections }, null, 2) }] }
    }
  )

  mcp.registerTool(
    'list_sessions',
    { description: '列出当前打开的终端会话（含标签标题与状态）' },
    () => {
      const sessions = ctx.sessions.list()
      return { content: [{ type: 'text' as const, text: JSON.stringify({ sessions }, null, 2) }] }
    }
  )

  mcp.registerTool(
    'exec_command',
    {
      description:
        '在指定连接上执行命令（复用已有连接，无活跃连接时临时建立），输出超过 50KB 自动截断。不影响交互式终端。',
      inputSchema: {
        connection_id: z.string().describe('连接 ID，来自 list_connections'),
        command: z.string().describe('要执行的 shell 命令'),
        timeout: z
          .number()
          .int()
          .min(1000)
          .max(600000)
          .optional()
          .describe('超时毫秒数，默认 120000')
      }
    },
    async (args): Promise<{ content: { type: 'text'; text: string }[] }> => {
      try {
        const result: ExecCommandResult = await ctx.ssh.exec(
          args.connection_id,
          args.command,
          args.timeout
        )
        const { stdout, stderr, truncated } = truncateExecOutput(result.stdout, result.stderr)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  stdout,
                  stderr,
                  exit_code: result.exitCode,
                  truncated,
                  duration_ms: result.durationMs
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        return toolError(err)
      }
    }
  )

  mcp.registerTool(
    'read_terminal',
    {
      description: '读取指定终端会话滚动缓冲中的最近 N 行输出（缓冲上限 10000 行）',
      inputSchema: {
        session_id: z.string().describe('会话 ID，来自 list_sessions'),
        lines: z.number().int().min(1).max(1000).optional().describe('读取行数，默认 100')
      }
    },
    (args): { content: { type: 'text'; text: string }[] } => {
      try {
        const result = ctx.sessions.readLines(args.session_id, args.lines ?? 100)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { session_id: args.session_id, lines: result.lines, total_lines: result.totalLines },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        return toolError(err)
      }
    }
  )

  mcp.registerTool(
    'sftp_list',
    {
      description: '列出远程目录内容（目录在前按名称排序）',
      inputSchema: {
        connection_id: z.string().describe('连接 ID'),
        path: z.string().describe('远程绝对路径，如 /home/user')
      }
    },
    async (args): Promise<{ content: { type: 'text'; text: string }[] }> => {
      try {
        const result = await ctx.sftp.list(args.connection_id, args.path)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      } catch (err) {
        return toolError(err)
      }
    }
  )

  mcp.registerTool(
    'sftp_upload',
    {
      description: '上传本地文件到远程（超过 100MB 拒绝）',
      inputSchema: {
        connection_id: z.string().describe('连接 ID'),
        local_path: z.string().describe('本地文件路径'),
        remote_path: z.string().describe('远程目标文件绝对路径')
      }
    },
    async (args): Promise<{ content: { type: 'text'; text: string }[] }> => {
      try {
        const result = await ctx.sftp.uploadAndWait(
          args.connection_id,
          args.local_path,
          args.remote_path
        )
        return {
          content: [
            { type: 'text', text: JSON.stringify({ ok: result.ok, message: result.message, bytes_transferred: result.bytesTransferred }) }
          ]
        }
      } catch (err) {
        return toolError(err)
      }
    }
  )

  mcp.registerTool(
    'sftp_download',
    {
      description: '下载远程文件到本地（超过 100MB 拒绝）',
      inputSchema: {
        connection_id: z.string().describe('连接 ID'),
        remote_path: z.string().describe('远程文件绝对路径'),
        local_path: z.string().describe('本地目标文件路径')
      }
    },
    async (args): Promise<{ content: { type: 'text'; text: string }[] }> => {
      try {
        const result = await ctx.sftp.downloadAndWait(
          args.connection_id,
          args.remote_path,
          args.local_path
        )
        return {
          content: [
            { type: 'text', text: JSON.stringify({ ok: result.ok, message: result.message, bytes_transferred: result.bytesTransferred }) }
          ]
        }
      } catch (err) {
        return toolError(err)
      }
    }
  )
}

/**
 * 应用内 MCP server：Streamable HTTP（127.0.0.1:<port>/mcp）+ Bearer token。
 * 无状态模式（每个请求独立 transport 实例）。
 */
export class McpService {
  private httpServer: Server | null = null
  private token = ''
  private enabled = false

  constructor(private readonly ctx: AppContext) {}

  async start(): Promise<void> {
    const settings = await this.ctx.settings.get()
    if (!settings.mcpEnabled) return
    this.enabled = true
    this.token = settings.mcpToken

    this.httpServer = createServer((req, res) => this.handle(req, res))
    await new Promise<void>((resolvePromise, reject) => {
      this.httpServer!.once('error', reject)
      this.httpServer!.listen(settings.mcpPort, '127.0.0.1', () => {
        this.httpServer!.removeListener('error', reject)
        resolvePromise()
      })
    })
  }

  async stop(): Promise<void> {
    this.enabled = false
    const server = this.httpServer
    this.httpServer = null
    if (server) {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
    }
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  private isAuthorized(req: IncomingMessage): boolean {
    if (!this.enabled) return false
    const header = req.headers.authorization ?? ''
    const prefix = 'Bearer '
    if (!header.startsWith(prefix)) return false
    const provided = Buffer.from(header.slice(prefix.length))
    const expected = Buffer.from(this.token)
    return (
      provided.length === expected.length && timingSafeEqual(provided, expected)
    )
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (!this.isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: '未授权：缺少或错误的 Bearer token' }, id: null }))
      return
    }
    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    // 无状态模式：每个请求独立的 server + transport，不维护会话（GET/DELETE 不支持）
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }))
      return
    }
    const body = await readJsonBody(req, res)
    if (body === null) return

    const mcp = new McpServer({ name: 'ssh-tool', version: APP_VERSION })
    registerTools(mcp, this.ctx)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    })
    try {
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (err) {
      console.error('MCP 请求处理失败:', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null
          })
        )
      }
    }
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
  }
}

async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse
): Promise<unknown | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buf.length
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'request body too large' }))
      return null
    }
    chunks.push(buf)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return null
  }
}
