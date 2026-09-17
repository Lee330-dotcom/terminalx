import { defineStore } from 'pinia'
import { ref } from 'vue'
import { TransferDoneEvent, TransferProgressEvent } from '@shared/types'

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
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** 全局传输队列：进度/完成事件由主进程推送，完成后短暂保留再从列表移除。 */
export const useTransferStore = defineStore('transfers', () => {
  const transfers = ref<TransferItem[]>([])
  let subscribed = false

  function ensureSubscribed(): void {
    if (subscribed) return
    subscribed = true
    // 订阅生命周期与应用一致，无需取消
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
      setTimeout(() => {
        transfers.value = transfers.value.filter((t) => t.id !== ev.transferId)
      }, 5000)
    })
  }

  async function upload(connectionId: string, localPath: string, remotePath: string): Promise<void> {
    ensureSubscribed()
    const id = await window.api.sftpUpload(connectionId, localPath, remotePath)
    transfers.value.push({
      id,
      direction: 'upload',
      name: basenameOf(remotePath),
      remotePath,
      localPath,
      transferred: 0,
      total: 0,
      status: 'running'
    })
  }

  async function download(connectionId: string, remotePath: string, localPath: string): Promise<void> {
    ensureSubscribed()
    const id = await window.api.sftpDownload(connectionId, remotePath, localPath)
    transfers.value.push({
      id,
      direction: 'download',
      name: basenameOf(remotePath),
      remotePath,
      localPath,
      transferred: 0,
      total: 0,
      status: 'running'
    })
  }

  async function cancel(id: string): Promise<void> {
    await window.api.sftpCancel(id)
  }

  return { transfers, upload, download, cancel }
})
