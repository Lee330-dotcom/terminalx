import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable, Writable } from 'stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client, Stats } from 'ssh2'
import { TransferDoneEvent, TransferProgressEvent } from '@shared/types'
import { SftpService, TransferEventSink } from '../sftpService'
import { ClientHandle, ConnectionManager } from '../connectionManager'

interface FakeEntry {
  filename: string
  longname: string
  attrs: { size: number; mode: number; mtime: number }
}

function makeStats(size = 0, isDir = false): Stats {
  return { size, mode: isDir ? 0o40755 : 0o100644, isDirectory: () => isDir } as unknown as Stats
}

class FakeSftp {
  entries: Record<string, FakeEntry[]> = {}
  unlinked: string[] = []
  createdDirs: string[] = []
  renames: { from: string; to: string }[] = []
  statResult: Record<string, Stats> = {}
  remoteContent: Record<string, Buffer> = {}
  writeDelayMs = 0
  activeWriters: Writable[] = []

  readdir(path: string, cb: (err: Error | null, list: FakeEntry[]) => void): void {
    cb(null, this.entries[path] ?? [])
  }
  mkdir(path: string, cb: (err: Error | null) => void): void {
    this.createdDirs.push(path)
    cb(null)
  }
  stat(path: string, cb: (err: Error | null, attrs: Stats) => void): void {
    const attrs = this.statResult[path]
    if (attrs) cb(null, attrs)
    else cb(new Error(`No such file: ${path}`), {} as Stats)
  }
  unlink(path: string, cb: (err?: Error | null) => void): void {
    this.unlinked.push(path)
    cb()
  }
  rmdir(path: string, cb: (err?: Error | null) => void): void {
    this.unlinked.push(path)
    cb()
  }
  rename(from: string, to: string, cb: (err?: Error | null) => void): void {
    this.renames.push({ from, to })
    cb()
  }
  createReadStream(path: string): Readable {
    const content = this.remoteContent[path] ?? Buffer.alloc(0)
    const chunkSize = 256 * 1024
    const chunks: Buffer[] = []
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.subarray(i, i + chunkSize))
    }
    let i = 0
    // 每块延迟 5ms，模拟真实网络，给取消操作留出窗口
    return new Readable({
      read() {
        if (i >= chunks.length) {
          this.push(null)
          return
        }
        const chunk = chunks[i++]
        setTimeout(() => this.push(chunk), 5)
      }
    })
  }
  createWriteStream(_path: string): Writable {
    const received: Buffer[] = []
    const ws = new Writable({
      write: (chunk, _enc, cb) => {
        received.push(Buffer.from(chunk))
        setTimeout(cb, this.writeDelayMs)
      }
    })
    ws.on('finish', () => {
      this.remoteContent[_path] = Buffer.concat(received)
      ws.emit('close')
    })
    this.activeWriters.push(ws)
    return ws
  }
  end(): void {
    // no-op
  }
}

function makeClient(sftp: FakeSftp): Client {
  return {
    sftp: (cb: (err: Error | null, s: unknown) => void) => cb(null, sftp),
    end: () => {}
  } as unknown as Client
}

class FakeConnections extends ConnectionManager {
  released: string[] = []
  constructor(private readonly sftp: FakeSftp) {
    super(async () => {
      throw new Error('unused')
    })
  }
  override async acquire(connectionId: string): Promise<ClientHandle> {
    const client = makeClient(this.sftp)
    return {
      client,
      release: () => this.released.push(connectionId),
      drop: () => this.released.push(connectionId)
    }
  }
  override async acquireIsolated(connectionId: string): Promise<ClientHandle> {
    return this.acquire(connectionId)
  }
}

interface Collected {
  progress: TransferProgressEvent[]
  done: TransferDoneEvent[]
}

