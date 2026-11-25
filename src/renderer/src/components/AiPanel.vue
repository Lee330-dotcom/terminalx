<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Close } from '@element-plus/icons-vue'
import { useAiStore } from '../stores/ai'
import { useAiChatStore, ChatTimelineItem } from '../stores/aiChat'
import { useWorkspaceStore } from '../stores/workspace'
import { useSettingsStore } from '../stores/settings'
import type { CommandRisk, CommandSuggestion } from '../utils/aiCommand'
import { renderMarkdown } from '../utils/markdown'

const emit = defineEmits<{ close: []; 'open-settings': [] }>()
const props = withDefaults(defineProps<{ width?: number }>(), { width: 380 })

const aiStore = useAiStore()
const chatStore = useAiChatStore()
const workspaceStore = useWorkspaceStore()
const settingsStore = useSettingsStore()
const bodyRef = ref<HTMLDivElement>()
const chatBodyRef = ref<HTMLDivElement>()
const instruction = ref('')
const chatInput = ref('')
const inserted = ref<string[]>([])

watch(
  () => aiStore.text,
  async () => {
    await nextTick()
    const body = bodyRef.value
    if (body) body.scrollTop = body.scrollHeight
  }
)

watch(
  () => aiStore.commands,
  () => {
    inserted.value = []
  }
)

watch(
  () => {
    const items = chatStore.timeline
    const last = items[items.length - 1]
    return `${items.length}:${last?.type === 'assistant' ? (last.text ?? '').length : (last?.status ?? '')}`
  },
  async () => {
    await nextTick()
    scrollChat()
  }
)

const connectedTab = computed(() => {
  const pane = workspaceStore.focusedPane
  return pane && pane.status === 'connected' ? pane : null
})

const insertTarget = computed(() => {
  if (!aiStore.runSessionId) return null
  const pane = workspaceStore.paneBySessionId(aiStore.runSessionId)
  return pane && pane.status === 'connected' ? pane : null
})

const canSend = computed(
  () => Boolean(connectedTab.value) && !aiStore.running && instruction.value.trim().length > 0
)

const canChat = computed(
  () =>
    Boolean(connectedTab.value?.sessionId && connectedTab.value?.connectionId) &&
    chatInput.value.trim().length > 0
)

const currentScope = computed(() =>
  aiStore.panelTab === 'analysis' ? aiStore.scope : (connectedTab.value?.title ?? '')
)

const autoExecuteEnabled = computed(() => settingsStore.settings?.aiAutoExecute === true)
const analysisHtml = computed(() => renderMarkdown(aiStore.text))

const RISK_LABELS: Record<CommandRisk, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  unknown: '未标注'
}

function riskLabel(risk: CommandRisk): string {
  return RISK_LABELS[risk]
}

function isMultiline(command: string): boolean {
  return command.includes('\n')
}

function canInsert(command: CommandSuggestion): boolean {
  return Boolean(insertTarget.value) && !isMultiline(command.command)
}

async function copy(): Promise<void> {
  if (!aiStore.text) return
  await navigator.clipboard.writeText(aiStore.text)
  ElMessage.success('已复制')
}

async function copyCommand(command: string): Promise<void> {
  await navigator.clipboard.writeText(command)
  ElMessage.success('命令已复制')
}

function focusTerminal(): void {
  document.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
}

async function sendCommand(): Promise<void> {
  const tab = connectedTab.value
  if (!tab) {
    ElMessage.warning('请先连接服务器')
    return
  }
  const text = instruction.value.trim()
  if (!text) return
  instruction.value = ''
  void aiStore.run({
    kind: 'command-suggestion',
    title: '命令建议',
    scope: tab.title,
    sessionId: tab.sessionId ?? undefined,
    connectionId: tab.connectionId ?? undefined,
    instruction: text
  })
}

function onComposerKeydown(ev: KeyboardEvent): void {
  if (ev.isComposing || ev.key !== 'Enter') return
  ev.preventDefault()
  if (canSend.value) void sendCommand()
}

