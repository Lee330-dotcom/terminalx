<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, Refresh, Bottom, Right } from '@element-plus/icons-vue'
import { useWorkspaceStore } from '../../stores/workspace'
import { useAiStore } from '../../stores/ai'
import { t } from '../../i18n'
import { MAX_PANES_PER_TAB } from '../../workspace/splitTree'
import TerminalView from '../TerminalView.vue'
import PanePicker from './PanePicker.vue'

const props = defineProps<{ paneId: string }>()

const workspace = useWorkspaceStore()
const aiStore = useAiStore()

const pickerVisible = ref(false)

const pane = computed(() => workspace.panes[props.paneId] ?? null)
const focused = computed(() => workspace.focusedPane?.id === props.paneId)
const title = computed(() => pane.value?.title || t('ws.paneUntitled'))

function doSplit(axis: 'x' | 'y'): void {
  if (!workspace.splitPane(props.paneId, axis)) {
    ElMessage.warning(t('ws.paneLimit', { n: MAX_PANES_PER_TAB }))
  }
}

function closePane(): void {
  void workspace.closePane(props.paneId)
}

function reconnect(): void {
  void workspace.reconnectPane(props.paneId)
}

function explainSelection(text: string): void {
  const p = pane.value
  if (!p?.sessionId) return
  void aiStore.run({
    kind: 'selection-explanation',
    title: title.value,
    scope: `选中 ${text.trim().length} 字符`,
    sessionId: p.sessionId,
    connectionId: p.connectionId ?? undefined,
    selection: text
  })
}

function diagnose(): void {
  const p = pane.value
  if (!p?.sessionId) return
  void aiStore.run({
    kind: 'connection-diagnosis',
    title: title.value,
    scope: '连接诊断',
    sessionId: p.sessionId,
    connectionId: p.connectionId ?? undefined,
    errorMessage: p.errorMessage ?? ''
  })
}
</script>

<template>
  <section class="pane" :class="{ focused }" @mousedown="workspace.focusPane(props.paneId)">
    <header class="pane-header">
      <span class="status-dot" :class="pane?.status ?? 'connecting'" />
      <span class="pane-title">{{ title }}</span>
      <div class="pane-actions">
        <el-tooltip :content="t('ws.splitRight')" placement="bottom">
          <button class="pane-btn" @click.stop="doSplit('x')">
            <el-icon><Right /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip :content="t('ws.splitDown')" placement="bottom">
          <button class="pane-btn" @click.stop="doSplit('y')">
            <el-icon><Bottom /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip v-if="pane?.sessionId" :content="t('app.reconnect')" placement="bottom">
          <button class="pane-btn" @click.stop="reconnect">
            <el-icon><Refresh /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip :content="t('ws.closePane')" placement="bottom">
          <button class="pane-btn" @click.stop="closePane">
            <el-icon><Close /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </header>

    <div class="pane-body">
      <div v-if="!pane?.sessionId" class="pane-empty">
        <p class="pane-empty-title">{{ t('ws.paneEmpty') }}</p>
        <p class="pane-empty-desc">{{ t('ws.paneEmptyHint') }}</p>
        <el-button type="primary" size="small" @click.stop="pickerVisible = true">
          {{ t('ws.chooseConnection') }}
        </el-button>
        <PanePicker
          v-model:visible="pickerVisible"
          @pick="(connectionId: string, name: string) => workspace.openSessionInPane(props.paneId, connectionId, name)"
        />
      </div>
      <div v-else-if="pane.status === 'error'" class="pane-state error">
        <p>{{ t('app.connectFailed', { err: pane.errorMessage }) }}</p>
        <div class="pane-state-actions">
          <el-button type="primary" size="small" @click.stop="reconnect">
            {{ t('app.reconnect') }}
          </el-button>
          <el-button size="small" @click.stop="diagnose">✦ {{ t('ws.aiDiagnose') }}</el-button>
        </div>
      </div>
      <div v-else-if="pane.status === 'disconnected'" class="pane-state">
        <p>{{ t('app.disconnected') }}</p>
        <el-button type="primary" size="small" @click.stop="reconnect">
          {{ t('app.reconnect') }}
        </el-button>
      </div>
      <template v-else>
        <TerminalView
          :session-id="pane.sessionId"
          :interactive="pane.status === 'connected'"
          @explain="(text: string) => explainSelection(text)"
        />
        <div v-if="pane.status === 'connecting'" class="pane-connecting">
          {{ t('ws.connecting') }}
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--tx-card);
  border: 1px solid transparent;
  overflow: hidden;
}
.pane.focused {
  border-color: color-mix(in srgb, var(--tx-accent) 45%, transparent);
}
.pane-header {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 6px 0 10px;
  flex-shrink: 0;
  background: var(--tx-nav);
  border-bottom: 1px solid var(--tx-border);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--tx-text-3);
}
.status-dot.connected {
  background: var(--tx-success);
}
.status-dot.connecting {
  background: var(--tx-warning);
}
.status-dot.disconnected {
  background: var(--tx-text-3);
}
.status-dot.error {
  background: var(--tx-danger);
}
.pane-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--tx-text-2);
  font-size: 12px;
}
.pane.focused .pane-title {
  color: var(--tx-text);
}
.pane-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.pane:hover .pane-actions,
.pane.focused .pane-actions {
  opacity: 1;
}
.pane-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--tx-text-3);
  cursor: pointer;
  font-size: 12px;
}
.pane-btn:hover {
  color: var(--tx-text);
  background: var(--tx-hover);
}
.pane-body {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.pane-body :deep(.terminal-container) {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}
.pane-empty,
.pane-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--tx-bg);
  color: var(--tx-text-2);
  text-align: center;
  padding: 16px;
}
.pane-state.error {
  color: var(--tx-danger);
}
.pane-state-actions {
  display: flex;
  gap: 8px;
}
.pane-empty-title {
  color: var(--tx-text);
  font-size: 13px;
  font-weight: 600;
}
.pane-empty-desc {
  color: var(--tx-text-3);
  font-size: 12px;
}
.pane-connecting {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--tx-card) 55%, transparent);
  color: var(--tx-text-3);
  font-size: 12px;
  letter-spacing: 0.5px;
  pointer-events: none;
  z-index: 5;
}
</style>
