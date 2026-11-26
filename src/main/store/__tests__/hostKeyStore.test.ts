import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HostKeyStore } from '../hostKeyStore'

let dir: string
let file: string
let store: HostKeyStore

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-hostkeys-'))
  file = join(dir, 'hostKeys.json')
  store = new HostKeyStore(file)
})

describe('HostKeyStore', () => {
  it('初始为空库', async () => {
    expect(await store.list()).toEqual([])
    expect(await store.get('h', 22)).toBeNull()
  })

  it('trust 写入记录并可按 host+port 读回', async () => {
    const rec = await store.trust('10.0.0.1', 22, 'SHA256:aaa', 'ssh-ed25519', 1000)
    expect(rec.addedAt).toBe(1000)
    const got = await store.get('10.0.0.1', 22)
    expect(got?.fingerprint).toBe('SHA256:aaa')
    expect(got?.keyType).toBe('ssh-ed25519')
  })

  it('同主机不同端口是不同记录', async () => {
    await store.trust('10.0.0.1', 22, 'SHA256:aaa', 'ssh-ed25519')
    await store.trust('10.0.0.1', 2222, 'SHA256:bbb', 'ssh-ed25519')
    expect(await store.list()).toHaveLength(2)
    expect((await store.get('10.0.0.1', 2222))?.fingerprint).toBe('SHA256:bbb')
  })

  it('重复 trust 覆盖指纹并保留首次信任时间', async () => {
    await store.trust('h', 22, 'SHA256:old', 'ssh-ed25519', 1000)
    const updated = await store.trust('h', 22, 'SHA256:new', 'ssh-rsa', 2000)
    expect(updated.fingerprint).toBe('SHA256:new')
    expect(updated.keyType).toBe('ssh-rsa')
    expect(updated.addedAt).toBe(1000)
    expect(await store.list()).toHaveLength(1)
  })

  it('touch 只更新最近确认时间', async () => {
    await store.trust('h', 22, 'SHA256:a', 'ssh-ed25519', 1000)
    await store.touch('h', 22, 5000)
    const rec = await store.get('h', 22)
    expect(rec?.lastSeenAt).toBe(5000)
    expect(rec?.fingerprint).toBe('SHA256:a')
  })

  it('forget 删除记录；不存在时返回 false', async () => {
    await store.trust('h', 22, 'SHA256:a', 'ssh-ed25519')
    expect(await store.forget('h', 22)).toBe(true)
    expect(await store.get('h', 22)).toBeNull()
    expect(await store.forget('h', 22)).toBe(false)
  })

  it('importRecords 区分新增与覆盖', async () => {
    const first = await store.importRecords([
      { host: 'a', port: 22, fingerprint: 'SHA256:a', keyType: 'ssh-ed25519' }
    ])
    expect(first).toEqual({ imported: 1, updated: 0, skipped: 0 })

    const second = await store.importRecords([
      { host: 'a', port: 22, fingerprint: 'SHA256:a2', keyType: 'ssh-rsa' },
      { host: 'b', port: 22, fingerprint: 'SHA256:b', keyType: 'ssh-ed25519' }
    ])
    expect(second).toEqual({ imported: 1, updated: 1, skipped: 0 })
    expect((await store.get('a', 22))?.fingerprint).toBe('SHA256:a2')
  })

  it('list 按 host 升序、端口升序排列', async () => {
    await store.trust('b', 22, 'SHA256:1', 'ssh-ed25519')
    await store.trust('a', 2222, 'SHA256:2', 'ssh-ed25519')
    await store.trust('a', 22, 'SHA256:3', 'ssh-ed25519')
    const list = await store.list()
    expect(list.map((r) => `${r.host}:${r.port}`)).toEqual(['a:22', 'a:2222', 'b:22'])
  })

  it('并发信任不同主机不会丢记录', async () => {
    await Promise.all([
      store.trust('a', 22, 'SHA256:a', 'ssh-ed25519'),
      store.trust('b', 22, 'SHA256:b', 'ssh-ed25519'),
      store.trust('c', 22, 'SHA256:c', 'ssh-ed25519')
    ])
    const list = await store.list()
    expect(list.map((r) => r.host)).toEqual(['a', 'b', 'c'])
  })

  it('文件损坏时降级为空库，不抛错', async () => {
    await fs.writeFile(file, '{ not json', 'utf8')
    const broken = new HostKeyStore(file)
    expect(await broken.list()).toEqual([])
    expect(await broken.get('h', 22)).toBeNull()
  })
})
