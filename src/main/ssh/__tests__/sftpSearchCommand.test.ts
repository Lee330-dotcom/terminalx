import { describe, expect, it } from 'vitest'
import {
  buildFindCommand,
  escapeGlob,
  isValidSearchKeyword,
  shellQuote
} from '../searchCommand'
import { FindOutputParser } from '../findOutput'

describe('isValidSearchKeyword', () => {
  it('接受普通名字与中文', () => {
    expect(isValidSearchKeyword('docx')).toBe(true)
    expect(isValidSearchKeyword('协议 文档')).toBe(true)
    expect(isValidSearchKeyword('a-b_c.2024')).toBe(true)
  })

  it('拒绝空串与超长关键字', () => {
    expect(isValidSearchKeyword('')).toBe(false)
    expect(isValidSearchKeyword('x'.repeat(65))).toBe(false)
    expect(isValidSearchKeyword('x'.repeat(64))).toBe(true)
  })

  it('拒绝 shell 元字符与控制字符', () => {
    for (const bad of ["a'b", 'a"b', 'a`b', 'a$b', 'a;b', 'a&b', 'a|b', 'a>b', 'a<b', 'a(b', 'a{b', 'a\\b', 'a\nb']) {
      expect(isValidSearchKeyword(bad)).toBe(false)
    }
  })
})

describe('shellQuote', () => {
  it('用单引号包裹并转义内部单引号', () => {
    expect(shellQuote('/data/app')).toBe("'/data/app'")
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })
})

describe('escapeGlob', () => {
  it('转义 glob 元字符', () => {
    expect(escapeGlob('a*b')).toBe('a\\*b')
    expect(escapeGlob('a?b')).toBe('a\\?b')
    expect(escapeGlob('a[b')).toBe('a\\[b')
    expect(escapeGlob('普通')).toBe('普通')
  })
})

describe('buildFindCommand', () => {
  it('把根目录与关键字放进引号，并限制深度与条数', () => {
    const cmd = buildFindCommand('/data/app', 'docx')
    expect(cmd).toContain("find '/data/app'")
    expect(cmd).toContain("-iname '*docx*'")
    expect(cmd).toContain('-maxdepth 12')
    expect(cmd).toContain('head -n 500')
  })

  it('关键字里的 glob 元字符被转义', () => {
    const cmd = buildFindCommand('/data', 'a*b')
    expect(cmd).toContain("-iname '*a\\*b*'")
  })
})

describe('FindOutputParser', () => {
  it('解析 -printf 格式：类型\\t路径', () => {
    const parser = new FindOutputParser()
    const entries = parser.push('f\t/data/a.docx\nd\t/data/sub\n')
    expect(entries).toHaveLength(2)
    expect(entries[0].name).toBe('a.docx')
    expect(entries[0].path).toBe('/data/a.docx')
    expect(entries[0].isDirectory).toBe(false)
    expect(entries[1].isDirectory).toBe(true)
  })

  it('解析 -print 格式：纯路径', () => {
    const parser = new FindOutputParser()
    const entries = parser.push('/data/a.docx\n/data/sub/b.txt\n')
    expect(entries).toHaveLength(2)
    expect(entries[0].path).toBe('/data/a.docx')
    expect(entries[1].name).toBe('b.txt')
  })

  it('按行切分：半行留到下一次', () => {
    const parser = new FindOutputParser()
    expect(parser.push('f\t/data/a')).toHaveLength(0)
    expect(parser.push('.docx\n')).toHaveLength(1)
  })

  it('收尾时解析最后一行', () => {
    const parser = new FindOutputParser()
    parser.push('f\t/data/a.docx')
    const tail = parser.flush()
    expect(tail).toHaveLength(1)
    expect(tail[0].name).toBe('a.docx')
  })

  it('忽略空行', () => {
    const parser = new FindOutputParser()
    expect(parser.push('\n\n')).toHaveLength(0)
  })
})
