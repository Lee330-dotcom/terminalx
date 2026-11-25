import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { ConnectConfig } from 'ssh2'
import { ConnectionManager, describeSshError } from '../connectionManager'
import { ConnectionNameLookup, SessionManager } from '../sessionManager'
import { startTestSshServer, TestSshServer } from './testSshServer'

let server: TestSshServer

beforeAll(async () => {
  server = await startTestSshServer()
})

afterAll(() => {
  server.close()
})

function makeManager(password: string): ConnectionManager {
  return new ConnectionManager(
    async () =>
      ({
        host: '127.0.0.1',
        port: server.port,
        username: 'tester',
        password,
        readyTimeout: 5000
      }) as ConnectConfig,
    { idleDestroyMs: 200 }
  )
}

interface CapturedEvent {
  type: 'status' | 'data'
  sessionId: string
  status?: string
  errorMessage?: string
  data?: string
}

describe('describeSshError', () => {
  it('区分认证失败与网络错误', () => {
    expect(describeSshError(Object.assign(new Error('x'), { level: 'client-authentication' }))).toContain(
      '认证失败'
    )
    expect(describeSshError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toContain(
      '拒绝连接'
    )
    expect(describeSshError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toContain('解析')
  })
})

describe('ConnectionManager 集成', () => {
  afterEach(() => {
    /* 各用例自建 manager，空闲销毁由计时器兜底 */
  })

  it('连接成功后 exec 执行命令并返回输出与退出码', async () => {
    const manager = makeManager('test-pass')
    const result = await manager.exec('conn-1', 'ls -la')
    expect(result.stdout).toBe('exec:ls -la')
    expect(result.exitCode).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('exec 输出超过上限时截断并标记 truncated', async () => {
    const manager = makeManager('test-pass')
    const result = await manager.exec('conn-1', 'big')
    expect(result.truncated).toBe(true)
    expect(result.stdout.length).toBe(1024 * 1024)
  })

  it('密码错误时抛认证失败', async () => {
    const manager = makeManager('wrong-pass')
    await expect(manager.exec('conn-1', 'ls')).rejects.toThrow()
  })

  it('连接复用：同一连接两次 acquire 返回同一底层连接', async () => {
    const manager = makeManager('test-pass')
    const h1 = await manager.acquire('conn-1')
    const h2 = await manager.acquire('conn-1')
    expect(h1.client).toBe(h2.client)
    h1.release()
    h2.release()
    expect(manager.isOnline('conn-1')).toBe(false)
  })

  it('drop 后重新 acquire 获得新连接，旧句柄迟到的 release 不影响新连接', async () => {
    const manager = makeManager('test-pass')
    const h1 = await manager.acquire('conn-1')
    h1.drop()
    expect(manager.isOnline('conn-1')).toBe(false)
    const h2 = await manager.acquire('conn-1')
    expect(h2.client).not.toBe(h1.client)
    h1.release()
    expect(manager.isOnline('conn-1')).toBe(true)
    h2.release()
    expect(manager.isOnline('conn-1')).toBe(false)
  })

  it('并发 acquire 只建立一条底层连接', async () => {
    const manager = makeManager('test-pass')
    const [h1, h2] = await Promise.all([manager.acquire('conn-1'), manager.acquire('conn-1')])
    expect(h1.client).toBe(h2.client)
    h1.release()
    h2.release()
  })

  it('空闲超时后底层连接销毁', async () => {
    const manager = makeManager('test-pass')
    const handle = await manager.acquire('conn-1')
    handle.release()
    await new Promise((r) => setTimeout(r, 400))
    expect(manager.isOnline('conn-1')).toBe(false)
  })

  it('共享连接：drop 其中一个句柄不影响另一个持有的连接', async () => {
    const manager = makeManager('test-pass')
    const h1 = await manager.acquire('conn-1')
    const h2 = await manager.acquire('conn-1')
    expect(h1.client).toBe(h2.client)
    h1.drop()
    // 另一个句柄仍在使用同一底层连接：连接必须存活
    expect(manager.isOnline('conn-1')).toBe(true)
    const h3 = await manager.acquire('conn-1')
    expect(h3.client).toBe(h1.client)
    h2.release()
    h3.release()
  })

  it('共享连接：最后一个持有者 drop 后连接被销毁', async () => {
    const manager = makeManager('test-pass')
    const h1 = await manager.acquire('conn-1')
    const h2 = await manager.acquire('conn-1')
    h1.drop()
    expect(manager.isOnline('conn-1')).toBe(true)
    h2.drop()
    expect(manager.isOnline('conn-1')).toBe(false)
  })
})

describe('SessionManager 自动切换目录', () => {
  const HELINK_DIR = '/data/apps/helink-pro/logs/app/helink-pro/'

  function collect(lookup?: ConnectionNameLookup): {
    dataText: () => string
    manager: SessionManager
  } {
    const events: CapturedEvent[] = []
    const sink = {
      emitData: (sessionId: string, data: Uint8Array) =>
        events.push({ type: 'data', sessionId, data: Buffer.from(data).toString('utf8') }),
      emitStatus: () => {}
    }
    const manager = new SessionManager(makeManager('test-pass'), sink as never, lookup)
    return {
      dataText: () => events.map((e) => e.data ?? '').join(''),
      manager
    }
  }

  it('连接名包含 helink 时自动 cd 到日志目录', async () => {
    const { dataText, manager } = collect(async () => ({ name: 'helink-pro 生产' }))
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 900))
    expect(dataText()).toContain(`cd ${HELINK_DIR}`)
    await manager.close(sessionId)
  })

  it('连接名不含 helink 时不写入任何命令', async () => {
    const { dataText, manager } = collect(async () => ({ name: 'other-server' }))
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 900))
    expect(dataText()).not.toContain('cd ')
    await manager.close(sessionId)
  })

  it('用户先输入时取消待执行的自动 cd', async () => {
    const { dataText, manager } = collect(async () => ({ name: 'helink-pro 生产' }))
    const { sessionId } = await manager.open('conn-1')
    // 连接尚未就绪时用户已开始输入：不得再向远端注入 cd
    manager.input(sessionId, new TextEncoder().encode('x'))
    await new Promise((r) => setTimeout(r, 900))
    expect(dataText()).not.toContain('cd ')
    await manager.close(sessionId)
  })
})

