import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { SettingsStore } from '../settingsStore'

let dir: string
let store: SettingsStore

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'ssh-tool-settings-'))
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
