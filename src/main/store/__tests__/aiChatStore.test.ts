import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AiChatStore } from '../aiChatStore'
import { AiChatConversation } from '@shared/types'

let dir: string
let file: string
let store: AiChatStore

function conversation(id: string, updatedAt: number): AiChatConversation {
  return {
    id,
    title: `对话 ${id}`,
    createdAt: updatedAt,
    updatedAt,
    messages: [
      { id: `${id}-m1`, role: 'user', text: '检查服务状态' },
      { id: `${id}-m2`, role: 'assistant', text: '服务正常' }
    ]
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-aichats-'))
  file = join(dir, 'ai-chats.json')
  store = new AiChatStore(file)
})

describe('AiChatStore', () => {
  it('初始为空列表', async () => {
    expect(await store.list()).toEqual([])
  })

  it('保存对话并读回', async () => {
    await store.saveConversation(conversation('a', 1000))
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0].messages).toHaveLength(2)
    expect(list[0].messages[0].text).toBe('检查服务状态')
  })

  it('同一 id 重复保存为覆盖更新', async () => {
    await store.saveConversation(conversation('a', 1000))
    const updated = conversation('a', 2000)
    updated.messages.push({ id: 'a-m3', role: 'assistant', text: '补充结论' })
    await store.saveConversation(updated)
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0].messages).toHaveLength(3)
    expect(list[0].updatedAt).toBe(2000)
  })

  it('列表按更新时间倒序', async () => {
    await store.saveConversation(conversation('old', 1000))
    await store.saveConversation(conversation('new', 2000))
    const list = await store.list()
    expect(list.map((c) => c.id)).toEqual(['new', 'old'])
  })

  it('超过上限时丢弃最旧对话', async () => {
    for (let i = 0; i < 55; i++) {
      await store.saveConversation(conversation(`c${i}`, 1000 + i))
    }
    const list = await store.list()
    expect(list).toHaveLength(50)
    expect(list.some((c) => c.id === 'c0')).toBe(false)
    expect(list.some((c) => c.id === 'c54')).toBe(true)
  })

  it('删除与清空', async () => {
    await store.saveConversation(conversation('a', 1000))
    await store.saveConversation(conversation('b', 2000))
    expect(await store.remove('a')).toBe(true)
    expect(await store.remove('a')).toBe(false)
    expect(await store.list()).toHaveLength(1)
    await store.clear()
    expect(await store.list()).toEqual([])
  })

  it('文件损坏时降级为空列表', async () => {
    await fs.writeFile(file, 'not json at all', 'utf8')
    expect(await store.list()).toEqual([])
    await store.saveConversation(conversation('a', 1000))
    expect(await store.list()).toHaveLength(1)
  })

  it('并发写入不互相覆盖', async () => {
    await Promise.all([
      store.saveConversation(conversation('a', 1000)),
      store.saveConversation(conversation('b', 2000)),
      store.saveConversation(conversation('c', 3000))
    ])
    expect(await store.list()).toHaveLength(3)
  })

  it('重启后对话仍在（落盘持久化）', async () => {
    await store.saveConversation(conversation('a', 1000))
    const reopened = new AiChatStore(file)
    const list = await reopened.list()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('对话 a')
  })
})
