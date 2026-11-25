/**
 * 终端配色：由设计令牌派生的 xterm 主题。
 *
 * 需求文档允许 ANSI 16 色调色板保留字面量（终端配色表豁免），
 * 但前景/背景/光标等界面相关取值一律取自令牌。
 */

import type { ITheme } from '@xterm/xterm'
import { ThemeTokens } from './tokens'

export interface AnsiPalette {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/** 暗色终端 ANSI 调色板 */
export const DARK_ANSI: AnsiPalette = {
  black: '#111827',
  red: '#fb7185',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e5e7eb',
  brightBlack: '#6b7280',
  brightRed: '#fda4af',
  brightGreen: '#6ee7b7',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff'
}

/** 亮色终端 ANSI 调色板（深色字，适配浅色终端底） */
export const LIGHT_ANSI: AnsiPalette = {
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#4d2d00',
  blue: '#0550ae',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f'
}

export function ansiPalette(mode: 'light' | 'dark'): AnsiPalette {
  return mode === 'dark' ? DARK_ANSI : LIGHT_ANSI
}

/** 构造 xterm 主题：前景/背景/光标来自令牌，ANSI 色来自对应模式的调色板。 */
export function buildXtermTheme(tokens: ThemeTokens): ITheme {
  const ansi = ansiPalette(tokens.mode)
  return {
    background: tokens.surface.card,
    foreground: tokens.surface.text,
    cursor: tokens.accent.accent,
    cursorAccent: tokens.surface.card,
    selectionBackground: tokens.accent.accentSoft,
    ...ansi
  }
}

/** 搜索命中装饰：全部取自强调色系令牌。 */
export interface SearchDecorations {
  matchBackground: string
  matchBorder: string
  matchOverviewRuler: string
  activeMatchBackground: string
  activeMatchBorder: string
  activeMatchColorOverviewRuler: string
}

export function buildSearchDecorations(tokens: ThemeTokens): SearchDecorations {
  return {
    matchBackground: tokens.accent.accentMedium,
    matchBorder: tokens.accent.accent,
    matchOverviewRuler: tokens.accent.accent,
    activeMatchBackground: tokens.accent.accent,
    activeMatchBorder: tokens.accent.accentHover,
    activeMatchColorOverviewRuler: tokens.accent.accentHover
  }
}
