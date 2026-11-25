/**
 * 分屏布局树：纯函数实现，不依赖 Vue / Pinia，便于单测。
 *
 * 布局是二叉树：叶子表示一个窗格，分屏节点表示两个子树的排布。
 * - axis 'x'：左右并排（中间是竖向分隔条）
 * - axis 'y'：上下堆叠（中间是横向分隔条）
 * - ratio：第一个子树占据的比例（0~1）
 */

export type SplitAxis = 'x' | 'y'

export interface PaneNode {
  type: 'pane'
  paneId: string
}

export interface SplitNode {
  type: 'split'
  id: string
  axis: SplitAxis
  ratio: number
  children: [LayoutNode, LayoutNode]
}

export type LayoutNode = PaneNode | SplitNode

/** 单个标签内的窗格数量上限（对应「2×2 以内」） */
export const MAX_PANES_PER_TAB = 4
/** 任一子窗格的最小占比，避免拖拽后窗格被压没 */
export const MIN_PANE_RATIO = 0.1

export function createPaneNode(paneId: string): PaneNode {
  return { type: 'pane', paneId }
}

export function createSplitNode(
  id: string,
  axis: SplitAxis,
  children: [LayoutNode, LayoutNode],
  ratio = 0.5
): SplitNode {
  return { type: 'split', id, axis, ratio: clampRatio(ratio), children }
}

/** 把比例钳制到「两个窗格都可见」的区间内 */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(1 - MIN_PANE_RATIO, Math.max(MIN_PANE_RATIO, ratio))
}

export function countPanes(node: LayoutNode): number {
  if (node.type === 'pane') return 1
  return countPanes(node.children[0]) + countPanes(node.children[1])
}

/** 按布局顺序（先左后右、先上后下）列出全部窗格 id */
export function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === 'pane') return [node.paneId]
  return [...collectPaneIds(node.children[0]), ...collectPaneIds(node.children[1])]
}

export function findPaneNode(node: LayoutNode, paneId: string): PaneNode | null {
  if (node.type === 'pane') return node.paneId === paneId ? node : null
  return findPaneNode(node.children[0], paneId) ?? findPaneNode(node.children[1], paneId)
}

export function findSplitNode(node: LayoutNode, splitId: string): SplitNode | null {
  if (node.type === 'pane') return null
  if (node.id === splitId) return node
  return findSplitNode(node.children[0], splitId) ?? findSplitNode(node.children[1], splitId)
}

/**
 * 遍历并替换节点。fn 返回 null 表示删除该节点；
 * 删除后其父分屏节点会自动折叠为剩余的兄弟子树。
 *
 * fn 会作用于树中每个节点（含分屏节点）；返回原引用表示未做修改。
 */
export function mapLayout(
  node: LayoutNode,
  fn: (n: LayoutNode) => LayoutNode | null
): LayoutNode | null {
  const mapped = fn(node)
  if (mapped === null) return null
  if (mapped.type === 'pane') return mapped
  const first = mapLayout(mapped.children[0], fn)
  const second = mapLayout(mapped.children[1], fn)
  // 没有子节点发生变化时保持原引用，避免无谓的响应式更新
  if (first === mapped.children[0] && second === mapped.children[1]) return mapped
  if (first && second) {
    return { ...mapped, children: [first, second] }
  }
  // 单侧被删除：折叠为剩余子树
  if (first) return first
  if (second) return second
  return null
}

/**
 * 在指定窗格处拆分出一个新窗格。原窗格保留在第一个子树中，
 * 新窗格在第二个子树中。已达上限时原样返回。
 */
export function splitPane(
  root: LayoutNode,
  paneId: string,
  axis: SplitAxis,
  newPaneId: string,
  splitId: string
): LayoutNode {
  if (countPanes(root) >= MAX_PANES_PER_TAB) return root
  let changed = false
  const next = mapLayout(root, (n) => {
    if (changed) return n
    if (n.type === 'pane' && n.paneId === paneId) {
      changed = true
      return createSplitNode(splitId, axis, [n, createPaneNode(newPaneId)])
    }
    return n
  })
  return next ?? root
}

/** 移除窗格；返回新的布局树与是否真的移除了 */
export function removePane(
  root: LayoutNode,
  paneId: string
): { root: LayoutNode | null; removed: boolean } {
  let removed = false
  const next = mapLayout(root, (n) => {
    if (n.type === 'pane' && n.paneId === paneId) {
      removed = true
      return null
    }
    return n
  })
  return { root: next, removed }
}

/** 更新分屏比例（越界自动钳制） */
export function updateRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  const next = mapLayout(root, (n) => {
    if (n.type === 'split' && n.id === splitId) {
      return { ...n, ratio: clampRatio(ratio) }
    }
    return n
  })
  return next ?? root
}

/** 矩形：坐标与宽高均为百分比（0~100），相对整个工作区 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 分隔条：pos 为分隔中心线的位置（百分比） */
export interface DividerRect {
  splitId: string
  axis: SplitAxis
  pos: number
  /** 分隔条覆盖区域 */
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutResult {
  /** 每个窗格的位置 */
  panes: Map<string, Rect>
  /** 每个分屏节点自身的包围盒，拖拽时用来换算比例 */
  splits: Map<string, Rect>
  /** 分隔条 */
  dividers: DividerRect[]
}

/**
 * 把布局树摊平成绝对定位的矩形。
 *
 * 窗格不在树里递归渲染，而是平铺到同一层按百分比定位：
 * 这样拆分时原窗格的组件实例不会被卸载重建，
 * xterm 的滚动缓冲与搜索状态得以保留。
 */
export function computeLayout(root: LayoutNode): LayoutResult {
  const panes = new Map<string, Rect>()
  const splits = new Map<string, Rect>()
  const dividers: DividerRect[] = []

  function walk(node: LayoutNode, rect: Rect): void {
    if (node.type === 'pane') {
      panes.set(node.paneId, rect)
      return
    }
    splits.set(node.id, rect)
    let first: Rect
    let second: Rect
    if (node.axis === 'x') {
      const cut = rect.x + rect.w * node.ratio
      first = { x: rect.x, y: rect.y, w: rect.w * node.ratio, h: rect.h }
      second = { x: cut, y: rect.y, w: rect.w * (1 - node.ratio), h: rect.h }
      dividers.push({
        splitId: node.id,
        axis: 'x',
        pos: cut,
        x: cut,
        y: rect.y,
        w: 0,
        h: rect.h
      })
    } else {
      const cut = rect.y + rect.h * node.ratio
      first = { x: rect.x, y: rect.y, w: rect.w, h: rect.h * node.ratio }
      second = { x: rect.x, y: cut, w: rect.w, h: rect.h * (1 - node.ratio) }
      dividers.push({
        splitId: node.id,
        axis: 'y',
        pos: cut,
        x: rect.x,
        y: cut,
        w: rect.w,
        h: 0
      })
    }
    walk(node.children[0], first)
    walk(node.children[1], second)
  }

  walk(root, { x: 0, y: 0, w: 100, h: 100 })
  return { panes, splits, dividers }
}

/** 找到窗格直接所属的分屏节点 id（即紧邻它的那条分隔条） */
export function findParentSplitId(node: LayoutNode, paneId: string): string | null {
  if (node.type === 'pane') return null
  for (const child of node.children) {
    if (child.type === 'pane' && child.paneId === paneId) return node.id
  }
  return findParentSplitId(node.children[0], paneId) ?? findParentSplitId(node.children[1], paneId)
}
