<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Collection, Clock, Folder, Star, TrendCharts } from '@element-plus/icons-vue'
import { useAppStore } from '../stores/app'
import { useSessionStore } from '../stores/sessions'
import type { ConnectionFilter } from '../filter'

const props = defineProps<{
  filter: ConnectionFilter
}>()

const emit = defineEmits<{
  changeFilter: [filter: ConnectionFilter]
  openSettings: []
}>()

const store = useAppStore()
const sessionStore = useSessionStore()

const favoriteCount = computed(() => store.connections.filter((c) => c.favorite).length)
const recentIds = computed(() => sessionStore.recentIds.slice(0, 7))
const frequentIds = computed(() => sessionStore.frequentIds.slice(0, 7))

function isActive(f: ConnectionFilter): boolean {
  return (
    props.filter.kind === f.kind &&
    (props.filter.kind !== 'group' || f.kind !== 'group' || props.filter.groupId === f.groupId)
  )
}

// ---- 分组右键菜单 ----
const menu = reactive({
  visible: false,
  x: 0,
  y: 0,
  groupId: '',
  label: ''
})
function onGroupContextMenu(e: MouseEvent, id: string, name: string): void {
  menu.visible = true
  menu.x = e.clientX
  menu.y = e.clientY
  menu.groupId = id
  menu.label = name
}
function hideMenu(): void {
  menu.visible = false
}
window.addEventListener('click', hideMenu)

async function renameGroup(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('新的分组名称', '重命名分组', {
      inputValue: menu.label,
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空'
    })
    await window.api.updateGroup(menu.groupId, value)
    await store.refresh()
  } catch {
    /* 取消 */
  }
}

async function deleteGroup(): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除分组「${menu.label}」？组内连接将移至未分组。`, '删除确认', {
      type: 'warning'
    })
    await store.deleteGroup(menu.groupId)
    ElMessage.success('分组已删除')
    if (props.filter.kind === 'group' && props.filter.groupId === menu.groupId) {
      emit('changeFilter', { kind: 'all' })
    }
  } catch {
    /* 取消或失败 */
  }
}

onMounted(() => store.refresh())
</script>

<template>
  <div class="side-nav">
    <div class="nav-section all-section">
      <div
        class="nav-item"
        :class="{ active: isActive({ kind: 'all' }) }"
        @click="emit('changeFilter', { kind: 'all' })"
      >
        <span class="nav-label">全部</span>
        <span class="nav-count">{{ store.connections.length }}</span>
      </div>
      <div class="nav-children">
        <div
          class="nav-item"
          :class="{ active: isActive({ kind: 'favorite' }) }"
          @click="emit('changeFilter', { kind: 'favorite' })"
        >
          <el-icon class="nav-icon star"><Star /></el-icon>
          <span class="nav-label">收藏</span>
          <span class="nav-count">{{ favoriteCount }}</span>
        </div>
        <div
          class="nav-item"
          :class="{ active: isActive({ kind: 'recent' }) }"
          @click="emit('changeFilter', { kind: 'recent' })"
        >
          <el-icon class="nav-icon"><Clock /></el-icon>
          <span class="nav-label">最近</span>
          <span class="nav-count">{{ recentIds.length }}</span>
        </div>
        <div
          class="nav-item"
          :class="{ active: isActive({ kind: 'frequent' }) }"
          @click="emit('changeFilter', { kind: 'frequent' })"
        >
          <el-icon class="nav-icon"><TrendCharts /></el-icon>
          <span class="nav-label">常用</span>
          <span class="nav-count">{{ frequentIds.length }}</span>
        </div>
      </div>
    </div>

    <div class="nav-section">
      <div class="nav-caption">
        <el-icon class="nav-icon"><Collection /></el-icon>
        <span>分组</span>
      </div>
      <div
        v-for="g in store.groups"
        :key="g.id"
        class="nav-item"
        :class="{ active: isActive({ kind: 'group', groupId: g.id }) }"
        @click="emit('changeFilter', { kind: 'group', groupId: g.id })"
        @contextmenu.prevent="onGroupContextMenu($event, g.id, g.name)"
      >
        <el-icon class="nav-icon"><Folder /></el-icon>
        <span class="nav-label">{{ g.name }}</span>
        <span class="nav-count">{{
          store.connections.filter((c) => c.groupId === g.id).length
        }}</span>
      </div>
      <div v-if="store.groups.length === 0" class="nav-hint">暂无分组</div>
    </div>

    <div class="nav-footer">
      <span class="footer-btn" @click="emit('openSettings')">设置</span>
    </div>

    <div
      v-if="menu.visible"
      class="context-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <div class="menu-item" @click="renameGroup">重命名</div>
      <div class="menu-item danger" @click="deleteGroup">删除分组</div>
    </div>
  </div>
</template>

<style scoped>
.side-nav {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #111;
  overflow: hidden;
}
.nav-section {
  padding: 8px;
  border-bottom: 1px solid #1d1d1d;
  overflow-y: auto;
}
.all-section {
  flex-shrink: 0;
  overflow: visible;
}
.nav-section:not(.all-section) {
  flex: 1;
  min-height: 0;
}
.nav-caption {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 6px;
  font-size: 12px;
  color: var(--tx-text-3);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--tx-text-2);
  cursor: pointer;
  white-space: nowrap;
}
.nav-item:hover {
  background: #1a1a1a;
  color: var(--tx-text);
}
.nav-item.active {
  background: #16241c;
  color: #34d399;
}
.nav-children {
  padding-left: 12px;
}
.nav-icon {
  font-size: 14px;
  color: #555;
  flex-shrink: 0;
}
.nav-item.active .nav-icon {
  color: #34d399;
}
.nav-icon.star {
  color: #f5c518;
}
.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nav-count {
  font-size: 11px;
  color: var(--tx-text-3);
  background: #1d1d1d;
  padding: 0 7px;
  border-radius: 8px;
}
.nav-item.active .nav-count {
  background: #1f3d2e;
  color: #34d399;
}
.nav-hint {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--tx-text-3);
}
.nav-footer {
  flex-shrink: 0;
  padding: 8px;
  border-top: 1px solid #1d1d1d;
}
.footer-btn {
  display: block;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--tx-text-2);
  cursor: pointer;
}
.footer-btn:hover {
  background: #1a1a1a;
  color: var(--tx-text);
}
.context-menu {
  position: fixed;
  z-index: 3000;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  padding: 4px 0;
  min-width: 110px;
}
.menu-item {
  padding: 7px 14px;
  font-size: 13px;
  color: var(--tx-text);
  cursor: pointer;
}
.menu-item:hover {
  background: #262626;
}
.menu-item.danger {
  color: #f87171;
}
</style>
