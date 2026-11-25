<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { SftpEntry } from '@shared/types'
import { useTransferStore } from '../stores/transfers'
import { t } from '../i18n'

const props = defineProps<{ connectionId: string }>()

const transferStore = useTransferStore()
const currentPath = ref('/')
const treeItems = ref<TreeItem[]>([])
const contextMenu = ref<{ visible: boolean; x: number; y: number; item: TreeItem | null }>({
  visible: false,
  x: 0,
  y: 0,
  item: null
})
const dragOver = ref(false)
const previewVisible = ref(false)
const previewText = ref('')
const previewTitle = ref('')
const selectedPath = ref<string | null>(null)

interface TreeItem {
  path: string
  name: string
  depth: number
  isDirectory: boolean
  isSymlink: boolean
  size: number
  mode: number
  mtime: number
  loaded: boolean
  expanded: boolean
  loading: boolean
}

function joinPosix(dir: string, name: string): string {
  const d = dir.endsWith('/') && dir.length > 1 ? dir.slice(0, -1) : dir
  return d === '/' ? `/${name}` : `${d}/${name}`
}

function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

async function refreshTree(fromPath?: string): Promise<void> {
  const path = fromPath ?? currentPath.value
  if (fromPath !== undefined) currentPath.value = path

  const parentItem = treeItems.value.find((it) => it.path === path)
  const depth = parentItem ? parentItem.depth + 1 : 0

  let entries: SftpEntry[]
  try {
    const result = await window.api.sftpList(props.connectionId, path)
    entries = result.entries
  } catch (err) {
    ElMessage.error(t('sftp.listFailed', { err: String(err) }))
    return
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const idx = parentItem ? treeItems.value.indexOf(parentItem) : -1
  const insertAt = idx >= 0 ? idx + 1 : treeItems.value.length

  // Remove old children of this path
  if (idx >= 0 && parentItem) {
    let removeCount = 0
    for (let i = idx + 1; i < treeItems.value.length; i++) {
      if (treeItems.value[i].depth > parentItem.depth) removeCount++
      else break
    }
    if (removeCount > 0) treeItems.value.splice(idx + 1, removeCount)
  }

  const newItems: TreeItem[] = entries.map((e) => ({
    path: e.path,
    name: e.name,
    depth,
    isDirectory: e.isDirectory,
    isSymlink: (e.mode & 0o170000) === 0o120000,
    size: e.size,
    mode: e.mode,
    mtime: e.mtime,
    loaded: false,
    expanded: false,
    loading: false
  }))

  treeItems.value.splice(insertAt, 0, ...newItems)

  if (parentItem) {
    parentItem.loaded = true
    parentItem.loading = false
  }
}

async function toggleExpand(item: TreeItem): Promise<void> {
  if (!item.isDirectory) return
  if (item.expanded) {
    collapseItem(item)
  } else {
    item.loading = true
    await refreshTree(item.path)
    item.expanded = true
  }
}

function collapseItem(item: TreeItem): void {
  const idx = treeItems.value.indexOf(item)
  if (idx < 0) return
  let count = 0
  for (let i = idx + 1; i < treeItems.value.length; i++) {
    if (treeItems.value[i].depth > item.depth) count++
    else break
  }
  if (count > 0) treeItems.value.splice(idx + 1, count)
  item.expanded = false
}

function onTreeClick(item: TreeItem): void {
  selectedPath.value = item.path
  contextMenu.value.visible = false
}

function onTreeDblclick(item: TreeItem): void {
  if (item.isDirectory) void toggleExpand(item)
  else void previewFile(item)
}

function onContextMenu(e: MouseEvent, item: TreeItem): void {
  e.preventDefault()
  e.stopPropagation()
  selectedPath.value = item.path
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, item }
}

function onPanelClick(): void {
  contextMenu.value.visible = false
  selectedPath.value = null
}

function navigateTo(path: string): void {
  treeItems.value = []
  void refreshTree(path)
}

function closeContext(): void {
  contextMenu.value.visible = false
}

async function previewFile(item: TreeItem): Promise<void> {
  if (item.isDirectory) return
  if (item.size > 2 * 1024 * 1024) {
    ElMessage.warning(t('sftp.fileTooLarge'))
    return
  }
  try {
    previewTitle.value = item.name
    previewText.value = await window.api.sftpReadText(props.connectionId, item.path)
    previewVisible.value = true
  } catch (err) {
    ElMessage.error(t('sftp.readFailed', { err: String(err) }))
  }
}

