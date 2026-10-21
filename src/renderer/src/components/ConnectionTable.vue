<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Clock, DocumentCopy, MoreFilled, Star, StarFilled } from '@element-plus/icons-vue'
import { useAppStore } from '../stores/app'
import { useSessionStore } from '../stores/sessions'
import type { ConnectionFilter } from '../filter'
import { t } from '../i18n'
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
const sortKey = ref<'latency' | 'name' | 'address' | null>(null)
const sortAsc = ref(true)

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
  // 排序
  if (sortKey.value) {
    const key = sortKey.value
    const asc = sortAsc.value
    list = [...list].sort((a, b) => {
      let va: number | string = 0
      let vb: number | string = 0
      if (key === 'latency') {
        va = store.probes[a.id] ?? 9999
        vb = store.probes[b.id] ?? 9999
      } else if (key === 'name') {
        va = a.name.toLowerCase()
        vb = b.name.toLowerCase()
      } else if (key === 'address') {
        va = a.host.toLowerCase()
        vb = b.host.toLowerCase()
      }
      if (va < vb) return asc ? -1 : 1
      if (va > vb) return asc ? 1 : -1
      return 0
    })
  }
  return list
})

function toggleSort(key: 'latency' | 'name' | 'address'): void {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    sortAsc.value = true
  }
}

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
    ElMessage.error(t('app.opFailed', { err: String(err) }))
  }
}

async function copyHost(host: string): Promise<void> {
  await navigator.clipboard.writeText(host)
  ElMessage.success(t('table.addressCopied'))
}

function onRowCommand(c: ConnectionWithStatus, cmd: string): void {
  if (cmd === 'clone') emit('clone', c.id)
  else if (cmd === 'delete') void deleteOne(c.id)
}

async function deleteOne(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm(t('table.deleteOneConfirm'), t('common.confirmDelete'), {
      type: 'warning'
    })
    await store.deleteConnection(id)
    ElMessage.success(t('table.connectionDeleted'))
  } catch {
    /* 取消 */
  }
}

