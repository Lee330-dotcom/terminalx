import { describe, it, expect } from 'vitest'
import {
  LayoutNode,
  MAX_PANES_PER_TAB,
  clampRatio,
  computeLayout,
  collectPaneIds,
  countPanes,
  createPaneNode,
  createSplitNode,
  findPaneNode,
  findParentSplitId,
  findSplitNode,
  mapLayout,
  removePane,
  splitPane,
  updateRatio
} from '../splitTree'

describe('基础查询', () => {
  it('统计窗格数量并按布局顺序收集 id', () => {
    const tree = createSplitNode('s1', 'x', [
      createPaneNode('p1'),
      createSplitNode('s2', 'y', [createPaneNode('p2'), createPaneNode('p3')])
    ])
    expect(countPanes(tree)).toBe(3)
    expect(collectPaneIds(tree)).toEqual(['p1', 'p2', 'p3'])
  })

  it('按 id 查找窗格与分屏节点', () => {
    const tree = createSplitNode('s1', 'x', [createPaneNode('p1'), createPaneNode('p2')])
    expect(findPaneNode(tree, 'p2')?.paneId).toBe('p2')
    expect(findPaneNode(tree, 'nope')).toBeNull()
    expect(findSplitNode(tree, 's1')?.id).toBe('s1')
    expect(findSplitNode(tree, 'nope')).toBeNull()
  })

  it('找到窗格所属的祖先分屏节点', () => {
    const tree = createSplitNode('s1', 'x', [
      createPaneNode('p1'),
      createSplitNode('s2', 'y', [createPaneNode('p2'), createPaneNode('p3')])
    ])
    expect(findParentSplitId(tree, 'p2')).toBe('s2')
    expect(findParentSplitId(tree, 'p1')).toBe('s1')
  })
})

describe('splitPane', () => {
  it('在指定窗格处拆分为分屏节点，原窗格保留', () => {
    const tree = createPaneNode('p1')
    const next = splitPane(tree, 'p1', 'x', 'p2', 's1')
    expect(next.type).toBe('split')
    expect(next.type === 'split' && next.axis).toBe('x')
    expect(next.type === 'split' && next.ratio).toBe(0.5)
    expect(collectPaneIds(next)).toEqual(['p1', 'p2'])
  })

  it('已达窗格上限时拒绝拆分且不改变原树', () => {
    let tree: LayoutNode = createPaneNode('p1')
    tree = splitPane(tree, 'p1', 'x', 'p2', 's1')
    tree = splitPane(tree, 'p2', 'y', 'p3', 's2')
    tree = splitPane(tree, 'p3', 'x', 'p4', 's3')
    expect(countPanes(tree)).toBe(MAX_PANES_PER_TAB)
    const next = splitPane(tree, 'p4', 'y', 'p5', 's4')
    expect(next).toBe(tree)
    expect(countPanes(next)).toBe(MAX_PANES_PER_TAB)
  })

  it('拆分目标不存在时树保持不变', () => {
    const tree = createPaneNode('p1')
    const next = splitPane(tree, 'missing', 'x', 'p2', 's1')
    expect(next).toBe(tree)
  })
})

describe('removePane', () => {
  it('移除窗格后父分屏折叠为兄弟节点', () => {
    const tree = createSplitNode('s1', 'x', [createPaneNode('p1'), createPaneNode('p2')])
    const { root, removed } = removePane(tree, 'p2')
    expect(removed).toBe(true)
    expect(root?.type).toBe('pane')
    expect(root?.type === 'pane' && root.paneId).toBe('p1')
  })

  it('移除嵌套窗格时逐级折叠', () => {
    const tree = createSplitNode('s1', 'x', [
      createPaneNode('p1'),
      createSplitNode('s2', 'y', [createPaneNode('p2'), createPaneNode('p3')])
    ])
    const { root, removed } = removePane(tree, 'p2')
    expect(removed).toBe(true)
    expect(countPanes(root!)).toBe(2)
    expect(collectPaneIds(root!)).toEqual(['p1', 'p3'])
  })

  it('移除不存在的窗格时树保持不变', () => {
    const tree = createPaneNode('p1')
    const { root, removed } = removePane(tree, 'missing')
    expect(removed).toBe(false)
    expect(root).toBe(tree)
  })
})