async function doRefresh(): Promise<void> {
  closeContext()
  const item = contextMenu.value.item
  if (item) {
    // Refresh this directory: collapse and reload
    if (item.isDirectory && item.expanded) {
      collapseItem(item)
      item.loaded = false
    }
    item.loading = true
    await refreshTree(item.path)
    item.expanded = true
  } else {
    // Refresh root
    treeItems.value = []
    await refreshTree(currentPath.value)
  }
}

async function doUpload(): Promise<void> {
  closeContext()
  const localPath = await window.api.openFileDialog()
  if (!localPath) return
  const targetDir = contextMenu.value.item?.isDirectory
    ? contextMenu.value.item.path
    : currentPath.value
  await transferStore.upload(
    props.connectionId,
    localPath,
    joinPosix(targetDir, basename(localPath))
  )
}

async function doCreateFolder(): Promise<void> {
  closeContext()
  try {
    const { value } = await ElMessageBox.prompt(
      t('sftp.folderNamePrompt'),
      t('sftp.folderNameTitle'),
      { inputPattern: /^[^/]+$/, inputErrorMessage: t('sftp.nameNoSlash') }
    )
    const targetDir = contextMenu.value.item?.isDirectory
      ? contextMenu.value.item.path
      : currentPath.value
    await window.api.sftpMkdir(props.connectionId, joinPosix(targetDir, value))
    // Reload parent
    treeItems.value = []
    await refreshTree(currentPath.value)
  } catch {
    /* cancelled */
  }
}

async function doDownload(): Promise<void> {
  closeContext()
  const item = contextMenu.value.item
  if (!item || item.isDirectory) return
  const dir = await window.api.openDirectoryDialog()
  if (!dir) return
  await transferStore.download(props.connectionId, item.path, joinPosix(dir, item.name))
}

function doCopyPath(): void {
  closeContext()
  const item = contextMenu.value.item
  if (!item) return
  navigator.clipboard.writeText(item.path).then(() => {
    ElMessage.success(t('sftp.pathCopied'))
  })
}

async function doDelete(): Promise<void> {
  closeContext()
  const item = contextMenu.value.item
  if (!item) return
  try {
    await ElMessageBox.confirm(
      t('sftp.deleteConfirm', {
        name: item.name,
        suffix: item.isDirectory ? t('sftp.deleteDirSuffix') : ''
      }),
      t('common.confirmDelete'),
      {
        type: 'warning',
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel')
      }
    )
    await window.api.sftpDelete(props.connectionId, item.path)
    treeItems.value = []
    await refreshTree(currentPath.value)
  } catch {
    /* cancelled */
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

function onGlobalClick(): void {
  if (contextMenu.value.visible) contextMenu.value.visible = false
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick)
})

