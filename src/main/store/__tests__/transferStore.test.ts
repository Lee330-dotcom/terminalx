import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TransferStore } from '../transferStore'
import { TransferRecord } from '@shared/types'

let dir: string
let file: string
let store: TransferStore

function record(id: string, startedAt: number, overrides: Partial<TransferRecord> = {}): TransferRecord {
  return {
    id,
    direction: 'download',
    name: `${id}.log`,
    remotePath: `/var/log/${id}.log`,
    localPath: `/tmp/${id}.log`,
    transferred: 0,
    total: 0,
    status: 'running',
    startedAt,
    ...overrides
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-transfers-'))
  file = join(dir, 'transfers.json')
  store = new TransferStore(file)
})

describe('TransferStore', () => {
  it('初始为空列表', async () => {
    expect(await store.list()).toEqual([])
  })

  it('记录传输开始并读回', async () => {
    await store.recordStart(record('a', 1000))
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('a')
    expect(list[0].status).toBe('running')
    expect(list[0].name).toBe('a.log')
  })

  it('更新进度与终态', async () => {
    await store.recordStart(record('a', 1000))
    await store.recordProgress('a', 512, 1024)
    let list = await store.list()
    expect(list[0].transferred).toBe(512)
    expect(list[0].total).toBe(1024)

    await store.recordFinish('a', 'done', undefined, 2000)
    list = await store.list()
    expect(list[0].status).toBe('done')
    expect(list[0].finishedAt).toBe(2000)
  })

  it('失败时保留错误信息', async () => {
    await store.recordStart(record('a', 1000))
    await store.recordFinish('a', 'error', '连接中断', 2000)
    const list = await store.list()
    expect(list[0].status).toBe('error')
    expect(list[0].error).toBe('连接中断')
  })

  it('列表按开始时间倒序', async () => {
    await store.recordStart(record('old', 1000))
    await store.recordStart(record('new', 2000))
    const list = await store.list()
    expect(list.map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('超过上限时丢弃最旧记录', async () => {
    for (let i = 0; i < 210; i++) {
      await store.recordStart(record(`r${i}`, 1000 + i))
    }
    const list = await store.list()
    expect(list).toHaveLength(200)
    expect(list.some((r) => r.id === 'r0')).toBe(false)
    expect(list.some((r) => r.id === 'r209')).toBe(true)
  })

  it('删除与清空', async () => {
    await store.recordStart(record('a', 1000))
    await store.recordStart(record('b', 2000))
    expect(await store.remove('a')).toBe(true)
    expect(await store.remove('a')).toBe(false)
    expect(await store.list()).toHaveLength(1)
    await store.clear()
    expect(await store.list()).toEqual([])
  })

  it('文件损坏时降级为空列表', async () => {
    await fs.writeFile(file, '{ not json', 'utf8')
    expect(await store.list()).toEqual([])
    await store.recordStart(record('a', 1000))
    expect(await store.list()).toHaveLength(1)
  })

  it('并发写入不互相覆盖', async () => {
    await Promise.all([
      store.recordStart(record('a', 1000)),
      store.recordStart(record('b', 2000)),
      store.recordStart(record('c', 3000))
    ])
    const list = await store.list()
    expect(list).toHaveLength(3)
  })

  it('重启后记录仍在（落盘持久化）', async () => {
    await store.recordStart(record('a', 1000))
    const reopened = new TransferStore(file)
    const list = await reopened.list()
    expect(list).toHaveLength(1)
    expect(list[0].remotePath).toBe('/var/log/a.log')
  })
})