describe('updateRatio', () => {
  it('写入比例并钳制到可见区间', () => {
    const tree = createSplitNode('s1', 'x', [createPaneNode('p1'), createPaneNode('p2')])
    const next = updateRatio(tree, 's1', 0.7)
    expect(findSplitNode(next, 's1')?.ratio).toBe(0.7)

    const tooSmall = updateRatio(tree, 's1', 0.01)
    expect(findSplitNode(tooSmall, 's1')?.ratio).toBe(0.1)

    const tooLarge = updateRatio(tree, 's1', 0.99)
    expect(findSplitNode(tooLarge, 's1')?.ratio).toBe(0.9)
  })

  it('比例非法时回落到中间值', () => {
    expect(clampRatio(Number.NaN)).toBe(0.5)
    expect(clampRatio(0.5)).toBe(0.5)
  })

  it('目标分屏不存在时树保持不变', () => {
    const tree = createSplitNode('s1', 'x', [createPaneNode('p1'), createPaneNode('p2')])
    expect(updateRatio(tree, 'missing', 0.6)).toBe(tree)
  })
})

describe('mapLayout', () => {
  it('替换节点时保持结构', () => {
    const tree = createSplitNode('s1', 'x', [createPaneNode('p1'), createPaneNode('p2')])
    const next = mapLayout(tree, (n) =>
      n.type === 'pane' && n.paneId === 'p1' ? createPaneNode('p9') : n
    )
    expect(collectPaneIds(next!)).toEqual(['p9', 'p2'])
  })
})

describe('computeLayout', () => {
  it('单窗格铺满整个工作区', () => {
    const { panes, dividers } = computeLayout(createPaneNode('p1'))
    expect(panes.get('p1')).toEqual({ x: 0, y: 0, w: 100, h: 100 })
    expect(dividers).toHaveLength(0)
  })

  it('左右分屏按比例切分宽度，分隔条落在分界处', () => {
    const tree = createSplitNode('s1', 'x', [createPaneNode('p1'), createPaneNode('p2')])
    const { panes, dividers, splits } = computeLayout(tree)
    expect(panes.get('p1')).toEqual({ x: 0, y: 0, w: 50, h: 100 })
    expect(panes.get('p2')).toEqual({ x: 50, y: 0, w: 50, h: 100 })
    expect(dividers[0]).toMatchObject({ splitId: 's1', axis: 'x', pos: 50 })
    expect(splits.get('s1')).toEqual({ x: 0, y: 0, w: 100, h: 100 })
  })

  it('上下分屏按比例切分高度', () => {
    const tree = createSplitNode('s1', 'y', [createPaneNode('p1'), createPaneNode('p2')])
    const { panes, dividers } = computeLayout(tree)
    expect(panes.get('p1')).toEqual({ x: 0, y: 0, w: 100, h: 50 })
    expect(panes.get('p2')).toEqual({ x: 0, y: 50, w: 100, h: 50 })
    expect(dividers[0]).toMatchObject({ axis: 'y', pos: 50 })
  })

  it('嵌套分屏：子树的矩形落在父级范围内', () => {
    const inner = createSplitNode('s2', 'y', [createPaneNode('p2'), createPaneNode('p3')])
    const tree = createSplitNode('s1', 'x', [createPaneNode('p1'), inner])
    const { panes, dividers } = computeLayout(tree)
    expect(panes.get('p1')).toEqual({ x: 0, y: 0, w: 50, h: 100 })
    expect(panes.get('p2')).toEqual({ x: 50, y: 0, w: 50, h: 50 })
    expect(panes.get('p3')).toEqual({ x: 50, y: 50, w: 50, h: 50 })
    expect(dividers).toHaveLength(2)
    expect(dividers[1]).toMatchObject({ splitId: 's2', axis: 'y', pos: 50 })
  })
})
