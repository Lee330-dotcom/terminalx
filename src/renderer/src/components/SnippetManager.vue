<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, FolderAdd, Plus, Search } from '@element-plus/icons-vue'
import { Snippet } from '@shared/types'
import { parseSnippetPlaceholders } from '@shared/snippets'
import { useSnippetStore } from '../stores/snippets'
import { useWorkspaceStore } from '../stores/workspace'
import { executeSnippet } from '../snippets/execute'
import { t } from '../i18n'

const snippetStore = useSnippetStore()
const workspaceStore = useWorkspaceStore()

const search = ref('')
const groupFilter = ref<string>('')
const dialogVisible = ref(false)
const editingId = ref<string>('')
const form = ref({
  name: '',
  command: '',
  description: '',
  groupId: '' as string,
  autoEnter: false
})

onMounted(() => {
  void snippetStore.load()
})

const groupOptions = computed(() => [
  { id: '', name: t('snippet.ungrouped') },
  ...snippetStore.groups.map((g) => ({ id: g.id, name: g.name }))
])

/** 按分组归拢；未分组的片段单独成组。 */
const sections = computed(() => {
  const q = search.value.trim().toLowerCase()
  const match = (s: Snippet): boolean =>
    !q ||
    s.name.toLowerCase().includes(q) ||
    s.command.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q)
  const list = snippetStore.snippets.filter(match)
  const result: { id: string; name: string; items: Snippet[] }[] = []
  for (const group of snippetStore.groups) {
    if (groupFilter.value && groupFilter.value !== group.id) continue
    const items = list.filter((s) => s.groupId === group.id)
    if (items.length === 0 && q) continue
    result.push({ id: group.id, name: group.name, items })
  }
  const loose = list.filter((s) => !s.groupId)
  if (loose.length > 0 || (!groupFilter.value && !q)) {
    result.push({ id: '', name: t('snippet.ungrouped'), items: loose })
  }
  return result
})

const placeholders = computed(() => parseSnippetPlaceholders(form.value.command))

function openCreate(): void {
  editingId.value = ''
  form.value = {
    name: '',
    command: '',
    description: '',
    groupId: groupFilter.value || '',
    autoEnter: false
  }
  dialogVisible.value = true
}

function openEdit(snippet: Snippet): void {
  editingId.value = snippet.id
  form.value = {
    name: snippet.name,
    command: snippet.command,
    description: snippet.description,
    groupId: snippet.groupId ?? '',
    autoEnter: snippet.autoEnter
  }
  dialogVisible.value = true
}

async function save(): Promise<void> {
  const name = form.value.name.trim()
  const command = form.value.command.trim()
  if (!name) {
    ElMessage.warning(t('snippet.nameRequired'))
    return
  }
  if (!command) {
    ElMessage.warning(t('snippet.commandRequired'))
    return
  }
  try {
    await snippetStore.save({
      id: editingId.value || undefined,
      name,
      command,
      description: form.value.description.trim(),
      groupId: form.value.groupId || null,
      autoEnter: form.value.autoEnter
    })
    dialogVisible.value = false
    ElMessage.success(t('snippet.saved'))
  } catch (err) {
    ElMessage.error(t('snippet.saveFailed', { err: String(err) }))
  }
}

async function remove(snippet: Snippet): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('snippet.deleteConfirm', { name: snippet.name }),
      t('common.confirmDelete'),
      { type: 'warning' }
    )
  } catch {
    return
  }
  await snippetStore.remove(snippet.id)
  ElMessage.success(t('snippet.deleted'))
}

async function createGroup(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      t('snippet.groupName'),
      t('snippet.newGroupTitle'),
      { inputPattern: /\S+/, inputErrorMessage: t('common.nameNotEmpty') }
    )
    await snippetStore.createGroup(value)
  } catch {
    /* 用户取消 */
  }
}

async function renameGroup(id: string, current: string): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(t('snippet.groupName'), t('common.rename'), {
      inputValue: current,
      inputPattern: /\S+/,
      inputErrorMessage: t('common.nameNotEmpty')
    })
    await snippetStore.renameGroup(id, value)
  } catch {
    /* 用户取消 */
  }
}

async function removeGroup(id: string, name: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('snippet.deleteGroupConfirm', { name }),
      t('common.confirmDelete'),
      { type: 'warning' }
    )
  } catch {
    return
  }
  await snippetStore.removeGroup(id)
  ElMessage.success(t('snippet.groupDeleted'))
}

async function run(snippet: Snippet): Promise<void> {
  await executeSnippet(snippet, workspaceStore.activeSessionId ?? '')
}
</script>

