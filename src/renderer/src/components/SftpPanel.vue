<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { SftpEntry } from '@shared/types'
import { useTransferStore } from '../stores/transfers'
import { t } from '../i18n'

const props = defineProps<{ connectionId: string }>()

const transferStore = useTransferStore()
const currentPath = ref('/')
const entries = ref<SftpEntry[]>([])
const loading = ref(false)
const selected = ref<SftpEntry | null>(null)
const previewVisible = ref(false)
const previewText = ref('')
const previewTitle = ref('')
const dragOver = ref(false)

function joinPosix(dir: string, name: string): string {
  const d = dir.endsWith('/') && dir.length > 1 ? dir.slice(0, -1) : dir
  return d === '/' ? `/${name}` : `${d}/${name}`
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const result = await window.api.sftpList(props.connectionId, currentPath.value)
    entries.value = result.entries
  } catch (err) {
    ElMessage.error(t('sftp.listFailed', { err: String(err) }))
    entries.value = []
  } finally {
    loading.value = false
  }
}

function enter(entry: SftpEntry): void {
  if (entry.isDirectory) {
    currentPath.value = entry.path
    void refresh()
  }
}

function goUp(): void {
  if (currentPath.value === '/') return
  const parts = currentPath.value.split('/').filter(Boolean)
  parts.pop()
  currentPath.value = parts.length === 0 ? '/' : '/' + parts.join('/')
  void refresh()
}

function goTo(path: string): void {
  currentPath.value = path.startsWith('/') ? path : '/' + path
  void refresh()
}

async function preview(entry: SftpEntry): Promise<void> {
  if (entry.isDirectory) return
  if (entry.size > 2 * 1024 * 1024) {
    ElMessage.warning(t('sftp.fileTooLarge'))
    return
  }
  try {
    previewTitle.value = entry.name
    previewText.value = await window.api.sftpReadText(props.connectionId, entry.path)
    previewVisible.value = true
  } catch (err) {
    ElMessage.error(t('sftp.readFailed', { err: String(err) }))
  }
}

async function createFolder(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      t('sftp.folderNamePrompt'),
      t('sftp.folderNameTitle'),
      {
        inputPattern: /^[^/]+$/,
        inputErrorMessage: t('sftp.nameNoSlash')
      }
    )
    await window.api.sftpMkdir(props.connectionId, joinPosix(currentPath.value, value))
    await refresh()
  } catch {
    /* 用户取消 */
  }
}

async function renameEntry(entry: SftpEntry): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(t('sftp.newNamePrompt'), t('sftp.renameTitle'), {
      inputValue: entry.name,
      inputPattern: /^[^/]+$/,
      inputErrorMessage: t('sftp.nameNoSlash')
    })
    if (value === entry.name) return
    await window.api.sftpRename(props.connectionId, entry.path, joinPosix(currentPath.value, value))
    await refresh()
  } catch {
    /* 用户取消 */
  }
}

async function deleteEntry(entry: SftpEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('sftp.deleteConfirm', {
        name: entry.name,
        suffix: entry.isDirectory ? t('sftp.deleteDirSuffix') : ''
      }),
      t('common.confirmDelete'),
      {
        type: 'warning',
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel')
      }
    )
    await window.api.sftpDelete(props.connectionId, entry.path)
    if (selected.value?.path === entry.path) selected.value = null
    await refresh()
  } catch {
    /* 用户取消 */
  }
}

async function uploadFiles(): Promise<void> {
  const localPath = await window.api.openFileDialog()
  if (!localPath) return
  await transferStore.upload(
    props.connectionId,
    localPath,
    joinPosix(currentPath.value, basename(localPath))
  )
}

async function downloadSelected(): Promise<void> {
  if (!selected.value || selected.value.isDirectory) return
  const dir = await window.api.openDirectoryDialog()
  if (!dir) return
  await transferStore.download(
    props.connectionId,
    selected.value.path,
    joinPosix(dir, selected.value.name)
  )
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function onDrop(e: DragEvent): void {
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (!files) return
  for (const file of Array.from(files)) {
    const localPath = window.api.getPathForFile(file)
    void transferStore.upload(
      props.connectionId,
      localPath,
      joinPosix(currentPath.value, file.name)
    )
  }
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatMode(mode: number, isDir: boolean): string {
  let s = isDir ? 'd' : '-'
  for (const shift of [6, 3, 0]) {
    s += mode & (4 << shift) ? 'r' : '-'
    s += mode & (2 << shift) ? 'w' : '-'
    s += mode & (1 << shift) ? 'x' : '-'
  }
  return s
}

function formatTime(mtime: number): string {
  if (!mtime) return '-'
  return new Date(mtime * 1000).toLocaleString('zh-CN', { hour12: false })
}

function onRowDblclick(row: SftpEntry): void {
  if (row.isDirectory) enter(row)
  else void preview(row)
}

function onRowClick(row: SftpEntry): void {
  selected.value = row
}

const pathParts = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  return parts.map((p, i) => ({
    name: p,
    path: '/' + parts.slice(0, i + 1).join('/')
  }))
})

