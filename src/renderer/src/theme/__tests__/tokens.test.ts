import { describe, it, expect } from 'vitest'
import {
  buildTokens,
  deriveAccent,
  deriveSemantic,
  deriveSurface,
  MODE_DEFAULT_SURFACE,
  resolveMode,
  scaleCssVars,
  terminalContrastOk,
  tokensToCssVars
} from '../tokens'
import { contrastRatio, isDarkColor } from '@shared/color'

describe('deriveSurface', () => {
  it('深色底色派生出层级递增的表面色', () => {
    const s = deriveSurface('#0d0d0d', '#151515')
    expect(s.bg).toBe('#0d0d0d')
    expect(s.nav).toBe('#151515')
    // 面板/卡片/填充由底色向白色混合得到
    expect(isDarkColor(s.panel)).toBe(true)
    expect(isDarkColor(s.card)).toBe(true)
    expect(contrastRatio(s.card, s.bg)).toBeGreaterThan(0)
  })

  it('浅色底色派生出层级递增的表面色', () => {
    const s = deriveSurface('#f4f5f6', '#ffffff')
    expect(isDarkColor(s.bg)).toBe(false)
    expect(isDarkColor(s.panel)).toBe(false)
    expect(isDarkColor(s.text)).toBe(true)
  })

  it('一级文字对底色满足 WCAG AA 4.5:1', () => {
    const dark = deriveSurface('#0d0d0d', '#151515')
    expect(contrastRatio(dark.text, dark.bg)).toBeGreaterThanOrEqual(4.5)

    const light = deriveSurface('#f4f5f6', '#ffffff')
    expect(contrastRatio(light.text, light.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('极端底色（纯黑 / 纯白）仍保证文字对比度', () => {
    const black = deriveSurface('#000000', '#000000')
    expect(contrastRatio(black.text, black.bg)).toBeGreaterThanOrEqual(4.5)

    const white = deriveSurface('#ffffff', '#ffffff')
    expect(contrastRatio(white.text, white.bg)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('deriveAccent', () => {
  it('强调色主色阶单调变浅', () => {
    const a = deriveAccent('#10b981', 'dark')
    const lums = [
      contrastRatio(a.primaryLight3, '#000000'),
      contrastRatio(a.primaryLight5, '#000000'),
      contrastRatio(a.primaryLight7, '#000000'),
      contrastRatio(a.primaryLight9, '#000000')
    ]
    for (let i = 1; i < lums.length; i++) {
      expect(lums[i]).toBeGreaterThan(lums[i - 1])
    }
  })

  it('强调色上的前景色与强调色形成可读对比', () => {
    for (const accent of ['#10b981', '#f59e0b', '#3b82f6', '#ffffff', '#000000']) {
      const a = deriveAccent(accent, 'dark')
      expect(contrastRatio(a.onAccent, a.accent)).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('deriveSemantic', () => {
  it('两种模式都提供语义色与柔和变体', () => {
    for (const mode of ['light', 'dark'] as const) {
      const sem = deriveSemantic(mode)
      expect(sem.success).toMatch(/^#[0-9a-f]{6}$/i)
      expect(sem.successSoft).toMatch(/^rgba\(/)
      expect(sem.dangerSoft).toMatch(/^rgba\(/)
      expect(sem.infoSoft).toMatch(/^rgba\(/)
    }
  })
})

describe('resolveMode', () => {
  it('三态模式解析为实际明暗', () => {
    expect(resolveMode('light', true)).toBe('light')
    expect(resolveMode('dark', false)).toBe('dark')
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('system', false)).toBe('light')
  })

  it('默认表面色与模式深浅一致', () => {
    expect(isDarkColor(MODE_DEFAULT_SURFACE.dark.bg)).toBe(true)
    expect(isDarkColor(MODE_DEFAULT_SURFACE.light.bg)).toBe(false)
  })
})

describe('tokensToCssVars', () => {
  it('同时写出系统令牌与组件库令牌', () => {
    const tokens = buildTokens('dark', { accent: '#10b981', bg: '#0d0d0d', nav: '#151515' })
    const vars = tokensToCssVars(tokens)
    expect(vars['--tx-bg']).toBe('#0d0d0d')
    expect(vars['--el-color-primary']).toBe('#10b981')
    expect(vars['--el-bg-color-page']).toBe('#0d0d0d')
    expect(vars['--el-text-color-primary']).toBe(tokens.surface.text)
  })

  it('浅色模式不会退回组件库默认配色', () => {
    const tokens = buildTokens('light', { accent: '#10b981', bg: '#f4f5f6', nav: '#ffffff' })
    const vars = tokensToCssVars(tokens)
    expect(vars['--el-color-primary']).toBe('#10b981')
    expect(vars['--el-bg-color-page']).toBe('#f4f5f6')
    expect(vars['--el-mask-color']).toMatch(/^rgba\(/)
  })

  it('尺度令牌只输出一次且不含颜色', () => {
    const vars = scaleCssVars()
    expect(vars['--tx-radius-md']).toBe('8px')
    expect(vars['--tx-space-4']).toBe('16px')
    expect(vars['--tx-font-md']).toBe('13px')
    expect(Object.values(vars).every((v) => !v.includes('#'))).toBe(true)
  })
})

describe('terminalContrastOk', () => {
  it('两种模式的终端前景背景对比度均达标', () => {
    for (const mode of ['light', 'dark'] as const) {
      const tokens = buildTokens(mode, {
        accent: '#10b981',
        bg: mode === 'dark' ? '#0d0d0d' : '#f4f5f6',
        nav: mode === 'dark' ? '#151515' : '#ffffff'
      })
      expect(terminalContrastOk(tokens.surface.text, tokens.surface.card)).toBe(true)
    }
  })
})
