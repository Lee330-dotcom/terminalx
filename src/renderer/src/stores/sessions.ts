import { defineStore } from 'pinia'

/**
 * 连接使用记录：统计每个连接的打开次数与最近使用时间，
 * 供连接中心的「最近使用 / 常用」筛选使用。
 *
 * 标签、窗格与会话生命周期由 `stores/workspace.ts` 负责。
 */

interface UsageRecord {
  count: number
  lastAt: number
}

const USAGE_KEY = 'terminalx.usage'

function loadUsage(): Record<string, UsageRecord> {
  try {
    return JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, UsageRecord>
  } catch {
    return {}
  }
}

function saveUsage(usage: Record<string, UsageRecord>): void {
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage))
}

export const useSessionStore = defineStore('sessions', {
  state: () => ({
    usage: loadUsage() as Record<string, UsageRecord>
  }),
  getters: {
    recentIds(state): string[] {
      return Object.entries(state.usage)
        .sort((a, b) => b[1].lastAt - a[1].lastAt)
        .map(([id]) => id)
    },
    frequentIds(state): string[] {
      return Object.entries(state.usage)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([id]) => id)
    }
  },
  actions: {
    recordUsage(connectionId: string): void {
      const prev = this.usage[connectionId] ?? { count: 0, lastAt: 0 }
      this.usage[connectionId] = { count: prev.count + 1, lastAt: Date.now() }
      saveUsage(this.usage)
    }
  }
})
