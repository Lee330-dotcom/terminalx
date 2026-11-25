<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useAppStore } from '../../stores/app'
import { t } from '../../i18n'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  pick: [connectionId: string, name: string]
}>()

const appStore = useAppStore()
const keyword = ref('')

const filtered = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  if (!key) return appStore.connections
  return appStore.connections.filter(
    (c) =>
      c.name.toLowerCase().includes(key) ||
      c.host.toLowerCase().includes(key) ||
      c.username.toLowerCase().includes(key)
  )
})

watch(
  () => props.visible,
  (v) => {
    if (v) keyword.value = ''
  }
)

function pick(id: string, name: string): void {
  emit('pick', id, name)
  emit('update:visible', false)
}
</script>

<template>
  <div v-if="props.visible" class="pane-picker" @click.stop>
    <el-input
      v-model="keyword"
      size="small"
      clearable
      :prefix-icon="Search"
      :placeholder="t('ws.pickerSearch')"
    />
    <ul v-if="filtered.length" class="pane-picker-list">
      <li
        v-for="conn in filtered"
        :key="conn.id"
        class="pane-picker-item"
        @click.stop="pick(conn.id, conn.name)"
      >
        <span class="picker-dot" :style="{ background: conn.color || 'var(--tx-accent)' }" />
        <span class="picker-name">{{ conn.name }}</span>
        <span class="picker-addr">{{ conn.username }}@{{ conn.host }}:{{ conn.port }}</span>
      </li>
    </ul>
    <p v-else class="pane-picker-empty">{{ t('ws.pickerEmpty') }}</p>
  </div>
</template>

<style scoped>
.pane-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 300px;
  max-width: 100%;
  margin-top: 4px;
  padding: 10px;
  border: 1px solid var(--tx-border);
  border-radius: 8px;
  background: var(--tx-panel);
  box-shadow: var(--tx-shadow-lg);
}
.pane-picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
}
.pane-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--tx-text-2);
  font-size: 12px;
}
.pane-picker-item:hover {
  background: var(--tx-hover);
  color: var(--tx-text);
}
.picker-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.picker-name {
  flex-shrink: 0;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.picker-addr {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--tx-text-3);
  font-size: 11px;
}
.pane-picker-empty {
  margin: 0;
  padding: 10px 2px;
  color: var(--tx-text-3);
  font-size: 12px;
  text-align: center;
}
</style>
