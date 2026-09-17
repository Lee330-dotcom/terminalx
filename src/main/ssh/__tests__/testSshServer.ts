import { generateKeyPairSync } from 'crypto'
import { Server, Connection } from 'ssh2'

export interface TestSshServer {
  port: number
  close(): void
  lastExec: { command: string; stdout: string }[]
}

/**
 * 用 ssh2 的 Server 类起一个本地临时 SSH 服务器（随机端口），
 * 支持密码认证（密码为 'test-pass'）、shell 与 exec 通道，供集成测试使用。
 */
export function startTestSshServer(): Promise<TestSshServer> {
  return new Promise((resolvePromise, reject) => {
    const execLog: { command: string; stdout: string }[] = []
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const server = new Server({ hostKeys: [privateKey] }, (client: Connection) => {
        client.on('authentication', (ctx) => {
          if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'test-pass') {
            ctx.accept()
          } else {
            ctx.reject()
          }
        })
        client.on('ready', () => {
          client.on('session', (accept) => {
            const session = accept()
            session.on('pty', (acceptPty) => acceptPty?.())
            session.on('shell', (acceptShell) => {
              const stream = acceptShell()
              stream.write('welcome to test server\r\n$ ')
              stream.on('data', (d: Buffer) => {
                const input = d.toString()
                if (input.includes('exit')) {
                  stream.exit(0)
                  stream.end()
                } else {
                  stream.write(input)
                }
              })
            })
            session.on('exec', (acceptExec, _reject, info) => {
              const stream = acceptExec()
              const command = String(info.command)
              execLog.push({ command, stdout: `exec:${command}` })
              stream.write(`exec:${command}`)
              stream.exit(0)
              stream.end()
            })
          })
        })
      }
    )
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
        close: () => server.close()
      })
    })
  })
}
