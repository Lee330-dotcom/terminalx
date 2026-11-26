import { defineStore } from 'pinia'
import { Snippet } from '@shared/types'

export interface SnippetRunResult {
  /** 用户是否确认执行 */
  ok: boolean
  /** 填参结果（无占位符时为空） */
  values: Record<string, string>
}

interface PendingRun {
  snippet: Snippet
  sessionId: string
  resolve: (result: SnippetRunResult) => void
}

/**
 * 待执行的快捷命令：需要填参的片段在此挂起，
 * 由全局弹窗（SnippetRunnerDialog.vue）收集参数后回填。
 */
export const useSnippetRunStore = defineStore('snippetRun', {
  state: () => ({
    pending: null as PendingRun | null
  }),
  actions: {
    /** 挂起一次执行请求，返回用户是否确认执行 */
    request(snippet: Snippet, sessionId: string): Promise<SnippetRunResult> {
      return new Promise<SnippetRunResult>((resolve) => {
        this.pending = { snippet, sessionId, resolve }
      })
    },
    /** 用户确认执行：回传填参结果，由调用方下发命令 */
    confirm(values: Record<string, string>): void {
      const pending = this.pending
      if (!pending) return
      this.pending = null
      pending.resolve({ ok: true, values })
    },
    /** 用户取消：不下发任何内容 */
    cancel(): void {
      const pending = this.pending
      if (!pending) return
      this.pending = null
      pending.resolve({ ok: false, values: {} })
    }
  }
})
