<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder } from '@element-plus/icons-vue'
import { useAppStore } from '../stores/app'

const emit = defineEmits<{
  connect: [connectionId: string]
  editConnection: [connectionId: string]
  cloneConnection: [connectionId: string]
  openSettings: []
}>()

const store = useAppStore()
const search = ref('')

interface TreeNode {
  id: string
  label: string
  type: 'group' | 'connection'
  connectionId?: string
  children?: TreeNode[]
}

const treeData = computed<TreeNode[]>(() => {
  const q = search.value.trim().toLowerCase()
  const match = (s: string): boolean => !q || s.toLowerCase().includes(q)
  const nodes: TreeNode[] = []
  const ungrouped: TreeNode[] = []
  for (const conn of store.connections) {
    const nameOk = match(conn.name) || match(conn.host) || match(conn.username)
    const groupOk = conn.groupId
      ? match(store.groups.find((g) => g.id === conn.groupId)?.name ?? '')
      : false
    if (!nameOk && !groupOk) continue
    const node: TreeNode = {
      id: `c:${conn.id}`,
      label: conn.name,
      type: 'connection',
      connectionId: conn.id
    }
    if (conn.groupId) {
      const group = nodes.find((n) => n.id === `g:${conn.groupId}`)
      if (group) group.children!.push(node)
      else {
        const g = store.groups.find((x) => x.id === conn.groupId)
        nodes.push({
          id: `g:${conn.groupId}`,
          label: g?.name ?? '未分组',
          type: 'group',
          children: [node]
        })
      }
    } else {
      ungrouped.push(node)
    }
  }
  for (const g of store.groups) {
    if (match(g.name) && !nodes.some((n) => n.id === `g:${g.id}`)) {
      nodes.push({ id: `g:${g.id}`, label: g.name, type: 'group', children: [] })
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.label.localeCompare(b.label) : 0))
  return [...nodes, ...ungrouped]
})

// ---- 右键菜单 ----
const menu = reactive({
  visible: false,
  x: 0,
  y: 0,
  nodeId: '',
  label: '',
  nodeType: '' as 'group' | 'connection'
})
function onContextMenu(e: MouseEvent, node: TreeNode): void {
  menu.visible = true
  menu.x = e.clientX
  menu.y = e.clientY
  menu.nodeId = node.id
  menu.label = node.label
  menu.nodeType = node.type
}
function hideMenu(): void {
  menu.visible = false
}
window.addEventListener('click', hideMenu)

async function createGroup(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('分组名称', '新建分组', {
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空'
    })
    await store.createGroup(value)
  } catch {
    /* 用户取消 */
  }
}

async function deleteGroup(): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除分组「${menu.label}」？组内连接将移至未分组。`, '删除确认', {
      type: 'warning'
    })
    await store.deleteGroup(menu.nodeId.slice(2))
    ElMessage.success('分组已删除')
  } catch {
    /* 取消或失败 */
  }
}

async function renameGroup(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('新的分组名称', '重命名分组', {
      inputValue: menu.label,
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空'
    })
    await window.api.updateGroup(menu.nodeId.slice(2), value)
    await store.refresh()
  } catch {
    /* 取消 */
  }
}

async function deleteConnection(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm('删除该连接？其保存的凭据将一并清除。', '删除确认', {
      type: 'warning'
    })
    await store.deleteConnection(id)
    ElMessage.success('连接已删除')
  } catch {
    /* 取消 */
  }
}

onMounted(() => store.refresh())
</script>

<template>
  <div class="connection-tree">
    <div class="tree-toolbar">
      <el-input v-model="search" placeholder="搜索连接" size="small" clearable />
      <div class="tree-actions">
        <el-button size="small" type="primary" @click="emit('editConnection', '')">
          新建连接
        </el-button>
        <el-button size="small" @click="createGroup">新建分组</el-button>
      </div>
    </div>
    <el-tree
      class="tree"
      :data="treeData"
      node-key="id"
      :props="{ label: 'label', children: 'children' }"
      :default-expand-all="true"
      :expand-on-click-node="false"
      highlight-current
    >
      <template #default="{ data }">
        <span
          class="tree-node"
          :class="{ 'is-conn': data.type === 'connection' }"
          @contextmenu.prevent="onContextMenu($event, data)"
          @dblclick="data.type === 'connection' && emit('connect', data.connectionId)"
        >
          <el-icon v-if="data.type === 'group'" class="node-icon">
            <Folder />
          </el-icon>
          <template v-else>
            <span
              class="status-dot"
              :class="{
                online: store.connections.find((c) => c.id === data.connectionId)?.online
              }"
            />
            <span
              class="color-tag"
              :style="{
                background:
                  store.connections.find((c) => c.id === data.connectionId)?.color ?? '#409eff'
              }"
            />
          </template>
          <span class="node-label">{{ data.label }}</span>
        </span>
      </template>
    </el-tree>

    <div class="tree-footer">
      <el-button size="small" text @click="emit('openSettings')">设置</el-button>
    </div>

    <div
      v-if="menu.visible"
      class="context-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <template v-if="menu.nodeType === 'connection'">
        <div class="menu-item" @click="emit('editConnection', menu.nodeId.slice(2))">编辑</div>
        <div class="menu-item" @click="emit('cloneConnection', menu.nodeId.slice(2))">复制</div>
        <div class="menu-item danger" @click="deleteConnection(menu.nodeId.slice(2))">删除</div>
      </template>
      <template v-else>
        <div class="menu-item" @click="renameGroup">重命名</div>
        <div class="menu-item danger" @click="deleteGroup">删除分组</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.connection-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f7f8fa;
}
.tree-toolbar {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid #e4e7ed;
}
.tree-actions {
  display: flex;
  gap: 6px;
}
.tree {
  flex: 1;
  overflow: auto;
  background: transparent;
  --el-tree-node-hover-bg-color: #eceff3;
}
.tree-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.node-icon {
  color: #a0a4ab;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0c4cc;
  flex-shrink: 0;
}
.status-dot.online {
  background: #67c23a;
}
.color-tag {
  width: 4px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
}
.node-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-footer {
  padding: 6px 8px;
  border-top: 1px solid #e4e7ed;
}
.context-menu {
  position: fixed;
  z-index: 3000;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  min-width: 110px;
}
.menu-item {
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.menu-item:hover {
  background: #f2f3f5;
}
.menu-item.danger {
  color: #f56c6c;
}
</style>