// Watch connection changes
import { watch } from 'vue'
watch(
  () => props.connectionId,
  () => {
    currentPath.value = '/'
    treeItems.value = []
    selectedPath.value = null
    void refreshTree()
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
    @click="onPanelClick"
  >
    <!-- Toolbar -->
    <div class="sftp-toolbar">
      <button class="tool-btn active" title="树形视图">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="1" width="5" height="4" rx="1" />
          <rect x="1" y="7" width="5" height="4" rx="1" />
          <rect x="1" y="13" width="5" height="2" rx="0.5" />
          <rect x="8" y="1" width="7" height="2" rx="0.5" />
          <rect x="8" y="5" width="7" height="2" rx="0.5" />
          <rect x="8" y="9" width="7" height="2" rx="0.5" />
          <rect x="8" y="13" width="7" height="2" rx="0.5" />
        </svg>
      </button>
      <button class="tool-btn" title="列表视图">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="2" width="14" height="2" rx="0.5" />
          <rect x="1" y="6" width="14" height="2" rx="0.5" />
          <rect x="1" y="10" width="14" height="2" rx="0.5" />
          <rect x="1" y="14" width="14" height="1" rx="0.5" />
        </svg>
      </button>
      <div class="toolbar-sep" />
      <button class="tool-btn" title="上传" @click.stop="uploadFiles">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M8 12V3M4 6l4-4 4 4" />
          <path d="M2 12v2h12v-2" />
        </svg>
      </button>
      <button class="tool-btn" title="新建文件夹" @click.stop="doCreateFolder">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M2 4h4l2 2h6v7H2V4z" />
          <path d="M8 9v4M6 11h4" />
        </svg>
      </button>
    </div>

    <!-- Breadcrumb -->
    <div class="sftp-breadcrumb">
      <button
        class="breadcrumb-btn"
        @click.stop="navigateTo('/')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3h5l2 2h5v8H2V3z" />
        </svg>
      </button>
      <span class="breadcrumb-path">
        <span
          class="breadcrumb-root"
          @click.stop="navigateTo('/')"
          >/</span
        >
        <template v-for="part in pathParts" :key="part.path">
          <span class="breadcrumb-sep">&gt;</span>
          <span
            class="breadcrumb-part"
            @click.stop="navigateTo(part.path)"
            >{{ part.name }}</span
          >
        </template>
      </span>
      <button class="breadcrumb-btn" @click.stop="doRefresh" :title="t('sftp.refresh')">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M13 8A5 5 0 1 1 8 3" />
          <path d="M8 1v3h3" />
        </svg>
      </button>
    </div>

    <!-- Tree -->
    <div class="sftp-tree">
      <div v-if="treeItems.length === 0" class="tree-empty">{{ t('sftp.emptyDir') }}</div>
      <div
        v-for="item in treeItems"
        :key="item.path"
        class="tree-item"
        :class="{
          selected: selectedPath === item.path,
          'is-dir': item.isDirectory
        }"
        :style="{ paddingLeft: `${item.depth * 20 + 8}px` }"
        @click.stop="onTreeClick(item)"
        @dblclick.stop="onTreeDblclick(item)"
        @contextmenu.stop="onContextMenu($event, item)"
      >
        <span class="tree-arrow" @click.stop="item.isDirectory ? toggleExpand(item) : undefined">
          <template v-if="item.isDirectory">
            <span v-if="item.loading" class="tree-spinner" />
            <svg
              v-else-if="item.expanded"
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="currentColor"
            >
              <path d="M2 3l3 4 3-4z" />
            </svg>
            <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M3 2l4 3-4 3z" />
            </svg>
          </template>
        </span>
        <span class="tree-icon">
          <template v-if="item.isSymlink">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            >
              <path d="M6 10l4-4M6 6h4v4" />
            </svg>
          </template>
          <template v-else-if="item.isDirectory">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="icon-folder">
              <path d="M2 3h5l2 2h5v8H2V3z" />
            </svg>
          </template>
          <template v-else>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="icon-file">
              <path d="M4 1h5l4 4v10H4V1z" />
            </svg>
          </template>
        </span>
        <span class="tree-name">
          {{ item.name }}
          <span v-if="item.isSymlink" class="tree-symlink">→ {{ basename(item.path) }}</span>
        </span>
        <span v-if="!item.isDirectory" class="tree-size">{{ formatSize(item.size) }}</span>
        <span class="tree-mode">{{ formatMode(item.mode, item.isDirectory) }}</span>
      </div>
    </div>

    <!-- Transfers -->
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

    <!-- Context Menu -->
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <div class="ctx-item" @click.stop="doRefresh">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M13 8A5 5 0 1 1 8 3" />
          <path d="M8 1v3h3" />
        </svg>
        {{ t('sftp.refresh') }}
      </div>
      <div class="ctx-item" @click.stop="doUpload">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M8 12V3M4 6l4-4 4 4" />
          <path d="M2 12v2h12v-2" />
        </svg>
        {{ t('sftp.upload') }}
      </div>
      <div class="ctx-item" @click.stop="doCreateFolder">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M2 4h4l2 2h6v7H2V4z" />
          <path d="M8 9v4M6 11h4" />
        </svg>
        {{ t('sftp.newFolder') }}
      </div>
      <div class="ctx-sep" />
      <div
        class="ctx-item"
        @click.stop="doDownload"
        :class="{ disabled: !contextMenu.item || contextMenu.item.isDirectory }"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M8 3v9M4 9l4 4 4-4" />
          <path d="M2 12v2h12v-2" />
        </svg>
        {{ t('sftp.download') }}
      </div>
      <div class="ctx-item" @click.stop="doCopyPath" :class="{ disabled: !contextMenu.item }">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <rect x="5" y="5" width="9" height="9" rx="1" />
          <path d="M3 11V3h8" />
        </svg>
        {{ t('sftp.copyPath') }}
      </div>
      <div class="ctx-sep" />
      <div
        class="ctx-item ctx-danger"
        @click.stop="doDelete"
        :class="{ disabled: !contextMenu.item }"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path
            d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4"
          />
        </svg>
        {{ t('common.delete') }}
      </div>
    </div>

    <!-- Preview Dialog -->
    <el-dialog v-model="previewVisible" :title="previewTitle" width="70%" top="6vh">
      <pre class="preview-text">{{ previewText }}</pre>
    </el-dialog>
  </div>
</template>

<style scoped>
.sftp-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--tx-bg);
  position: relative;
  overflow: hidden;
}
.sftp-panel.drag-over::after {
  content: '松开鼠标上传到当前目录';
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--tx-accent) 10%, transparent);
  border: 2px dashed var(--tx-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tx-accent-hover);
  font-size: 14px;
  z-index: 10;
  pointer-events: none;
}
:lang(en-US) .sftp-panel.drag-over::after {
  content: 'Release to upload to current directory';
}

