import { defineStore } from 'pinia'
import { Snippet, SnippetGroup, SnippetInput } from '@shared/types'

/**
 * 快捷命令库状态：分组 + 命令。
 *
 * 片段本身是用户自己写的命令文本，不含凭据，落盘在主进程，
 * 这里只做渲染层缓存与 CRUD 转发。
 */
export const useSnippetStore = defineStore('snippets', {
  state: () => ({
    groups: [] as SnippetGroup[],
    snippets: [] as Snippet[],
    loaded: false
  }),
  getters: {
    /** 分组名（未分组返回空串） */
    groupName:
      (state) =>
      (groupId: string | null): string =>
        state.groups.find((g) => g.id === groupId)?.name ?? '',
    /** 未分组的快捷命令 */
    ungrouped: (state): Snippet[] => state.snippets.filter((s) => !s.groupId)
  },
  actions: {
    async load(): Promise<void> {
      const library = await window.api.listSnippets()
      this.groups = library.groups
      this.snippets = library.snippets
      this.loaded = true
    },
    async save(input: SnippetInput): Promise<Snippet> {
      const saved = await window.api.upsertSnippet(input)
      await this.load()
      return saved
    },
    async remove(id: string): Promise<void> {
      await window.api.deleteSnippet(id)
      await this.load()
    },
    async createGroup(name: string): Promise<SnippetGroup> {
      const group = await window.api.createSnippetGroup(name)
      await this.load()
      return group
    },
    async renameGroup(id: string, name: string): Promise<void> {
      await window.api.renameSnippetGroup(id, name)
      await this.load()
    },
    /** 删除分组；其下快捷命令回落为未分组，不会被删除 */
    async removeGroup(id: string): Promise<void> {
      await window.api.deleteSnippetGroup(id)
      await this.load()
    }
  }
})
