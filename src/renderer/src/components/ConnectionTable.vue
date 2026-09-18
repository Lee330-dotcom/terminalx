<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DocumentCopy, Star, StarFilled } from '@element-plus/icons-vue'
import { useAppStore } from '../stores/app'
import { useSessionStore } from '../stores/sessions'
import type { ConnectionFilter } from '../filter'
import type { ConnectionWithStatus } from '@shared/types'

const props = defineProps<{
  search: string
  filter: ConnectionFilter
}>()

const emit = defineEmits<{
  connect: [id: string]
  edit: [id: string]
  clone: [id: string]
}>()

const store = useAppStore()
const sessionStore = useSessionStore()

const selected = ref<string[]>([])
const expanded = ref<string[]>([])

const groupName = (id: string | null): string =>
  id ? (store.groups.find((g) => g.id === id)?.name ?? '') : ''

const rows = computed<ConnectionWithStatus[]>(() => {
  const q = props.search.trim().toLowerCase()
  const f = props.filter
  let list = store.connections
  if (f.kind === 'favorite') {
    list = list.filter((c) => c.favorite)
  } else if (f.kind === 'recent') {
    const ids = new Set(sessionStore.recentIds)
    list = list.filter((c) => ids.has(c.id))
  } else if (f.kind === 'frequent') {
    const ids = new Set(sessionStore.frequentIds)
    list = list.filter((c) => ids.has(c.id))
  } else if (f.kind === 'group') {
    const gid = f.groupId
    list = list.filter((c) => c.groupId === gid)
  }
  if (q) {
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q) ||
        groupName(c.groupId).toLowerCase().includes(q)
    )
  }
  return list
})

const allChecked = computed(
  () => rows.value.length > 0 && rows.value.every((r) => selected.value.includes(r.id))
)

function toggleAll(): void {
  selected.value = allChecked.value ? [] : rows.value.map((r) => r.id)
}

function toggleExpanded(id: string): void {
  const i = expanded.value.indexOf(id)
  if (i >= 0) expanded.value.splice(i, 1)
  else expanded.value.push(id)
}

async function toggleFavorite(id: string): Promise<void> {
  try {
    await store.toggleFavorite(id)
  } catch (err) {
    ElMessage.error(`操作失败：${String(err)}`)
  }
}

async function copyHost(host: string): Promise<void> {
  await navigator.clipboard.writeText(host)
  ElMessage.success('地址已复制')
}

function onRowCommand(c: ConnectionWithStatus, cmd: string): void {
  if (cmd === 'clone') emit('clone', c.id)
  else if (cmd === 'delete') void deleteOne(c.id)
}

