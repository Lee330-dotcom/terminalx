<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{ sessionId: string }>()

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

onMounted(() => {
  term = new Terminal({
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    cursorBlink: true,
    scrollback: 5000,
    theme: { background: '#141414', cursor: '#10b981', cursorAccent: '#141414' }
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container.value!)
  safeFit()

  term.onData((data) => {
    window.api.sendInput(props.sessionId, new TextEncoder().encode(data))
  })

  unsubData = window.api.onSessionData((ev) => {
    if (ev.sessionId === props.sessionId) term!.write(ev.data)
  })

  resizeObserver = new ResizeObserver(safeFit)
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
  <div ref="container" class="terminal-container" />
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
}
.terminal-container :deep(.xterm) {
  height: 100%;
  padding: 4px;
}
</style>
