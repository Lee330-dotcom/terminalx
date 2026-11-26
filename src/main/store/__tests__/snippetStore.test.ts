import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SnippetStore } from '../snippetStore'

let dir: string
let file: string
let store: SnippetStore

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-snippets-'))
  file = join(dir, 'snippets.json')
  store = new SnippetStore(file)
})

describe('SnippetStore', () => {
  it('初始为空库', async () => {
    const library = await store.list()
    expect(library.snippets).toEqual([])
    expect(library.groups).toEqual([])
  })

  it('新建快捷命令并读回', async () => {
    const snippet = await store.upsert({
      name: '重启服务',
      command: 'systemctl restart {service}',
      description: '重启指定服务',
      autoEnter: true
    })
    expect(snippet.id).toBeTruthy()
    expect(snippet.groupId).toBeNull()
    expect(snippet.autoEnter).toBe(true)
    const library = await store.list()
    expect(library.snippets).toHaveLength(1)
    expect(library.snippets[0].command).toBe('systemctl restart {service}')
  })

  it('名称或命令为空时拒绝保存', async () => {
    await expect(store.upsert({ name: '  ', command: 'ls' })).rejects.toThrow(/名称/)
    await expect(store.upsert({ name: 'x', command: '  ' })).rejects.toThrow(/内容/)
    expect((await store.list()).snippets).toHaveLength(0)
  })

  it('更新保留 id 与创建时间', async () => {
    const created = await store.upsert({ name: 'A', command: 'ls' }, 1000)
    const updated = await store.upsert(
      { id: created.id, name: 'B', command: 'pwd', description: 'd', autoEnter: true },
      2000
    )
    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toBe(1000)
    expect(updated.updatedAt).toBe(2000)
    expect(updated.name).toBe('B')
    expect(updated.autoEnter).toBe(true)
    const library = await store.list()
    expect(library.snippets).toHaveLength(1)
  })

  it('删除快捷命令', async () => {
    const created = await store.upsert({ name: 'A', command: 'ls' })
    expect(await store.remove(created.id)).toBe(true)
    expect((await store.list()).snippets).toHaveLength(0)
  })

  it('分组：新建、改名、删除', async () => {
    const group = await store.createGroup('服务运维')
    const renamed = await store.renameGroup(group.id, '运维')
    expect(renamed.name).toBe('运维')
    expect((await store.list()).groups[0].name).toBe('运维')
    expect(await store.removeGroup(group.id)).toBe(true)
    expect((await store.list()).groups).toHaveLength(0)
  })

  it('删除分组时组内快捷命令回落为未分组，不被删除', async () => {
    const group = await store.createGroup('服务运维')
    const snippet = await store.upsert({ name: 'A', command: 'ls', groupId: group.id })
    await store.removeGroup(group.id)
    const library = await store.list()
    expect(library.groups).toHaveLength(0)
    expect(library.snippets).toHaveLength(1)
    expect(library.snippets[0].groupId).toBeNull()
    expect(library.snippets[0].id).toBe(snippet.id)
  })

  it('引用不存在的分组时拒绝保存', async () => {
    await expect(store.upsert({ name: 'A', command: 'ls', groupId: 'nope' })).rejects.toThrow(
      /分组不存在/
    )
  })

  it('并发保存不会互相覆盖', async () => {
    await Promise.all([
      store.upsert({ name: 'A', command: 'ls' }),
      store.upsert({ name: 'B', command: 'pwd' }),
      store.upsert({ name: 'C', command: 'df -h' })
    ])
    const library = await store.list()
    expect(library.snippets).toHaveLength(3)
  })

  it('文件损坏时降级为空库', async () => {
    await fs.writeFile(file, '{ not json', 'utf8')
    const library = await store.list()
    expect(library.snippets).toEqual([])
    // 降级后仍可正常写入
    await store.upsert({ name: 'A', command: 'ls' })
    expect((await store.list()).snippets).toHaveLength(1)
  })

  it('重启后数据仍在（重新建 store 读同一文件）', async () => {
    await store.upsert({ name: 'A', command: 'ls', description: 'd' })
    const reopened = new SnippetStore(file)
    const library = await reopened.list()
    expect(library.snippets).toHaveLength(1)
    expect(library.snippets[0].description).toBe('d')
  })
})
