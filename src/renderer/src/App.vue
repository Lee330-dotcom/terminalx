<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import ConnectionTree from './components/ConnectionTree.vue'
import ConnectionFormDialog from './components/ConnectionFormDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import TerminalView from './components/TerminalView.vue'
import { useSessionStore } from './stores/sessions'
import { useAppStore } from './stores/app'

const sessionStore = useSessionStore()
const appStore = useAppStore()

const formVisible = ref(false)
const editingId = ref('')
const settingsVisible = ref(false)

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
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <ConnectionTree
        @connect="connect"
        @edit-connection="openEdit"
        @clone-connection="cloneConnection"
        @open-settings="settingsVisible = true"
      />
    </aside>
    <main class="main-area">
      <div v-if="sessionStore.tabs.length === 0" class="empty-state">
        <p>双击左侧连接，或右键新建连接开始使用</p>
      </div>
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
            <span class="tab-close" @click.stop="sessionStore.closeSession(tab.sessionId)">×</span>
          </div>
        </div>
        <div class="tab-body">
          <template v-for="tab in sessionStore.tabs" :key="tab.sessionId">
            <div
              v-show="tab.sessionId === sessionStore.activeSessionId"
              class="tab-panel"
            >
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
      </div>
    </main>

    <ConnectionFormDialog v-model:visible="formVisible" :connection-id="editingId" />
    <SettingsDialog v-model:visible="settingsVisible" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.sidebar {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid #e4e7ed;
}
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  min-width: 0;
}
.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
}
.tabs-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tab-bar {
  display: flex;
  background: #f0f1f3;
  border-bottom: 1px solid #e4e7ed;
  overflow-x: auto;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  border-right: 1px solid #e4e7ed;
  white-space: nowrap;
}
.tab.active {
  background: #fff;
}
.tab-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.tab-dot.status-connected {
  background: #67c23a;
}
.tab-dot.status-connecting {
  background: #e6a23c;
}
.tab-dot.status-disconnected {
  background: #c0c4cc;
}
.tab-dot.status-error {
  background: #f56c6c;
}
.tab-close {
  color: #909399;
}
.tab-close:hover {
  color: #f56c6c;
}
.tab-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tab-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #1e1e1e;
}
.state-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #909399;
  background: #fff;
}
.state-panel.error {
  color: #f56c6c;
}
</style>
