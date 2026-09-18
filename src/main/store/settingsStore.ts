import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { Settings } from '@shared/types'
import { writeJsonAtomic } from './jsonFile'

const DEFAULT_PORT = 8080

function defaultSettings(): Settings {
  return {
    mcpEnabled: true,
    mcpPort: DEFAULT_PORT,
    mcpToken: randomBytes(32).toString('hex'),
    mcpDisabledTools: [],
    themeColor: '#10b981',
    backgroundColor: '#0d0d0d',
    navColor: '#151515',
    followSystemTheme: false,
    uiFont: '',
    windowOpacity: 100,
    uiScale: 100,
    autoLaunch: false,
    disableHardwareAcceleration: false,
    blockSystemSleep: false,
    closeButtonAction: 'hide',
    confirmOnClose: false,
    language: 'zh-CN'
  }
}

export class SettingsStore {
  constructor(private readonly file: string) {}

  async get(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<Settings>
      return { ...defaultSettings(), ...parsed }
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
    const parsed = raw as Partial<Settings>
    const next: Settings = {
      ...defaultSettings(),
      ...current,
      ...parsed,
      mcpToken:
        typeof parsed.mcpToken === 'string' && parsed.mcpToken.length >= 16
          ? parsed.mcpToken
          : current.mcpToken
    }
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