async function insertCommand(command: CommandSuggestion): Promise<void> {
  const target = insertTarget.value
  if (!target) {
    ElMessage.warning('会话已断开，请重新连接后再插入')
    return
  }
  if (isMultiline(command.command)) return
  window.api.sendInput(target.sessionId ?? '', new TextEncoder().encode(command.command))
  if (!inserted.value.includes(command.command)) inserted.value.push(command.command)
  ElMessage.success('已插入终端，按 Enter 执行')
  focusTerminal()
}

function switchTab(tab: 'analysis' | 'assistant'): void {
  if (tab === 'assistant') {
    if (!connectedTab.value) {
      ElMessage.warning('请先连接服务器')
      return
    }
    void chatStore.refreshStatus()
  }
  aiStore.panelTab = tab
  if (tab === 'assistant') void nextTick(scrollChat)
}

function scrollChat(): void {
  const el = chatBodyRef.value
  if (el) el.scrollTop = el.scrollHeight
}

async function sendChat(): Promise<void> {
  const tab = connectedTab.value
  if (!tab?.sessionId || !tab.connectionId) {
    ElMessage.warning('请先连接服务器')
    return
  }
  if (!chatInput.value.trim()) return
  const text = chatInput.value
  chatInput.value = ''
  await chatStore.send(text, {
    sessionId: tab.sessionId,
    connectionId: tab.connectionId
  })
  await nextTick()
  scrollChat()
}

function onChatKeydown(ev: KeyboardEvent): void {
  if (ev.isComposing || ev.key !== 'Enter' || ev.shiftKey) return
  ev.preventDefault()
  if (canChat.value) void sendChat()
}

function toolStatusLabel(item: ChatTimelineItem): string {
  switch (item.status) {
    case 'awaiting-approval':
      return '等待确认'
    case 'running':
      return '执行中…'
    case 'success':
      return item.result && item.result.exitCode !== 0 ? `退出码 ${item.result.exitCode}` : '已执行'
    case 'failed':
      return '执行失败'
    case 'rejected':
    case 'skipped':
      return '已跳过'
    default:
      return ''
  }
}

function toolStatusClass(item: ChatTimelineItem): string {
  if (item.status === 'success' && item.result && item.result.exitCode !== 0) return 'status-warn'
  return `status-${item.status ?? 'unknown'}`
}

function outputText(item: ChatTimelineItem): string {
  const result = item.result
  if (!result) return ''
  const parts: string[] = []
  if (result.stdout) parts.push(result.stdout)
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
  if (parts.length === 0) parts.push('(无输出)')
  if (result.truncated) parts.push('[输出已截断]')
  return parts.join('\n')
}
</script>

