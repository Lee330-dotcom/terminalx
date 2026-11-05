import { reactive } from 'vue'

export interface TerminalSearchHandlers {
  findNext(query: string, incremental: boolean): boolean
  findPrevious(query: string): boolean
  clear(): void
}

export const terminalSearchResult = reactive({ index: -1, total: 0 })

const handlers = new Map<string, TerminalSearchHandlers>()

export function registerTerminalSearch(sessionId: string, api: TerminalSearchHandlers): () => void {
  handlers.set(sessionId, api)
  return () => {
    if (handlers.get(sessionId) === api) handlers.delete(sessionId)
  }
}

export function getTerminalSearch(sessionId: string): TerminalSearchHandlers | undefined {
  return handlers.get(sessionId)
}

export function resetTerminalSearchResult(): void {
  terminalSearchResult.index = -1
  terminalSearchResult.total = 0
}
