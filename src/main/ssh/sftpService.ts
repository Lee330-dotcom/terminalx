import { randomUUID } from 'crypto'
import { createReadStream, createWriteStream, statSync, unlink } from 'fs'
import { posix } from 'path'
import { SFTPWrapper } from 'ssh2'
import {
  SftpEntry,
  SftpListResult,
  TransferDoneEvent,
  TransferProgressEvent,
  TransferResult
} from '@shared/types'
import { ConnectionManager } from './connectionManager'

const MAX_READ_TEXT_BYTES = 1024 * 1024
const MAX_TRANSFER_BYTES = 100 * 1024 * 1024
const PROGRESS_INTERVAL_MS = 100

export interface TransferEventSink {
  emitProgress(ev: TransferProgressEvent): void
  emitDone(ev: TransferDoneEvent): void
}

/** 归一化远程绝对路径；包含 `..` 片段的路径会被拒绝，防止目录穿越。 */
export function normalizeRemotePath(input: string): string {
  if (typeof input !== 'string' || input.length === 0 || !input.startsWith('/')) {
    throw new Error('远程路径必须是绝对路径（以 / 开头）')
  }
  if (input.split('/').includes('..')) {
    throw new Error('远程路径包含非法片段（..），已拒绝')
  }
  const normalized = posix.normalize(input)
  if (normalized.split('/').includes('..')) {
    throw new Error('远程路径包含非法片段（..），已拒绝')
  }
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

export function joinRemotePath(dir: string, name: string): string {
  if (name.split('/').includes('..')) {
    throw new Error('远程路径包含非法片段（..），已拒绝')
  }
  return posix.join(normalizeRemotePath(dir), name)
}

/** 取消传输后尽力删除残留的部分文件（上传删远端、下载删本地）。 */
function cleanupPartial(sftp: SFTPWrapper, t: QueuedTransfer): void {
  if (t.direction === 'upload') {
    sftp.unlink(t.remotePath, () => {})
  } else {
    unlink(t.localPath, () => {})
  }
}

interface QueuedTransfer {
  id: string
  connectionId: string
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
  cancelRequested: boolean
  streams: { destroy(): void }[]
}

/**
 * SFTP 服务：复用连接池开 sftp 通道做列表/增删改/预览，
 * 上传下载走全局串行队列（后台执行），支持取消与进度事件。
 */
export class SftpService {
  private queue: QueuedTransfer[] = []
  private active: QueuedTransfer | null = null
  private transfers = new Map<string, QueuedTransfer>()
  private waiters = new Map<string, (r: TransferResult) => void>()

  constructor(
    private readonly ssh: ConnectionManager,
    private readonly sink: TransferEventSink
  ) {}

  private async openSftp(
    connectionId: string
  ): Promise<{ sftp: SFTPWrapper; release: () => void }> {
    const handle = await this.ssh.acquire(connectionId)
    try {
      const sftp = await new Promise<SFTPWrapper>((resolvePromise, reject) => {
        handle.client.sftp((err, s) => (err ? reject(err) : resolvePromise(s)))
      })
      return { sftp, release: () => handle.release() }
    } catch (err) {
      handle.release()
      throw err
    }
  }

  async list(connectionId: string, path: string): Promise<SftpListResult> {
    const remotePath = normalizeRemotePath(path)
    const { sftp, release } = await this.openSftp(connectionId)
    try {
      const entries = await new Promise<SftpEntry[]>((resolvePromise, reject) => {
        sftp.readdir(remotePath, (err, list) => {
          if (err) {
            reject(err)
            return
          }
          const mapped: SftpEntry[] = list.map((e) => ({
            name: e.filename,
            path: posix.join(remotePath, e.filename),
            isDirectory: e.longname.startsWith('d'),
            size: e.attrs.size,
            mode: e.attrs.mode,
            mtime: e.attrs.mtime
          }))
          mapped.sort((a, b) =>
            a.isDirectory !== b.isDirectory
              ? a.isDirectory
                ? -1
                : 1
              : a.name.localeCompare(b.name)
          )
          resolvePromise(mapped)
        })
      })
      return { path: remotePath, entries }
    } finally {
      release()
    }
  }

  async mkdir(connectionId: string, path: string): Promise<void> {
    const remotePath = normalizeRemotePath(path)
    const { sftp, release } = await this.openSftp(connectionId)
    try {
      await new Promise<void>((resolvePromise, reject) => {
        sftp.mkdir(remotePath, (err) => (err ? reject(err) : resolvePromise()))
      })
    } finally {
      release()
    }
  }

  async delete(connectionId: string, path: string): Promise<void> {
    const remotePath = normalizeRemotePath(path)
    const { sftp, release } = await this.openSftp(connectionId)
    try {
      await new Promise<void>((resolvePromise, reject) => {
        sftp.stat(remotePath, (err, attrs) => {
          if (err) {
            reject(err)
            return
          }
          const done = (e?: Error | null): void => (e ? reject(e) : resolvePromise())
          if (attrs.isDirectory()) sftp.rmdir(remotePath, done)
          else sftp.unlink(remotePath, done)
        })
      })
    } finally {
      release()
    }
  }

  async rename(connectionId: string, from: string, to: string): Promise<void> {
    const fromPath = normalizeRemotePath(from)
    const toPath = normalizeRemotePath(to)
    const { sftp, release } = await this.openSftp(connectionId)
    try {
      await new Promise<void>((resolvePromise, reject) => {
        sftp.rename(fromPath, toPath, (err) => (err ? reject(err) : resolvePromise()))
      })
    } finally {
      release()
    }
  }

  /** 读取文本文件内容用于预览，超过 1MB 截断。 */
  async readText(connectionId: string, path: string): Promise<string> {
    const remotePath = normalizeRemotePath(path)
    const { sftp, release } = await this.openSftp(connectionId)
    try {
      return await new Promise<string>((resolvePromise, reject) => {
        const stream = sftp.createReadStream(remotePath)
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        stream.on('data', (chunk: Buffer | string) => {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
          size += buf.length
          if (size > MAX_READ_TEXT_BYTES) {
            truncated = true
            stream.destroy()
            return
          }
          chunks.push(buf)
        })
        stream.on('error', (err) => {
          if (truncated) resolvePromise(buildText())
          else reject(err)
        })
        stream.on('end', () => resolvePromise(buildText()))
        // destroy() 截断时不会触发 end，用 close 兜底
        stream.on('close', () => resolvePromise(buildText()))
        function buildText(): string {
          const text = Buffer.concat(chunks).toString('utf8')
          return truncated ? `${text}\n\n[文件过大，仅显示前 1MB]` : text
        }
      })
    } finally {
      release()
    }
  }

  upload(connectionId: string, localPath: string, remotePath: string): string {
    return this.enqueue({
      id: randomUUID(),
      connectionId,
      direction: 'upload',
      localPath,
      remotePath: normalizeRemotePath(remotePath)
    })
  }

  download(connectionId: string, remotePath: string, localPath: string): string {
    return this.enqueue({
      id: randomUUID(),
      connectionId,
      direction: 'download',
      localPath,
      remotePath: normalizeRemotePath(remotePath)
    })
  }

  /** MCP 等需要同步结果的调用方：入队并等待完成。 */
  async uploadAndWait(
    connectionId: string,
    localPath: string,
    remotePath: string
  ): Promise<TransferResult> {
    return this.waitForTransfer(this.upload(connectionId, localPath, remotePath))
  }

  async downloadAndWait(
    connectionId: string,
    remotePath: string,
    localPath: string
  ): Promise<TransferResult> {
    return this.waitForTransfer(this.download(connectionId, remotePath, localPath))
  }

  private waitForTransfer(id: string): Promise<TransferResult> {
    return new Promise((resolvePromise) => this.waiters.set(id, resolvePromise))
  }

  cancel(transferId: string): void {
    const transfer = this.transfers.get(transferId)
    if (!transfer) return
    if (transfer === this.active) {
      transfer.cancelRequested = true
      for (const s of transfer.streams) s.destroy()
    } else {
      this.queue = this.queue.filter((t) => t.id !== transferId)
      this.transfers.delete(transferId)
      this.sink.emitDone({ transferId, ok: false, error: '已取消' })
      const waiter = this.waiters.get(transferId)
      this.waiters.delete(transferId)
      waiter?.({ ok: false, message: '已取消', bytesTransferred: 0 })
    }
  }

  private enqueue(t: Omit<QueuedTransfer, 'cancelRequested' | 'streams'>): string {
    const transfer: QueuedTransfer = { ...t, cancelRequested: false, streams: [] }
    this.transfers.set(transfer.id, transfer)
    this.queue.push(transfer)
    void this.pump()
    return transfer.id
  }

  private async pump(): Promise<void> {
    if (this.active || this.queue.length === 0) return
    const transfer = this.queue.shift() as QueuedTransfer
    this.active = transfer
    let result: TransferResult
    try {
      result = await this.runTransfer(transfer)
    } catch (err) {
      result = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        bytesTransferred: 0
      }
    }
    this.sink.emitDone({
      transferId: transfer.id,
      ok: result.ok,
      error: result.ok ? undefined : result.message
    })
    this.transfers.delete(transfer.id)
    this.active = null
    const waiter = this.waiters.get(transfer.id)
    this.waiters.delete(transfer.id)
    waiter?.(result)
    void this.pump()
  }

  private async runTransfer(t: QueuedTransfer): Promise<TransferResult> {
    const { sftp, release } = await this.openSftp(t.connectionId)
    let bytesTransferred = 0
    try {
      return await new Promise<TransferResult>((resolvePromise) => {
        let finished = false
        let lastEmit = 0
        const emitProgress = (n: number, total: number): void => {
          bytesTransferred = n
          const now = Date.now()
          if (now - lastEmit >= PROGRESS_INTERVAL_MS || n === total) {
            lastEmit = now
            this.sink.emitProgress({
              transferId: t.id,
              direction: t.direction,
              remotePath: t.remotePath,
              localPath: t.localPath,
              transferred: n,
              total
            })
          }
        }
        const finish = (ok: boolean, message: string): void => {
          if (finished) return
          finished = true
          if (t.cancelRequested) {
            void cleanupPartial(sftp, t)
            resolvePromise({ ok: false, message: '已取消', bytesTransferred })
            return
          }
          resolvePromise({ ok, message, bytesTransferred })
        }
        const fail = (err: Error): void => {
          finish(false, err.message)
        }

        if (t.direction === 'upload') {
          const total = statSync(t.localPath).size
          if (total > MAX_TRANSFER_BYTES) {
            finish(false, `文件超过 ${MAX_TRANSFER_BYTES / 1024 / 1024}MB 传输上限`)
            return
          }
          const rs = createReadStream(t.localPath)
          const ws = sftp.createWriteStream(t.remotePath)
          t.streams = [rs, ws]
          let sent = 0
          rs.on('data', (chunk: Buffer | string) => {
            sent += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
            emitProgress(sent, total)
          })
          rs.on('error', fail)
          ws.on('error', fail)
          ws.on('close', () => finish(true, '上传完成'))
          rs.pipe(ws)
        } else {
          sftp.stat(t.remotePath, (statErr, attrs) => {
            if (statErr) {
              finish(false, statErr.message)
              return
            }
            const total = attrs.size
            if (total > MAX_TRANSFER_BYTES) {
              finish(false, `文件超过 ${MAX_TRANSFER_BYTES / 1024 / 1024}MB 传输上限`)
              return
            }
            const rs = sftp.createReadStream(t.remotePath)
            const ws = createWriteStream(t.localPath)
            t.streams = [rs, ws]
            let got = 0
            rs.on('data', (chunk: Buffer | string) => {
              got += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
              emitProgress(got, total)
            })
            rs.on('error', fail)
            ws.on('error', fail)
            ws.on('close', () => finish(true, '下载完成'))
            rs.pipe(ws)
          })
        }
      })
    } finally {
      release()
    }
  }
}
