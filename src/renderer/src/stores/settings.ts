import { defineStore } from 'pinia'
import { Settings } from '@shared/types'
import { applyUiSettings } from '../theme'
import { setLang } from '../i18n'

const UI_KEYS = ['themeColor', 'backgroundColor', 'navColor', 'themeMode', 'uiFont'] as const

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: null as Settings | null
  }),
  actions: {
    async load(): Promise<void> {
      const s = await window.api.getSettings()
      this.settings = s
      setLang(s.language)
      applyUiSettings(s)
    },
    async update(patch: Partial<Omit<Settings, 'mcpToken'>>): Promise<Settings> {
      const next = await window.api.updateSettings(patch)
      this.settings = next
      if (UI_KEYS.some((k) => k in patch)) {
        applyUiSettings(next)
      }
      return next
    }
  }
})
