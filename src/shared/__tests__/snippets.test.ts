import { describe, expect, it } from 'vitest'
import { applySnippetPlaceholders, parseSnippetPlaceholders } from '../snippets'

describe('parseSnippetPlaceholders', () => {
  it('提取占位符并按首次出现顺序排列', () => {
    expect(parseSnippetPlaceholders('tail -f {logfile} | grep {keyword}')).toEqual([
      'logfile',
      'keyword'
    ])
  })

  it('同名占位符只出现一次', () => {
    expect(parseSnippetPlaceholders('diff {file} {file}')).toEqual(['file'])
  })

  it('无占位符时返回空数组', () => {
    expect(parseSnippetPlaceholders('ls -la')).toEqual([])
  })

  it('非法占位符按普通文本忽略', () => {
    expect(parseSnippetPlaceholders('echo {带空格} {} {a b}')).toEqual([])
  })

  it('支持下划线与连字符命名', () => {
    expect(parseSnippetPlaceholders('run {log_file} {log-dir}')).toEqual(['log_file', 'log-dir'])
  })
})

describe('applySnippetPlaceholders', () => {
  it('替换所有出现位置', () => {
    expect(applySnippetPlaceholders('diff {file} {file}', { file: '/tmp/a.log' })).toBe(
      'diff /tmp/a.log /tmp/a.log'
    )
  })

  it('缺失的参数替换为空串', () => {
    expect(applySnippetPlaceholders('tail -f {logfile}', {})).toBe('tail -f ')
  })

  it('保留非法占位符文本', () => {
    expect(applySnippetPlaceholders('echo {带空格}', {})).toBe('echo {带空格}')
  })

  it('参数值原样插入，不做转义', () => {
    expect(applySnippetPlaceholders('grep {word} file', { word: 'a b' })).toBe('grep a b file')
  })
})
