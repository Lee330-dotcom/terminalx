/**
 * 设计令牌：颜色、圆角、间距、字号、阴影、动效的唯一真相源。
 *
 * 组件只允许引用令牌变量（`var(--tx-*)`），不得内联颜色字面量；
 * 终端 ANSI 调色板是唯一豁免项，见 `xtermTheme.ts`。
 */

import { ThemeMode } from '@shared/types'
import {
  BLACK,
  WHITE,
  contrastRatio,
  ensureContrast,
  isDarkColor,
  mix,
  relativeLuminance,
  withAlpha
} from '@shared/color'

/** 实际生效的外观（跟随系统已解析为 light / dark） */
export type ResolvedMode = 'light' | 'dark'

// ---------------------------------------------------------------- 尺度令牌

export const RADIUS_TOKENS = {
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '999px'
} as const

export const SPACE_TOKENS = {
  '1': '4px',
  '2': '8px',
  '3': '12px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '7': '32px',
  '8': '40px'
} as const

export const FONT_SIZE_TOKENS = {
  xs: '11px',
  sm: '12px',
  md: '13px',
  lg: '14px',
  xl: '16px',
  '2xl': '20px'
} as const

/** 阴影统一引用 `--tx-shadow-color`，随明暗切换。 */
export const SHADOW_TOKENS = {
  sm: '0 1px 2px var(--tx-shadow-color)',
  md: '0 4px 12px var(--tx-shadow-color)',
  lg: '0 12px 32px var(--tx-shadow-color)'
} as const

export const DURATION_TOKENS = {
  fast: '120ms',
  base: '180ms',
  slow: '260ms'
} as const

export const EASING_TOKENS = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)'
} as const

// ---------------------------------------------------------------- 颜色令牌

export interface SurfaceTokens {
  /** 页面底色 */
  bg: string
  /** 面板底色 */
  panel: string
  /** 卡片底色 */
  card: string
  /** 输入框/填充底色 */
  fill: string
  /** 悬停底色 */
  hover: string
  /** 分隔线 */
  border: string
  /** 强边框 */
  borderStrong: string
  /** 顶部导航底色 */
  nav: string
  /** 一级文字 */
  text: string
  /** 二级文字 */
  text2: string
  /** 三级文字 */
  text3: string
  /** 浮层/弹层底色 */
  overlay: string
  /** 阴影颜色 */
  shadowColor: string
}

export interface AccentTokens {
  accent: string
  accentHover: string
  /** 强调色上的前景色（按钮文字），按强调色亮度自动取深/浅 */
  onAccent: string
  /** 强调色低透明底 */
  accentSoft: string
  /** 强调色中透明底（搜索命中、选中行等） */
  accentMedium: string
  primaryLight3: string
  primaryLight5: string
  primaryLight7: string
  primaryLight8: string
  primaryLight9: string
  primaryDark2: string
}

export interface SemanticTokens {
  success: string
  warning: string
  danger: string
  info: string
  successSoft: string
  warningSoft: string
  dangerSoft: string
  infoSoft: string
}

export interface ThemeTokens {
  mode: ResolvedMode
  surface: SurfaceTokens
  accent: AccentTokens
  semantic: SemanticTokens
}

const SEMANTIC_BASE: Omit<SemanticTokens, 'successSoft' | 'warningSoft' | 'dangerSoft' | 'infoSoft'> = {
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6'
}

/**
 * 由背景色派生整套中性槽位。
 * 深色系向白色混合出层级，浅色系向黑色混合出层级；文字色带对比度兜底。
 */
