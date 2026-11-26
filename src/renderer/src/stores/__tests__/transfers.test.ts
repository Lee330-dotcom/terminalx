// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTransferStore } from '../transfers'
import { TransferDoneEvent, TransferProgressEvent, TransferStartEvent } from '@shared/types'

type ApiMock = Record<string, ReturnType<typeof vi.fn>>

const startHandlers: Array<(ev: TransferStartEvent) => void> = []
const progressHandlers: Array<(ev: TransferProgressEvent) => void> = []
const doneHandlers: Array<(ev: TransferDoneEvent) => void> = []

function makeApi(): ApiMock {
  return {
    onTransferStart: vi.fn((cb: (ev: TransferStartEvent) => void) => {
      startHandlers.push(cb)
      return () => undefined
    }),
    onTransferProgress: vi.fn((cb: (ev: TransferProgressEvent) => void) => {
      progressHandlers.push(cb)
      return () => undefined
    }),
    onTransferDone: vi.fn((cb: (ev: TransferDoneEvent) => void) => {
      doneHandlers.push(cb)
      return () => undefined
    }),
    sftpUpload: vi.fn(async () => 'up-1'),
    sftpDownload: vi.fn(async () => 'dl-1'),
    sftpCancel: vi.fn(async () => undefined),
    listTransferRecords: vi.fn(async () => [] as unknown[]),
    removeTransferRecord: vi.fn(async () => undefined),
    clearTransferRecords: vi.fn(async () => undefined),
    revealTransferFile: vi.fn(async () => true)
  }
}

function emitStart(ev: TransferStartEvent): void {
  for (const h of startHandlers) h(ev)
}
function emitProgress(ev: TransferProgressEvent): void {
  for (const h of progressHandlers) h(ev)
}
function emitDone(ev: TransferDoneEvent): void {
  for (const h of doneHandlers) h(ev)
}

beforeEach(() => {
  startHandlers.length = 0
  progressHandlers.length = 0
  doneHandlers.length = 0
  setActivePinia(createPinia())
  ;(window as unknown as { api: ApiMock }).api = makeApi()
})

describe('transfers store：传输条目状态', () => {
  it('start 事件创建条目', () => {
    const store = useTransferStore()
    emitStart({
      transferId: 't1',
      direction: 'download',
      remotePath: '/data/a.log',
      localPath: '/tmp/a.log',
      startedAt: 1000
    })
    expect(store.transfers).toHaveLength(1)
    expect(store.transfers[0]).toMatchObject({
      id: 't1',
      direction: 'download',
      name: 'a.log',
      status: 'running'
    })
  })

  it('进度事件更新已传输字节', () => {
    const store = useTransferStore()
    emitStart({
      transferId: 't1',
      direction: 'download',
      remotePath: '/data/a.log',
      localPath: '/tmp/a.log',
      startedAt: 1000
    })
    emitProgress({
      transferId: 't1',
      direction: 'download',
      remotePath: '/data/a.log',
      localPath: '/tmp/a.log',
      transferred: 512,
      total: 1024
    })
    expect(store.transfers[0].transferred).toBe(512)
    expect(store.transfers[0].total).toBe(1024)
  })

  it('完成后条目保留（不再自动消失）', () => {
    const store = useTransferStore()
    emitStart({
      transferId: 't1',
      direction: 'download',
      remotePath: '/data/a.log',
      localPath: '/tmp/a.log',
      startedAt: 1000
    })
    emitDone({ transferId: 't1', ok: true })
    expect(store.transfers).toHaveLength(1)
    expect(store.transfers[0].status).toBe('done')
  })

  it('连续两次下载各自保留条目', () => {
    const store = useTransferStore()
    emitStart({
      transferId: 't1',
      direction: 'download',
      remotePath: '/data/a.log',
      localPath: '/tmp/a.log',
      startedAt: 1000
    })
    emitDone({ transferId: 't1', ok: true })
    emitStart({
      transferId: 't2',
      direction: 'download',
      remotePath: '/data/b.log',
      localPath: '/tmp/b.log',
      startedAt: 2000
    })
    emitDone({ transferId: 't2', ok: true })
    expect(store.transfers).toHaveLength(2)
    expect(store.transfers.every((t) => t.status === 'done')).toBe(true)
  })

  it('取消与失败分别标记状态', () => {
    const store = useTransferStore()
    emitStart({
      transferId: 't1',
      direction: 'download',
      remotePath: '/data/a.log',
      localPath: '/tmp/a.log',
      startedAt: 1000
    })
    emitDone({ transferId: 't1', ok: false, error: '已取消' })
    expect(store.transfers[0].status).toBe('canceled')

    emitStart({
      transferId: 't2',
      direction: 'upload',
      remotePath: '/data/b.log',
      localPath: '/tmp/b.log',
      startedAt: 2000
    })
    emitDone({ transferId: 't2', ok: false, error: '连接中断' })
    expect(store.transfers[0].status).toBe('error')
    expect(store.transfers[0].error).toBe('连接中断')
  })

  it('清空只移除已结束的条目', () => {
    const store = useTransferStore()
    emitStart({
      transferId: 't1',
      direction: 'download',
      remotePath: '/data/a.log',
      localPath: '/tmp/a.log',
      startedAt: 1000
    })
    emitDone({ transferId: 't1', ok: true })
    emitStart({
      transferId: 't2',
      direction: 'download',
      remotePath: '/data/b.log',
      localPath: '/tmp/b.log',
      startedAt: 2000
    })
    store.clearFinished()
    expect(store.transfers).toHaveLength(1)
    expect(store.transfers[0].id).toBe('t2')
  })

  it('下载时不再由渲染层自行插入条目（避免重复）', async () => {
    const store = useTransferStore()
    await store.download('c1', '/data/a.log', '/tmp/a.log')
    expect(store.transfers).toHaveLength(0)
  })
})
