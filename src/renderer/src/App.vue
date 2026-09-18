<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Setting } from '@element-plus/icons-vue'
import ConnectionTree from './components/ConnectionTree.vue'
import ConnectionTable from './components/ConnectionTable.vue'
import ConnectionFormDialog from './components/ConnectionFormDialog.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import TerminalView from './components/TerminalView.vue'
import SftpPanel from './components/SftpPanel.vue'
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
const settingsVisible = ref(false)
const epLocale = computed(() => (currentLang() === 'zh-CN' ? zhCn : en))
const sftpVisible = ref(false)
const search = ref('')
const filter = ref<ConnectionFilter>({ kind: 'all' })

function openEdit(id: string): void {
  editingId.value = id
  formVisible.value = true
}

function cloneConnection(id: string): void {
  editingId.value = id
  formVisible.value = true
  ElMessage.info(t('app.loadedForClone'))
}

async function connect(connectionId: string): Promise<void> {
  try {
    const conn = appStore.connections.find((c) => c.id === connectionId)
    await sessionStore.openSession(connectionId, conn?.name)
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

onMounted(() => {
  void appStore.refresh()
  void settingsStore.load()
})
</script>

<template>
  <el-config-provider :locale="epLocale">
    <div class="app-shell">
      <header class="top-bar">
        <div class="proto-tabs">
          <span class="proto-tab active">SSH</span>
        </div>
        <div class="top-search">
          <el-input
            v-model="search"
            :placeholder="t('app.searchPlaceholder')"
            clearable
            :prefix-icon="Search"
          />
        </div>
        <div class="top-actions">
          <el-button type="primary" @click="openEdit('')">{{ t('app.newConnection') }}</el-button>
          <el-button @click="createGroup">{{ t('app.newGroup') }}</el-button>
          <el-button class="gear-btn" text circle @click="settingsVisible = true">
            <el-icon :size="16"><Setting /></el-icon>
          </el-button>
        </div>
      </header>

      <div class="app-body">
        <aside class="sidebar">
          <ConnectionTree
            :filter="filter"
            @change-filter="filter = $event"
            @open-settings="settingsVisible = true"
          />
        </aside>

        <main class="main-area">
          <ConnectionTable
            v-if="sessionStore.tabs.length === 0"
            :search="search"
            :filter="filter"
            @connect="connect"
            @edit="openEdit"
            @clone="cloneConnection"
          />
          <div v-else class="tabs-area">
            <div class="tab-bar">
              <div
                v-for="tab in sessionStore.tabs"
                :key="tab.sessionId"
                class="tab"
                :class="{ active: tab.sessionId === sessionStore.activeSessionId }"
                @click="sessionStore.setActive(tab.sessionId)"
              >
                <span class="tab-dot" :class="`status-${tab.status}`" />
                <span class="tab-title">{{ tab.title }}</span>
                <span class="tab-close" @click.stop="sessionStore.closeSession(tab.sessionId)"
                  >×</span
                >
              </div>
              <button
                class="sftp-toggle"
                :class="{ on: sftpVisible }"
                @click="sftpVisible = !sftpVisible"
              >
                {{ t('app.files') }}
              </button>
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
              <SftpPanel
                v-if="sftpVisible && activeConnectionId"
                :key="activeConnectionId"
                class="sftp-panel"
                :connection-id="activeConnectionId"
              />
            </div>
          </div>
        </main>
      </div>

      <ConnectionFormDialog v-model:visible="formVisible" :connection-id="editingId" />
      <SettingsPanel v-model:visible="settingsVisible" />
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
.top-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  background: var(--tx-nav, #121212);
  border-bottom: 1px solid var(--tx-border);
  flex-shrink: 0;
}
.proto-tabs {
  display: flex;
  gap: 4px;
}
.proto-tab {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--tx-text-3);
  cursor: default;
}
.proto-tab.active {
  background: color-mix(in srgb, var(--tx-green) 14%, transparent);
  color: var(--tx-green-hover);
  font-weight: 600;
}
.top-search {
  width: 300px;
}
.top-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.gear-btn {
  color: var(--tx-text-2);
}
.gear-btn:hover {
  color: var(--tx-green-hover);
}
.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--tx-border);
}
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--tx-bg);
}
.tabs-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tab-bar {
  display: flex;
  background: var(--tx-panel);
  border-bottom: 1px solid var(--tx-border);
  overflow-x: auto;
  flex-shrink: 0;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  border-right: 1px solid var(--tx-border);
  white-space: nowrap;
  color: var(--tx-text-2);
}
.tab:hover {
  background: var(--tx-hover);
}
.tab.active {
  background: var(--tx-bg);
  color: var(--tx-text);
  box-shadow: inset 0 2px 0 var(--tx-green);
}
.tab-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.tab-dot.status-connected {
  background: var(--tx-green);
}
.tab-dot.status-connecting {
  background: #f59e0b;
}
.tab-dot.status-disconnected {
  background: var(--tx-text-3);
}
.tab-dot.status-error {
  background: #f87171;
}
.tab-close {
  color: var(--tx-text-3);
}
.tab-close:hover {
  color: #f87171;
}
.sftp-toggle {
  margin-left: auto;
  padding: 4px 14px;
  border: none;
  background: transparent;
  color: var(--tx-text-2);
  font-size: 13px;
  cursor: pointer;
  border-left: 1px solid var(--tx-border);
  white-space: nowrap;
}
.sftp-toggle:hover {
  background: var(--tx-hover);
}
.sftp-toggle.on {
  color: var(--tx-green-hover);
  font-weight: 600;
}
.tab-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
}
.panel-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.tab-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #1e1e1e;
}
.sftp-panel {
  width: 460px;
  flex-shrink: 0;
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
