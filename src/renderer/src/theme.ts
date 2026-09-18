/** 主题色/背景色/字体/导航栏颜色的运行时应用：直接覆盖 html 上的 CSS 变量。 */

export interface ThemePreset {
  id: string
  themeColor: string
  backgroundColor: string
  navColor: string
}

/** 背景预设（仿 XTerminal：预设包含主题色、背景色、导航栏颜色三件套）。 */
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

/** 跟随系统主题时使用：暗色 → 暗夜，浅色 → 明亮。 */
export function presetById(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[1]
}

export const DEFAULT_THEME = {
  themeColor: '#10b981',
  backgroundColor: '#0d0d0d',
  navColor: '#151515'
} as const

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = parseInt(full, 16)
  if (Number.isNaN(n) || full.length !== 6) return [16, 185, 129]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(hex: string, target: [number, number, number], ratio: number): string {
  const [r, g, b] = hexToRgb(hex)
  const c = [r, g, b].map((v, i) => Math.round(v + (target[i] - v) * ratio))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function isDark(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex)
  return r * 0.299 + g * 0.587 + b * 0.114 < 128
}

/** 应用主题色：Element Plus 主色阶 + 界面强调色。 */
export function applyThemeColor(color: string): void {
  const root = document.documentElement.style
  root.setProperty('--el-color-primary', color)
  root.setProperty('--el-color-primary-light-3', mix(color, [255, 255, 255], 0.3))
  root.setProperty('--el-color-primary-light-5', mix(color, [255, 255, 255], 0.5))
  root.setProperty('--el-color-primary-light-7', mix(color, [255, 255, 255], 0.7))
  root.setProperty('--el-color-primary-light-8', mix(color, [255, 255, 255], 0.8))
  root.setProperty('--el-color-primary-light-9', mix(color, [255, 255, 255], 0.9))
  root.setProperty('--el-color-primary-dark-2', mix(color, [0, 0, 0], 0.2))
  root.setProperty('--tx-green', color)
  // 强调色在浅色背景上加深、深色背景上变亮，保证可读性
  root.setProperty(
    '--tx-green-hover',
    mix(
      color,
      document.documentElement.classList.contains('dark') ? [255, 255, 255] : [0, 0, 0],
      0.25
    )
  )
}

/** 应用主背景色：按深浅切换 html.dark，面板/边框/文字变量随之切换。 */
export function applyBackgroundColor(color: string): void {
  const root = document.documentElement
  root.style.setProperty('--tx-bg', color)
  document.body.style.background = color
  const dark = isDark(color)
  root.classList.toggle('dark', dark)
  const green = root.style.getPropertyValue('--tx-green') || '#10b981'
  root.style.setProperty('--tx-green-hover', mix(green, dark ? [255, 255, 255] : [0, 0, 0], 0.25))
}

/** 应用顶部导航栏背景色。 */
export function applyNavColor(color: string): void {
  document.documentElement.style.setProperty('--tx-nav', color)
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

export function applyThemePreset(preset: ThemePreset): void {
  applyThemeColor(preset.themeColor)
  applyBackgroundColor(preset.backgroundColor)
  applyNavColor(preset.navColor)
}

// ---- 跟随系统主题 ----

let followCleanup: (() => void) | null = null

export function applyFollowSystem(enabled: boolean): void {
  if (!enabled) {
    followCleanup?.()
    followCleanup = null
    return
  }
  if (followCleanup) return
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (): void => applyThemePreset(presetById(mq.matches ? 'dark' : 'bright'))
  apply()
  mq.addEventListener('change', apply)
  followCleanup = () => mq.removeEventListener('change', apply)
}

export interface UiSettingsLike {
  themeColor: string
  backgroundColor: string
  navColor: string
  followSystemTheme: boolean
  uiFont: string
}

export function applyUiSettings(s: UiSettingsLike): void {
  if (s.followSystemTheme) {
    applyFollowSystem(true)
  } else {
    applyFollowSystem(false)
    applyThemeColor(s.themeColor)
    applyBackgroundColor(s.backgroundColor)
    applyNavColor(s.navColor)
  }
  applyUiFont(s.uiFont)
}