<template>
  <aside class="ai-panel" :style="{ width: `${props.width}px` }">
    <header class="ai-header">
      <div class="ai-title">
        <span class="ai-dot" />
        <span>AI</span>
        <span v-if="currentScope" class="ai-scope">{{ currentScope }}</span>
      </div>
      <el-button text circle size="small" @click="emit('close')">
        <el-icon :size="14"><Close /></el-icon>
      </el-button>
    </header>

    <nav class="ai-tabs">
      <button
        class="ai-tab"
        :class="{ active: aiStore.panelTab === 'analysis' }"
        @click="switchTab('analysis')"
      >
        分析
      </button>
      <button
        class="ai-tab"
        :class="{ active: aiStore.panelTab === 'assistant' }"
        :disabled="!connectedTab"
        @click="switchTab('assistant')"
      >
        助手
      </button>
    </nav>

    <div v-if="aiStore.panelTab === 'analysis' && aiStore.title" class="ai-subtitle">
      {{ aiStore.title }}
      <span v-if="aiStore.kind === 'command-suggestion'" class="ai-context">
        · 上下文：最近 120 行
      </span>
    </div>

    <!-- 分析页签 -->
    <div v-if="aiStore.panelTab === 'analysis'" ref="bodyRef" class="ai-body">
      <div v-if="aiStore.configured === false" class="ai-hint">
        <p>尚未配置 AI 服务，请先在 设置 → AI 中填写服务地址、模型并保存 API Key。</p>
        <el-button type="primary" size="small" @click="emit('open-settings')">打开设置</el-button>
      </div>
      <template v-else>
        <div v-if="aiStore.commands.length" class="ai-commands">
          <div
            v-for="suggestion in aiStore.commands"
            :key="suggestion.command"
            class="ai-command-card"
            :class="`risk-${suggestion.risk}`"
          >
            <div class="ai-command-head">
              <span class="ai-risk-badge" :class="`risk-${suggestion.risk}`">
                {{ riskLabel(suggestion.risk) }}
              </span>
              <span class="ai-command-note">{{ suggestion.note || '命令建议' }}</span>
            </div>
            <pre class="ai-command-code">{{ suggestion.command }}</pre>
            <p v-if="suggestion.localRisk" class="ai-local-risk">
              本地预检：{{ suggestion.localRisk.reason }}
            </p>
            <p v-if="isMultiline(suggestion.command)" class="ai-command-warn">
              多行命令不会自动插入，请复制后手动粘贴
            </p>
            <div class="ai-command-actions">
              <el-button
                type="primary"
                size="small"
                :disabled="!canInsert(suggestion) || inserted.includes(suggestion.command)"
                @click="insertCommand(suggestion)"
              >
                {{ inserted.includes(suggestion.command) ? '已插入' : '插入终端' }}
              </el-button>
              <el-button size="small" @click="copyCommand(suggestion.command)">复制</el-button>
            </div>
          </div>
        </div>

        <!-- eslint-disable vue/no-v-html -- 已经过 DOMPurify 净化 -->
        <div
          v-if="aiStore.text"
          class="ai-text markdown-body"
          :class="{ 'with-commands': aiStore.commands.length }"
          v-html="analysisHtml"
        />
        <!-- eslint-enable vue/no-v-html -->
        <div v-else-if="aiStore.running" class="ai-hint">
          {{ aiStore.kind === 'command-suggestion' ? '正在生成命令…' : '正在分析…' }}
        </div>
        <div v-else-if="!aiStore.error" class="ai-hint">
          选中终端日志后点「AI 解释」，或在下方描述需求让 AI 生成命令。
        </div>
        <div v-if="aiStore.error" class="ai-error">{{ aiStore.error }}</div>
        <div v-if="aiStore.cancelled" class="ai-cancelled">已停止生成</div>
      </template>
    </div>

    <!-- 助手页签 -->
    <div v-else ref="chatBodyRef" class="ai-body">
      <div v-if="chatStore.configured === false" class="ai-hint">
        <p>尚未配置 AI 服务，请先在 设置 → AI 中填写服务地址、模型并保存 API Key。</p>
        <el-button type="primary" size="small" @click="emit('open-settings')">打开设置</el-button>
      </div>
      <div v-else-if="!connectedTab" class="ai-hint">
        <p>助手仅能在已连接的会话中使用，请先连接服务器。</p>
      </div>
      <template v-else>
        <div v-if="chatStore.timeline.length" class="chat-timeline">
          <template v-for="item in chatStore.timeline" :key="item.id">
            <div v-if="item.type === 'user'" class="chat-msg user">
              <div class="chat-bubble">{{ item.text }}</div>
            </div>
            <!-- eslint-disable vue/no-v-html -- 已经过 DOMPurify 净化 -->
            <div
              v-else-if="item.type === 'assistant'"
              class="chat-msg assistant markdown-body"
              v-html="renderMarkdown(item.text ?? '')"
            />
            <!-- eslint-enable vue/no-v-html -->
            <div v-else-if="item.type === 'notice'" class="chat-notice">{{ item.text }}</div>
            <div v-else class="chat-tool" :class="`risk-${item.risk ?? 'unknown'}`">
              <div class="chat-tool-head">
                <span class="ai-risk-badge" :class="`risk-${item.risk ?? 'unknown'}`">
                  {{ riskLabel(item.risk ?? 'unknown') }}
                </span>
                <span class="chat-tool-purpose">{{ item.purpose || '命令' }}</span>
                <span class="chat-tool-status" :class="toolStatusClass(item)">
                  {{ toolStatusLabel(item) }}
                </span>
              </div>
              <pre class="chat-tool-code">{{ item.command || '（空命令）' }}</pre>
              <p v-if="item.reason" class="chat-tool-reason">{{ item.reason }}</p>
              <p v-if="item.error" class="chat-tool-error">{{ item.error }}</p>
              <div v-if="item.status === 'awaiting-approval'" class="chat-tool-actions">
                <el-button
                  type="primary"
                  size="small"
                  @click="chatStore.approve(item.callId!, true)"
                >
                  执行
                </el-button>
                <el-button size="small" @click="chatStore.approve(item.callId!, false)">
                  跳过
                </el-button>
              </div>
              <div v-else-if="item.result" class="chat-tool-output">
                <button class="chat-output-toggle" @click="item.expanded = !item.expanded">
                  {{
                    item.expanded
                      ? '收起输出'
                      : `查看输出${item.result.truncated ? '（已截断）' : ''}`
                  }}
                </button>
                <pre v-if="item.expanded" class="chat-output">{{ outputText(item) }}</pre>
              </div>
            </div>
          </template>
        </div>
        <div v-else class="ai-hint">
          <p>描述问题或目标，助手会按需执行只读命令收集信息，再给出结论。</p>
          <p class="chat-hint-dim">
            命令通过独立 exec 通道执行，不会写入你的终端；写操作与未知命令会先征求确认。
          </p>
        </div>
        <div v-if="chatStore.error" class="ai-error">{{ chatStore.error }}</div>
      </template>
    </div>

    <div v-if="aiStore.panelTab === 'analysis' && aiStore.configured !== false" class="ai-composer">
      <el-input
        v-model="instruction"
        size="small"
        :disabled="!connectedTab"
        :placeholder="
          connectedTab
            ? '描述要做什么，例如：查看最近一小时 ERROR 日志'
            : '连接服务器后可让 AI 生成命令'
        "
        @keydown="onComposerKeydown"
      />
      <el-button type="primary" size="small" :disabled="!canSend" @click="sendCommand">
        生成
      </el-button>
    </div>

    <div
      v-else-if="aiStore.panelTab === 'assistant' && chatStore.configured !== false"
      class="ai-composer chat-composer"
    >
      <el-input
        v-model="chatInput"
        type="textarea"
        :rows="2"
        resize="none"
        size="small"
        :disabled="!connectedTab"
        :placeholder="
          connectedTab
            ? '描述问题，例如：检查服务是否正常，并定位最近的错误'
            : '连接服务器后可使用助手'
        "
        @keydown="onChatKeydown"
      />
      <div class="chat-composer-actions">
        <el-button
          v-if="chatStore.running"
          size="small"
          :loading="chatStore.stopping"
          @click="chatStore.stop()"
        >
          停止
        </el-button>
        <el-button type="primary" size="small" :disabled="!canChat" @click="sendChat">
          发送
        </el-button>
      </div>
    </div>

    <footer v-if="aiStore.panelTab === 'analysis'" class="ai-footer">
      <span class="ai-readonly">
        {{
          aiStore.kind === 'command-suggestion'
            ? '命令建议 · 只插入不回车'
            : '只读分析 · 不会执行任何命令'
        }}
      </span>
      <div class="ai-actions">
        <el-button v-if="aiStore.running" size="small" @click="aiStore.cancel()">停止</el-button>
        <el-button size="small" :disabled="!aiStore.text" @click="copy">复制</el-button>
      </div>
    </footer>
    <footer v-else class="ai-footer">
      <span class="ai-readonly">
        {{ autoExecuteEnabled ? '只读命令自动执行 · 写操作需确认' : '每条命令执行前需确认' }}
      </span>
      <div class="ai-actions">
        <el-button size="small" :disabled="!chatStore.timeline.length" @click="chatStore.reset()">
          清空
        </el-button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.ai-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--tx-border);
  background: var(--tx-panel);
}
.ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 6px 16px;
}
.ai-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--tx-text);
  font-size: 13px;
  font-weight: 600;
}
.ai-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tx-accent-hover);
  box-shadow: 0 0 10px color-mix(in srgb, var(--tx-accent) 60%, transparent);
}
.ai-scope {
  color: var(--tx-text-3);
  font-size: 11px;
  font-weight: 400;
}
.ai-tabs {
  display: flex;
  gap: 2px;
  padding: 0 12px;
  border-bottom: 1px solid var(--tx-border);
}
.ai-tab {
  flex: 1;
  padding: 7px 0 6px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--tx-text-3);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}
