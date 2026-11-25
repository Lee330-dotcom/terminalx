/**
 * 主题应用层：把用户设置解析为设计令牌，写入 CSS 变量并广播主题变更。
 *
 * 令牌定义与派生在 `./tokens`，终端配色在 `./xtermTheme`。
 */

import { ThemeMode } from '@shared/types'
import { BLACK, WHITE, isDarkColor, mix } from '@shared/color'
import {
  ResolvedMode,
  ThemeTokens,
  buildTokens,
  prefersDark,
  resolveMode,
  scaleCssVars,
  tokensToCssVars
} from './tokens'

/** 主题变更事件名：终端等订阅者据此刷新自身配色。 */
export const THEME_CHANGE_EVENT = 'tx-theme-change'

export interface ThemePreset {
  id: string
  themeColor: string
  backgroundColor: string
  navColor: string
}

/** 皮肤预设（仿 XTerminal）：强调色、底色、导航栏三件套。 */
export const THEME_PRESETS: ThemePreset[] = [
  { id: 'bright', themeColor: '#059669', backgroundColor: '#f4f5f6', navColor: '#ffffff' },
  { id: 'dark', themeColor: '#10b981', backgroundColor: '#0d0d0d', navColor: '#151515' },
  { id: 'crimson', themeColor: '#dc2626', backgroundColor: '#1a0e0e', navColor: '#241414' },
  { id: 'emerald', themeColor: '#34d399', backgroundColor: '#0c1712', navColor: '#14241c' },
  { id: 'silver', themeColor: '#9ca3af', backgroundColor: '#131313', navColor: '#1c1c1c' },
  { id: 'skyblue', themeColor: '#3b82f6', backgroundColor: '#0e1520', navColor: '#161f2c' },
  { id: 'gold', themeColor: '#f59e0b', backgroundColor: '#181307', navColor: '#221c0e' },
  { id: 'orange', themeColor: '#f97316', backgroundColor: '#1a1108', navColor: '#251a0e' },
  { id: 'vividred', themeColor: '#f43f5e', backgroundColor: '#1a0d12', navColor: '#241318' },
  { id: 'pink', themeColor: '#ec4899', backgroundColor: '#1a0e15', navColor: '#25141d' },
  { id: 'purple', themeColor: '#8b5cf6', backgroundColor: '#140e1a', navColor: '#1d1626' },
  { id: 'lake', themeColor: '#06b6d4', backgroundColor: '#0d181a', navColor: '#132125' },
  { id: 'deepblue', themeColor: '#1d4ed8', backgroundColor: '#0e1220', navColor: '#141a2c' },
  { id: 'brown', themeColor: '#a16207', backgroundColor: '#181208', navColor: '#221b0e' },
  { id: 'inkblack', themeColor: '#6ee7b7', backgroundColor: '#050505', navColor: '#0e0e0e' },
  { id: 'turquoise', themeColor: '#14b8a6', backgroundColor: '#0d1a17', navColor: '#122520' },
  { id: 'red', themeColor: '#ef4444', backgroundColor: '#160909', navColor: '#200d0d' },
  { id: 'indigo', themeColor: '#6366f1', backgroundColor: '#0f0e1a', navColor: '#171626' },
  { id: 'tea', themeColor: '#d97706', backgroundColor: '#171006', navColor: '#201809' },
  { id: 'snow', themeColor: '#059669', backgroundColor: '#f8f9fa', navColor: '#f0f0f0' }
]

export const DEFAULT_THEME = {
  themeColor: '#10b981',
  backgroundColor: '#0d0d0d',
  navColor: '#151515'
} as const

export function presetById(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[1]
}

export interface ThemeSettingsLike {
  themeColor: string
  backgroundColor: string
  navColor: string
  themeMode: ThemeMode
  uiFont: string
}

/**
 * 表面解析：用户保存的底色若与当前模式的深浅一致就直接沿用（保留既有皮肤效果），
 * 否则按强调色派生当前模式的表面，避免浅色模式配深底、深色模式配浅底。
 */
export function resolveSurface(
  mode: ResolvedMode,
  accent: string,
  bg: string,
  nav: string
): { bg: string; nav: string } {
  if (isDarkColor(bg) === (mode === 'dark')) return { bg, nav }
  return mode === 'dark'
    ? { bg: mix(accent, BLACK, 0.94), nav: mix(accent, BLACK, 0.9) }
    : { bg: mix(accent, WHITE, 0.965), nav: mix(accent, WHITE, 0.99) }
}

let currentTokens: ThemeTokens | null = null
let lastSettings: ThemeSettingsLike | null = null
let systemCleanup: (() => void) | null = null

/** 当前生效的令牌，供终端等订阅者在挂载时取用。 */
export function currentThemeTokens(): ThemeTokens | null {
  return currentTokens
}

/** 当前令牌；设置尚未加载时回退到默认深色令牌。 */
export function themeTokensOrDefault(): ThemeTokens {
  return (
    currentTokens ??
    buildTokens('dark', {
      accent: DEFAULT_THEME.themeColor,
      bg: DEFAULT_THEME.backgroundColor,
      nav: DEFAULT_THEME.navColor
    })
  )
}

/** 订阅主题变更，返回取消订阅函数。 */
export function onThemeChange(handler: (tokens: ThemeTokens) => void): () => void {
  const listener = (e: Event): void => {
    handler((e as CustomEvent<ThemeTokens>).detail)
  }
  window.addEventListener(THEME_CHANGE_EVENT, listener)
  return () => window.removeEventListener(THEME_CHANGE_EVENT, listener)
}

/** 应用界面字体，空串恢复系统默认。 */
export function applyUiFont(font: string): void {
  const root = document.documentElement.style
  if (font) {
    const stack = `${font}, Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif`
    root.setProperty('--tx-font', stack)
    document.body.style.fontFamily = stack
    root.setProperty('--el-font-family', stack)
  } else {
    root.removeProperty('--tx-font')
    document.body.style.fontFamily = ''
    root.removeProperty('--el-font-family')
  }
}

function render(s: ThemeSettingsLike): ThemeTokens {
  const mode = resolveMode(s.themeMode, prefersDark())
  const surface = resolveSurface(mode, s.themeColor, s.backgroundColor, s.navColor)
  const tokens = buildTokens(mode, {
    accent: s.themeColor,
    bg: surface.bg,
    nav: surface.nav
  })

  const vars = { ...scaleCssVars(), ...tokensToCssVars(tokens) }
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  root.classList.toggle('dark', mode === 'dark')
  document.body.style.background = tokens.surface.bg
  applyUiFont(s.uiFont)

  currentTokens = tokens
  window.dispatchEvent(new CustomEvent<ThemeTokens>(THEME_CHANGE_EVENT, { detail: tokens }))
  return tokens
}

/** 监听系统外观变化：仅当外观模式为「跟随系统」时才重绘。 */
function ensureSystemListener(): void {
  if (systemCleanup || typeof window === 'undefined' || !window.matchMedia) return
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (): void => {
    if (lastSettings?.themeMode === 'system') render(lastSettings)
  }
  mq.addEventListener('change', onChange)
  systemCleanup = () => mq.removeEventListener('change', onChange)
}

/** 应用整套外观设置：解析模式 → 计算令牌 → 写入变量 → 广播变更。 */
export function applyTheme(s: ThemeSettingsLike): ThemeTokens {
  lastSettings = s
  ensureSystemListener()
  return render(s)
}

/** 设置入口：兼容既有调用方。 */
export function applyUiSettings(s: ThemeSettingsLike): void {
  applyTheme(s)
}
