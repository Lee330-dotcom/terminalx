import { randomUUID } from 'crypto'
import { createReadStream, createWriteStream, statSync, unlink } from 'fs'
import { posix } from 'path'
import { StringDecoder } from 'string_decoder'
import { SFTPWrapper } from 'ssh2'
import {
  SftpEntry,
  SftpListResult,
  SftpSearchEvent,
  TransferDoneEvent,
  TransferProgressEvent,
  TransferResult
} from '@shared/types'
import { ClientHandle, ConnectionManager } from './connectionManager'
import { FindOutputParser } from './findOutput'
import {
  buildFindCommand,
  isValidSearchKeyword,
  MAX_FIND_LINES
} from './searchCommand'
import { searchEntriesByName } from './sftpSearch'

const MAX_READ_TEXT_BYTES = 1024 * 1024
const MAX_TRANSFER_BYTES = 100 * 1024 * 1024
const PROGRESS_INTERVAL_MS = 100

export interface TransferEventSink {
  emitProgress(ev: TransferProgressEvent): void
  emitDone(ev: TransferDoneEvent): void
}

/** 文件名搜索结果的事件出口 */
export interface SearchEventSink {
  emitSearch(ev: SftpSearchEvent): void
}

/** 一次搜索的可取消状态 */
interface SearchState {
  cancelled: boolean
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
  /** 进行中的文件名搜索：searchId -> 取消标记 */
  private searches = new Map<string, SearchState>()
  /** 每个连接当前生效的搜索：connectionId -> searchId。
   * 堡垒机限制单会话通道数，同一连接同时只能有一条搜索在跑。 */
  private activeSearches = new Map<string, string>()

  constructor(
    private readonly ssh: ConnectionManager,
    private readonly sink: TransferEventSink,
    private readonly searchSink?: SearchEventSink
  ) {}

