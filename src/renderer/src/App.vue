<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Setting } from '@element-plus/icons-vue'
import ConnectionTree from './components/ConnectionTree.vue'
import ConnectionTable from './components/ConnectionTable.vue'
import ConnectionFormDialog from './components/ConnectionFormDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import TerminalView from './components/TerminalView.vue'
import SftpPanel from './components/SftpPanel.vue'
import { useSessionStore } from './stores/sessions'
import { useAppStore } from './stores/app'
import type { ConnectionFilter } from './filter'

const sessionStore = useSessionStore()
const appStore = useAppStore()

const formVisible = ref(false)
const editingId = ref('')
const settingsVisible = ref(false)
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
  ElMessage.info('已载入连接配置，保存为新连接即可完成复制')
}

async function connect(connectionId: string): Promise<void> {
  try {
    const conn = appStore.connections.find((c) => c.id === connectionId)
    await sessionStore.openSession(connectionId, conn?.name)
  } catch (err) {
    ElMessage.error(`连接失败：${String(err)}`)
  }
}

async function createGroup(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('分组名称', '新建分组', {
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空'
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

onMounted(() => appStore.refresh())
</script>

<template>
  <div class="app-shell">
    <header class="top-bar">
      <div class="proto-tabs">
        <span class="proto-tab active">SSH</span>
      </div>
      <div class="top-search">
        <el-input
          v-model="search"
          placeholder="ssh root@** / 搜索"
          clearable
          :prefix-icon="Search"
        />
      </div>
      <div class="top-actions">
        <el-button type="primary" @click="openEdit('')">新建连接</el-button>
        <el-button @click="createGroup">新建分组</el-button>
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
              文件
            </button>
          </div>
          <div class="tab-body">
            <div class="panel-main">
              <template v-for="tab in sessionStore.tabs" :key="tab.sessionId">
                <div v-show="tab.sessionId === sessionStore.activeSessionId" class="tab-panel">
                  <div v-if="tab.status === 'error'" class="state-panel error">
                    <p>连接失败：{{ tab.errorMessage }}</p>
                    <el-button type="primary" @click="sessionStore.reconnect(tab.sessionId)">
                      重新连接
                    </el-button>
                  </div>
                  <div v-else-if="tab.status === 'disconnected'" class="state-panel">
                    <p>连接已断开</p>
                    <el-button type="primary" @click="sessionStore.reconnect(tab.sessionId)">
                      重新连接
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
    <SettingsDialog v-model:visible="settingsVisible" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: #0d0d0d;
}
.top-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  background: #121212;
  border-bottom: 1px solid #1f1f1f;
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
  background: #16241c;
  color: #34d399;
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
  color: #34d399;
}
.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid #1f1f1f;
}
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #0d0d0d;
}
.tabs-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tab-bar {
  display: flex;
  background: #121212;
  border-bottom: 1px solid #1f1f1f;
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
  border-right: 1px solid #1f1f1f;
  white-space: nowrap;
  color: var(--tx-text-2);
}
.tab:hover {
  background: #181818;
}
.tab.active {
  background: #0d0d0d;
  color: var(--tx-text);
  box-shadow: inset 0 2px 0 #10b981;
}
.tab-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.tab-dot.status-connected {
  background: #10b981;
}
.tab-dot.status-connecting {
  background: #f59e0b;
}
.tab-dot.status-disconnected {
  background: #4a4a4a;
}
.tab-dot.status-error {
  background: #f87171;
}
.tab-close {
  color: #4a4a4a;
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
  border-left: 1px solid #1f1f1f;
  white-space: nowrap;
}
.sftp-toggle:hover {
  background: #181818;
}
.sftp-toggle.on {
  color: #34d399;
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
  background: #0d0d0d;
}
.state-panel.error {
  color: #f87171;
}
</style>
