<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { registerTerminalSearch, terminalSearchResult } from '../utils/terminalSearch'
import { onThemeChange, themeTokensOrDefault } from '../theme'
import { buildSearchDecorations, buildXtermTheme } from '../theme/xtermTheme'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{ sessionId: string; interactive?: boolean }>()
const emit = defineEmits<{ explain: [text: string] }>()

const commandNames = [
  'ls',
  'cd',
  'pwd',
  'cat',
  'tail',
  'grep',
  'find',
  'ps',
  'top',
  'df',
  'free',
  'curl',
  'ping',
  'ssh',
  'scp',
  'tar',
  'chmod',
  'chown',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'vim',
  'nano',
  'git',
  'docker',
  'kubectl',
  'systemctl',
  'journalctl',
  'clear',
  'exit',
  'kill',
  'pkill',
  'ollama',
  'rollup',
  'zellij',
  'install',
  'killall',
  'tailcall',
  'll'
]
const inputBuffer = ref('')
const selectedHintIndex = ref(0)
const hintStyle = ref<Record<string, string>>({ left: '12px', top: '12px' })
const commandHints = computed(() => {
  const token = inputBuffer.value.split(/\s/, 1)[0].toLowerCase()
  if (!token || inputBuffer.value.includes(' ')) return []
  return commandNames.filter((name) => name.includes(token) && name !== token).slice(0, 8)
})

const container = ref<HTMLDivElement>()
const selectionPos = ref<{ left: number; top: number } | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let search: SearchAddon | null = null
let unregisterSearch: (() => void) | null = null
let searchResultSub: { dispose(): void } | null = null
let unsubData: (() => void) | null = null
let unsubSelection: (() => void) | null = null
let unsubTheme: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let lastMouse = { x: 0, y: 0 }

function refreshExplainButton(): void {
  requestAnimationFrame(() => {
    if (!term || !container.value) return
    if (!term.getSelection().trim()) {
      selectionPos.value = null
      return
    }
    const rect = container.value.getBoundingClientRect()
    selectionPos.value = {
      left: Math.max(8, Math.min(lastMouse.x - rect.left - 24, rect.width - 110)),
      top: Math.max(8, lastMouse.y - rect.top + 10)
    }
  })
}

function explainSelection(): void {
  const text = term?.getSelection() ?? ''
  selectionPos.value = null
  term?.clearSelection()
  if (text.trim()) emit('explain', text)
}

function safeFit(): void {
  try {
    fit?.fit()
    if (term) window.api.resizeSession(props.sessionId, term.cols, term.rows)
  } catch {
    /* 容器不可见时 fit 会抛错，忽略 */
  }
}

function updateHintPosition(): void {
  if (!term || !container.value) return
  const shell = container.value.parentElement
  if (!shell) return
  const width = shell.clientWidth
  const height = shell.clientHeight
  if (!width || !height) return

  const cellWidth = width / Math.max(term.cols, 1)
  const lineHeight = height / Math.max(term.rows, 1)
  const cursor = term.buffer.active
  const panelWidth = Math.min(520, width - 32)
  const panelHeight = 330
  const left = Math.min(
    Math.max(12, (cursor.cursorX + 1) * cellWidth + 12),
    width - panelWidth - 12
  )
  const below = (cursor.cursorY + 1) * lineHeight + 8
  const top =
    below + panelHeight <= height - 12
      ? below
      : Math.max(12, cursor.cursorY * lineHeight - panelHeight)
  hintStyle.value = { left: `${left}px`, top: `${top}px`, transform: 'none' }
}

