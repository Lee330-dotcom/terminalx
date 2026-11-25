<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorkspaceStore } from '../../stores/workspace'
import { DividerRect, Rect, computeLayout } from '../../workspace/splitTree'
import TerminalPane from './TerminalPane.vue'

const props = defineProps<{ tabId: string }>()

defineOptions({ name: 'WorkspaceGrid' })

const workspace = useWorkspaceStore()
const gridRef = ref<HTMLElement | null>(null)

const tab = computed(() => workspace.tabs.find((t) => t.id === props.tabId) ?? null)
const layout = computed(() => computeLayout(tab.value?.root ?? { type: 'pane', paneId: '' }))

/** 窗格按布局顺序平铺，同层按 paneId 作 key：拆分时原窗格组件实例不重建 */
const cells = computed(() => {
  const current = tab.value
  if (!current) return []
  return workspace.tabPanes(props.tabId).map((pane) => ({
    pane,
    rect: layout.value.panes.get(pane.id) ?? { x: 0, y: 0, w: 100, h: 100 }
  }))
})

const dividers = computed(() => layout.value.dividers)

function cellStyle(rect: Rect): Record<string, string> {
  return {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.w}%`,
    height: `${rect.h}%`
  }
}

function dividerStyle(divider: DividerRect): Record<string, string> {
  if (divider.axis === 'x') {
    return {
      left: `${divider.pos}%`,
      top: `${divider.y}%`,
      height: `${divider.h}%`
    }
  }
  return {
    left: `${divider.x}%`,
    top: `${divider.pos}%`,
    width: `${divider.w}%`
  }
}

let dragging = false
let pendingRatio = 0.5
let startPos = 0
let startSize = 0
/** 拖拽中的分屏节点 id 与方向 */
let dragSplitId = ''
let dragAxis: 'x' | 'y' = 'x'

function onDividerDown(event: MouseEvent, divider: DividerRect): void {
  const grid = gridRef.value
  const splitRect = layout.value.splits.get(divider.splitId)
  if (!grid || !splitRect) return
  event.preventDefault()
  const gridRect = grid.getBoundingClientRect()
  if (gridRect.width <= 0 || gridRect.height <= 0) return
  dragSplitId = divider.splitId
  dragAxis = divider.axis
  // 分屏节点自身的像素范围：比例换算的分母
  if (divider.axis === 'x') {
    startPos = gridRect.left + (splitRect.x / 100) * gridRect.width
    startSize = (splitRect.w / 100) * gridRect.width
    pendingRatio = (divider.pos - splitRect.x) / splitRect.w
  } else {
    startPos = gridRect.top + (splitRect.y / 100) * gridRect.height
    startSize = (splitRect.h / 100) * gridRect.height
    pendingRatio = (divider.pos - splitRect.y) / splitRect.h
  }
  if (startSize <= 0) return
  dragging = true
  document.addEventListener('mousemove', onDividerMove)
  document.addEventListener('mouseup', onDividerUp)
}

function onDividerMove(event: MouseEvent): void {
  if (!dragging || startSize <= 0 || !dragSplitId) return
  const pos = dragAxis === 'x' ? event.clientX : event.clientY
  pendingRatio = (pos - startPos) / startSize
  workspace.setSplitRatio(dragSplitId, pendingRatio)
}

function onDividerUp(): void {
  // 收尾再落一次比例：窗口不可见时 rAF/事件节流可能漏掉最后一次移动
  if (dragging && startSize > 0 && dragSplitId) {
    workspace.setSplitRatio(dragSplitId, pendingRatio)
  }
  dragging = false
  document.removeEventListener('mousemove', onDividerMove)
  document.removeEventListener('mouseup', onDividerUp)
}
</script>

<template>
  <div ref="gridRef" class="pane-grid">
    <div
      v-for="{ pane, rect } in cells"
      :key="pane.id"
      class="grid-cell"
      :style="cellStyle(rect)"
    >
      <TerminalPane :pane-id="pane.id" />
    </div>
    <div
      v-for="divider in dividers"
      :key="divider.splitId"
      class="grid-divider"
      :class="`axis-${divider.axis}`"
      :style="dividerStyle(divider)"
      @mousedown="(e: MouseEvent) => onDividerDown(e, divider)"
    >
      <span class="grid-grip" />
    </div>
  </div>
</template>

<style scoped>
.pane-grid {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.grid-cell {
  position: absolute;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.grid-divider {
  position: absolute;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
}
.grid-divider.axis-x {
  width: 7px;
  margin-left: -3px;
  cursor: col-resize;
}
.grid-divider.axis-y {
  height: 7px;
  margin-top: -3px;
  cursor: row-resize;
}
.grid-grip {
  border-radius: 1px;
  background: var(--tx-text-3);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.axis-x .grid-grip {
  width: 2px;
  height: 26px;
}
.axis-y .grid-grip {
  width: 26px;
  height: 2px;
}
.grid-divider:hover .grid-grip {
  opacity: 0.9;
}
.grid-divider:hover {
  background: color-mix(in srgb, var(--tx-accent) 45%, transparent);
}
</style>