  private async openSftp(
    connectionId: string
  ): Promise<{ sftp: SFTPWrapper; release: () => void }> {
    const handle = await this.ssh.acquireIsolated(connectionId)
    try {
      const sftp = await new Promise<SFTPWrapper>((resolvePromise, reject) => {
        handle.client.sftp((err, s) => (err ? reject(err) : resolvePromise(s)))
      })
      let released = false
      return {
        sftp,
        release: () => {
          if (released) return
          released = true
          // SFTP 通道与 shell 共享底层 SSH client，操作完成后必须显式关闭，
          // 否则重复打开会触发服务端的 channelOpen too often 限制。
          sftp.end()
          handle.release()
        }
      }
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

  /**
   * 按名称递归搜索远程目录树。立即返回 searchId，遍历在后台进行，
   * 命中的条目分批通过 searchSink 推送，取消用 cancelSearch。
   *
   * 优先用远端 find（一次往返、远端自己遍历，速度远快于逐目录 readdir）；
   * 远端不支持 find 时回退到 SFTP 逐层遍历。
   */
  async startSearch(connectionId: string, root: string, keyword: string): Promise<string> {
    const searchId = randomUUID()
    const state: SearchState = { cancelled: false }
    // 同一连接上的旧搜索先停掉：堡垒机限制单会话通道数，并发 exec 会失败
    const previous = this.activeSearches.get(connectionId)
    if (previous) this.cancelSearch(previous)
    this.activeSearches.set(connectionId, searchId)
    this.searches.set(searchId, state)
    void this.runSearch(searchId, connectionId, root, keyword, state)
    return searchId
  }

  /** 取消进行中的搜索；遍历会在下一个目录边界停下，远端 find 会立刻关掉通道 */
  cancelSearch(searchId: string): void {
    const state = this.searches.get(searchId)
    if (state) state.cancelled = true
  }

  private async runSearch(
    searchId: string,
    connectionId: string,
    root: string,
    keyword: string,
    state: SearchState
  ): Promise<void> {
    const started = Date.now()
    try {
      const remoteRoot = normalizeRemotePath(root)
      if (!isValidSearchKeyword(keyword)) {
        throw new Error('搜索关键字包含非法字符')
      }
      const found = await this.searchViaExec(connectionId, remoteRoot, keyword, state, (entries) =>
        this.searchSink?.emitSearch({ searchId, connectionId, type: 'match', entries })
      )
      const way = found.cancelled ? '已取消' : found.ok ? 'find' : '回退遍历'
      console.log(
        `[timing] 搜索 ${remoteRoot} ${way}，命中 ${found.total} 条，用时 ${Date.now() - started}ms`
      )
      this.searchSink?.emitSearch({
        searchId,
        connectionId,
        type: 'done',
        truncated: found.truncated,
        stopped: found.cancelled || state.cancelled,
        scanned: found.scanned,
        total: found.total
      })
    } catch (err) {
      this.searchSink?.emitSearch({
        searchId,
        connectionId,
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      this.searches.delete(searchId)
      if (this.activeSearches.get(connectionId) === searchId) {
        this.activeSearches.delete(connectionId)
      }
    }
  }

  /**
   * 用远端 find 搜索。远端自己遍历文件系统，一次往返即可返回结果；
   * find 不可用或 -printf 不支持时回退到 SFTP 逐层遍历。
   */
  private async searchViaExec(
    connectionId: string,
    root: string,
    keyword: string,
    state: SearchState,
    onEntries: (entries: SftpEntry[]) => void
  ): Promise<{
    ok: boolean
    cancelled: boolean
    total: number
    truncated: boolean
    scanned: number
  }> {
    const handle = await this.ssh.acquireIsolated(connectionId)
    try {
      // 探测与搜索共用一个 exec 通道（堡垒机限制单会话通道数）
      const command = buildFindCommand(root, keyword)

      // 结果按行流式解析：命令还在跑就能看到已命中的文件
      const parser = new FindOutputParser()
      let total = 0
      const output = await this.execCommand(
        handle.client,
        command,
        120000,
        (chunk) => {
          const batch = parser.push(chunk)
          if (batch.length > 0) {
            total += batch.length
            onEntries(batch)
          }
        },
        () => state.cancelled
      )
      if (output.cancelled || state.cancelled) {
        return { ok: false, cancelled: true, total, truncated: false, scanned: total }
      }
      const tail = parser.flush()
      if (tail.length > 0) {
        total += tail.length
        onEntries(tail)
      }
      console.log(
        `[timing] find stderr: ${output.stderr.slice(0, 200)}，命中 ${total} 条`
      )
      if (/command not found/i.test(output.stderr)) {
        throw new Error('远端没有 find 命令')
      }
      if (output.timedOut) {
        throw new Error('远端搜索超时')
      }
      return {
        ok: true,
        cancelled: false,
        total,
        truncated: total >= MAX_FIND_LINES,
        scanned: total
      }
    } catch (err) {
      if (state.cancelled) {
        return { ok: false, cancelled: true, total: 0, truncated: false, scanned: 0 }
      }
      console.log(`[timing] find 搜索不可用，回退目录遍历: ${String(err)}`)
      // exec 不可用（堡垒机限制等）或远端没有 find：回退到 SFTP 遍历
      return this.searchViaWalk(connectionId, root, keyword, state, onEntries)
    } finally {
      handle.release()
    }
  }

  /**
   * 在独立连接上执行一条命令。
   *
   * 堡垒机代理的通道在命令结束后可能不发送 exit-status，通道不会自动关闭，
   * 因此以 stdout 的 EOF 作为主要完成信号，并留超时兜底。
   *
   * shouldAbort 返回 true 时立刻关闭通道，把堡垒机的会话通道配额还回去。
   */
  private execCommand(
    client: ClientHandle['client'],
    command: string,
    timeoutMs = 30000,
    onStdout?: (chunk: string) => void,
    shouldAbort?: () => boolean
  ): Promise<{
    stdout: string
    stderr: string
    code: number
    timedOut: boolean
    cancelled: boolean
  }> {
    return new Promise((resolvePromise, reject) => {
      let settled = false
      let cancelled = false
      const decoder = new StringDecoder('utf8')
      let stdout = ''
      let stderr = ''
      let timer: NodeJS.Timeout | null = null
      let endTimer: NodeJS.Timeout | null = null
      let abortTimer: NodeJS.Timeout | null = null

      const finish = (code: number, timedOut: boolean): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (endTimer) clearTimeout(endTimer)
        if (abortTimer) clearInterval(abortTimer)
        stdout += decoder.end()
        stderr += decoder.end()
        resolvePromise({ stdout, stderr, code, timedOut, cancelled })
      }

      client.exec(command, (err, stream) => {
        if (err) {
          settled = true
          reject(err)
          return
        }
        const abort = (): void => {
          if (settled) return
          cancelled = true
          // 关闭通道，把堡垒机的单会话通道配额立刻释放
          try {
            stream.close()
          } catch {
            /* 通道可能已经关闭 */
          }
          finish(0, false)
        }
        timer = setTimeout(() => finish(-1, true), timeoutMs)
        // 远端命令可能长时间没有输出，轮询取消标记保证停止能及时生效
        abortTimer = setInterval(() => {
          if (shouldAbort?.()) abort()
        }, 200)
        stream.stdout.on('data', (chunk: Buffer) => {
          if (shouldAbort?.()) {
            abort()
            return
          }
          const text = decoder.write(chunk)
          stdout += text
          onStdout?.(text)
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          stderr += decoder.write(chunk)
        })
        // stdout EOF：命令输出结束（通道可能仍不关闭）
        stream.stdout.on('end', () => {
          endTimer = setTimeout(() => finish(0, false), 200)
        })
        stream.on('close', (code: number | null) => finish(code ?? 0, false))
        stream.on('error', (e: Error) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          if (abortTimer) clearInterval(abortTimer)
          reject(e)
        })
      })
    })
  }

  /** 回退方案：用 SFTP 逐层遍历（远端没有 find 或 exec 被禁用时） */
  private async searchViaWalk(
    connectionId: string,
    root: string,
    keyword: string,
    state: SearchState,
    onEntries: (entries: SftpEntry[]) => void
  ): Promise<{
    ok: boolean
    cancelled: boolean
    total: number
    truncated: boolean
    scanned: number
  }> {
    const { sftp, release } = await this.openSftp(connectionId)
    try {
      const result = await searchEntriesByName(
        (path) => this.readdir(sftp, path),
        root,
        keyword,
        { shouldStop: () => state.cancelled },
        onEntries
      )
      return {
        ok: true,
        cancelled: state.cancelled,
        total: result.entries.length,
        truncated: result.truncated,
        scanned: result.scannedEntries
      }
    } finally {
      release()
    }
  }

  /** 读取单层目录；目录不存在或无权限时抛错 */
  private readdir(sftp: SFTPWrapper, path: string): Promise<SftpEntry[]> {
    return new Promise<SftpEntry[]>((resolvePromise, reject) => {
      sftp.readdir(path, (err, list) => {
        if (err) {
          reject(err)
          return
        }
        resolvePromise(
          list.map((e) => ({
            name: e.filename,
            path: posix.join(path, e.filename),
            isDirectory: e.longname.startsWith('d'),
            size: e.attrs.size,
            mode: e.attrs.mode,
            mtime: e.attrs.mtime
          }))
        )
      })
    })
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