onMounted(() => {
  term = new Terminal({
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    theme: buildXtermTheme(themeTokensOrDefault())
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  search = new SearchAddon()
  term.loadAddon(search)
  searchResultSub = search.onDidChangeResults(({ resultIndex, resultCount }) => {
    terminalSearchResult.index = resultIndex
    terminalSearchResult.total = resultCount
  })
  unregisterSearch = registerTerminalSearch(props.sessionId, {
    findNext: (query, incremental) =>
      search?.findNext(query, {
        incremental,
        decorations: buildSearchDecorations(themeTokensOrDefault())
      }) ?? false,
    findPrevious: (query) =>
      search?.findPrevious(query, {
        decorations: buildSearchDecorations(themeTokensOrDefault())
      }) ?? false,
    clear: () => search?.clearDecorations()
  })
  term.open(container.value!)
  safeFit()
  updateHintPosition()

  term.onData((data) => {
    // 连接/重连过程中远端 stream 可能尚未就绪，输入会被丢弃；
    // 此时直接忽略按键，避免用户以为命令已经输入
    if (props.interactive === false) return
    if (data === '\u001b[A' && commandHints.value.length > 0) {
      selectedHintIndex.value =
        (selectedHintIndex.value - 1 + commandHints.value.length) % commandHints.value.length
      return
    }
    if (data === '\u001b[B' && commandHints.value.length > 0) {
      selectedHintIndex.value = (selectedHintIndex.value + 1) % commandHints.value.length
      return
    }
    if (data === '\t' && commandHints.value.length > 0) {
      const current = inputBuffer.value
      const completion = commandHints.value[selectedHintIndex.value].slice(current.length)
      inputBuffer.value += completion
      window.api.sendInput(props.sessionId, new TextEncoder().encode(completion))
      return
    }
    if (data === '\r' || data === '\n') {
      inputBuffer.value = ''
      selectedHintIndex.value = 0
    } else if (data === '\u007f') inputBuffer.value = inputBuffer.value.slice(0, -1)
    else if (/^[\x20-\x7e]+$/.test(data)) inputBuffer.value += data
    else if (data.includes('\u001b')) inputBuffer.value = ''
    window.api.sendInput(props.sessionId, new TextEncoder().encode(data))
    updateHintPosition()
  })

  unsubData = window.api.onSessionData((ev) => {
    if (ev.sessionId === props.sessionId) {
      term!.write(ev.data)
      if (commandHints.value.length > 0) requestAnimationFrame(updateHintPosition)
    }
  })

  // 选区清空时隐藏按钮；显示与定位等到 mouseup，避免拖动过程中闪烁
  const selectionDisposable = term.onSelectionChange(() => {
    if (!term?.getSelection().trim()) selectionPos.value = null
  })
  unsubSelection = () => selectionDisposable.dispose()
  container.value!.addEventListener('mouseup', onMouseUp)

  resizeObserver = new ResizeObserver(() => {
    safeFit()
    updateHintPosition()
  })
  resizeObserver.observe(container.value!)

  // 主题切换后刷新终端配色，连接与滚动内容不受影响
  unsubTheme = onThemeChange((tokens) => {
    if (term) term.options.theme = buildXtermTheme(tokens)
  })
})

watch(
  () => props.interactive,
  (interactive) => {
    if (interactive === false) {
      inputBuffer.value = ''
      selectedHintIndex.value = 0
    }
  }
)

function onMouseUp(e: MouseEvent): void {
  lastMouse = { x: e.clientX, y: e.clientY }
  refreshExplainButton()
}

onBeforeUnmount(() => {
  unsubData?.()
  unsubSelection?.()
  unsubTheme?.()
  unregisterSearch?.()
  searchResultSub?.dispose()
  container.value?.removeEventListener('mouseup', onMouseUp)
  resizeObserver?.disconnect()
  term?.dispose()
  term = null
})

defineExpose({ fit: safeFit })
</script>

<template>
  <div class="terminal-shell">
    <div ref="container" class="terminal-container" />
    <div
      v-if="commandHints.length > 0"
      class="command-hints"
      :style="hintStyle"
      aria-label="命令提示"
    >
      <div class="command-hints-list">
        <div
          v-for="(hint, index) in commandHints"
          :key="hint"
          class="command-hint"
          :class="{ selected: index === selectedHintIndex }"
        >
          <span class="command-hint-icon">ϟ</span>
          <span>{{ hint }}</span>
        </div>
      </div>
      <div class="command-hints-footer">
        <span class="command-hints-description">暂无说明</span>
        <span class="command-hints-key">↑/↓ 选择 · Tab 接受 · Esc 关闭</span>
        <span class="command-hints-settings">⚙</span>
      </div>
    </div>
    <button
      v-if="selectionPos"
      class="ai-explain-btn"
      :style="{ left: `${selectionPos.left}px`, top: `${selectionPos.top}px` }"
      @mousedown.prevent
      @click.stop="explainSelection"
    >
      ✦ AI 解释
    </button>
  </div>
</template>

<style scoped>
.terminal-shell {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  height: 100%;
}
.terminal-container {
  width: 100%;
  height: 100%;
}
.terminal-container :deep(.xterm) {
  height: 100%;
  padding: 4px;
}
.command-hints {
  position: absolute;
  top: 12px;
  left: 12px;
  width: min(520px, calc(100% - 32px));
  overflow: hidden;
  border: 1px solid var(--tx-border-strong);
  border-radius: var(--tx-radius-md);
  background: var(--tx-overlay);
  box-shadow: var(--tx-shadow-lg);
  pointer-events: none;
  color: var(--tx-text);
  font-size: var(--tx-font-sm);
}
.command-hints-list {
  max-height: 272px;
  overflow: hidden;
  padding: 7px 0;
}
.command-hint {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 34px;
  padding: 0 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.command-hint.selected {
  background: var(--tx-accent-soft);
}
.command-hint-icon {
  width: 16px;
  color: var(--tx-warning);
  font-size: 19px;
  line-height: 1;
}
.command-hints-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 7px 12px;
  border-top: 1px solid var(--tx-border);
  color: var(--tx-text-2);
}
.command-hints-description {
  flex: 1;
  color: var(--tx-accent);
  font-size: var(--tx-font-md);
}
.command-hints-key {
  white-space: nowrap;
  color: var(--tx-text-2);
}
.command-hints-settings {
  color: var(--tx-text-3);
  font-size: 16px;
}
.ai-explain-btn {
  position: absolute;
  z-index: 8;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--tx-accent) 45%, transparent);
  border-radius: var(--tx-radius-sm);
  background: color-mix(in srgb, var(--tx-panel) 92%, transparent);
  color: var(--tx-accent-hover);
  font: inherit;
  font-size: var(--tx-font-xs);
  cursor: pointer;
  box-shadow: var(--tx-shadow-md);
}
.ai-explain-btn:hover {
  background: color-mix(in srgb, var(--tx-accent) 18%, var(--tx-panel));
  color: var(--tx-text);
}
</style>
