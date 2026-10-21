<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Connection,
  Folder,
  FolderAdd,
  FolderOpened,
  Monitor,
  Plus,
  Refresh,
  Search,
  Setting
} from '@element-plus/icons-vue'
import ConnectionTree from './components/ConnectionTree.vue'
import ConnectionTable from './components/ConnectionTable.vue'
import ConnectionFormDialog from './components/ConnectionFormDialog.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import TerminalView from './components/TerminalView.vue'
import SftpPanel from './components/SftpPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import { useSessionStore } from './stores/sessions'
import { useAppStore } from './stores/app'
import { useSettingsStore } from './stores/settings'
import { t, currentLang } from './i18n'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import type { ConnectionFilter } from './filter'

const sessionStore = useSessionStore()
const appStore = useAppStore()
const settingsStore = useSettingsStore()

const formVisible = ref(false)
const editingId = ref('')
const cloneFromId = ref('')
const settingsVisible = ref(false)
const epLocale = computed(() => (currentLang() === 'zh-CN' ? zhCn : en))
const sftpVisible = ref(true)
const search = ref('')
const filter = ref<ConnectionFilter>({ kind: 'all' })
const connectionCenterVisible = ref(false)
const sidebarCollapsed = ref(false)
const cmdPaletteVisible = ref(false)
const sftpWidth = ref(320)
let resizingSftp = false

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
    await sessionStore.openSession(connectionId, conn?.name)
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

const activeConnectionId = computed(() => {
  const tab = sessionStore.tabs.find((t) => t.sessionId === sessionStore.activeSessionId)
  return tab?.connectionId ?? null
})
const activeTab = computed(() => sessionStore.activeTab)

function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    cmdPaletteVisible.value = !cmdPaletteVisible.value
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    openEdit('')
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('.title-search input')?.focus()
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w' && sessionStore.activeSessionId) {
    e.preventDefault()
    void sessionStore.closeSession(sessionStore.activeSessionId)
  }
  if (e.key === 'Escape') {
    cmdPaletteVisible.value = false
    connectionCenterVisible.value = false
  }
}

function sendCommand(command: string): void {
  if (sessionStore.activeSessionId) {
    window.api.sendInput(sessionStore.activeSessionId, new TextEncoder().encode(command))
  }
}

