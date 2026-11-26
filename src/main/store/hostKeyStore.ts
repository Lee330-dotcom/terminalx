import { readJson, writeJsonAtomic } from './jsonFile'
import { hostKeyId } from '../ssh/hostKeyUtils'

export interface HostKeyRecord {
  host: string
  port: number
  /** `SHA256:` + base64(SHA256(公钥 blob)) */
  fingerprint: string
  /** ssh-ed25519 / ssh-rsa 等 */
  keyType: string
  /** 首次信任时间 */
  addedAt: number
  /** 最近一次校验通过（并确认）的时间 */
  lastSeenAt: number
}

interface HostKeysFile {
  hosts: HostKeyRecord[]
}

export interface HostKeyImportResult {
  /** 新增条目数 */
  imported: number
  /** 覆盖已有条目数 */
  updated: number
  /** 跳过的行数（含带标记的行与非法行） */
  skipped: number
}

/**
 * 主机指纹库：记录用户已信任的主机公钥指纹。
 *
 * 威胁模型与 OpenSSH known_hosts 一致——防网络中间人，不防本机 root。
 * 文件损坏时降级为空库（不阻断终端主链路），但下次连接会重新走首次确认。
 */
export class HostKeyStore {
  /**
   * 写操作串行化：指纹库是"读—改—写"流程，
   * 两条并发握手（不同主机同时首次信任）若各自读写整份文件会互相覆盖，
   * 这里用一把进程内互斥锁把读改写串起来。
   */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  /** 把一段读改写放进串行队列执行，保证不会丢更新。 */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn)
    // 队列本身不因业务错误而中断
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<HostKeysFile> {
    try {
      const data = await readJson<HostKeysFile>(this.file, { hosts: [] })
      if (!Array.isArray(data.hosts)) return { hosts: [] }
      return data
    } catch {
      // 文件损坏：降级为空库，不阻断连接（降级容忍）
      return { hosts: [] }
    }
  }

  private async save(data: HostKeysFile): Promise<void> {
    await writeJsonAtomic(this.file, data)
  }

  async list(): Promise<HostKeyRecord[]> {
    const data = await this.load()
    return [...data.hosts].sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port)
  }

  async get(host: string, port: number): Promise<HostKeyRecord | null> {
    const data = await this.load()
    const id = hostKeyId(host, port)
    return data.hosts.find((h) => hostKeyId(h.host, h.port) === id) ?? null
  }

  /** 信任（或更新）一台主机的指纹。 */
  async trust(
    host: string,
    port: number,
    fingerprint: string,
    keyType: string,
    now = Date.now()
  ): Promise<HostKeyRecord> {
    return this.withLock(async () => {
      const data = await this.load()
      const id = hostKeyId(host, port)
      const existing = data.hosts.find((h) => hostKeyId(h.host, h.port) === id)
      if (existing) {
        existing.fingerprint = fingerprint
        existing.keyType = keyType
        existing.lastSeenAt = now
        await this.save(data)
        return existing
      }
      const record: HostKeyRecord = {
        host,
        port,
        fingerprint,
        keyType,
        addedAt: now,
        lastSeenAt: now
      }
      data.hosts.push(record)
      await this.save(data)
      return record
    })
  }

  /** 忘记一台主机的指纹；返回是否确实删除了记录。 */
  async forget(host: string, port: number): Promise<boolean> {
    return this.withLock(async () => {
      const data = await this.load()
      const id = hostKeyId(host, port)
      const before = data.hosts.length
      data.hosts = data.hosts.filter((h) => hostKeyId(h.host, h.port) !== id)
      if (data.hosts.length === before) return false
      await this.save(data)
      return true
    })
  }

  /** 仅更新最近确认时间（指纹未变时的轻量写入）。 */
  async touch(host: string, port: number, now = Date.now()): Promise<void> {
    await this.withLock(async () => {
      const data = await this.load()
      const id = hostKeyId(host, port)
      const existing = data.hosts.find((h) => hostKeyId(h.host, h.port) === id)
      if (!existing) return
      existing.lastSeenAt = now
      await this.save(data)
    })
  }

  /**
   * 批量写入指纹（known_hosts 导入场景）。
   * 已存在的条目按导入值覆盖并计入 updated，否则计入 imported。
   */
  async importRecords(
    records: { host: string; port: number; fingerprint: string; keyType: string }[],
    now = Date.now()
  ): Promise<HostKeyImportResult> {
    return this.withLock(async () => {
      const data = await this.load()
      let imported = 0
      let updated = 0
      for (const rec of records) {
        const id = hostKeyId(rec.host, rec.port)
        const existing = data.hosts.find((h) => hostKeyId(h.host, h.port) === id)
        if (existing) {
          existing.fingerprint = rec.fingerprint
          existing.keyType = rec.keyType
          existing.lastSeenAt = now
          updated++
        } else {
          data.hosts.push({
            host: rec.host,
            port: rec.port,
            fingerprint: rec.fingerprint,
            keyType: rec.keyType,
            addedAt: now,
            lastSeenAt: now
          })
          imported++
        }
      }
      await this.save(data)
      return { imported, updated, skipped: 0 }
    })
  }
}
