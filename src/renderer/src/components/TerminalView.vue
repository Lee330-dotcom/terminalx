<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{ sessionId: string }>()

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
let term: Terminal | null = null
let fit: FitAddon | null = null
let unsubData: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null

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
    theme: {
      background: '#141414',
      foreground: '#e5e7eb',
      cursor: '#10b981',
      cursorAccent: '#141414',
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
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container.value!)
  safeFit()
  updateHintPosition()

  term.onData((data) => {
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

  resizeObserver = new ResizeObserver(() => {
    safeFit()
    updateHintPosition()
  })
  resizeObserver.observe(container.value!)
})

onBeforeUnmount(() => {
  unsubData?.()
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
  border: 1px solid rgba(229, 231, 235, 0.92);
  border-radius: 8px;
  background: rgba(18, 21, 33, 0.98);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.38);
  pointer-events: none;
  color: #f3f4f6;
  font-size: 12px;
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
  background: rgba(52, 211, 153, 0.1);
}
.command-hint-icon {
  width: 16px;
  color: #fbbf24;
  font-size: 19px;
  line-height: 1;
}
.command-hints-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 7px 12px;
  border-top: 1px solid rgba(229, 231, 235, 0.9);
  color: #d1d5db;
}
.command-hints-description {
  flex: 1;
  color: #34d399;
  font-size: 13px;
}
.command-hints-key {
  white-space: nowrap;
  color: #d1d5db;
}
.command-hints-settings {
  color: #9ca3af;
  font-size: 16px;
}
</style>
