import { generateKeyPairSync } from 'crypto'
import { Server, Connection } from 'ssh2'

export interface TestSshServer {
  port: number
  close(): void
  lastExec: { command: string; stdout: string }[]
  /** 所有 shell 通道收到的原始输入（含回车），用于验证是否发生过回车执行 */
  shellInput(): string
  /** 每次打开 shell 时申请的 PTY 尺寸 */
  ptyRequests: { cols: number; rows: number }[]
  /** 运行期 PTY 窗口尺寸变化 */
  windowChanges: { cols: number; rows: number }[]
}

/**
 * 用 ssh2 的 Server 类起一个本地临时 SSH 服务器（随机端口），
 * 支持密码认证（密码为 'test-pass'）、shell 与 exec 通道，供集成测试使用。
 */
export function startTestSshServer(): Promise<TestSshServer> {
  return new Promise((resolvePromise, reject) => {
    const execLog: { command: string; stdout: string }[] = []
    const ptyRequests: { cols: number; rows: number }[] = []
    const windowChanges: { cols: number; rows: number }[] = []
    let shellInput = ''
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const server = new Server({ hostKeys: [privateKey] }, (client: Connection) => {
      // 客户端在握手阶段中断（例如拒绝主机指纹）时，ssh2 会通过协议对象抛
      // KEY_EXCHANGE_FAILED；测试服务器忽略这类中断错误
      const protocol = (client as unknown as { _protocol?: { on?: (e: string, cb: () => void) => void } })
        ._protocol
      protocol?.on?.('error', () => {})
      client.on('error', () => {})
      client.on('authentication', (ctx) => {
        if (
          ctx.method === 'password' &&
          ctx.username === 'tester' &&
          ctx.password === 'test-pass'
        ) {
          ctx.accept()
        } else {
          ctx.reject()
        }
      })
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept()
          session.on('pty', (acceptPty, _rejectPty, info) => {
            ptyRequests.push({ cols: info.cols, rows: info.rows })
            acceptPty?.()
          })
          session.on('window-change', (acceptChange, _rejectChange, info) => {
            windowChanges.push({ cols: info.cols, rows: info.rows })
            acceptChange?.()
          })
          session.on('shell', (acceptShell) => {
            const stream = acceptShell()
            stream.write('welcome to test server\r\n$ ')
            // xterm 逐键发送输入，exit 可能被拆成多个 chunk，需累积判断
            let accumulated = ''
            stream.on('data', (d: Buffer) => {
              const input = d.toString()
              stream.write(input)
              shellInput += input
              accumulated += input
              if (accumulated.includes('exit')) {
                stream.exit(0)
                stream.end()
              }
            })
          })
          session.on('exec', (acceptExec, _reject, info) => {
            const stream = acceptExec()
            const command = String(info.command)
            execLog.push({ command, stdout: `exec:${command}` })
            if (command === 'big') {
              // 2MB 输出，用于验证客户端侧的输出截断
              for (let i = 0; i < 32; i++) stream.write(Buffer.alloc(64 * 1024, 120))
            } else {
              stream.write(`exec:${command}`)
            }
            stream.exit(0)
            stream.end()
          })
        })
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string' || !address) {
        reject(new Error('failed to bind test server'))
        return
      }
      resolvePromise({
        port: address.port,
        lastExec: execLog,
        shellInput: () => shellInput,
        ptyRequests,
        windowChanges,
        close: () => server.close()
      })
    })
  })
}
