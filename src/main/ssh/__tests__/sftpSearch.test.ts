import { describe, expect, it } from 'vitest'
import { SftpEntry } from '@shared/types'
import {
  matchFileName,
  searchEntriesByName,
  isSymlinkMode
} from '../sftpSearch'

function dir(name: string, path: string): SftpEntry {
  return { name, path, isDirectory: true, size: 0, mode: 0o040755, mtime: 0 }
}

function file(name: string, path: string): SftpEntry {
  return { name, path, isDirectory: false, size: 10, mode: 0o100644, mtime: 0 }
}

/** 构造一棵目录树：tree[path] = 该目录下的条目 */
function makeTree(tree: Record<string, SftpEntry[]>): (path: string) => Promise<SftpEntry[]> {
  return async (path: string) => {
    const entries = tree[path]
    if (!entries) throw new Error(`no such directory: ${path}`)
    return entries
  }
}

describe('matchFileName', () => {
  it('忽略大小写做子串匹配', () => {
    expect(matchFileName('Readme.md', 'readme')).toBe(true)
    expect(matchFileName('README.MD', 'readme')).toBe(true)
    expect(matchFileName('协议文档.docx', '协议')).toBe(true)
  })

  it('关键字为空时不算命中', () => {
    expect(matchFileName('readme.md', '')).toBe(false)
    expect(matchFileName('readme.md', '   ')).toBe(false)
  })

  it('不匹配时返回 false', () => {
    expect(matchFileName('readme.md', 'zzz')).toBe(false)
  })
})

describe('isSymlinkMode', () => {
  it('识别软链接位', () => {
    expect(isSymlinkMode(0o120777)).toBe(true)
    expect(isSymlinkMode(0o100644)).toBe(false)
    expect(isSymlinkMode(0o040755)).toBe(false)
  })
})

describe('searchEntriesByName', () => {
  it('递归收集命中条目并给出完整路径', async () => {
    const tree = makeTree({
      '/': [dir('apps', '/apps'), file('a.txt', '/a.txt')],
      '/apps': [dir('doc', '/apps/doc')],
      '/apps/doc': [file('协议.docx', '/apps/doc/协议.docx')]
    })
    const result = await searchEntriesByName(tree, '/', '协议')
    expect(result.entries.map((e) => e.path)).toEqual(['/apps/doc/协议.docx'])
    expect(result.truncated).toBe(false)
    expect(result.stopped).toBe(false)
  })

  it('同时命中文件与目录', async () => {
    const tree = makeTree({
      '/': [dir('data', '/data'), file('data.log', '/data.log')]
    })
    const result = await searchEntriesByName(tree, '/', 'data')
    expect(result.entries.map((e) => e.name).sort()).toEqual(['data', 'data.log'])
  })

  it('超过最大深度不再展开', async () => {
    const tree = makeTree({
      '/': [dir('l1', '/l1')],
      '/l1': [dir('l2', '/l1/l2')],
      '/l1/l2': [file('deep.txt', '/l1/l2/deep.txt')]
    })
    const result = await searchEntriesByName(tree, '/', 'deep', { maxDepth: 2 })
    expect(result.entries).toHaveLength(0)

    const deeper = await searchEntriesByName(tree, '/', 'deep', { maxDepth: 3 })
    expect(deeper.entries.map((e) => e.path)).toEqual(['/l1/l2/deep.txt'])
  })

  it('结果数达到上限时截断并标记', async () => {
    const tree = makeTree({
      '/': [
        file('hit1.txt', '/hit1.txt'),
        file('hit2.txt', '/hit2.txt'),
        file('hit3.txt', '/hit3.txt')
      ]
    })
    const result = await searchEntriesByName(tree, '/', 'hit', { maxResults: 2 })
    expect(result.entries).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('shouldStop 返回 true 时中止', async () => {
    const tree = makeTree({
      '/': [dir('a', '/a')],
      '/a': [file('hit.txt', '/a/hit.txt')]
    })
    let calls = 0
    const result = await searchEntriesByName(tree, '/', 'hit', {
      shouldStop: () => {
        calls += 1
        return calls > 1
      }
    })
    expect(result.stopped).toBe(true)
    expect(result.entries).toHaveLength(0)
  })

  it('子目录不可读时跳过，结果仍可用', async () => {
    const tree = makeTree({
      '/': [dir('locked', '/locked'), file('ok.txt', '/ok.txt')]
      // '/locked' 不在目录表里，读取时抛错
    })
    const result = await searchEntriesByName(tree, '/', '.txt')
    expect(result.entries.map((e) => e.path)).toEqual(['/ok.txt'])
  })

  it('根目录不可读时抛错', async () => {
    const tree = makeTree({})
    await expect(searchEntriesByName(tree, '/missing', 'x')).rejects.toThrow()
  })

  it('不跟随软链接目录', async () => {
    const link: SftpEntry = {
      name: 'loop',
      path: '/loop',
      isDirectory: true,
      size: 0,
      mode: 0o120777,
      mtime: 0
    }
    const tree = makeTree({
      '/': [link, file('hit.txt', '/hit.txt')]
    })
    const result = await searchEntriesByName(tree, '/', 'hit')
    expect(result.entries.map((e) => e.path)).toEqual(['/hit.txt'])
    expect(result.scannedDirs).toBe(1)
  })

  it('按目录分批回调命中项', async () => {
    const tree = makeTree({
      '/': [dir('x', '/x'), dir('y', '/y')],
      '/x': [file('hit-a', '/x/hit-a')],
      '/y': [file('hit-b', '/y/hit-b')]
    })
    const batches: string[][] = []
    await searchEntriesByName(tree, '/', 'hit', {}, (entries) =>
      batches.push(entries.map((e) => e.path))
    )
    expect(batches).toEqual([['/x/hit-a'], ['/y/hit-b']])
  })

  it('关键字为空时没有结果', async () => {
    const tree = makeTree({ '/': [file('a.txt', '/a.txt')] })
    const result = await searchEntriesByName(tree, '/', '')
    expect(result.entries).toHaveLength(0)
  })
})
