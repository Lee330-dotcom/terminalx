import { defineStore } from 'pinia'
import { SessionStatus } from '@shared/types'

export interface SessionTab {
  sessionId: string
  connectionId: string
  title: string
  status: SessionStatus
  errorMessage?: string
}

let unsubStatus: (() => void) | null = null

export const useSessionStore = defineStore('sessions', {
  state: () => ({
    tabs: [] as SessionTab[],
    activeSessionId: null as string | null
  }),
  getters: {
    activeTab(state): SessionTab | null {
      return state.tabs.find((t) => t.sessionId === state.activeSessionId) ?? null
    }
  },
  actions: {
    ensureStatusListener(): void {
      if (unsubStatus) return
      unsubStatus = window.api.onSessionStatus((ev) => {
        const tab = this.tabs.find((t) => t.sessionId === ev.sessionId)
        if (tab) {
          tab.status = ev.status
          tab.errorMessage = ev.errorMessage
        }
      })
    },
    async openSession(connectionId: string, title?: string): Promise<void> {
      this.ensureStatusListener()
      const { sessionId } = await window.api.openSession(connectionId)
      this.tabs.push({
        sessionId,
        connectionId,
        title: title ?? connectionId,
        status: 'connecting'
      })
      this.activeSessionId = sessionId
    },
    setActive(sessionId: string): void {
      this.activeSessionId = sessionId
    },
    async closeSession(sessionId: string): Promise<void> {
      await window.api.closeSession(sessionId)
      const idx = this.tabs.findIndex((t) => t.sessionId === sessionId)
      if (idx >= 0) this.tabs.splice(idx, 1)
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = this.tabs.length > 0 ? this.tabs[Math.max(0, idx - 1)].sessionId : null
      }
    },
    async reconnect(sessionId: string): Promise<void> {
      const tab = this.tabs.find((t) => t.sessionId === sessionId)
      if (!tab) return
      tab.status = 'connecting'
      tab.errorMessage = undefined
      await window.api.reconnectSession(sessionId)
    }
  }
})
