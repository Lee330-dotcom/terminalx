import { randomUUID } from 'crypto'
import { readJson, writeJsonAtomic } from './jsonFile'
import { Snippet, SnippetGroup, SnippetInput, SnippetLibrary } from '@shared/types'

interface SnippetsFile {
  groups: SnippetGroup[]
  snippets: Snippet[]
}

/**
 * 快捷命令库：本地保存常用命令（分组 + 命令 + 参数模板）。
 *
 * 命令正文本身是用户自己写的文本，不含凭据；与凭据库不同，
 * 这里直接明文落盘，便于用户自行查看与备份。
 */
export class SnippetStore {
  /**
   * 写操作串行化：片段库是"读—改—写"流程，
   * 连续保存会各自读写整份文件，这里用进程内队列把读改写串起来。
   */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn)
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<SnippetsFile> {
    try {
      const data = await readJson<SnippetsFile>(this.file, { groups: [], snippets: [] })
      return {
        groups: Array.isArray(data.groups) ? data.groups : [],
        snippets: Array.isArray(data.snippets) ? data.snippets : []
      }
    } catch {
      // 文件损坏：降级为空库，不阻断终端主链路
      return { groups: [], snippets: [] }
    }
  }

  private async save(data: SnippetsFile): Promise<void> {
    await writeJsonAtomic(this.file, data)
  }

  /** 读取全部分组与快捷命令。 */
  async list(): Promise<SnippetLibrary> {
    const data = await this.load()
    return {
      groups: [...data.groups].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
      snippets: [...data.snippets].sort(
        (a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)
      )
    }
  }

  /** 新建或更新一条快捷命令；id 为空表示新建。 */
  async upsert(input: SnippetInput, now = Date.now()): Promise<Snippet> {
    const name = input.name?.trim() ?? ''
    const command = input.command?.trim() ?? ''
    if (!name) throw new Error('快捷命令名称不能为空')
    if (!command) throw new Error('快捷命令内容不能为空')

    return this.withLock(async () => {
      const data = await this.load()
      const groupId = input.groupId ?? null
      if (groupId && !data.groups.some((g) => g.id === groupId)) {
        throw new Error(`分组不存在: ${groupId}`)
      }
      const existing = input.id ? data.snippets.find((s) => s.id === input.id) : undefined
      if (existing) {
        existing.name = name
        existing.command = command
        existing.description = input.description?.trim() ?? ''
        existing.groupId = groupId
        existing.autoEnter = input.autoEnter === true
        existing.updatedAt = now
        await this.save(data)
        return existing
      }
      const snippet: Snippet = {
        id: randomUUID(),
        name,
        command,
        description: input.description?.trim() ?? '',
        groupId,
        autoEnter: input.autoEnter === true,
        createdAt: now,
        updatedAt: now
      }
      data.snippets.push(snippet)
      await this.save(data)
      return snippet
    })
  }

  /** 删除一条快捷命令；返回是否确实删除了记录。 */
  async remove(id: string): Promise<boolean> {
    return this.withLock(async () => {
      const data = await this.load()
      const before = data.snippets.length
      data.snippets = data.snippets.filter((s) => s.id !== id)
      if (data.snippets.length === before) return false
      await this.save(data)
      return true
    })
  }

  /** 新建分组。 */
  async createGroup(name: string, now = Date.now()): Promise<SnippetGroup> {
    const trimmed = name?.trim() ?? ''
    if (!trimmed) throw new Error('分组名称不能为空')
    return this.withLock(async () => {
      const data = await this.load()
      const order = data.groups.reduce((max, g) => Math.max(max, g.order), -1) + 1
      const group: SnippetGroup = { id: randomUUID(), name: trimmed, order, createdAt: now }
      data.groups.push(group)
      await this.save(data)
      return group
    })
  }

  /** 重命名分组。 */
  async renameGroup(id: string, name: string): Promise<SnippetGroup> {
    const trimmed = name?.trim() ?? ''
    if (!trimmed) throw new Error('分组名称不能为空')
    return this.withLock(async () => {
      const data = await this.load()
      const group = data.groups.find((g) => g.id === id)
      if (!group) throw new Error(`分组不存在: ${id}`)
      group.name = trimmed
      await this.save(data)
      return group
    })
  }

  /**
   * 删除分组：该分组下的快捷命令回落为"未分组"（groupId 置空），
   * 快捷命令本身不删除——分组只是归类方式，不该带走用户内容。
   */
  async removeGroup(id: string): Promise<boolean> {
    return this.withLock(async () => {
      const data = await this.load()
      const before = data.groups.length
      data.groups = data.groups.filter((g) => g.id !== id)
      if (data.groups.length === before) return false
      for (const snippet of data.snippets) {
        if (snippet.groupId === id) snippet.groupId = null
      }
      await this.save(data)
      return true
    })
  }
}
