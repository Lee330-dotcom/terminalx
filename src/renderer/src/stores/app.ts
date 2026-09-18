import { defineStore } from 'pinia'
import { ConnectionGroup, ConnectionWithStatus } from '@shared/types'

export const useAppStore = defineStore('app', {
  state: () => ({
    connections: [] as ConnectionWithStatus[],
    groups: [] as ConnectionGroup[],
    loaded: false,
    /** 连接 ID -> 延迟(ms)，null 表示不可达 */
    probes: {} as Record<string, number | null>
  }),
  actions: {
    async refresh(): Promise<void> {
      const [connections, groups] = await Promise.all([
        window.api.listConnections(),
        window.api.listGroups()
      ])
      this.connections = connections
      this.groups = groups
      this.loaded = true
    },
    async toggleFavorite(id: string): Promise<void> {
      await window.api.toggleFavorite(id)
      await this.refresh()
    },
    async refreshProbes(): Promise<void> {
      const targets = this.connections.map((c) => ({ id: c.id, host: c.host, port: c.port }))
      if (targets.length === 0) {
        this.probes = {}
        return
      }
      const results = await window.api.probeConnections(targets)
      this.probes = Object.fromEntries(results.map((r) => [r.id, r.latencyMs]))
    },
    async createGroup(name: string): Promise<void> {
      await window.api.createGroup(name)
      await this.refresh()
    },
    async deleteGroup(id: string): Promise<void> {
      await window.api.deleteGroup(id)
      await this.refresh()
    },
    async deleteConnection(id: string): Promise<void> {
      await window.api.deleteConnection(id)
      await this.refresh()
    }
  }
})
