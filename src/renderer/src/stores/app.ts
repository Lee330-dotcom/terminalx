import { defineStore } from 'pinia'
import { ConnectionGroup, ConnectionWithStatus } from '@shared/types'

export const useAppStore = defineStore('app', {
  state: () => ({
    connections: [] as ConnectionWithStatus[],
    groups: [] as ConnectionGroup[],
    loaded: false
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