export function deriveSurface(baseBg: string, navColor: string): SurfaceTokens {
  const dark = isDarkColor(baseBg)
  const surface = dark
    ? {
        panel: mix(baseBg, WHITE, 0.05),
        card: mix(baseBg, WHITE, 0.08),
        fill: mix(baseBg, WHITE, 0.04),
        hover: mix(baseBg, WHITE, 0.11),
        border: mix(baseBg, WHITE, 0.13),
        borderStrong: mix(baseBg, WHITE, 0.24),
        text: mix(baseBg, WHITE, 0.92),
        text2: mix(baseBg, WHITE, 0.62),
        text3: mix(baseBg, WHITE, 0.42),
        overlay: mix(baseBg, WHITE, 0.07),
        shadowColor: 'rgba(0, 0, 0, 0.45)'
      }
    : {
        panel: mix(baseBg, WHITE, 0.75),
        card: mix(baseBg, WHITE, 0.95),
        fill: mix(baseBg, BLACK, 0.04),
        hover: mix(baseBg, BLACK, 0.06),
        border: mix(baseBg, BLACK, 0.12),
        borderStrong: mix(baseBg, BLACK, 0.22),
        text: mix(baseBg, BLACK, 0.88),
        text2: mix(baseBg, BLACK, 0.58),
        text3: mix(baseBg, BLACK, 0.38),
        overlay: mix(baseBg, WHITE, 0.9),
        shadowColor: 'rgba(15, 23, 42, 0.14)'
      }
  return {
    bg: baseBg,
    nav: navColor,
    ...surface,
    // 一级文字满足 WCAG AA 正文对比度，二级文字至少达到大字/次要文本档
    text: ensureContrast(surface.text, baseBg, 4.5),
    text2: ensureContrast(surface.text2, baseBg, 3),
    text3: surface.text3
  }
}

/** 派生强调色及其主色阶。 */
export function deriveAccent(accent: string, mode: ResolvedMode): AccentTokens {
  const hover = mode === 'dark' ? mix(accent, WHITE, 0.25) : mix(accent, BLACK, 0.25)
  return {
    accent,
    accentHover: hover,
    onAccent: relativeLuminance(accent) > 0.35 ? mix(accent, BLACK, 0.85) : '#ffffff',
    accentSoft: withAlpha(accent, 0.14),
    accentMedium: withAlpha(accent, 0.4),
    primaryLight3: mix(accent, WHITE, 0.3),
    primaryLight5: mix(accent, WHITE, 0.5),
    primaryLight7: mix(accent, WHITE, 0.7),
    primaryLight8: mix(accent, WHITE, 0.8),
    primaryLight9: mix(accent, WHITE, 0.9),
    primaryDark2: mix(accent, BLACK, 0.2)
  }
}

/** 语义色：暗色下略微提亮，浅色下略微压暗，保证可读。 */
export function deriveSemantic(mode: ResolvedMode): SemanticTokens {
  const adjust = (c: string): string =>
    mode === 'dark' ? mix(c, WHITE, 0.12) : mix(c, BLACK, 0.08)
  const success = adjust(SEMANTIC_BASE.success)
  const warning = adjust(SEMANTIC_BASE.warning)
  const danger = adjust(SEMANTIC_BASE.danger)
  const info = adjust(SEMANTIC_BASE.info)
  return {
    success,
    warning,
    danger,
    info,
    successSoft: withAlpha(success, 0.16),
    warningSoft: withAlpha(warning, 0.16),
    dangerSoft: withAlpha(danger, 0.16),
    infoSoft: withAlpha(info, 0.16)
  }
}

export interface ThemeInput {
  /** 强调色 */
  accent: string
  /** 页面底色 */
  bg: string
  /** 导航底色 */
  nav: string
}

export function buildTokens(mode: ResolvedMode, input: ThemeInput): ThemeTokens {
  return {
    mode,
    surface: deriveSurface(input.bg, input.nav),
    accent: deriveAccent(input.accent, mode),
    semantic: deriveSemantic(mode)
  }
}

// ---------------------------------------------------------------- CSS 变量

