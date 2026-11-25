import { describe, it, expect } from 'vitest'
import {
  ansiPalette,
  buildSearchDecorations,
  buildXtermTheme,
  DARK_ANSI,
  LIGHT_ANSI
} from '../xtermTheme'
import { buildTokens } from '../tokens'
import { contrastRatio } from '@shared/color'

const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const

describe('ANSI 调色板', () => {
  it('暗色与亮色两套调色板各含 16 色', () => {
    for (const palette of [DARK_ANSI, LIGHT_ANSI]) {
      expect(Object.keys(palette)).toHaveLength(16)
      for (const key of ANSI_KEYS) {
        expect(palette[key]).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('按模式返回对应调色板', () => {
    expect(ansiPalette('dark')).toBe(DARK_ANSI)
    expect(ansiPalette('light')).toBe(LIGHT_ANSI)
  })
})

describe('buildXtermTheme', () => {
  it('前景背景光标来自设计令牌', () => {
    const tokens = buildTokens('dark', { accent: '#10b981', bg: '#0d0d0d', nav: '#151515' })
    const theme = buildXtermTheme(tokens)
    expect(theme.background).toBe(tokens.surface.card)
    expect(theme.foreground).toBe(tokens.surface.text)
    expect(theme.cursor).toBe(tokens.accent.accent)
    expect(theme.cursorAccent).toBe(tokens.surface.card)
  })

  it('亮色模式使用亮色调色板且前景背景对比度达标', () => {
    const tokens = buildTokens('light', { accent: '#10b981', bg: '#f4f5f6', nav: '#ffffff' })
    const theme = buildXtermTheme(tokens)
    expect(theme.black).toBe(LIGHT_ANSI.black)
    expect(contrastRatio(theme.foreground!, theme.background!)).toBeGreaterThanOrEqual(4.5)
  })

  it('暗色模式使用暗色调色板', () => {
    const tokens = buildTokens('dark', { accent: '#10b981', bg: '#0d0d0d', nav: '#151515' })
    const theme = buildXtermTheme(tokens)
    expect(theme.black).toBe(DARK_ANSI.black)
    expect(contrastRatio(theme.foreground!, theme.background!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('buildSearchDecorations', () => {
  it('装饰色全部取自强调色系令牌', () => {
    const tokens = buildTokens('dark', { accent: '#10b981', bg: '#0d0d0d', nav: '#151515' })
    const deco = buildSearchDecorations(tokens)
    expect(deco.matchBackground).toBe(tokens.accent.accentMedium)
    expect(deco.matchBorder).toBe(tokens.accent.accent)
    expect(deco.activeMatchBackground).toBe(tokens.accent.accent)
  })
})
