<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSnippetRunStore } from '../stores/snippetRun'
import { applySnippetPlaceholders, parseSnippetPlaceholders } from '@shared/snippets'
import { t } from '../i18n'

const runStore = useSnippetRunStore()

const visible = ref(false)
const values = ref<Record<string, string>>({})
const placeholders = ref<string[]>([])

watch(
  () => runStore.pending,
  (pending) => {
    if (!pending) {
      visible.value = false
      values.value = {}
      placeholders.value = []
      return
    }
    const names = parseSnippetPlaceholders(pending.snippet.command)
    placeholders.value = names
    values.value = Object.fromEntries(names.map((n) => [n, '']))
    visible.value = true
  }
)

const preview = computed(() => {
  const pending = runStore.pending
  if (!pending) return ''
  return applySnippetPlaceholders(pending.snippet.command, values.value)
})

function submit(): void {
  runStore.confirm(values.value)
}

function cancel(): void {
  runStore.cancel()
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('snippet.runTitle')"
    width="560px"
    :close-on-click-modal="false"
    :show-close="false"
    :z-index="10001"
    append-to-body
    @close="cancel"
  >
    <div v-if="runStore.pending" class="snippet-run">
      <div class="snippet-run-name">{{ runStore.pending.snippet.name }}</div>
      <div v-if="runStore.pending.snippet.description" class="snippet-run-desc">
        {{ runStore.pending.snippet.description }}
      </div>

      <div class="snippet-run-fields">
        <label v-for="name in placeholders" :key="name" class="snippet-run-field">
          <span class="snippet-run-label">{{ name }}</span>
          <el-input
            v-model="values[name]"
            size="small"
            spellcheck="false"
            :placeholder="t('snippet.paramPlaceholder', { name })"
            @keyup.enter="submit"
          />
        </label>
      </div>

      <div class="snippet-run-preview-label">{{ t('snippet.preview') }}</div>
      <pre class="snippet-run-preview">{{ preview }}</pre>

      <div class="snippet-run-hint">
        {{
          runStore.pending.snippet.autoEnter ? t('snippet.autoEnterOn') : t('snippet.autoEnterOff')
        }}
      </div>
    </div>
    <template #footer>
      <el-button size="small" @click="cancel">{{ t('common.cancel') }}</el-button>
      <el-button size="small" type="primary" @click="submit">{{ t('snippet.execute') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.snippet-run-name {
  color: var(--tx-text);
  font-size: 14px;
  font-weight: 600;
}
.snippet-run-desc {
  margin-top: 4px;
  color: var(--tx-text-2);
  font-size: 12px;
}
.snippet-run-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
.snippet-run-field {
  display: flex;
  align-items: center;
  gap: 10px;
}
.snippet-run-label {
  width: 120px;
  flex-shrink: 0;
  overflow: hidden;
  color: var(--tx-text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snippet-run-preview-label {
  margin-top: 16px;
  color: var(--tx-text-3);
  font-size: 11px;
}
.snippet-run-preview {
  margin: 6px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--tx-border);
  border-radius: var(--tx-radius-sm);
  background: var(--tx-fill);
  color: var(--tx-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.snippet-run-hint {
  margin-top: 10px;
  color: var(--tx-text-3);
  font-size: 11px;
}
</style>
