<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown,
  ArrowUp,
  Close,
  Connection,
  Folder,
  FolderAdd,
  FolderOpened,
  MagicStick,
  Monitor,
  Plus,
  Refresh,
  Search,
  Setting,
  Upload
} from '@element-plus/icons-vue'
import ConnectionTree from './components/ConnectionTree.vue'
import ConnectionTable from './components/ConnectionTable.vue'
import ConnectionFormDialog from './components/ConnectionFormDialog.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import SftpPanel from './components/SftpPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import AiPanel from './components/AiPanel.vue'
import ImportDialog from './components/ImportDialog.vue'
import HostKeyDialog from './components/HostKeyDialog.vue'
import WorkspaceGrid from './components/workspace/WorkspaceGrid.vue'
import { useWorkspaceStore, PaneState } from './stores/workspace'
import { useAiStore } from './stores/ai'
import { useAiChatStore } from './stores/aiChat'
import { useAppStore } from './stores/app'
import { useSettingsStore } from './stores/settings'
import { useHostKeyStore } from './stores/hostKeys'
import { t, currentLang } from './i18n'
import { MAX_PANES_PER_TAB } from './workspace/splitTree'
import {
  getTerminalSearch,
  resetTerminalSearchResult,
  terminalSearchResult
} from './utils/terminalSearch'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import type { ConnectionFilter } from './filter'

const workspaceStore = useWorkspaceStore()
const hostKeyStore = useHostKeyStore()
const appStore = useAppStore()
const settingsStore = useSettingsStore()
const aiStore = useAiStore()
const aiChatStore = useAiChatStore()

const formVisible = ref(false)
const editingId = ref('')
const cloneFromId = ref('')
const settingsVisible = ref(false)
const importVisible = ref(false)
const epLocale = computed(() => (currentLang() === 'zh-CN' ? zhCn : en))
const sftpVisible = ref(true)
const search = ref('')
const filter = ref<ConnectionFilter>({ kind: 'all' })
const connectionCenterVisible = ref(false)
const sidebarCollapsed = ref(false)
const cmdPaletteVisible = ref(false)
const sftpWidth = ref(320)
let resizingSftp = false
const aiWidth = ref(380)
let resizingAi = false
let aiResizeStartX = 0
let aiResizeStartWidth = 0

const terminalSearchQuery = ref('')
const terminalSearchLabel = computed(() => {
  if (!terminalSearchQuery.value.trim()) return ''
  const { index, total } = terminalSearchResult
  return total ? `${index >= 0 ? index + 1 : '?'}/${total}` : '0/0'
})

function startSftpResize(event: MouseEvent): void {
  event.preventDefault()
  resizingSftp = true
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', resizeSftp)
  window.addEventListener('mouseup', stopSftpResize)
}

function resizeSftp(event: MouseEvent): void {
  if (resizingSftp) sftpWidth.value = Math.min(560, Math.max(240, event.clientX))
}

function stopSftpResize(): void {
  resizingSftp = false
  document.body.style.cursor = ''
  window.removeEventListener('mousemove', resizeSftp)
  window.removeEventListener('mouseup', stopSftpResize)
}

function startAiResize(event: MouseEvent): void {
  event.preventDefault()
  resizingAi = true
  aiResizeStartX = event.clientX
  aiResizeStartWidth = aiWidth.value
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', resizeAi)
  window.addEventListener('mouseup', stopAiResize)
}

function resizeAi(event: MouseEvent): void {
  if (!resizingAi) return
  const max = Math.max(320, Math.min(760, window.innerWidth - 400))
  const next = aiResizeStartWidth + aiResizeStartX - event.clientX
  aiWidth.value = Math.min(max, Math.max(320, next))
}

function stopAiResize(): void {
  resizingAi = false
  document.body.style.cursor = ''
  window.removeEventListener('mousemove', resizeAi)
  window.removeEventListener('mouseup', stopAiResize)
}

function openEdit(id: string): void {
  editingId.value = id
  cloneFromId.value = ''
  formVisible.value = true
}

