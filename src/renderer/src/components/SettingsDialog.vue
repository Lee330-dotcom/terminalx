<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Settings } from '@shared/types'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [boolean]; changed: [] }>()

const settings = reactive<Settings>({ mcpEnabled: true, mcpPort: 8080, mcpToken: '' })
const showToken = ref(false)
const saving = ref(false)

async function load(): Promise<void> {
  const s = await window.api.getSettings()
  Object.assign(settings, s)
}

async function save(): Promise<void> {
  saving.value = true
  try {
    await window.api.updateSettings({ mcpEnabled: settings.mcpEnabled, mcpPort: settings.mcpPort })
    ElMessage.success('设置已保存')
    emit('changed')
  } finally {
    saving.value = false
  }
}

async function regenerate(): Promise<void> {
  try {
    const { value } = await ElMessageBox.confirm(
      '重新生成后旧 token 立即失效，需要重新配置接入方。确定？',
      '重新生成 token',
      { type: 'warning' }
    )
    if (value !== 'confirm') return
    settings.mcpToken = await window.api.regenerateToken()
    ElMessage.success('token 已更新')
    emit('changed')
  } catch {
    /* 取消 */
  }
}

async function copyUrl(): Promise<void> {
  const url = `http://127.0.0.1:${settings.mcpPort}/mcp`
  await navigator.clipboard.writeText(url)
  ElMessage.success('URL 已复制')
}

async function copyToken(): Promise<void> {
  await navigator.clipboard.writeText(settings.mcpToken)
  ElMessage.success('token 已复制')
}

onMounted(load)
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="设置"
    width="520px"
    @update:model-value="emit('update:visible', $event)"
    @open="load"
  >
    <el-form label-width="110px" label-position="left">
      <el-form-item label="MCP 服务">
        <el-switch v-model="settings.mcpEnabled" />
      </el-form-item>
      <el-form-item label="MCP 端口">
        <el-input-number v-model="settings.mcpPort" :min="1024" :max="65535" />
      </el-form-item>
      <el-form-item label="接入 URL">
        <div class="url-row">
          <code class="url-text">http://127.0.0.1:{{ settings.mcpPort }}/mcp</code>
          <el-button size="small" @click="copyUrl">复制</el-button>
        </div>
      </el-form-item>
      <el-form-item label="接入 token">
        <div class="token-row">
          <code class="token-text">
            {{ showToken ? settings.mcpToken : '•'.repeat(32) }}
          </code>
          <el-button size="small" text @click="showToken = !showToken">
            {{ showToken ? '隐藏' : '显示' }}
          </el-button>
          <el-button size="small" @click="copyToken">复制</el-button>
          <el-button size="small" type="danger" plain @click="regenerate">重新生成</el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">关闭</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.url-row,
.token-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.url-text {
  flex: 1;
  background: #1a1a1a;
  padding: 4px 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.token-text {
  flex: 1;
  background: #1a1a1a;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