/** 尺度类令牌：与模式无关，只需写入一次。 */
export function scaleCssVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(RADIUS_TOKENS)) vars[`--tx-radius-${k}`] = v
  for (const [k, v] of Object.entries(SPACE_TOKENS)) vars[`--tx-space-${k}`] = v
  for (const [k, v] of Object.entries(FONT_SIZE_TOKENS)) vars[`--tx-font-${k}`] = v
  for (const [k, v] of Object.entries(SHADOW_TOKENS)) vars[`--tx-shadow-${k}`] = v
  for (const [k, v] of Object.entries(DURATION_TOKENS)) vars[`--tx-duration-${k}`] = v
  for (const [k, v] of Object.entries(EASING_TOKENS)) vars[`--tx-ease-${k}`] = v
  return vars
}

/**
 * 把令牌映射为 CSS 变量：系统令牌 `--tx-*` 与组件库令牌 `--el-*` 同时写入。
 * 组件库变量两套模式都写，避免浅色模式退回组件库默认配色。
 */
export function tokensToCssVars(tokens: ThemeTokens): Record<string, string> {
  const s = tokens.surface
  const a = tokens.accent
  const sem = tokens.semantic
  return {
    '--tx-bg': s.bg,
    '--tx-panel': s.panel,
    '--tx-card': s.card,
    '--tx-fill': s.fill,
    '--tx-hover': s.hover,
    '--tx-border': s.border,
    '--tx-border-strong': s.borderStrong,
    '--tx-nav': s.nav,
    '--tx-text': s.text,
    '--tx-text-2': s.text2,
    '--tx-text-3': s.text3,
    '--tx-overlay': s.overlay,
    '--tx-shadow-color': s.shadowColor,
    '--tx-accent': a.accent,
    '--tx-accent-hover': a.accentHover,
    '--tx-on-accent': a.onAccent,
    '--tx-accent-soft': a.accentSoft,
    '--tx-accent-medium': a.accentMedium,
    '--tx-success': sem.success,
    '--tx-warning': sem.warning,
    '--tx-danger': sem.danger,
    '--tx-info': sem.info,
    '--tx-success-soft': sem.successSoft,
    '--tx-warning-soft': sem.warningSoft,
    '--tx-danger-soft': sem.dangerSoft,
    '--tx-info-soft': sem.infoSoft,

    // ---- Element Plus 对齐 ----
    '--el-color-primary': a.accent,
    '--el-color-primary-light-3': a.primaryLight3,
    '--el-color-primary-light-5': a.primaryLight5,
    '--el-color-primary-light-7': a.primaryLight7,
    '--el-color-primary-light-8': a.primaryLight8,
    '--el-color-primary-light-9': a.primaryLight9,
    '--el-color-primary-dark-2': a.primaryDark2,
    '--el-bg-color': s.panel,
    '--el-bg-color-page': s.bg,
    '--el-bg-color-overlay': s.overlay,
    '--el-border-color': s.borderStrong,
    '--el-border-color-light': s.border,
    '--el-border-color-lighter': s.border,
    '--el-fill-color': s.fill,
    '--el-fill-color-light': s.card,
    '--el-fill-color-lighter': s.panel,
    '--el-text-color-primary': s.text,
    '--el-text-color-regular': s.text,
    '--el-text-color-secondary': s.text2,
    '--el-text-color-placeholder': s.text3,
    '--el-mask-color': tokens.mode === 'dark' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(15, 23, 42, 0.35)'
  }
}

// ---------------------------------------------------------------- 模式判定

/** 读取系统外观偏好；不可用时按亮色处理。 */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 把三态外观模式解析为实际生效的明暗。 */
export function resolveMode(mode: ThemeMode, systemDark: boolean): ResolvedMode {
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return mode
}

/** 模式对应的默认底色与导航色（跟随系统时使用）。 */
export const MODE_DEFAULT_SURFACE: Record<ResolvedMode, { bg: string; nav: string }> = {
  light: { bg: '#f4f5f6', nav: '#ffffff' },
  dark: { bg: '#0d0d0d', nav: '#151515' }
}

/** 终端前景与背景的对比度校验（WCAG 相对亮度）。 */
export function terminalContrastOk(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 4.5
}