.ai-tab:hover:not(:disabled) {
  color: var(--tx-text-2);
}
.ai-tab.active {
  color: var(--tx-accent-hover);
  border-bottom-color: var(--tx-accent);
  font-weight: 600;
}
.ai-tab:disabled {
  opacity: 0.5;
  cursor: default;
}
.ai-subtitle {
  padding: 8px 16px;
  color: var(--tx-text-3);
  font-size: 11px;
  border-bottom: 1px solid var(--tx-border);
}
.ai-context {
  color: var(--tx-text-3);
}
.ai-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px;
}
.ai-text {
  margin: 0;
  color: var(--tx-text-2);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.7;
  word-break: break-word;
}
.ai-text.with-commands {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--tx-border);
}
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin: 14px 0 6px;
  color: var(--tx-text);
  font-weight: 600;
  line-height: 1.4;
}
.markdown-body :deep(h1) {
  font-size: 15px;
}
.markdown-body :deep(h2) {
  font-size: 14px;
}
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 13px;
}
.markdown-body :deep(p) {
  margin: 0 0 8px;
}
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 8px;
  padding-left: 18px;
}
.markdown-body :deep(li) {
  margin: 2px 0;
}
.markdown-body :deep(li > p) {
  margin: 0;
}
.markdown-body :deep(strong) {
  color: var(--tx-text);
  font-weight: 600;
}
.markdown-body :deep(em) {
  color: var(--tx-text);
}
.markdown-body :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--tx-bg) 70%, var(--tx-panel));
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
}
.markdown-body :deep(pre) {
  margin: 8px 0;
  padding: 10px;
  border-radius: 6px;
  background: var(--tx-bg);
  overflow-x: auto;
}
.markdown-body :deep(pre code) {
  padding: 0;
  background: none;
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre;
}
.markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding: 2px 0 2px 10px;
  border-left: 2px solid var(--tx-border-strong);
  color: var(--tx-text-3);
}
.markdown-body :deep(a) {
  color: var(--tx-accent-hover);
  text-decoration: none;
}
.markdown-body :deep(a:hover) {
  text-decoration: underline;
}
.markdown-body :deep(hr) {
  margin: 10px 0;
  border: 0;
  border-top: 1px solid var(--tx-border);
}
.markdown-body :deep(table) {
  width: 100%;
  margin: 8px 0;
  border-collapse: collapse;
  font-size: 11.5px;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 4px 6px;
  border: 1px solid var(--tx-border);
  text-align: left;
}
.markdown-body :deep(th) {
  color: var(--tx-text);
  background: color-mix(in srgb, var(--tx-bg) 60%, var(--tx-panel));
}
.markdown-body :deep(img) {
  max-width: 100%;
}
.ai-commands {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ai-command-card {
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--tx-border);
  background: color-mix(in srgb, var(--tx-panel) 70%, var(--tx-bg));
}
.ai-command-card.risk-medium {
  border-color: color-mix(in srgb, var(--tx-warning) 45%, transparent);
}
.ai-command-card.risk-high {
  border-color: color-mix(in srgb, var(--tx-danger) 60%, transparent);
  background: color-mix(in srgb, var(--tx-danger) 10%, transparent);
}
.ai-command-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ai-command-note {
  color: var(--tx-text-2);
  font-size: 12px;
  line-height: 1.5;
}
.ai-risk-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--tx-text-3);
  background: var(--tx-fill);
}
.ai-risk-badge.risk-low {
  color: var(--tx-accent);
  background: color-mix(in srgb, var(--tx-accent) 16%, transparent);
}
.ai-risk-badge.risk-medium {
  color: var(--tx-warning);
  background: var(--tx-warning-soft);
}
.ai-risk-badge.risk-high {
  color: var(--tx-danger);
  background: var(--tx-danger-soft);
}
.ai-command-code {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--tx-bg);
  color: var(--tx-text);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}
