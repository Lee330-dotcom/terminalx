import { posix } from 'path'
import { SftpEntry } from '@shared/types'

/**
 * 解析远端 find 的输出，按行切分。
 * - -printf 模式：每行为「类型\t路径」（类型 f/d/l）
 * - -print 模式：每行为纯路径
 *
 * 两种格式可以混在同一次输出里（命令会在两种格式间回退），
 * 因此逐行判断：首段是单个 f/d/l 字符时按 -printf 解析，否则按纯路径解析。
 */
export class FindOutputParser {
  private buffer = ''

  /** 追加一段输出，返回本次可解析出的完整条目 */
  push(chunk: string): SftpEntry[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    return this.toEntries(lines)
  }

  /** 收尾：解析最后一段不完整的行 */
  flush(): SftpEntry[] {
    const rest = this.buffer
    this.buffer = ''
    if (!rest.trim()) return []
    return this.toEntries([rest])
  }

  private toEntries(lines: string[]): SftpEntry[] {
    const entries: SftpEntry[] = []
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      let type = 'f'
      let path = line
      const tab = line.indexOf('\t')
      if (tab === 1 && 'fdl'.includes(line[0])) {
        type = line[0]
        path = line.slice(tab + 1)
      }
      if (!path.startsWith('/')) path = posix.join('/', path)
      const name = path.slice(path.lastIndexOf('/') + 1)
      if (!name) continue
      entries.push({
        name,
        path,
        isDirectory: type === 'd',
        size: 0,
        mode: type === 'd' ? 0o040755 : 0o100644,
        mtime: 0
      })
    }
    return entries
  }
}