describe('SftpService 集成（fake sftp 通道）', () => {
  let sftp: FakeSftp
  let conns: FakeConnections
  let service: SftpService
  let collected: Collected
  let tempDir: string

  const sink: TransferEventSink = {
    emitProgress: (ev) => collected.progress.push(ev),
    emitDone: (ev) => collected.done.push(ev)
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sftp-test-'))
    sftp = new FakeSftp()
    conns = new FakeConnections(sftp)
    collected = { progress: [], done: [] }
    service = new SftpService(conns, sink)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function waitForDone(id: string): Promise<TransferDoneEvent> {
    return new Promise((resolvePromise) => {
      const found = collected.done.find((d) => d.transferId === id)
      if (found) {
        resolvePromise(found)
        return
      }
      const prev = sink.emitDone
      sink.emitDone = (ev) => {
        prev(ev)
        if (ev.transferId === id) resolvePromise(ev)
      }
    })
  }

  it('list：目录在前，按名称排序，路径正确拼接', async () => {
    sftp.entries['/data'] = [
      { filename: 'b.txt', longname: '-rw-r--r--', attrs: { size: 3, mode: 0o100644, mtime: 1 } },
      { filename: 'a-dir', longname: 'drwxr-xr-x', attrs: { size: 0, mode: 0o40755, mtime: 1 } },
      { filename: 'a.txt', longname: '-rw-r--r--', attrs: { size: 5, mode: 0o100644, mtime: 1 } }
    ]
    const result = await service.list('c1', '/data')
    expect(result.entries.map((e) => e.name)).toEqual(['a-dir', 'a.txt', 'b.txt'])
    expect(result.entries[0]).toMatchObject({ isDirectory: true, path: '/data/a-dir' })
    expect(conns.released).toEqual(['c1'])
  })

  it('mkdir / rename / delete（目录走 rmdir，文件走 unlink）', async () => {
    sftp.statResult['/data/d'] = makeStats(0, true)
    sftp.statResult['/data/f.txt'] = makeStats(3, false)
    sftp.statResult['/data/f2.txt'] = makeStats(3, false)
    await service.mkdir('c1', '/data/new')
    await service.rename('c1', '/data/f.txt', '/data/f2.txt')
    await service.delete('c1', '/data/d')
    await service.delete('c1', '/data/f2.txt')
    expect(sftp.createdDirs).toEqual(['/data/new'])
    expect(sftp.renames).toEqual([{ from: '/data/f.txt', to: '/data/f2.txt' }])
    expect(sftp.unlinked).toEqual(['/data/d', '/data/f2.txt'])
  })

  it('delete 拒绝穿越路径', async () => {
    await expect(service.delete('c1', '/data/../secret')).rejects.toThrow(/\.\./)
    expect(sftp.unlinked).toEqual([])
  })

  it('readText：正常读取内容，超过 1MB 截断并标注', async () => {
    sftp.remoteContent['/small.txt'] = Buffer.from('hello sftp')
    sftp.remoteContent['/big.txt'] = Buffer.alloc(3 * 1024 * 1024, 0x61)
    expect(await service.readText('c1', '/small.txt')).toBe('hello sftp')
    const big = await service.readText('c1', '/big.txt')
    expect(big).toContain('[文件过大，仅显示前 1MB]')
    expect(big.length).toBeLessThan(1024 * 1024 + 512 * 1024)
  })

  it('上传：写入远端、发出进度与完成事件、释放连接', async () => {
    const localFile = join(tempDir, 'up.bin')
    writeFileSync(localFile, Buffer.alloc(700 * 1024, 0x42))
    const id = service.upload('c1', localFile, '/data/up.bin')
    const done = await waitForDone(id)
    expect(done.ok).toBe(true)
    expect(sftp.remoteContent['/data/up.bin']?.length).toBe(700 * 1024)
    const last = collected.progress.filter((p) => p.transferId === id).at(-1)
    expect(last).toMatchObject({ transferred: 700 * 1024, total: 700 * 1024 })
    expect(conns.released).toContain('c1')
  })

  it('下载：内容落盘到本地，进度齐全', async () => {
    sftp.remoteContent['/data/dl.bin'] = Buffer.alloc(600 * 1024, 0x33)
    sftp.statResult['/data/dl.bin'] = makeStats(600 * 1024)
    const localFile = join(tempDir, 'dl.bin')
    const id = service.download('c1', '/data/dl.bin', localFile)
    const done = await waitForDone(id)
    expect(done.ok).toBe(true)
    expect(readFileSync(localFile).length).toBe(600 * 1024)
    const last = collected.progress.filter((p) => p.transferId === id).at(-1)
    expect(last).toMatchObject({ transferred: 600 * 1024, total: 600 * 1024 })
  })

  it('队列串行：第二个传输在第一个完成后才开始', async () => {
    sftp.writeDelayMs = 30
    const f1 = join(tempDir, 'q1.bin')
    const f2 = join(tempDir, 'q2.bin')
    writeFileSync(f1, Buffer.alloc(300 * 1024))
    writeFileSync(f2, Buffer.alloc(300 * 1024))
    const id1 = service.upload('c1', f1, '/data/q1.bin')
    const id2 = service.upload('c1', f2, '/data/q2.bin')
    // 第二个传输此时不应开始：remoteContent 里还没有任何写入者完成
    expect(sftp.remoteContent['/data/q2.bin']).toBeUndefined()
    const done1 = await waitForDone(id1)
    const done2 = await waitForDone(id2)
    expect(done1.ok).toBe(true)
    expect(done2.ok).toBe(true)
    expect(sftp.remoteContent['/data/q2.bin']?.length).toBe(300 * 1024)
  })

  it('取消排队中的传输：立即 done 且不执行，后续传输继续', async () => {
    sftp.writeDelayMs = 30
    const f1 = join(tempDir, 'c1.bin')
    const f2 = join(tempDir, 'c2.bin')
    writeFileSync(f1, Buffer.alloc(200 * 1024))
    writeFileSync(f2, Buffer.alloc(200 * 1024))
    const id1 = service.upload('c1', f1, '/data/c1.bin')
    const id2 = service.upload('c1', f2, '/data/c2.bin')
    service.cancel(id2)
    const done2 = await waitForDone(id2)
    expect(done2).toMatchObject({ ok: false, error: '已取消' })
    const done1 = await waitForDone(id1)
    expect(done1.ok).toBe(true)
    expect(sftp.remoteContent['/data/c2.bin']).toBeUndefined()
  })

  it('取消进行中的下载：结果标记已取消并清理本地残留', async () => {
    sftp.remoteContent['/data/big.bin'] = Buffer.alloc(4 * 1024 * 1024, 0x77)
    sftp.statResult['/data/big.bin'] = makeStats(4 * 1024 * 1024)
    const localFile = join(tempDir, 'big.bin')
    const id = service.download('c1', '/data/big.bin', localFile)
    // 等出现首个进度事件后取消
    await new Promise<void>((resolvePromise) => {
      const timer = setInterval(() => {
        if (collected.progress.some((p) => p.transferId === id)) {
          clearInterval(timer)
          resolvePromise()
        }
      }, 5)
    })
    service.cancel(id)
    const done = await waitForDone(id)
    expect(done).toMatchObject({ ok: false, error: '已取消' })
    // 清理回调是异步的，稍等片刻验证残留被删除
    await new Promise((r) => setTimeout(r, 100))
    expect(() => readFileSync(localFile)).toThrow()
  })

  it('连接不存在时 list 报错', async () => {
    const bad = new ConnectionManager(async () => {
      throw new Error('连接不存在: nope')
    })
    const svc = new SftpService(bad, sink)
    await expect(svc.list('nope', '/')).rejects.toThrow('连接不存在')
  })
})
