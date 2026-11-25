import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SettingsStore } from '../settingsStore'

let dir: string
let store: SettingsStore

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-settings-'))
  store = new SettingsStore(join(dir, 'settings.json'))
})

describe('SettingsStore', () => {
  it('首次读取返回默认值并生成随机 token', async () => {
    const s1 = await store.get()
    const s2 = await store.get()
    expect(s1.mcpEnabled).toBe(true)
    expect(s1.mcpPort).toBe(8080)
    expect(s1.mcpToken).toMatch(/^[0-9a-f]{64}$/)
    expect(s1.mcpToken).toBe(s2.mcpToken)
  })

  it('update 修改端口且保留 token', async () => {
    const before = await store.get()
    const after = await store.update({ mcpPort: 9000 })
    expect(after.mcpPort).toBe(9000)
    expect(after.mcpToken).toBe(before.mcpToken)
    // 重新加载（模拟重启）后持久化生效
    const reloaded = new SettingsStore(join(dir, 'settings.json'))
    const s = await reloaded.get()
    expect(s.mcpPort).toBe(9000)
    expect(s.mcpToken).toBe(before.mcpToken)
  })

  it('update 不允许修改 token', async () => {
    const before = await store.get()
    const after = await store.update({ mcpToken: 'hacked' } as never)
    expect(after.mcpToken).toBe(before.mcpToken)
  })

  it('regenerateToken 生成新 token 且旧 token 失效', async () => {
    const before = await store.get()
    const next = await store.regenerateToken()
    expect(next).toMatch(/^[0-9a-f]{64}$/)
    expect(next).not.toBe(before.mcpToken)
    const s = await store.get()
    expect(s.mcpToken).toBe(next)
  })
})

describe('外观模式迁移', () => {
  const file = (dir: string): string => join(dir, 'settings.json')

  async function writeLegacy(dir: string, data: Record<string, unknown>): Promise<void> {
    await fs.writeFile(file(dir), JSON.stringify(data), 'utf8')
  }

  it('旧 followSystemTheme=true 迁移为 system', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-settings-'))
    await writeLegacy(dir, { followSystemTheme: true })
    const s = await new SettingsStore(file(dir)).get()
    expect(s.themeMode).toBe('system')
    expect((s as unknown as Record<string, unknown>).followSystemTheme).toBeUndefined()
  })

  it('旧 followSystemTheme=false 且深色背景迁移为 dark', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-settings-'))
    await writeLegacy(dir, { followSystemTheme: false, backgroundColor: '#0d0d0d' })
    const s = await new SettingsStore(file(dir)).get()
    expect(s.themeMode).toBe('dark')
  })

  it('旧 followSystemTheme=false 且浅色背景迁移为 light', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-settings-'))
    await writeLegacy(dir, { followSystemTheme: false, backgroundColor: '#f4f5f6' })
    const s = await new SettingsStore(file(dir)).get()
    expect(s.themeMode).toBe('light')
  })

  it('已有 themeMode 直接采用，不被旧字段覆盖', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-settings-'))
    await writeLegacy(dir, { themeMode: 'light', followSystemTheme: true })
    const s = await new SettingsStore(file(dir)).get()
    expect(s.themeMode).toBe('light')
  })

  it('两者都缺失时沿用默认 dark', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-settings-'))
    await writeLegacy(dir, { mcpPort: 9999 })
    const s = await new SettingsStore(file(dir)).get()
    expect(s.themeMode).toBe('dark')
    expect(s.mcpPort).toBe(9999)
  })

  it('replace 同样执行迁移并写回时清理旧字段', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-settings-'))
    await writeLegacy(dir, { followSystemTheme: true })
    const store = new SettingsStore(file(dir))
    const next = await store.replace({ followSystemTheme: true })
    expect(next.themeMode).toBe('system')
    const raw = JSON.parse(await fs.readFile(file(dir), 'utf8')) as Record<string, unknown>
    expect(raw.followSystemTheme).toBeUndefined()
    expect(raw.themeMode).toBe('system')
  })
})
