import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  TransferDoneEvent,
  TransferProgressEvent,
  TransferRecord,
  TransferStartEvent
} from '@shared/types'

export interface TransferItem {
  id: string
  direction: 'upload' | 'download'
  name: string
  remotePath: string
  localPath: string
  transferred: number
  total: number
  status: 'running' | 'done' | 'error' | 'canceled'
  error?: string
  startedAt: number
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** 面板里最多保留的条目数，超出后丢弃最旧的已结束条目。 */
const MAX_LIVE_ITEMS = 50

/**
 * 全局传输队列：条目由主进程 start 事件创建，进度/完成事件只更新状态。
 *
 * 已结束的条目会保留在列表里（不再自动消失），用户可以清楚看到
 * 「这次传输到底成功了没有」，历史留痕见 records。
 */
export const useTransferStore = defineStore('transfers', () => {
  const transfers = ref<TransferItem[]>([])
  const records = ref<TransferRecord[]>([])
  let subscribed = false

  function ensureSubscribed(): void {
    if (subscribed) return
    subscribed = true
    // 订阅生命周期与应用一致，无需取消
    window.api.onTransferStart((ev: TransferStartEvent) => {
      if (transfers.value.some((t) => t.id === ev.transferId)) return
      transfers.value.unshift({
        id: ev.transferId,
        direction: ev.direction,
        name: basenameOf(ev.direction === 'download' ? ev.localPath : ev.remotePath),
        remotePath: ev.remotePath,
        localPath: ev.localPath,
        transferred: 0,
        total: 0,
        status: 'running',
        startedAt: ev.startedAt
      })
      trimLive()
    })
    window.api.onTransferProgress((ev: TransferProgressEvent) => {
      const item = transfers.value.find((t) => t.id === ev.transferId)
      if (!item) return
      item.transferred = ev.transferred
      item.total = ev.total
    })
    window.api.onTransferDone((ev: TransferDoneEvent) => {
      const item = transfers.value.find((t) => t.id === ev.transferId)
      if (!item) return
      item.status = ev.ok ? 'done' : item.status === 'running' ? 'error' : item.status
      if (!ev.ok && ev.error === '已取消') item.status = 'canceled'
      item.error = ev.error
      void loadRecords()
    })
  }

  /** 列表过长时丢弃最旧的已结束条目，进行中的始终保留。 */
  function trimLive(): void {
    if (transfers.value.length <= MAX_LIVE_ITEMS) return
    const overflow = transfers.value.length - MAX_LIVE_ITEMS
    const removable = transfers.value.filter((t) => t.status !== 'running').slice(0, overflow)
    if (removable.length === 0) return
    const ids = new Set(removable.map((t) => t.id))
    transfers.value = transfers.value.filter((t) => !ids.has(t.id))
  }

  /** 读取历史传输记录（落盘留痕）。 */
  async function loadRecords(): Promise<void> {
    try {
      records.value = await window.api.listTransferRecords()
    } catch {
      records.value = []
    }
  }

  /** 清空面板里已结束的条目（进行中的不受影响）。 */
  function clearFinished(): void {
    transfers.value = transfers.value.filter((t) => t.status === 'running')
  }

  async function removeRecord(id: string): Promise<void> {
    await window.api.removeTransferRecord(id)
    records.value = records.value.filter((r) => r.id !== id)
  }

  async function clearRecords(): Promise<void> {
    await window.api.clearTransferRecords()
    records.value = []
  }

  /** 在系统文件管理器中定位本地文件；文件不存在返回 false。 */
  async function reveal(localPath: string): Promise<boolean> {
    return window.api.revealTransferFile(localPath)
  }

  async function upload(connectionId: string, localPath: string, remotePath: string): Promise<void> {
    ensureSubscribed()
    await window.api.sftpUpload(connectionId, localPath, remotePath)
  }

  async function download(connectionId: string, remotePath: string, localPath: string): Promise<void> {
    ensureSubscribed()
    await window.api.sftpDownload(connectionId, remotePath, localPath)
  }

  async function cancel(id: string): Promise<void> {
    await window.api.sftpCancel(id)
  }

  ensureSubscribed()

  return {
    transfers,
    records,
    loadRecords,
    clearFinished,
    removeRecord,
    clearRecords,
    reveal,
    upload,
    download,
    cancel
  }
})
