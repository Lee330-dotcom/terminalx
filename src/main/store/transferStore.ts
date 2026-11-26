import { readJson, writeJsonAtomic } from './jsonFile'
import { TransferRecord } from '@shared/types'

/** 记录上限：只保留最近的一批，避免文件无限增长。 */
const MAX_RECORDS = 200

/**
 * 传输记录：把每次上传/下载留痕落盘（transfers.json）。
 *
 * 记录里只有路径与文件名，不含凭据，因此明文落盘，
 * 便于用户自行核对"刚才下载了什么、落在哪里"。
 */
export class TransferStore {
  /**
   * 写操作串行化：记录是"读—改—写"流程，
   * 传输进度与完成事件可能接连到达，这里用进程内队列把读改写串起来。
   */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn)
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<TransferRecord[]> {
    try {
      const data = await readJson<TransferRecord[]>(this.file, [])
      return Array.isArray(data) ? data.filter((r) => r && typeof r.id === 'string') : []
    } catch {
      // 文件损坏：降级为空列表，不影响传输功能
      return []
    }
  }

  private async save(records: TransferRecord[]): Promise<void> {
    await writeJsonAtomic(this.file, records)
  }

  private trim(records: TransferRecord[]): TransferRecord[] {
    if (records.length <= MAX_RECORDS) return records
    // 保留最新的 MAX_RECORDS 条
    return [...records].sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_RECORDS)
  }

  /** 读取全部传输记录，按开始时间倒序（最新在前）。 */
  async list(): Promise<TransferRecord[]> {
    const data = await this.load()
    return [...data].sort((a, b) => b.startedAt - a.startedAt)
  }

  /** 记录一次传输的开始。 */
  async recordStart(record: TransferRecord): Promise<void> {
    await this.withLock(async () => {
      const data = await this.load()
      const existing = data.find((r) => r.id === record.id)
      if (existing) {
        Object.assign(existing, record)
      } else {
        data.push(record)
      }
      await this.save(this.trim(data))
    })
  }

  /** 更新传输进度。 */
  async recordProgress(id: string, transferred: number, total: number): Promise<void> {
    await this.withLock(async () => {
      const data = await this.load()
      const record = data.find((r) => r.id === id)
      if (!record) return
      record.transferred = transferred
      if (total > 0) record.total = total
      await this.save(data)
    })
  }

  /** 更新传输终态。 */
  async recordFinish(
    id: string,
    status: TransferRecord['status'],
    error?: string,
    now = Date.now()
  ): Promise<void> {
    await this.withLock(async () => {
      const data = await this.load()
      const record = data.find((r) => r.id === id)
      if (!record) return
      record.status = status
      record.finishedAt = now
      if (error) record.error = error
      await this.save(data)
    })
  }

  /** 删除一条记录；返回是否确实删除了。 */
  async remove(id: string): Promise<boolean> {
    return this.withLock(async () => {
      const data = await this.load()
      const before = data.length
      const next = data.filter((r) => r.id !== id)
      if (next.length === before) return false
      await this.save(next)
      return true
    })
  }

  /** 清空全部记录。 */
  async clear(): Promise<void> {
    await this.withLock(async () => {
      await this.save([])
    })
  }
}
