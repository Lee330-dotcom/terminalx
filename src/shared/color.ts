/**
 * 颜色工具：主进程（设置迁移）与渲染进程（设计令牌派生）共用。
 * 纯函数，无 DOM 依赖，便于单测。
 */

export type Rgb = [number, number, number]

export const WHITE: Rgb = [255, 255, 255]
export const BLACK: Rgb = [0, 0, 0]

/** 非法色值回退到品牌绿，避免派生链路整体失效。 */
export function hexToRgb(hex: string): Rgb {
  const h = (hex ?? '').trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [16, 185, 129]
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`
}

/** 把 from 朝 target 混合 ratio（0~1），ratio=0 返回 from。 */
export function mix(from: string, target: Rgb, ratio: number): string {
  const [r, g, b] = hexToRgb(from)
  const c: Rgb = [
    r + (target[0] - r) * ratio,
    g + (target[1] - g) * ratio,
    b + (target[2] - b) * ratio
  ]
  return rgbToHex(c)
}

/** 感知亮度加权判定深浅（与历史实现保持一致，阈值 128）。 */
export function isDarkColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex)
  return r * 0.299 + g * 0.587 + b * 0.114 < 128
}

/** WCAG 2.1 相对亮度。 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 对比度（1~21）。 */
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 把前景色朝高对比方向推进，直到与背景的对比度达标。
 * 深色背景向白色靠拢，浅色背景向黑色靠拢；达标即返回原色。
 */
export function ensureContrast(fg: string, bg: string, minRatio = 4.5): string {
  if (contrastRatio(fg, bg) >= minRatio) return fg
  const toward = isDarkColor(bg) ? WHITE : BLACK
  let out = fg
  for (let i = 1; i <= 20; i++) {
    out = mix(fg, toward, i / 20)
    if (contrastRatio(out, bg) >= minRatio) return out
  }
  return out
}

/** 带透明度的 rgba 字符串。 */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