<template>
  <div class="snippet-manager">
    <div class="snippet-toolbar">
      <el-input
        v-model="search"
        size="small"
        clearable
        :prefix-icon="Search"
        :placeholder="t('snippet.searchPlaceholder')"
        style="width: 220px"
      />
      <el-select
        v-model="groupFilter"
        size="small"
        :placeholder="t('snippet.groupFilter')"
        style="width: 160px"
      >
        <el-option v-for="g in groupOptions" :key="g.id" :label="g.name" :value="g.id" />
      </el-select>
      <el-button size="small" @click="createGroup">
        <el-icon><FolderAdd /></el-icon>
        {{ t('snippet.newGroup') }}
      </el-button>
      <el-button size="small" type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>
        {{ t('snippet.newSnippet') }}
      </el-button>
    </div>

    <div v-if="snippetStore.snippets.length === 0" class="snippet-empty">
      {{ t('snippet.empty') }}
    </div>

    <div v-for="section in sections" :key="section.id || 'loose'" class="snippet-section">
      <div class="snippet-section-head">
        <span class="snippet-section-name">{{ section.name }}</span>
        <span class="snippet-section-count">{{ section.items.length }}</span>
        <template v-if="section.id">
          <el-button text size="small" @click="renameGroup(section.id, section.name)">
            {{ t('common.rename') }}
          </el-button>
          <el-button text size="small" @click="removeGroup(section.id, section.name)">
            {{ t('common.delete') }}
          </el-button>
        </template>
      </div>

      <div v-if="section.items.length === 0" class="snippet-group-empty">
        {{ t('snippet.groupEmpty') }}
      </div>

      <div v-for="item in section.items" :key="item.id" class="snippet-row">
        <div class="snippet-row-main">
          <div class="snippet-row-name">
            {{ item.name }}
            <span v-if="item.autoEnter" class="snippet-flag">{{
              t('snippet.autoEnterBadge')
            }}</span>
          </div>
          <code class="snippet-row-command">{{ item.command }}</code>
          <div v-if="item.description" class="snippet-row-desc">{{ item.description }}</div>
        </div>
        <div class="snippet-row-actions">
          <el-button size="small" @click="run(item)">{{ t('snippet.execute') }}</el-button>
          <el-button text size="small" @click="openEdit(item)">
            <el-icon><Edit /></el-icon>
          </el-button>
          <el-button text size="small" @click="remove(item)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? t('snippet.editSnippet') : t('snippet.newSnippet')"
      width="560px"
      append-to-body
    >
      <el-form label-width="72px" label-position="left" @submit.prevent>
        <el-form-item :label="t('snippet.name')" required>
          <el-input v-model="form.name" size="small" :placeholder="t('snippet.namePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('snippet.command')" required>
          <el-input
            v-model="form.command"
            type="textarea"
            :rows="3"
            spellcheck="false"
            :placeholder="t('snippet.commandPlaceholder')"
          />
          <div v-if="placeholders.length" class="snippet-form-hint">
            {{ t('snippet.paramHint', { names: placeholders.join(', ') }) }}
          </div>
        </el-form-item>
        <el-form-item :label="t('snippet.description')">
          <el-input v-model="form.description" size="small" />
        </el-form-item>
        <el-form-item :label="t('snippet.group')">
          <el-select v-model="form.groupId" size="small" style="width: 100%">
            <el-option v-for="g in groupOptions" :key="g.id" :label="g.name" :value="g.id" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('snippet.autoEnter')">
          <el-switch v-model="form.autoEnter" />
          <div class="snippet-form-hint">{{ t('snippet.autoEnterDesc') }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button size="small" type="primary" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.snippet-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.snippet-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.snippet-empty,
.snippet-group-empty {
  color: var(--tx-text-3);
  font-size: 12px;
  padding: 10px 2px;
}
.snippet-section {
  border: 1px solid var(--tx-border);
  border-radius: var(--tx-radius-sm);
  background: var(--tx-panel);
  overflow: hidden;
}
.snippet-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: var(--tx-fill);
  border-bottom: 1px solid var(--tx-border);
}
.snippet-section-name {
  color: var(--tx-text);
  font-size: 12px;
  font-weight: 600;
}
.snippet-section-count {
  color: var(--tx-text-3);
  font-size: 11px;
}
.snippet-section-head .el-button {
  margin-left: 0;
  padding: 2px 6px;
  font-size: 11px;
}
.snippet-section-head .el-button:first-of-type {
  margin-left: auto;
}
.snippet-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--tx-border);
}
.snippet-row:last-child {
  border-bottom: none;
}
.snippet-row:hover {
  background: var(--tx-hover);
}
.snippet-row-main {
  flex: 1;
  min-width: 0;
}
.snippet-row-name {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--tx-text);
  font-size: 13px;
  font-weight: 600;
}
.snippet-flag {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--tx-accent-soft);
  color: var(--tx-accent-hover);
  font-size: 10px;
  font-weight: 500;
}
.snippet-row-command {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: var(--tx-text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snippet-row-desc {
  margin-top: 3px;
  color: var(--tx-text-3);
  font-size: 11px;
}
.snippet-row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.snippet-form-hint {
  margin-top: 4px;
  color: var(--tx-text-3);
  font-size: 11px;
  line-height: 1.5;
}
</style>