/* Toolbar */
.sftp-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--tx-border);
  flex-shrink: 0;
}
.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--tx-text-3);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.tool-btn:hover {
  background: var(--tx-hover);
  color: var(--tx-text);
}
.tool-btn.active {
  color: var(--tx-accent);
  background: var(--tx-accent-soft);
}
.toolbar-sep {
  width: 1px;
  height: 18px;
  background: var(--tx-border);
  margin: 0 4px;
}

/* Breadcrumb */
.sftp-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--tx-border);
  flex-shrink: 0;
  font-size: 13px;
}
.breadcrumb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--tx-text-3);
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.breadcrumb-btn:hover {
  background: var(--tx-hover);
  color: var(--tx-text);
}
.breadcrumb-path {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  white-space: nowrap;
  min-width: 0;
}
.breadcrumb-root {
  color: var(--tx-text-2);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
}
.breadcrumb-root:hover {
  background: var(--tx-hover);
  color: var(--tx-accent-hover);
}
.breadcrumb-sep {
  color: var(--tx-text-3);
  font-size: 11px;
}
.breadcrumb-part {
  color: var(--tx-text-2);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
}
.breadcrumb-part:hover {
  background: var(--tx-hover);
  color: var(--tx-accent-hover);
}

/* Tree */
.sftp-tree {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}
.tree-empty {
  padding: 30px;
  text-align: center;
  color: var(--tx-text-3);
  font-size: 13px;
}
.tree-item {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  border-left: 3px solid transparent;
  transition: background 0.1s;
}
.tree-item:hover {
  background: var(--tx-hover);
}
.tree-item.selected {
  background: var(--tx-accent-soft);
  border-left-color: var(--tx-accent);
}
.tree-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--tx-text-3);
}
.tree-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid var(--tx-border);
  border-top-color: var(--tx-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.tree-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--tx-text-2);
}
.icon-folder {
  color: var(--tx-warning);
}
.icon-file {
  color: var(--tx-text-3);
}
.tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--tx-text);
}
.tree-symlink {
  color: var(--tx-text-3);
  font-size: 11px;
  margin-left: 4px;
}
.tree-size {
  font-size: 11px;
  color: var(--tx-text-3);
  width: 60px;
  text-align: right;
  flex-shrink: 0;
}
.tree-mode {
  font-size: 11px;
  color: var(--tx-text-3);
  width: 75px;
  text-align: right;
  flex-shrink: 0;
  font-family: 'Menlo, Monaco, monospace';
}

/* Context Menu */
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 180px;
  background: var(--tx-card);
  border: 1px solid var(--tx-border);
  border-radius: 8px;
  box-shadow: var(--tx-shadow-lg);
  padding: 4px 0;
  overflow: hidden;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--tx-text);
  cursor: pointer;
  transition: background 0.1s;
}
.ctx-item:hover {
  background: var(--tx-hover);
}
.ctx-item.disabled {
  color: var(--tx-text-3);
  cursor: default;
}
.ctx-item.disabled:hover {
  background: transparent;
}
.ctx-danger {
  color: var(--tx-danger);
}
.ctx-danger:hover {
  background: var(--tx-danger-soft);
}
.ctx-sep {
  height: 1px;
  background: var(--tx-border);
  margin: 4px 0;
}

/* Transfers */
.transfer-list {
  border-top: 1px solid var(--tx-border);
  padding: 6px 8px;
  max-height: 120px;
  overflow-y: auto;
  background: var(--tx-panel);
  flex-shrink: 0;
}
.transfer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 2px 0;
}
.transfer-name {
  width: 100px;
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

/* Preview */
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