function cloneConnection(id: string): void {
  // 复制进入表单时只读取源连接配置，保存必须走 createConnection。
  editingId.value = ''
  cloneFromId.value = id
  formVisible.value = true
  ElMessage.info(t('app.loadedForClone'))
}

async function connect(connectionId: string): Promise<void> {
  try {
    const conn = appStore.connections.find((c) => c.id === connectionId)
    await workspaceStore.openConnection(connectionId, conn?.name)
    connectionCenterVisible.value = false
  } catch (err) {
    ElMessage.error(t('app.connectFailed', { err: String(err) }))
  }
}

async function createGroup(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(t('app.groupName'), t('app.newGroupTitle'), {
      inputPattern: /\S+/,
      inputErrorMessage: t('common.nameNotEmpty')
    })
    await appStore.createGroup(value)
  } catch {
    /* 用户取消 */
  }
}

const activeConnectionId = computed(() => workspaceStore.activeConnectionId)
const focusedPane = computed(() => workspaceStore.focusedPane)

function newTab(): void {
  workspaceStore.createTab(t('ws.newTab'))
  connectionCenterVisible.value = false
}

function onGlobalKeydown(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    cmdPaletteVisible.value = !cmdPaletteVisible.value
  }
  if (mod && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    openEdit('')
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('.title-search input')?.focus()
  }
  if (mod && e.key.toLowerCase() === 't' && !e.shiftKey) {
    e.preventDefault()
    newTab()
  }
  if (mod && e.key.toLowerCase() === 'w') {
    const pane = focusedPane.value
    if (pane) {
      e.preventDefault()
      void workspaceStore.closePane(pane.id)
    }
  }
  if (mod && e.key.toLowerCase() === 'd') {
    const pane = focusedPane.value
    if (!pane) return
    e.preventDefault()
    // ⌘D 左右分屏，⇧⌘D 上下分屏
    const ok = workspaceStore.splitPane(pane.id, e.shiftKey ? 'y' : 'x')
    if (!ok) ElMessage.warning(t('ws.paneLimit', { n: MAX_PANES_PER_TAB }))
  }
  if (mod && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault()
    workspaceStore.cycleFocus(e.key === 'ArrowRight' ? 1 : -1)
  }
  if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    const index = Number(e.key) - 1
    const tab = workspaceStore.tabs[index]
    if (tab) {
      e.preventDefault()
      workspaceStore.setActiveTab(tab.id)
    }
  }
  if (e.key === 'Escape') {
    cmdPaletteVisible.value = false
    connectionCenterVisible.value = false
  }
}

function sendCommand(command: string): void {
  const sessionId = workspaceStore.activeSessionId
  if (sessionId) {
    window.api.sendInput(sessionId, new TextEncoder().encode(command))
  }
}

function summarizeSession(pane: PaneState): void {
  void aiStore.run({
    kind: 'session-summary',
    title: pane.title,
    scope: '最近 300 行',
    sessionId: pane.sessionId ?? undefined,
    connectionId: pane.connectionId ?? undefined
  })
}

function toggleAiPanel(): void {
  aiStore.visible = !aiStore.visible
  if (!aiStore.visible) return
  void aiStore.refreshStatus()
  void aiChatStore.refreshStatus()
  if (focusedPane.value?.status !== 'connected') aiStore.panelTab = 'analysis'
}

function activeTerminalSearch(): ReturnType<typeof getTerminalSearch> {
  const pane = focusedPane.value
  if (!pane?.sessionId || pane.status !== 'connected') return undefined
  return getTerminalSearch(pane.sessionId)
}

function runTerminalSearch(incremental: boolean): void {
  const api = activeTerminalSearch()
  const query = terminalSearchQuery.value.trim()
  if (!api || !query) {
    api?.clear()
    resetTerminalSearchResult()
    return
  }
  api.findNext(query, incremental)
}

function stepTerminalSearch(delta: number): void {
  const api = activeTerminalSearch()
  const query = terminalSearchQuery.value.trim()
  if (!api || !query) return
  if (delta > 0) api.findNext(query, false)
  else api.findPrevious(query)
}

function clearTerminalSearch(): void {
  activeTerminalSearch()?.clear()
  terminalSearchQuery.value = ''
  resetTerminalSearchResult()
}

function onTerminalSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    clearTerminalSearch()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    stepTerminalSearch(event.shiftKey ? -1 : 1)
  }
}

watch(terminalSearchQuery, () => runTerminalSearch(true))

watch(
  () => workspaceStore.activeSessionId,
  async (nextId, prevId) => {
    if (prevId && prevId !== nextId) getTerminalSearch(prevId)?.clear()
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    if (terminalSearchQuery.value.trim()) runTerminalSearch(true)
    else resetTerminalSearchResult()
  }
)

watch(
  () => focusedPane.value?.status,
  async (status) => {
    if (status !== 'connected') {
      resetTerminalSearchResult()
      return
    }
    // 重连或终端重新挂载完成后，SearchAddon 才可用；等一帧再按当前关键字重新搜索
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    if (terminalSearchQuery.value.trim()) runTerminalSearch(true)
  }
)

watch(
  () => ({
    id: workspaceStore.activeSessionId,
    status: focusedPane.value?.status ?? null
  }),
  (next, prev) => {
    const prevId = prev?.id ?? null
    if (prevId !== next.id) {
      aiChatStore.handleActiveSessionChange(prevId, next.id)
      return
    }
    if (next.id && prev?.status === 'connected' && next.status !== 'connected') {
      aiChatStore.handleDisconnect(next.id)
    }
  },
  { immediate: true }
)