.ai-local-risk,
.ai-command-warn {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.5;
}
.ai-local-risk {
  color: var(--tx-warning);
}
.ai-command-warn {
  color: var(--tx-text-3);
}
.ai-command-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.ai-hint {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--tx-text-3);
  font-size: 12.5px;
  line-height: 1.7;
}
.ai-hint p {
  margin: 0;
}
.ai-error {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--tx-danger-soft);
  color: var(--tx-danger);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.ai-cancelled {
  margin-top: 10px;
  color: var(--tx-text-3);
  font-size: 11px;
}
.ai-composer {
  display: flex;
  gap: 6px;
  padding: 8px 16px 0;
}
.chat-composer {
  flex-direction: column;
  align-items: stretch;
  padding-bottom: 8px;
}
.chat-composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}
.ai-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--tx-border);
}
.ai-readonly {
  color: var(--tx-text-3);
  font-size: 10.5px;
}
.ai-actions {
  display: flex;
  gap: 6px;
}
.chat-timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chat-msg.user {
  display: flex;
  justify-content: flex-end;
}
.chat-bubble {
  max-width: 92%;
  padding: 8px 10px;
  border-radius: 10px 10px 2px 10px;
  background: color-mix(in srgb, var(--tx-accent) 18%, transparent);
  color: var(--tx-text);
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-msg.assistant {
  color: var(--tx-text-2);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.7;
  word-break: break-word;
}
.chat-msg.assistant :deep(> :first-child) {
  margin-top: 0;
}
.chat-msg.assistant :deep(> :last-child) {
  margin-bottom: 0;
}
.chat-notice {
  padding: 2px 0;
  color: var(--tx-text-3);
  font-size: 11px;
  text-align: center;
}
.chat-tool {
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--tx-border);
  background: color-mix(in srgb, var(--tx-panel) 70%, var(--tx-bg));
}
.chat-tool.risk-medium {
  border-color: color-mix(in srgb, var(--tx-warning) 45%, transparent);
}
.chat-tool.risk-high {
  border-color: color-mix(in srgb, var(--tx-danger) 60%, transparent);
  background: color-mix(in srgb, var(--tx-danger) 10%, transparent);
}
.chat-tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chat-tool-purpose {
  flex: 1;
  color: var(--tx-text-2);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.chat-tool-status {
  flex-shrink: 0;
  color: var(--tx-text-3);
  font-size: 10.5px;
}
.status-success {
  color: var(--tx-accent);
}
.status-warn,
.status-awaiting-approval {
  color: var(--tx-warning);
}
.status-failed,
.status-rejected,
.status-skipped {
  color: var(--tx-danger);
}
.chat-tool-code {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--tx-bg);
  color: var(--tx-text);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}
.chat-tool-reason,
.chat-tool-error {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.5;
}
.chat-tool-reason {
  color: var(--tx-warning);
}
.chat-tool-error {
  color: var(--tx-danger);
  white-space: pre-wrap;
}
.chat-tool-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.chat-output-toggle {
  margin-top: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--tx-accent-hover);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.chat-output {
  max-height: 220px;
  margin: 6px 0 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: 6px;
  background: var(--tx-bg);
  color: var(--tx-text-2);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}
.chat-hint-dim {
  color: var(--tx-text-3);
  font-size: 11.5px;
}
</style>
