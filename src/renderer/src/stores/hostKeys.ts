import { defineStore } from 'pinia'
import { HostKeyPrompt, HostKeyRecord } from '@shared/types'

/**
 * 主机指纹状态：待确认的指纹请求 + 已信任主机列表。
 *
 * 指纹确认是全局的（任何 SSH 握手都可能触发），因此放在独立 store 里，
 * 由 App.vue 挂载的全局弹窗消费。
 */
export const useHostKeyStore = defineStore('hostKeys', {
  state: () => ({
    /** 当前待用户确认的指纹请求 */
    pending: null as HostKeyPrompt | null,
    /** 已信任的主机指纹 */
    records: [] as HostKeyRecord[],
    unsubPrompt: null as (() => void) | null
  }),
  actions: {
    /** 订阅主进程推送的指纹确认请求（只订阅一次） */
    ensurePromptListener(): void {
      if (this.unsubPrompt) return
      this.unsubPrompt = window.api.onHostKeyPrompt((prompt) => {
        this.pending = prompt
      })
    },
    setPending(prompt: HostKeyPrompt | null): void {
      this.pending = prompt
    },
    /** 应答指纹确认；accept 为 true 表示信任并继续 */
    async respond(accept: boolean): Promise<void> {
      const request = this.pending
      if (!request) return
      // 先清空，避免用户连点导致重复应答
      this.pending = null
      await window.api.respondHostKey(request.requestId, accept)
      if (!accept) await this.load()
    },
    async load(): Promise<void> {
      this.records = await window.api.listHostKeys()
    },
    async forget(host: string, port: number): Promise<void> {
      await window.api.forgetHostKey(host, port)
      await this.load()
    },
    /** 导入 known_hosts；返回 null 表示用户取消 */
    async importKnownHosts(filePath?: string): Promise<{
      imported: number
      updated: number
      skipped: number
    } | null> {
      const result = await window.api.importKnownHosts(filePath)
      if (result) await this.load()
      return result
    }
  }
})
