import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { Settings } from '@shared/types'
import { writeJsonAtomic } from './jsonFile'

const DEFAULT_PORT = 8080

function defaultSettings(): Settings {
  return {
    mcpEnabled: true,
    mcpPort: DEFAULT_PORT,
    mcpToken: randomBytes(32).toString('hex')
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

  async regenerateToken(): Promise<string> {
    const current = await this.get()
    const next: Settings = { ...current, mcpToken: randomBytes(32).toString('hex') }
    await writeJsonAtomic(this.file, next)
    return next.mcpToken
  }
}