async function deleteOne(id: string): Promise<void> {
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

async function batchDelete(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除选中的 ${selected.value.length} 个连接？其保存的凭据将一并清除。`,
      '删除确认',
      { type: 'warning' }
    )
    for (const id of selected.value) {
      await store.deleteConnection(id)
    }
    selected.value = []
    ElMessage.success('已删除')
  } catch {
    /* 取消 */
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

let probeTimer: number | undefined
onMounted(() => {
  void store.refreshProbes()
  probeTimer = window.setInterval(() => void store.refreshProbes(), 15000)
})
onUnmounted(() => window.clearInterval(probeTimer))
watch(
  () => store.connections.map((c) => c.id).join(','),
  () => void store.refreshProbes()
)
</script>

<template>
  <div class="conn-table-wrap">
    <div v-if="selected.length > 0" class="batch-bar">
      <span class="batch-count">已选 {{ selected.length }} 项</span>
      <el-button size="small" type="danger" plain @click="batchDelete">删除</el-button>
      <el-button size="small" text @click="selected = []">取消</el-button>
    </div>

    <div v-if="rows.length > 0" class="conn-table">
      <div class="row head">
        <span class="col-check">
          <el-checkbox :model-value="allChecked" @change="toggleAll" />
        </span>
        <span class="col-star" />
        <span class="col-os" />
        <span class="col-latency">延迟</span>
        <span class="col-name">名称</span>
        <span class="col-addr">地址</span>
        <span class="col-info">信息</span>
        <span class="col-actions">操作</span>
      </div>

      <template v-for="c in rows" :key="c.id">
        <div
          class="row"
          :class="{ expanded: expanded.includes(c.id) }"
          @dblclick="emit('connect', c.id)"
        >
          <span class="col-check">
            <el-checkbox v-model="selected" :value="c.id" @click.stop />
          </span>
          <span class="col-star" @click.stop="toggleFavorite(c.id)">
            <el-icon v-if="c.favorite" class="star filled"><StarFilled /></el-icon>
            <el-icon v-else class="star"><Star /></el-icon>
          </span>
          <span class="col-os">
            <svg class="os-icon" viewBox="0 0 24 24" width="17" height="17" aria-label="Linux">
              <path
                d="M12 2.5c-2.6 0-4.5 2-4.5 4.6v1.7C5.6 9.6 4.4 11.3 4.4 13.3c0 1.8 1.2 3.3 2.9 3.7l.2 3.6c0 .5.4.9 1 .9s1-.4 1-1v-2.6h5v2.6c0 .5.4 1 1 1s1-.4 1-1v-3.5c1.7-.4 2.9-1.9 2.9-3.7 0-2-1.2-3.7-3.1-4.5V7.1C16.5 4.5 14.6 2.5 12 2.5z"
                fill="#3a3a3a"
              />
              <ellipse cx="12" cy="12.4" rx="3.6" ry="4.4" fill="#dcdcdc" />
              <path
                d="M10.3 8.6l1.7 1.5 1.7-1.5"
                fill="none"
                stroke="#f59e0b"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="col-latency">
            <template v-if="store.probes[c.id] != null">
              <span class="latency-ok">{{ store.probes[c.id] }} ms</span>
            </template>
            <span v-else-if="store.probes[c.id] === null" class="latency-bad">超时</span>
            <span v-else class="latency-pending">…</span>
          </span>
          <span class="col-name">
            <span class="color-tag" :style="{ background: c.color }" />
            <span class="conn-name">{{ c.name }}</span>
          </span>
          <span class="col-addr">
            <span class="addr-text">{{ c.host }}</span>
            <el-icon class="copy-icon" @click.stop="copyHost(c.host)"><DocumentCopy /></el-icon>
          </span>
          <span class="col-info">
            <el-switch
              size="small"
              :model-value="expanded.includes(c.id)"
              @change="toggleExpanded(c.id)"
            />
          </span>
          <span class="col-actions">
            <el-button size="small" type="primary" @click.stop="emit('connect', c.id)">
              连接
            </el-button>
            <el-button size="small" text @click.stop="emit('edit', c.id)">编辑</el-button>
            <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(c, cmd)">
              <span class="more-btn" @click.stop>更多 ▾</span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="clone">复制</el-dropdown-item>
                  <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </span>
        </div>

        <div v-if="expanded.includes(c.id)" class="row detail">
          <span class="detail-inner">
            <span class="detail-item">用户：{{ c.username }}</span>
            <span class="detail-item">端口：{{ c.port }}</span>
            <span class="detail-item">分组：{{ c.groupId ? groupName(c.groupId) : '未分组' }}</span>
            <span class="detail-item">认证：{{ c.authType === 'password' ? '密码' : '私钥' }}</span>
            <span v-if="c.remark" class="detail-item">备注：{{ c.remark }}</span>
            <span class="detail-item">创建：{{ formatTime(c.createdAt) }}</span>
            <span v-if="sessionStore.usage[c.id]" class="detail-item">
              使用 {{ sessionStore.usage[c.id].count }} 次 · 最近
              {{ formatTime(sessionStore.usage[c.id].lastAt) }}
            </span>
          </span>
        </div>
      </template>
    </div>

    <div v-else class="table-empty">
      <p>{{ store.connections.length === 0 ? '暂无连接' : '没有匹配的连接' }}</p>
      <el-button v-if="store.connections.length === 0" type="primary" @click="emit('edit', '')">
        新建连接
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.conn-table-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px;
}
.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: #16241c;
  border: 1px solid #1f3d2e;
  border-radius: 8px;
}
.batch-count {
  color: #34d399;
  font-size: 13px;
}
.conn-table {
  flex: 1;
  overflow: auto;
  background: #121212;
  border: 1px solid #232323;
  border-radius: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-bottom: 1px solid #1d1d1d;
  font-size: 13px;
}
.row:hover {
  background: #181818;
}
.row.expanded {
  background: #161616;
}
.row.head {
  position: sticky;
  top: 0;
  background: #171717;
  color: var(--tx-text-3);
  font-size: 12px;
  z-index: 1;
}
.row.head:hover {
  background: #171717;
}
.col-check {
  width: 22px;
  flex-shrink: 0;
}
.col-star {
  width: 20px;
  flex-shrink: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.star {
  color: #4a4a4a;
  font-size: 15px;
}
.star.filled {
  color: #f5c518;
}
.col-os {
  width: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.os-icon {
  display: block;
}
.col-latency {
  width: 60px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.latency-ok {
  color: #34d399;
}
.latency-bad {
  color: #f87171;
}
.latency-pending {
  color: var(--tx-text-3);
}
.col-name {
  flex: 1;
  min-width: 130px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.color-tag {
  width: 4px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
}
.conn-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-addr {
  flex: 0 1 150px;
  min-width: 100px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--tx-text-2);
  font-variant-numeric: tabular-nums;
}
.addr-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-icon {
  cursor: pointer;
  color: #4a4a4a;
  font-size: 13px;
  flex-shrink: 0;
}
.copy-icon:hover {
  color: #34d399;
}
.col-info {
  width: 46px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}
.col-actions {
  width: 196px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0;
}
.more-btn {
  color: var(--tx-text-2);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
.more-btn:hover {
  color: #34d399;
  background: #1f1f1f;
}
.row.detail {
  background: #141414;
  padding-top: 2px;
  padding-bottom: 8px;
}
.detail-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  padding-left: 150px;
  color: var(--tx-text-2);
  font-size: 12px;
}
.table-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--tx-text-3);
}
</style>