onMounted(() => {
  void appStore.refresh()
  void settingsStore.load()
  void aiStore.refreshStatus()
  aiChatStore.ensureListeners()
  workspaceStore.ensureStatusListener()
  hostKeyStore.ensurePromptListener()
  document.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  stopSftpResize()
  document.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <el-config-provider :locale="epLocale">
    <div class="app-shell">
      <!-- macOS 风格标题栏 -->
      <header class="title-bar">
        <div class="title-bar-left">
          <div class="brand" aria-label="terminalX">
            <span class="brand-mark">›_</span>
            <span class="brand-name">terminal<span class="brand-x">X</span></span>
          </div>
          <div class="view-switcher">
            <button
              class="view-switch"
              :class="{ active: workspaceStore.tabs.length === 0 || connectionCenterVisible }"
              @click="connectionCenterVisible = true"
            >
              <el-icon><Connection /></el-icon> 连接
            </button>
            <button
              class="view-switch"
              :class="{ active: workspaceStore.tabs.length > 0 && !connectionCenterVisible }"
              :disabled="workspaceStore.tabs.length === 0"
              @click="connectionCenterVisible = false"
            >
              <el-icon><Monitor /></el-icon> 会话
              <span v-if="workspaceStore.tabs.length" class="view-count">{{
                workspaceStore.tabs.length
              }}</span>
            </button>
          </div>
        </div>
        <div class="title-bar-center">
          <el-input
            v-model="search"
            placeholder="搜索连接..."
            clearable
            size="small"
            :prefix-icon="Search"
            class="title-search"
          />
        </div>
        <div class="title-bar-right">
          <el-button text size="small" @click="cmdPaletteVisible = true">
            <span class="cmd-hint">⌘K</span>
            命令面板
          </el-button>
          <el-button text circle size="small" @click="appStore.refresh()">
            <el-icon><Refresh /></el-icon>
          </el-button>
          <el-button text size="small" @click="importVisible = true">
            <el-icon><Upload /></el-icon>
            导入
          </el-button>
          <el-button class="new-connection" type="primary" size="small" @click="openEdit('')">
            <el-icon><Plus /></el-icon>
            新建连接
          </el-button>
          <el-tooltip content="AI 助手（分析 + 受控执行）" placement="bottom">
            <el-button class="gear-btn ai-entry-btn" text size="small" @click="toggleAiPanel">
              <el-icon :size="15"><MagicStick /></el-icon>
              <span class="ai-entry-label">AI</span>
            </el-button>
          </el-tooltip>
          <el-button class="gear-btn settings-entry-btn" text circle @click="settingsVisible = true">
            <el-icon :size="16"><Setting /></el-icon>
          </el-button>
        </div>
      </header>

      <div class="app-body">
        <!-- 未连接时显示连接树侧栏 -->
        <aside v-if="workspaceStore.tabs.length === 0 && sidebarCollapsed" class="sidebar-rail">
          <el-tooltip content="展开连接列表" placement="right">
            <el-button text circle @click="sidebarCollapsed = false"
              ><el-icon><FolderOpened /></el-icon
            ></el-button>
          </el-tooltip>
        </aside>
        <aside v-if="workspaceStore.tabs.length === 0 && !sidebarCollapsed" class="sidebar">
          <div class="sidebar-header">
            <div>
              <p class="sidebar-eyebrow">CONNECTIONS</p>
              <strong>我的连接</strong>
            </div>
            <div class="sidebar-actions">
              <el-tooltip content="新建分组" placement="bottom">
                <el-button text circle size="small" @click="createGroup"
                  ><el-icon><FolderAdd /></el-icon
                ></el-button>
              </el-tooltip>
              <el-tooltip content="收起侧栏" placement="bottom">
                <el-button text circle size="small" @click="sidebarCollapsed = true"
                  ><el-icon><Folder /></el-icon
                ></el-button>
              </el-tooltip>
            </div>
          </div>
          <ConnectionTree
            :filter="filter"
            @change-filter="filter = $event"
            @open-settings="settingsVisible = true"
          />
        </aside>

        <!-- 连接后左侧显示文件工作区 -->
        <div
          v-if="
            workspaceStore.tabs.length > 0 &&
            sftpVisible &&
            activeConnectionId &&
            focusedPane?.status === 'connected'
          "
          class="sftp-sidebar"
          :style="{ width: `${sftpWidth}px` }"
        >
          <div class="sub-tab-bar">
            <span class="sub-tab active">
              文件工作区
              <span class="sub-tab-close" @click.stop="sftpVisible = false">×</span>
            </span>
          </div>
          <SftpPanel :key="activeConnectionId" :connection-id="activeConnectionId" />
        </div>
        <div
          v-if="
            workspaceStore.tabs.length > 0 &&
            sftpVisible &&
            activeConnectionId &&
            focusedPane?.status === 'connected'
          "
          class="sftp-resizer"
          @mousedown="startSftpResize"
        />

        <main class="main-area">
          <section
            v-if="workspaceStore.tabs.length === 0 || connectionCenterVisible"
            class="connection-center"
          >
            <div class="workspace-toolbar">
              <div>
                <p class="workspace-eyebrow">CONNECTION CENTER</p>
                <h1>
                  连接管理 <span>{{ appStore.connections.length }}</span>
                </h1>
              </div>
              <div class="workspace-toolbar-actions">
                <span class="shortcut-hint">⌘⇧F 搜索</span>
                <el-button text size="small" @click="appStore.refresh()"
                  ><el-icon><Refresh /></el-icon> 刷新</el-button
                >
              </div>
            </div>
            <ConnectionTable
              :search="search"
              :filter="filter"
              @connect="connect"
              @edit="openEdit"
              @clone="cloneConnection"
            />
          </section>
          <div
            v-show="workspaceStore.tabs.length > 0 && !connectionCenterVisible"
            class="tabs-area"
            :class="{ 'terminal-only': !connectionCenterVisible }"
            :style="{ height: connectionCenterVisible ? '60%' : '100%' }"
          >
            <div class="tab-bar">
              <div
                v-for="tab in workspaceStore.tabs"
                :key="tab.id"
                class="tab"
                :class="{ active: tab.id === workspaceStore.activeTabId }"
                @click="workspaceStore.setActiveTab(tab.id)"
              >
                <span class="tab-title">{{ tab.title }}</span>
                <span v-if="workspaceStore.tabPanes(tab.id).length > 1" class="tab-pane-count">
                  {{ workspaceStore.tabPanes(tab.id).length }}
                </span>
                <span class="tab-close" @click.stop="workspaceStore.closeTab(tab.id)">×</span>
              </div>
              <button class="tab-add" :title="t('ws.newTab')" @click="newTab">
                <el-icon><Plus /></el-icon>
              </button>
              <div class="tab-actions">
                <div
                  v-if="focusedPane?.status === 'connected'"
                  class="terminal-search"
                  :title="t('ws.searchCurrent')"
                >
                  <el-icon class="terminal-search-icon"><Search /></el-icon>
                  <input
                    v-model="terminalSearchQuery"
                    class="terminal-search-input"
                    type="text"
                    spellcheck="false"
                    :placeholder="t('ws.searchPlaceholder')"
                    :aria-label="t('ws.searchCurrent')"
                    @keydown="onTerminalSearchKeydown"
                  />
                  <span v-if="terminalSearchLabel" class="terminal-search-count">
                    {{ terminalSearchLabel }}
                  </span>
                  <button
                    class="terminal-search-btn"
                    :title="t('ws.searchPrev')"
                    :aria-label="t('ws.searchPrev')"
                    :disabled="!terminalSearchResult.total"
                    @mousedown.prevent
                    @click="stepTerminalSearch(-1)"
                  >
                    <el-icon><ArrowUp /></el-icon>
                  </button>
                  <button
                    class="terminal-search-btn"
                    :title="t('ws.searchNext')"
                    :aria-label="t('ws.searchNext')"
                    :disabled="!terminalSearchResult.total"
                    @mousedown.prevent
                    @click="stepTerminalSearch(1)"
                  >
                    <el-icon><ArrowDown /></el-icon>
                  </button>
                  <button
                    class="terminal-search-btn"
                    :title="t('ws.searchClear')"
                    :aria-label="t('ws.searchClear')"
                    :disabled="!terminalSearchQuery"
                    @mousedown.prevent
                    @click="clearTerminalSearch"
                  >
                    <el-icon><Close /></el-icon>
                  </button>
                </div>
                <el-tooltip
                  v-if="focusedPane?.status === 'connected'"
                  placement="bottom"
                  :content="t('ws.aiSummaryDesc')"
                >
                  <span
                    class="sub-tab ai-summary-btn"
                    @click="focusedPane && summarizeSession(focusedPane)"
                  >
                    ✦ {{ t('ws.aiSummary') }}
                  </span>
                </el-tooltip>
                <span
                  v-if="!sftpVisible && activeConnectionId"
                  class="sub-tab sftp-show-btn"
                  @click="sftpVisible = true"
                >
                  <el-icon><Folder /></el-icon>
                  文件
                </span>
              </div>
            </div>
            <div class="tab-body">
              <div class="panel-main">
                <div
                  v-for="tab in workspaceStore.tabs"
                  :key="tab.id"
                  v-show="tab.id === workspaceStore.activeTabId"
                  class="tab-panel"
                >
                  <WorkspaceGrid :tab-id="tab.id" />
                </div>
              </div>
            </div>
          </div>
        </main>

        <div v-if="aiStore.visible" class="ai-resizer" @mousedown="startAiResize" />
        <AiPanel
          v-if="aiStore.visible"
          :width="aiWidth"
          @close="aiStore.hide()"
          @open-settings="settingsVisible = true"
        />
      </div>

      <ConnectionFormDialog
        v-model:visible="formVisible"
        :connection-id="editingId"
        :clone-from-id="cloneFromId"
      />
      <SettingsPanel v-model:visible="settingsVisible" />
      <ImportDialog v-model:visible="importVisible" @imported="appStore.refresh()" />
      <HostKeyDialog />
      <CommandPalette
        :visible="cmdPaletteVisible"
        :session-id="workspaceStore.activeSessionId ?? ''"
        @close="cmdPaletteVisible = false"
        @send="sendCommand"
      />
    </div>
  </el-config-provider>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--tx-bg);
}

