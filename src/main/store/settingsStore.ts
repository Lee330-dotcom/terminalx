import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { Settings, ThemeMode } from '@shared/types'
import { isDarkColor } from '@shared/color'
import { writeJsonAtomic } from './jsonFile'

const DEFAULT_PORT = 8080
const DEFAULT_THEME_COLOR = '#10b981'
const DEFAULT_BACKGROUND = '#0d0d0d'
const DEFAULT_NAV = '#151515'

/** 旧版设置：followSystemTheme 布尔已由 themeMode 三态取代。 */
type LegacySettings = Partial<Settings> & { followSystemTheme?: boolean }

function defaultSettings(): Settings {
  return {
    mcpEnabled: true,
    mcpPort: DEFAULT_PORT,
    mcpToken: randomBytes(32).toString('hex'),
    mcpDisabledTools: [],
    themeColor: DEFAULT_THEME_COLOR,
    backgroundColor: DEFAULT_BACKGROUND,
    navColor: DEFAULT_NAV,
    themeMode: 'dark',
    uiFont: '',
    windowOpacity: 100,
    uiScale: 100,
    autoLaunch: false,
    disableHardwareAcceleration: false,
    blockSystemSleep: false,
    closeButtonAction: 'hide',
    confirmOnClose: false,
    language: 'zh-CN',
    aiBaseUrl: 'https://api.openai.com/v1',
    aiModel: '',
    aiAutoExecute: false
  }
}

/**
 * 迁移外观模式：
 * - 已有 themeMode 直接采用
 * - 旧 followSystemTheme=true → system
 * - 旧 followSystemTheme=false → 按背景色深浅推导 light/dark
 * - 都缺失 → 沿用 fallback
 */
function migrateThemeMode(
  parsed: LegacySettings,
  fallback: { mode: ThemeMode; backgroundColor: string }
): ThemeMode {
  if (parsed.themeMode === 'light' || parsed.themeMode === 'dark' || parsed.themeMode === 'system') {
    return parsed.themeMode
  }
  if (typeof parsed.followSystemTheme === 'boolean') {
    if (parsed.followSystemTheme) return 'system'
    return isDarkColor(parsed.backgroundColor ?? fallback.backgroundColor) ? 'dark' : 'light'
  }
  return fallback.mode
}

export class SettingsStore {
  constructor(private readonly file: string) {}

  async get(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as LegacySettings
      const defaults = defaultSettings()
      const next = {
        ...defaults,
        ...parsed,
        themeMode: migrateThemeMode(parsed, {
          mode: defaults.themeMode,
          backgroundColor: defaults.backgroundColor
        })
      } as Settings & { followSystemTheme?: boolean }
      delete next.followSystemTheme
      return next
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // 首次读取：生成默认配置（含随机 token）并持久化
        const settings = defaultSettings()
        await writeJsonAtomic(this.file, settings)
        return settings
      }
      throw err
    }
  }

  /** patch 不允许修改 token（token 只能通过 regenerateToken 变更）。 */
  async update(patch: Partial<Omit<Settings, 'mcpToken'>>): Promise<Settings> {
    const current = await this.get()
    const next: Settings = { ...current, ...patch, mcpToken: current.mcpToken }
    await writeJsonAtomic(this.file, next)
    return next
  }

  /** 从备份文件整体恢复：未知字段丢弃，token 缺失时重新生成。 */
  async replace(raw: unknown): Promise<Settings> {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('配置文件格式无效')
    }
    const current = await this.get()
    const parsed = raw as LegacySettings
    const next = {
      ...defaultSettings(),
      ...current,
      ...parsed,
      themeMode: migrateThemeMode(parsed, {
        mode: current.themeMode,
        backgroundColor: current.backgroundColor
      }),
      mcpToken:
        typeof parsed.mcpToken === 'string' && parsed.mcpToken.length >= 16
          ? parsed.mcpToken
          : current.mcpToken
    } as Settings & { followSystemTheme?: boolean }
    delete next.followSystemTheme
    await writeJsonAtomic(this.file, next)
    return next
  }

  async regenerateToken(): Promise<string> {
    const current = await this.get()
    const next: Settings = { ...current, mcpToken: randomBytes(32).toString('hex') }
    await writeJsonAtomic(this.file, next)
    return next.mcpToken
  }
}
