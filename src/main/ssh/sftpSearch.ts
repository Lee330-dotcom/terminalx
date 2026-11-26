import { SftpEntry } from '@shared/types'

/** 递归搜索默认最大深度（根目录记为第 0 层） */
export const SEARCH_MAX_DEPTH = 12
/** 递归搜索默认最大结果条数 */
export const SEARCH_MAX_RESULTS = 500

export interface SftpSearchLimits {
  /** 最大递归深度，超过该深度的目录不再展开 */
  maxDepth?: number
  /** 最大结果条数，达到上限即停止并标记 truncated */
  maxResults?: number
  /** 返回 true 时中止遍历（用于取消） */
  shouldStop?: () => boolean
}

export interface SftpSearchWalkResult {
  entries: SftpEntry[]
  /** 结果数达到上限被截断 */
  truncated: boolean
  /** 被 shouldStop 中止 */
  stopped: boolean
  scannedDirs: number
  scannedEntries: number
}

/** 遍历进度回调，用于界面/日志观察扫描过程 */
export interface SftpSearchProgress {
  scannedDirs: number
  scannedEntries: number
  matched: number
}

export type SftpReaddir = (path: string) => Promise<SftpEntry[]>

/** 是否为符号链接（遍历时不跟随，避免环） */
export function isSymlinkMode(mode: number): boolean {
  return (mode & 0o170000) === 0o120000
}

/** 名称匹配：忽略大小写的子串匹配 */
export function matchFileName(name: string, keyword: string): boolean {
  const key = keyword.trim().toLowerCase()
  if (!key) return false
  return name.toLowerCase().includes(key)
}

/**
 * 广度优先遍历远程目录树，收集名称匹配 keyword 的条目。
 *
 * - 单个目录不可读（权限不足 / 软链断裂）时跳过继续，保证部分结果可用；
 * - 根目录不可读时抛错，由调用方提示；
 * - 命中结果按目录分批回调，便于界面渐进展示。
 */
export async function searchEntriesByName(
  readdir: SftpReaddir,
  root: string,
  keyword: string,
  limits: SftpSearchLimits = {},
  onBatch?: (entries: SftpEntry[]) => void,
  onProgress?: (progress: SftpSearchProgress) => void
): Promise<SftpSearchWalkResult> {
  const maxDepth = limits.maxDepth ?? SEARCH_MAX_DEPTH
  const maxResults = limits.maxResults ?? SEARCH_MAX_RESULTS
  const key = keyword.trim().toLowerCase()

  const entries: SftpEntry[] = []
  const queue: { path: string; depth: number }[] = [{ path: root, depth: 0 }]
  let truncated = false
  let stopped = false
  let scannedDirs = 0
  let scannedEntries = 0

  while (queue.length > 0) {
    if (limits.shouldStop?.()) {
      stopped = true
      break
    }
    const current = queue.shift() as { path: string; depth: number }
    let children: SftpEntry[]
    try {
      children = await readdir(current.path)
    } catch (err) {
      // 根目录读不出来没有继续搜索的意义，直接上抛
      if (current.path === root) throw err
      continue
    }
    scannedDirs += 1

    const batch: SftpEntry[] = []
    for (const child of children) {
      scannedEntries += 1
      if (key && child.name.toLowerCase().includes(key)) {
        entries.push(child)
        batch.push(child)
        if (entries.length >= maxResults) {
          truncated = true
          break
        }
      }
      if (child.isDirectory && !isSymlinkMode(child.mode) && current.depth + 1 < maxDepth) {
        queue.push({ path: child.path, depth: current.depth + 1 })
      }
    }
    if (batch.length > 0) onBatch?.(batch)
    onProgress?.({ scannedDirs, scannedEntries, matched: entries.length })
    if (truncated) break
  }

  return { entries, truncated, stopped, scannedDirs, scannedEntries }
}