/* macOS 风格标题栏 */
.title-bar {
  display: flex;
  align-items: center;
  padding: 0 18px;
  background: color-mix(in srgb, var(--tx-nav) 92%, var(--tx-border-strong));
  border-bottom: 1px solid var(--tx-border);
  flex-shrink: 0;
  height: 56px;
  -webkit-app-region: drag;
  gap: 20px;
}
.title-bar-left,
.title-bar-center,
.title-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}
.title-bar-left {
  padding-left: 72px;
  gap: 20px;
}
.title-bar-center {
  flex: 1;
  max-width: 460px;
}
.title-bar-right {
  margin-left: auto;
}
.title-search {
  width: 100%;
}
.title-search :deep(.el-input__wrapper) {
  background: color-mix(in srgb, var(--tx-bg) 78%, transparent);
  border: 1px solid var(--tx-border);
  border-radius: 7px;
  box-shadow: none;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;
}
.title-search :deep(.el-input__wrapper.is-focus) {
  background: var(--tx-bg);
  border-color: var(--tx-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tx-accent) 14%, transparent);
}
.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  letter-spacing: -0.03em;
  white-space: nowrap;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border-radius: 7px;
  color: var(--tx-on-accent);
  background: var(--tx-accent-hover);
  font:
    700 13px/1 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  box-shadow: 0 0 18px color-mix(in srgb, var(--tx-accent) 28%, transparent);
}
.brand-name {
  color: var(--tx-text);
  font-size: 15px;
  font-weight: 650;
}
.brand-name span {
  color: var(--tx-accent-hover);
}
.brand-x {
  font-weight: 800;
}
.view-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--tx-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--tx-bg) 60%, transparent);
}
.view-switch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--tx-text-3);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.view-switch:hover:not(:disabled) {
  color: var(--tx-text);
  background: var(--tx-hover);
}
.view-switch.active {
  color: var(--tx-text);
  background: var(--tx-fill);
}
.view-switch:disabled {
  cursor: default;
  opacity: 0.55;
}
.view-count {
  display: inline-grid;
  place-items: center;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--tx-accent) 24%, transparent);
  color: var(--tx-accent-hover);
  font-size: 10px;
}
.new-connection :deep(.el-icon) {
  margin-right: 3px;
}
.cmd-hint {
  padding: 1px 5px;
  border: 1px solid var(--tx-border-strong);
  border-radius: 4px;
  color: var(--tx-text-3);
  font:
    10px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.gear-btn {
  color: var(--tx-text-2);
}
.gear-btn:hover {
  color: var(--tx-accent-hover);
}
.ai-entry-btn {
  gap: 4px;
}
.ai-entry-label {
  color: var(--tx-accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

/* 主体布局 */
.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 246px;
  flex-shrink: 0;
  border-right: 1px solid var(--tx-border);
  background: var(--tx-panel);
  display: flex;
  flex-direction: column;
}
.sidebar-rail {
  display: flex;
  width: 40px;
  padding-top: 12px;
  justify-content: center;
  border-right: 1px solid var(--tx-border);
  background: var(--tx-panel);
}
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 17px 12px 11px 16px;
  border-bottom: 1px solid var(--tx-border);
}
.sidebar-eyebrow,
.workspace-eyebrow {
  margin-bottom: 4px;
  color: var(--tx-text-3);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
}
.sidebar-header strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--tx-text);
}
.sidebar-actions {
  display: flex;
  gap: 2px;
}
.sidebar :deep(.side-nav) {
  flex: 1;
  min-height: 0;
}
.connection-center {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.workspace-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 6px;
}
.workspace-toolbar h1 {
  color: var(--tx-text);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.workspace-toolbar h1 span {
  margin-left: 5px;
  color: var(--tx-text-3);
  font-size: 13px;
  font-weight: 500;
}
.workspace-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.shortcut-hint {
  color: var(--tx-text-3);
  font-size: 11px;
}
.connection-center :deep(.conn-table-wrap) {
  flex: 1;
  max-height: none;
  min-height: 0;
}
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--tx-bg);
}
.main-area :deep(.conn-table-wrap) {
  overflow-y: auto;
}
.tabs-area {
  display: flex;
  flex-direction: column;
  flex: 0 1 60%;
  min-height: 100px;
  margin-top: auto;
  background: var(--tx-card);
}
.tabs-area.terminal-only {
  flex: 1 1 auto;
  height: auto !important;
  min-height: 0;
}
.tab-bar {
  display: flex;
  min-height: 42px;
  background: var(--tx-nav);
  border-bottom: 1px solid var(--tx-border);
  overflow-x: auto;
  flex-shrink: 0;
  padding: 0 10px;
  gap: 2px;
}
.tab-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}
.sftp-sidebar {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--tx-border);
  background: var(--tx-bg);
  min-height: 0;
  overflow: hidden;
}
.sftp-resizer {
  width: 6px;
  flex: 0 0 6px;
  cursor: col-resize;
  background: transparent;
  z-index: 4;
  transition: background 0.15s ease;
}
.sftp-resizer:hover,
.sftp-resizer:active {
  background: color-mix(in srgb, var(--tx-accent) 55%, transparent);
}
.ai-resizer {
  width: 6px;
  flex: 0 0 6px;
  cursor: col-resize;
  background: transparent;
  z-index: 4;
  transition: background 0.15s ease;
}
.ai-resizer:hover,
.ai-resizer:active {
  background: color-mix(in srgb, var(--tx-accent) 55%, transparent);
}
.sftp-sidebar :deep(.sftp-panel) {
  border-left: none;
  flex: 1;
}
.sub-tab-bar {
  display: flex;
  align-items: center;
  background: var(--tx-nav);
  border-bottom: 1px solid var(--tx-border);
  padding: 0 8px;
  gap: 2px;
  flex-shrink: 0;
}
.sub-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 12px;
  cursor: pointer;
  color: var(--tx-text-3);
  border-radius: 6px 6px 0 0;
  transition: all 0.2s;
}
.sub-tab:hover {
  background: var(--tx-hover);
  color: var(--tx-text-2);
}
.sub-tab.active {
  background: var(--tx-bg);
  color: var(--tx-text);
  font-weight: 500;
}
.sub-tab-close {
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 3px;
}
.sub-tab-close:hover {
  color: var(--tx-danger);
  background: var(--tx-danger-soft);
}
.tab-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.terminal-search {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  margin-right: 6px;
  padding: 0 4px 0 7px;
  border: 1px solid var(--tx-border);
  border-radius: 6px;
  background: var(--tx-bg);
  transition: border-color 0.15s ease;
}
.terminal-search:focus-within {
  border-color: var(--tx-accent);
}
.terminal-search-icon {
  flex-shrink: 0;
  color: var(--tx-text-3);
  font-size: 12px;
}
.terminal-search-input {
  width: 140px;
  min-width: 0;
  height: 22px;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--tx-text);
  font: inherit;
  font-size: 12px;
}
.terminal-search-input::placeholder {
  color: var(--tx-text-3);
}
.terminal-search-count {
  flex-shrink: 0;
  min-width: 30px;
  color: var(--tx-text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.terminal-search-btn {
  flex-shrink: 0;
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
  font-size: 11px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.terminal-search-btn:hover:not(:disabled) {
  color: var(--tx-text);
  background: color-mix(in srgb, var(--tx-text-3) 16%, transparent);
}
.terminal-search-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.sftp-show-btn,
.ai-summary-btn {
  color: var(--tx-accent-hover);
}
.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--tx-text-3);
  background: transparent;
  border-radius: 6px;
  margin: 4px 0;
  transition: all 0.2s;
  min-width: 120px;
  justify-content: center;
}
.tab:hover {
  background: var(--tx-hover);
  color: var(--tx-text-2);
}
.tab.active {
  background: var(--tx-fill);
  color: var(--tx-text);
  font-weight: 500;
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--tx-text) 8%, transparent);
}
.tab-pane-count {
  display: inline-grid;
  place-items: center;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--tx-accent) 24%, transparent);
  color: var(--tx-accent-hover);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin: auto 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--tx-text-3);
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;
}
.tab-add:hover {
  background: var(--tx-hover);
  color: var(--tx-text);
}
.tab-close {
  color: var(--tx-text-3);
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 4px;
}
.tab-close:hover {
  color: var(--tx-danger);
  background: var(--tx-danger-soft);
}
.panel-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.tab-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  background: var(--tx-card);
}
.terminal-connecting {
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
.tab-panel :deep(.terminal-container) {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}
.state-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--tx-text-2);
  background: var(--tx-bg);
}
.state-panel.error {
  color: var(--tx-danger);
}
.state-panel-actions {
  display: flex;
  gap: 8px;
}
</style>