describe('SessionManager 集成', () => {
  function collect(): { events: CapturedEvent[]; manager: SessionManager } {
    const events: CapturedEvent[] = []
    const sink = {
      emitData: (sessionId: string, data: Uint8Array) =>
        events.push({ type: 'data', sessionId, data: Buffer.from(data).toString('utf8') }),
      emitStatus: (sessionId: string, status: string, errorMessage?: string) =>
        events.push({ type: 'status', sessionId, status, errorMessage })
    }
    const connManager = makeManager('test-pass')
    const manager = new SessionManager(connManager, sink as never)
    return { events, manager }
  }

  it('打开会话后收到欢迎输出并变为 connected', async () => {
    const { events, manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 300))
    const statusEvents = events.filter((e) => e.type === 'status')
    expect(statusEvents[0]?.status).toBe('connecting')
    expect(statusEvents.some((e) => e.status === 'connected')).toBe(true)
    const dataText = events
      .filter((e) => e.type === 'data')
      .map((e) => e.data)
      .join('')
    expect(dataText).toContain('welcome to test server')
    await manager.close(sessionId)
  })

  it('输入回显：写入的数据被服务器回传', async () => {
    const { events, manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 200))
    manager.input(sessionId, new TextEncoder().encode('echo-test'))
    await new Promise((r) => setTimeout(r, 300))
    const dataText = events
      .filter((e) => e.type === 'data')
      .map((e) => e.data)
      .join('')
    expect(dataText).toContain('echo-test')
    await manager.close(sessionId)
  })

  it('readLines 返回滚动缓冲最近行', async () => {
    const { manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 300))
    const result = manager.readLines(sessionId, 1)
    expect(result.totalLines).toBeGreaterThan(0)
    expect(result.lines.length).toBe(1)
    await manager.close(sessionId)
  })

  it('关闭会话后 has() 为 false', async () => {
    const { manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 200))
    expect(manager.has(sessionId)).toBe(true)
    await manager.close(sessionId)
    expect(manager.has(sessionId)).toBe(false)
  })

  it('重连后用最近一次窗口尺寸打开新 shell', async () => {
    const { manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 300))
    manager.resize(sessionId, 123, 45)
    await new Promise((r) => setTimeout(r, 100))
    const before = server.ptyRequests.length
    await manager.reconnect(sessionId)
    await new Promise((r) => setTimeout(r, 300))
    expect(server.ptyRequests.length).toBe(before + 1)
    expect(server.ptyRequests[before]).toEqual({ cols: 123, rows: 45 })
    await manager.close(sessionId)
  })

  it('并发重连只保留最后一次，旧附加不会覆盖新通道', async () => {
    const { manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 300))
    const before = server.ptyRequests.length
    await Promise.all([manager.reconnect(sessionId), manager.reconnect(sessionId)])
    await new Promise((r) => setTimeout(r, 300))
    expect(server.ptyRequests.length).toBe(before + 1)
    expect(manager.list()[0]?.status).toBe('connected')
    await manager.close(sessionId)
  })

  it('滚动缓冲合并未换行的跨 chunk 行', async () => {
    const { manager } = collect()
    const { sessionId } = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 300))
    manager.input(sessionId, new TextEncoder().encode('abc'))
    await new Promise((r) => setTimeout(r, 120))
    manager.input(sessionId, new TextEncoder().encode('def'))
    await new Promise((r) => setTimeout(r, 200))
    const last = manager.readLines(sessionId, 1)
    expect(last.lines).toEqual(['$ abcdef'])
    await manager.close(sessionId)
  })

  it('同一连接的两个会话：关闭其中一个，另一个仍可输入输出', async () => {
    const { events, manager } = collect()
    const a = await manager.open('conn-1')
    const b = await manager.open('conn-1')
    await new Promise((r) => setTimeout(r, 300))
    expect(manager.list().filter((s) => s.status === 'connected')).toHaveLength(2)

    await manager.close(a.sessionId)
    await new Promise((r) => setTimeout(r, 200))

    // 被关闭的会话已消失，另一个会话仍是 connected
    expect(manager.has(a.sessionId)).toBe(false)
    const bStatus = events
      .filter((e) => e.type === 'status' && e.sessionId === b.sessionId)
      .map((e) => e.status)
    expect(bStatus[bStatus.length - 1]).toBe('connected')

    manager.input(b.sessionId, new TextEncoder().encode('still-alive'))
    await new Promise((r) => setTimeout(r, 300))
    const bText = events
      .filter((e) => e.type === 'data' && e.sessionId === b.sessionId)
      .map((e) => e.data)
      .join('')
    expect(bText).toContain('still-alive')
    await manager.close(b.sessionId)
  })
})
