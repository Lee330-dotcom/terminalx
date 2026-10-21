<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight, Folder, Setting } from '@element-plus/icons-vue'
import { useAppStore } from '../stores/app'
import { useSessionStore } from '../stores/sessions'
import { t } from '../i18n'
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

// 树节点展开状态
const expandedGroups = reactive<Record<string, boolean>>({
  favorite: false,
  recent: false,
  frequent: false
})

function toggleGroup(key: string): void {
  expandedGroups[key] = !expandedGroups[key]
}

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
    const { value } = await ElMessageBox.prompt(t('tree.newGroupName'), t('tree.renameGroup'), {
      inputValue: menu.label,
      inputPattern: /\S+/,
      inputErrorMessage: t('common.nameNotEmpty')
    })
    await window.api.updateGroup(menu.groupId, value)
    await store.refresh()
  } catch {
    /* 取消 */
  }
}

async function deleteGroup(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('tree.deleteGroupConfirm', { name: menu.label }),
      t('common.confirmDelete'),
      {
        type: 'warning'
      }
    )
    await store.deleteGroup(menu.groupId)
    ElMessage.success(t('tree.groupDeleted'))
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
    <!-- 全部 -->
    <div
      class="tree-item"
      :class="{ active: isActive({ kind: 'all' }) }"
      @click="emit('changeFilter', { kind: 'all' })"
    >
      <span class="tree-label">{{ t('tree.all') }}</span>
      <span class="tree-count">{{ store.connections.length }}</span>
      <el-icon class="tree-settings" @click.stop="emit('openSettings')"><Setting /></el-icon>
    </div>

    <!-- 收藏 -->
    <div class="tree-group">
      <div class="tree-item group-header" @click="toggleGroup('favorite')">
        <el-icon class="tree-arrow" :class="{ expanded: expandedGroups.favorite }">
          <ArrowRight />
        </el-icon>
        <el-icon class="tree-icon"><Folder /></el-icon>
        <span class="tree-label">{{ t('tree.favorite') }}</span>
        <span class="tree-count">{{ favoriteCount }}</span>
      </div>
      <div v-show="expandedGroups.favorite" class="tree-children">
        <div
          v-for="c in store.connections.filter((x) => x.favorite)"
          :key="c.id"
          class="tree-item child-item"
          @click="emit('changeFilter', { kind: 'favorite' })"
        >
          <span class="tree-label">{{ c.name }}</span>
        </div>
      </div>
    </div>

    <!-- 最近 -->
    <div class="tree-group">
      <div class="tree-item group-header" @click="toggleGroup('recent')">
        <el-icon class="tree-arrow" :class="{ expanded: expandedGroups.recent }">
          <ArrowRight />
        </el-icon>
        <el-icon class="tree-icon"><Folder /></el-icon>
        <span class="tree-label">{{ t('tree.recent') }}</span>
        <span class="tree-count">{{ recentIds.length }}</span>
      </div>
      <div v-show="expandedGroups.recent" class="tree-children">
        <div
          v-for="id in recentIds"
          :key="id"
          class="tree-item child-item"
          @click="emit('changeFilter', { kind: 'recent' })"
        >
          <span class="tree-label">{{
            store.connections.find((c) => c.id === id)?.name ?? id
          }}</span>
        </div>
      </div>
    </div>

    <!-- 常用 -->
    <div class="tree-group">
      <div class="tree-item group-header" @click="toggleGroup('frequent')">
        <el-icon class="tree-arrow" :class="{ expanded: expandedGroups.frequent }">
          <ArrowRight />
        </el-icon>
        <el-icon class="tree-icon"><Folder /></el-icon>
        <span class="tree-label">{{ t('tree.frequent') }}</span>
        <span class="tree-count">{{ frequentIds.length }}</span>
      </div>
      <div v-show="expandedGroups.frequent" class="tree-children">
        <div
          v-for="id in frequentIds"
          :key="id"
          class="tree-item child-item"
          @click="emit('changeFilter', { kind: 'frequent' })"
        >
          <span class="tree-label">{{
            store.connections.find((c) => c.id === id)?.name ?? id
          }}</span>
        </div>
      </div>
    </div>

    <!-- 自定义分组 -->
    <div v-if="store.groups.length > 0" class="tree-divider" />
    <div
      v-for="g in store.groups"
      :key="g.id"
      class="tree-item"
      :class="{ active: isActive({ kind: 'group', groupId: g.id }) }"
      @click="emit('changeFilter', { kind: 'group', groupId: g.id })"
      @contextmenu.prevent="onGroupContextMenu($event, g.id, g.name)"
    >
      <el-icon class="tree-icon"><Folder /></el-icon>
      <span class="tree-label">{{ g.name }}</span>
      <span class="tree-count">{{
        store.connections.filter((c) => c.groupId === g.id).length
      }}</span>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="menu.visible"
      class="context-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <div class="menu-item" @click="renameGroup">{{ t('common.rename') }}</div>
      <div class="menu-item danger" @click="deleteGroup">{{ t('tree.deleteGroupTitle') }}</div>
    </div>
  </div>
</template>

<style scoped>
.side-nav {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--tx-panel);
  overflow-y: auto;
  padding: 8px;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 6px 9px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--tx-text-2);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.tree-item:hover {
  background: var(--tx-hover);
  color: var(--tx-text);
}
.tree-item.active {
  background: color-mix(in srgb, var(--tx-green) 16%, transparent);
  color: var(--tx-green-hover);
  box-shadow: inset 2px 0 0 var(--tx-green);
}

.group-header {
  margin-top: 3px;
  color: var(--tx-text);
  font-weight: 550;
}

.tree-arrow {
  font-size: 12px;
  transition: transform 0.2s;
  color: var(--tx-text-3);
}
.tree-arrow.expanded {
  transform: rotate(90deg);
}

.tree-icon {
  font-size: 14px;
  color: var(--tx-text-3);
  flex-shrink: 0;
}
.tree-item.active .tree-icon {
  color: var(--tx-green-hover);
}

.tree-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-count {
  font-size: 11px;
  color: var(--tx-text-3);
  background: var(--tx-fill);
  padding: 0 6px;
  border-radius: 8px;
  min-width: 18px;
  text-align: center;
}
.tree-item.active .tree-count {
  background: color-mix(in srgb, var(--tx-green) 22%, transparent);
  color: var(--tx-green-hover);
}

.tree-settings {
  font-size: 13px;
  color: var(--tx-text-3);
  cursor: pointer;
}
.tree-settings:hover {
  color: var(--tx-green-hover);
}

.tree-children {
  margin-left: 7px;
  padding-left: 13px;
  border-left: 1px solid var(--tx-border);
}
.child-item {
  min-height: 29px;
  padding: 5px 9px;
  font-size: 12px;
}

.tree-divider {
  height: 1px;
  background: var(--tx-border);
  margin: 8px 12px;
}

.context-menu {
  position: fixed;
  z-index: 3000;
  background: var(--tx-card);
  border: 1px solid var(--tx-border);
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
  background: var(--tx-hover);
}
.menu-item.danger {
  color: #f87171;
}
</style>
