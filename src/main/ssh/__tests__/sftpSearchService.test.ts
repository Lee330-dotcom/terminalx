import { EventEmitter } from 'events'
import { describe, expect, it } from 'vitest'
import { Client } from 'ssh2'
import { SftpSearchEvent } from '@shared/types'
import { SftpService } from '../sftpService'
import { ClientHandle, ConnectionManager } from '../connectionManager'

/** 模拟 ssh2 的 exec 通道流 */
class FakeExecStream extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  closed = false
  command = ''

  /** 服务端侧写入一段输出 */
  writeOut(text: string): void {
    this.stdout.emit('data', Buffer.from(text))
  }

  /** 输出结束（stdout EOF） */
  endOut(): void {
    this.stdout.emit('end')
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.emit('close', 0)
  }
}

class FakeExecClient {
  streams: FakeExecStream[] = []
  /** SFTP 回退路径被调用时记录 */
  readdirCalls: string[] = []

  exec(command: string, cb: (err: Error | null, stream: FakeExecStream) => void): void {
    const stream = new FakeExecStream()
    stream.command = command
    this.streams.push(stream)
    cb(null, stream)
  }

  sftp(cb: (err: Error | null, s: unknown) => void): void {
    cb(null, {
      readdir: (path: string, cb2: (e: Error | null, list: unknown[]) => void): void => {
        this.readdirCalls.push(path)
        cb2(null, [])
      },
      end: (): void => {}
    })
  }

  end(): void {}
}

class FakeSearchConnections extends ConnectionManager {
  released: string[] = []
  execClient = new FakeExecClient()

  constructor() {
    super(async () => {
      throw new Error('unused')
    })
  }

  override async acquire(connectionId: string): Promise<ClientHandle> {
    return {
      client: this.execClient as unknown as Client,
      release: () => this.released.push(connectionId),
      drop: () => this.released.push(connectionId)
    }
  }

  override async acquireIsolated(connectionId: string): Promise<ClientHandle> {
    return this.acquire(connectionId)
  }
}

interface Collector {
  events: SftpSearchEvent[]
  done(): SftpSearchEvent | undefined
  match(): SftpSearchEvent | undefined
  waitDone(timeoutMs?: number): Promise<SftpSearchEvent>
}

function makeCollector(): Collector {
  const events: SftpSearchEvent[] = []
  const collector: Collector = {
    events,
    done: () => events.find((e) => e.type === 'done'),
    match: () => events.find((e) => e.type === 'match'),
    waitDone: async (timeoutMs = 3000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const found = events.find((e) => e.type === 'done' || e.type === 'error')
        if (found) return found
        await new Promise((r) => setTimeout(r, 20))
      }
      throw new Error('等待搜索结束超时')
    }
  }
  return collector
}

/** 等第 index 个 exec 通道建立（index 从 0 开始） */
async function waitForStream(
  client: FakeExecClient,
  index = 0,
  timeoutMs = 2000
): Promise<FakeExecStream> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (client.streams.length > index) return client.streams[index]
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('等待 exec 通道超时')
}

describe('SftpService 文件名搜索：远端 find', () => {
  it('把 find 输出解析成条目并回报完成', async () => {
    const conns = new FakeSearchConnections()
    const collector = makeCollector()
    const service = new SftpService(conns, { emitProgress: () => {}, emitDone: () => {} }, {
      emitSearch: (ev) => collector.events.push(ev)
    })

    const id = await service.startSearch('c1', '/data', 'doc')
    const stream = await waitForStream(conns.execClient)
    expect(stream.command).toContain('find')
    expect(stream.command).toContain("'/data'")

    stream.writeOut('f\t/data/docs/a.docx\n')
    stream.writeOut('d\t/data/docs\n')
    stream.endOut()

    const done = await collector.waitDone()
    expect(done.type).toBe('done')
    expect(done.searchId).toBe(id)
    expect(done.total).toBe(2)
    expect(done.truncated).toBe(false)
    expect(done.stopped).toBe(false)

    // 结果按行分批推送，合并所有 match 事件
    const entries = collector.events
      .filter((e) => e.type === 'match')
      .flatMap((e) => e.entries ?? [])
    expect(entries.map((e) => e.name)).toEqual(['a.docx', 'docs'])
    expect(entries[0]).toMatchObject({
      path: '/data/docs/a.docx',
      isDirectory: false
    })
    expect(entries[1]).toMatchObject({ isDirectory: true })
  })

  it('关键字非法时报错而不是执行命令', async () => {
    const conns = new FakeSearchConnections()
    const collector = makeCollector()
    const service = new SftpService(conns, { emitProgress: () => {}, emitDone: () => {} }, {
      emitSearch: (ev) => collector.events.push(ev)
    })

    await service.startSearch('c1', '/data', "a'; rm -rf /")
    const done = await collector.waitDone()
    expect(done.type).toBe('error')
    expect(conns.execClient.streams).toHaveLength(0)
  })
})

describe('SftpService 文件名搜索：取消', () => {
  it('取消进行中的搜索会关闭远端通道并回报已取消', async () => {
    const conns = new FakeSearchConnections()
    const collector = makeCollector()
    const service = new SftpService(conns, { emitProgress: () => {}, emitDone: () => {} }, {
      emitSearch: (ev) => collector.events.push(ev)
    })

    const id = await service.startSearch('c1', '/data', 'doc')
    const stream = await waitForStream(conns.execClient)
    // 远端命令一直没输出
    service.cancelSearch(id)

    const done = await collector.waitDone()
    expect(done.type).toBe('done')
    expect(done.stopped).toBe(true)
    // 通道被关掉，堡垒机的会话通道配额立刻归还
    await new Promise((r) => setTimeout(r, 50))
    expect(stream.closed).toBe(true)
    // 取消不应回退到 SFTP 遍历
    expect(conns.execClient.readdirCalls).toHaveLength(0)
  })

  it('同一连接上发起新搜索会先取消旧搜索', async () => {
    const conns = new FakeSearchConnections()
    const collector = makeCollector()
    const service = new SftpService(conns, { emitProgress: () => {}, emitDone: () => {} }, {
      emitSearch: (ev) => collector.events.push(ev)
    })

    const first = await service.startSearch('c1', '/data', 'doc')
    const firstStream = await waitForStream(conns.execClient, 0)
    const second = await service.startSearch('c1', '/data', 'docx')
    const secondStream = await waitForStream(conns.execClient, 1)
    expect(secondStream).not.toBe(firstStream)
    expect(second).not.toBe(first)

    await new Promise((r) => setTimeout(r, 300))
    expect(firstStream.closed).toBe(true)
    const stopped = collector.events.find((e) => e.searchId === first && e.type === 'done')
    expect(stopped?.stopped).toBe(true)
  })
})