async function batchDelete(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('table.deleteManyConfirm', { n: selected.value.length }),
      t('common.confirmDelete'),
      { type: 'warning' }
    )
    for (const id of selected.value) {
      await store.deleteConnection(id)
    }
    selected.value = []
    ElMessage.success(t('table.deleted'))
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
      <span class="batch-count">{{ t('table.selected', { n: selected.length }) }}</span>
      <el-button size="small" type="danger" plain @click="batchDelete">{{
        t('common.delete')
      }}</el-button>
      <el-button size="small" text @click="selected = []">{{ t('common.cancel') }}</el-button>
    </div>

    <div v-if="rows.length > 0" class="conn-table">
      <div class="row head">
        <span class="col-check">
          <el-checkbox :model-value="allChecked" @change="toggleAll" />
        </span>
        <span class="col-drag" />
        <span class="col-star" aria-hidden="true" />
        <span class="col-os">{{ t('table.os') }}</span>
        <span class="col-latency sortable" @click="toggleSort('latency')">
          {{ t('table.latency') }}
          <span v-if="sortKey === 'latency'" class="sort-indicator">{{ sortAsc ? '↑' : '↓' }}</span>
        </span>
        <span class="col-name sortable" @click="toggleSort('name')">
          {{ t('table.name') }}
          <span v-if="sortKey === 'name'" class="sort-indicator">{{ sortAsc ? '↑' : '↓' }}</span>
        </span>
        <span class="col-addr sortable" @click="toggleSort('address')">
          {{ t('table.address') }}
          <span v-if="sortKey === 'address'" class="sort-indicator">{{ sortAsc ? '↑' : '↓' }}</span>
        </span>
        <span class="col-info">{{ t('table.info') }}</span>
        <span class="col-spacer" />
        <span class="col-actions">
          {{ t('table.actions') }}
        </span>
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
          <span class="col-drag" />
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
              <el-icon class="latency-icon"><Clock /></el-icon>
              <span class="latency-ok">{{ store.probes[c.id] }} ms</span>
            </template>
            <span v-else-if="store.probes[c.id] === null" class="latency-bad">{{
              t('table.timeout')
            }}</span>
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
          <span class="col-spacer" />
          <span class="col-actions">
            <el-button size="small" type="success" @click.stop="emit('connect', c.id)">
              {{ t('common.connect') }}
            </el-button>
            <el-button size="small" text @click.stop="emit('edit', c.id)">{{
              t('common.edit')
            }}</el-button>
            <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(c, cmd)">
              <span class="more-btn" @click.stop>
                {{ t('table.more') }}
                <el-icon><MoreFilled /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="clone">{{ t('common.copy') }}</el-dropdown-item>
                  <el-dropdown-item command="delete" divided>{{
                    t('common.delete')
                  }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </span>
        </div>

        <div v-if="expanded.includes(c.id)" class="row detail">
          <span class="detail-inner">
            <span class="detail-item">{{ t('table.user', { v: c.username }) }}</span>
            <span class="detail-item">{{ t('table.port', { v: c.port }) }}</span>
            <span class="detail-item">{{
              t('table.group', { v: c.groupId ? groupName(c.groupId) : t('table.ungrouped') })
            }}</span>
            <span class="detail-item">{{
              t('table.auth', {
                v: c.authType === 'password' ? t('table.authPassword') : t('table.authKey')
              })
            }}</span>
            <span v-if="c.remark" class="detail-item">{{
              t('table.remark', { v: c.remark })
            }}</span>
            <span class="detail-item">{{
              t('table.createdAt', { v: formatTime(c.createdAt) })
            }}</span>
            <span v-if="sessionStore.usage[c.id]" class="detail-item">
              {{
                t('table.usage', {
                  count: sessionStore.usage[c.id].count,
                  time: formatTime(sessionStore.usage[c.id].lastAt)
                })
              }}
            </span>
          </span>
        </div>
      </template>
    </div>

    <div v-else class="table-empty">
      <p>{{ store.connections.length === 0 ? t('table.noConnections') : t('table.noMatch') }}</p>
      <el-button v-if="store.connections.length === 0" type="primary" @click="emit('edit', '')">
        {{ t('app.newConnection') }}
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
  padding: 12px 22px 20px;
}
.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: color-mix(in srgb, var(--tx-green) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--tx-green) 30%, transparent);
  border-radius: 8px;
}
.batch-count {
  color: var(--tx-green-hover);
  font-size: 13px;
}
.conn-table {
  flex: 1;
  overflow: auto;
  background: var(--tx-panel);
  border: 1px solid var(--tx-border);
  border-radius: 8px;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.06);
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 46px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--tx-border);
  font-size: 13px;
}
.row:hover {
  background: color-mix(in srgb, var(--tx-green) 5%, var(--tx-hover));
}
.row.expanded {
  background: var(--tx-fill);
}
.row.head {
  position: sticky;
  top: 0;
  min-height: 39px;
  background: color-mix(in srgb, var(--tx-panel) 90%, var(--tx-fill));
  color: var(--tx-text-3);
  font-size: 12px;
  z-index: 1;
}
.row.head:hover {
  background: var(--tx-panel);
}
.col-check {
  width: 22px;
  flex-shrink: 0;
}
.col-drag {
  width: 16px;
  flex-shrink: 0;
  cursor: grab;
}
.col-star {
  width: 20px;
  flex-shrink: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.star {
  color: var(--tx-text-3);
  font-size: 15px;
}
.star.filled {
  color: #f5c518;
}
.col-os {
  width: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.os-icon {
  display: block;
}
.col-latency {
  width: 90px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  gap: 4px;
}
.col-latency.sortable {
  cursor: pointer;
}
.col-latency.sortable:hover {
  color: var(--tx-text);
}
.sort-icon {
  font-size: 12px;
}
.sort-indicator {
  font-size: 10px;
  margin-left: 2px;
}
.latency-icon {
  font-size: 12px;
  color: var(--tx-green-hover);
}
.latency-ok {
  color: var(--tx-green-hover);
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
.col-name.sortable {
  cursor: pointer;
}
.col-name.sortable:hover {
  color: var(--tx-text);
}
.color-tag {
  width: 6px;
  height: 18px;
  border-radius: 3px;
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
.col-addr.sortable {
  cursor: pointer;
}
.col-addr.sortable:hover {
  color: var(--tx-text);
}
.addr-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-icon {
  cursor: pointer;
  color: var(--tx-text-3);
  font-size: 13px;
  flex-shrink: 0;
}
.copy-icon:hover {
  color: var(--tx-green-hover);
}
.col-info {
  width: 70px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.info-switch {
  transform: scale(0.85);
}
.col-spacer {
  flex: 1;
}
.col-actions {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.col-actions .el-button--success {
  background: var(--tx-green);
  border-color: var(--tx-green);
  color: #062c20;
  font-weight: 600;
}
.col-actions .el-button--success:hover {
  background: var(--tx-green-hover);
  border-color: var(--tx-green-hover);
}
.more-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--tx-text-2);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  white-space: nowrap;
}
.more-btn:hover {
  color: var(--tx-green-hover);
  background: var(--tx-hover);
}
.action-settings {
  font-size: 14px;
  color: var(--tx-text-3);
  cursor: pointer;
  margin-left: 8px;
}
.action-settings:hover {
  color: var(--tx-green-hover);
}
.row.detail {
  background: var(--tx-fill);
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

@media (max-width: 900px) {
  .conn-table-wrap {
    padding: 10px 12px;
  }
  .col-info,
  .col-spacer {
    display: none;
  }
  .col-actions {
    width: 160px;
  }
  .col-latency {
    width: 72px;
  }
}
</style>