const runningTransfers = computed(() =>
  transferStore.transfers.filter((t) => t.status === 'running')
)

watch(
  () => props.connectionId,
  () => {
    currentPath.value = '/'
    selected.value = null
    void refresh()
  },
  { immediate: true }
)
</script>

<template>
  <div
    class="sftp-panel"
    :class="{ 'drag-over': dragOver }"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <div class="sftp-header">
      <el-button size="small" text @click="goUp" :disabled="currentPath === '/'">{{
        t('sftp.up')
      }}</el-button>
      <div class="path-bar">
        <span class="path-sep">/</span>
        <template v-for="part in pathParts" :key="part.path">
          <span class="path-part" @click="goTo(part.path)">{{ part.name }}</span>
          <span class="path-sep">/</span>
        </template>
      </div>
      <el-button size="small" text @click="refresh">{{ t('sftp.refresh') }}</el-button>
    </div>
    <div class="sftp-toolbar">
      <el-button size="small" type="primary" @click="uploadFiles">{{ t('sftp.upload') }}</el-button>
      <el-button size="small" @click="createFolder">{{ t('sftp.newFolder') }}</el-button>
      <el-button size="small" :disabled="!selected" @click="downloadSelected">{{
        t('sftp.download')
      }}</el-button>
      <el-button size="small" :disabled="!selected" @click="renameEntry(selected!)">{{
        t('common.rename')
      }}</el-button>
      <el-button size="small" type="danger" :disabled="!selected" @click="deleteEntry(selected!)">
        {{ t('common.delete') }}
      </el-button>
    </div>
    <div class="sftp-list">
      <el-table
        v-loading="loading"
        :data="entries"
        size="small"
        height="100%"
        highlight-current-row
        @row-click="onRowClick"
        @row-dblclick="onRowDblclick"
        :empty-text="t('sftp.emptyDir')"
      >
        <el-table-column :label="t('table.name')" min-width="160">
          <template #default="{ row }">
            <span class="entry-name">
              <span class="entry-icon">{{ row.isDirectory ? '📁' : '📄' }}</span>
              {{ row.name }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('sftp.size')" width="80">
          <template #default="{ row }">
            <span v-if="!row.isDirectory">{{ formatSize(row.size) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('sftp.permissions')" width="100">
          <template #default="{ row }">{{ formatMode(row.mode, row.isDirectory) }}</template>
        </el-table-column>
        <el-table-column :label="t('sftp.mtime')" width="150">
          <template #default="{ row }">{{ formatTime(row.mtime) }}</template>
        </el-table-column>
      </el-table>
    </div>
    <div v-if="runningTransfers.length > 0" class="transfer-list">
      <div v-for="tr in runningTransfers" :key="tr.id" class="transfer-item">
        <span class="transfer-name" :title="tr.remotePath">{{ tr.name }}</span>
        <el-progress
          class="transfer-progress"
          :percentage="
            tr.total > 0 ? Math.min(100, Math.round((tr.transferred / tr.total) * 100)) : 0
          "
          :stroke-width="6"
          :show-text="false"
        />
        <span class="transfer-size">
          {{ formatSize(tr.transferred) }}{{ tr.total > 0 ? ` / ${formatSize(tr.total)}` : '' }}
        </span>
        <el-button size="small" text type="danger" @click="transferStore.cancel(tr.id)">{{
          t('common.cancel')
        }}</el-button>
      </div>
    </div>

    <el-dialog v-model="previewVisible" :title="previewTitle" width="70%" top="6vh">
      <pre class="preview-text">{{ previewText }}</pre>
    </el-dialog>
  </div>
</template>

<style scoped>
.sftp-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--tx-bg);
  border-left: 1px solid var(--tx-border);
  position: relative;
}
.sftp-panel.drag-over::after {
  content: '松开鼠标上传到当前目录';
  position: absolute;
  inset: 0;
  background: rgba(16, 185, 129, 0.08);
  border: 2px dashed var(--tx-green);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tx-green-hover);
  font-size: 14px;
  z-index: 10;
  pointer-events: none;
}
:lang(en-US) .sftp-panel.drag-over::after {
  content: 'Release to upload to current directory';
}
.sftp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--tx-border);
}
.path-bar {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  overflow-x: auto;
  white-space: nowrap;
}
.path-part {
  color: var(--tx-green-hover);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
}
.path-part:hover {
  background: color-mix(in srgb, var(--tx-green) 14%, transparent);
}
.path-sep {
  color: var(--tx-text-3);
}
.sftp-toolbar {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--tx-border);
}
.sftp-list {
  flex: 1;
  min-height: 0;
}
.entry-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.transfer-list {
  border-top: 1px solid var(--tx-border);
  padding: 6px 8px;
  max-height: 160px;
  overflow-y: auto;
  background: var(--tx-panel);
}
.transfer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 2px 0;
}
.transfer-name {
  width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.transfer-progress {
  flex: 1;
}
.transfer-size {
  color: var(--tx-text-3);
  white-space: nowrap;
}
.preview-text {
  max-height: 60vh;
  overflow: auto;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  background: var(--tx-fill);
  color: var(--tx-text);
  padding: 12px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
