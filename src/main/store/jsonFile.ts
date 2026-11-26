import { promises as fs } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

let writeSeq = 0

/**
 * 原子写入：先写临时文件再 rename，避免崩溃留下半截 JSON。
 *
 * 临时文件名带随机后缀：并发写同一文件时（例如同时信任两台主机）
 * 各自的临时文件互不覆盖，否则后写者会把先写者已 rename 走的临时文件搞丢。
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${writeSeq++}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}