onMounted(() => {
  void appStore.refresh()
  void settingsStore.load()
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
          <div class="brand" aria-label="TerminalX">
            <span class="brand-mark">›_</span>
            <span class="brand-name">terminal<span>x</span></span>
          </div>
          <div class="view-switcher">
            <button
              class="view-switch"
              :class="{ active: sessionStore.tabs.length === 0 || connectionCenterVisible }"
              @click="connectionCenterVisible = true"
            >
              <el-icon><Connection /></el-icon> 连接
            </button>
            <button
              class="view-switch"
              :class="{ active: sessionStore.tabs.length > 0 && !connectionCenterVisible }"
              :disabled="sessionStore.tabs.length === 0"
              @click="connectionCenterVisible = false"
            >
              <el-icon><Monitor /></el-icon> 会话
              <span v-if="sessionStore.tabs.length" class="view-count">{{
                sessionStore.tabs.length
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
          <el-button class="new-connection" type="primary" size="small" @click="openEdit('')">
            <el-icon><Plus /></el-icon>
            新建连接
          </el-button>
          <el-button class="gear-btn" text circle @click="settingsVisible = true">
            <el-icon :size="16"><Setting /></el-icon>
          </el-button>
        </div>
      </header>

      <div class="app-body">
        <!-- 未连接时显示连接树侧栏 -->
        <aside v-if="sessionStore.tabs.length === 0 && sidebarCollapsed" class="sidebar-rail">
          <el-tooltip content="展开连接列表" placement="right">
            <el-button text circle @click="sidebarCollapsed = false"
              ><el-icon><FolderOpened /></el-icon
            ></el-button>
          </el-tooltip>
        </aside>
        <aside v-if="sessionStore.tabs.length === 0 && !sidebarCollapsed" class="sidebar">
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
            sessionStore.tabs.length > 0 &&
            sftpVisible &&
            activeConnectionId &&
            activeTab?.status === 'connected'
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
            sessionStore.tabs.length > 0 &&
            sftpVisible &&
            activeConnectionId &&
            activeTab?.status === 'connected'
          "
          class="sftp-resizer"
          @mousedown="startSftpResize"
        />

        <main class="main-area">
          <section
            v-if="sessionStore.tabs.length === 0 || connectionCenterVisible"
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
            v-show="sessionStore.tabs.length > 0 && !connectionCenterVisible"
            class="tabs-area"
            :class="{ 'terminal-only': !connectionCenterVisible }"
            :style="{ height: connectionCenterVisible ? '60%' : '100%' }"
          >
            <div class="tab-bar">
              <div
                v-for="tab in sessionStore.tabs"
                :key="tab.sessionId"
                class="tab"
                :class="{ active: tab.sessionId === sessionStore.activeSessionId }"
                @click="sessionStore.setActive(tab.sessionId)"
              >
                <span class="tab-title">{{ tab.title }}</span>
                <span class="tab-close" @click.stop="sessionStore.closeSession(tab.sessionId)"
                  >×</span
                >
              </div>
              <span
                v-if="!sftpVisible && activeConnectionId"
                class="sub-tab sftp-show-btn"
                @click="sftpVisible = true"
              >
                + 文件
              </span>
            </div>
            <div class="tab-body">
              <div class="panel-main">
                <template v-for="tab in sessionStore.tabs" :key="tab.sessionId">
                  <div v-show="tab.sessionId === sessionStore.activeSessionId" class="tab-panel">
                    <div v-if="tab.status === 'error'" class="state-panel error">
                      <p>{{ t('app.connectFailed', { err: tab.errorMessage }) }}</p>
                      <el-button type="primary" @click="sessionStore.reconnect(tab.sessionId)">
                        {{ t('app.reconnect') }}
                      </el-button>
                    </div>
                    <div v-else-if="tab.status === 'disconnected'" class="state-panel">
                      <p>{{ t('app.disconnected') }}</p>
                      <el-button type="primary" @click="sessionStore.reconnect(tab.sessionId)">
                        {{ t('app.reconnect') }}
                      </el-button>
                    </div>
                    <TerminalView v-else :session-id="tab.sessionId" />
                  </div>
                </template>
              </div>
            </div>
          </div>
        </main>
      </div>

      <ConnectionFormDialog
        v-model:visible="formVisible"
        :connection-id="editingId"
        :clone-from-id="cloneFromId"
      />
      <SettingsPanel v-model:visible="settingsVisible" />
      <CommandPalette
        :visible="cmdPaletteVisible"
        :session-id="sessionStore.activeSessionId ?? ''"
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
  background: color-mix(in srgb, var(--tx-nav) 92%, #303030);
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
  border-color: var(--tx-green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tx-green) 14%, transparent);
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
  color: #07140f;
  background: var(--tx-green-hover);
  font:
    700 13px/1 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  box-shadow: 0 0 18px color-mix(in srgb, var(--tx-green) 28%, transparent);
}
.brand-name {
  color: var(--tx-text);
  font-size: 15px;
  font-weight: 650;
}
.brand-name span {
  color: var(--tx-green-hover);
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
  background: color-mix(in srgb, var(--tx-green) 24%, transparent);
  color: var(--tx-green-hover);
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
  color: var(--tx-green-hover);
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
  background: #14161f;
}
.tabs-area.terminal-only {
  flex: 1 1 auto;
  height: auto !important;
  min-height: 0;
}
.tab-bar {
  display: flex;
  min-height: 42px;
  background: var(--tx-nav, #1a1a1a);
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
  background: color-mix(in srgb, var(--tx-green) 55%, transparent);
}
.sftp-sidebar :deep(.sftp-panel) {
  border-left: none;
  flex: 1;
}
.sub-tab-bar {
  display: flex;
  align-items: center;
  background: var(--tx-nav, #1a1a1a);
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
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
}
.sftp-show-btn {
  margin-left: auto;
  color: var(--tx-green-hover);
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
.tab-close {
  color: var(--tx-text-3);
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 4px;
}
.tab-close:hover {
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
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
  background: #14161f;
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
  color: #f87171;
}
</style>
