import { describe, expect, it } from 'vitest'
import { joinRemotePath, normalizeRemotePath } from '../sftpService'

describe('normalizeRemotePath 远程路径归一化与防穿越', () => {
  it('接受普通绝对路径', () => {
    expect(normalizeRemotePath('/home/user')).toBe('/home/user')
    expect(normalizeRemotePath('/')).toBe('/')
    expect(normalizeRemotePath('/var/log/app.log')).toBe('/var/log/app.log')
  })

  it('折叠多余斜杠与 . 片段', () => {
    expect(normalizeRemotePath('/home//user')).toBe('/home/user')
    expect(normalizeRemotePath('/home/user/')).toBe('/home/user')
    expect(normalizeRemotePath('/home/user/.')).toBe('/home/user')
    expect(normalizeRemotePath('/home/./user/./app')).toBe('/home/user/app')
  })

  it('拒绝包含 .. 的路径（目录穿越）', () => {
    expect(() => normalizeRemotePath('/home/../etc')).toThrow(/\.\./)
    expect(() => normalizeRemotePath('/..')).toThrow(/\.\./)
    expect(() => normalizeRemotePath('/home/..')).toThrow(/\.\./)
    expect(() => normalizeRemotePath('/home/../../etc/passwd')).toThrow(/\.\./)
  })

  it('拒绝相对路径与空路径', () => {
    expect(() => normalizeRemotePath('')).toThrow(/绝对路径/)
    expect(() => normalizeRemotePath('home/user')).toThrow(/绝对路径/)
    expect(() => normalizeRemotePath('../etc')).toThrow(/绝对路径/)
    expect(() => normalizeRemotePath('..')).toThrow(/绝对路径/)
  })

  it('拒绝非字符串输入', () => {
    expect(() => normalizeRemotePath(null as unknown as string)).toThrow(/绝对路径/)
    expect(() => normalizeRemotePath(undefined as unknown as string)).toThrow(/绝对路径/)
  })
})

describe('joinRemotePath', () => {
  it('拼接目录与文件名', () => {
    expect(joinRemotePath('/home/user', 'app.log')).toBe('/home/user/app.log')
    expect(joinRemotePath('/', 'etc')).toBe('/etc')
  })

  it('拼接时同样拒绝穿越片段', () => {
    expect(() => joinRemotePath('/home/user', '../secret')).toThrow(/\.\./)
    expect(() => joinRemotePath('/home/user', '..')).toThrow(/\.\./)
  })
})
