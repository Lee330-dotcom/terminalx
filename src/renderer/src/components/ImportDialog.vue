<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload, View, Hide } from '@element-plus/icons-vue'
import { ImportKind, ImportPreview, ImportResult } from '@shared/types'
import { t } from '../i18n'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [boolean]
  imported: []
}>()

const activeKind = ref<ImportKind>('bastion')
const filePath = ref('')
const password = ref('')
const showPassword = ref(false)
const preview = ref<ImportPreview | null>(null)
const loading = ref(false)
const applying = ref(false)

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    activeKind.value = 'bastion'
    filePath.value = ''
    password.value = ''
    preview.value = null
  }
)

async function pickFile(): Promise<void> {
  const picked = await window.api.openFileDialog()
  if (picked) {
    filePath.value = picked
    await loadPreview()
  }
}

async function loadPreview(): Promise<void> {
  if (!filePath.value) return
  loading.value = true
  try {
    preview.value = await window.api.importPreview({
      kind: activeKind.value,
      filePath: filePath.value
    })
  } catch (err) {
    ElMessage.error(t('app.opFailed').replace('{err}', String(err)))
    preview.value = null
  } finally {
    loading.value = false
  }
}

async function applyImport(): Promise<void> {
  if (!preview.value || !preview.value.ok || preview.value.rows.length === 0) return
  applying.value = true
  try {
    const req: Parameters<typeof window.api.importApply>[0] = {
      kind: activeKind.value,
      filePath: filePath.value
    }
    if (activeKind.value === 'bastion') {
      req.password = password.value
    }
    const result: ImportResult = await window.api.importApply(req)
    ElMessage.success(
      `导入完成：新增 ${result.created} 条` +
        (result.skippedDuplicates > 0 ? `，跳过重复 ${result.skippedDuplicates}` : '') +
        (result.skippedErrors > 0 ? `，跳过错误 ${result.skippedErrors}` : '')
    )
    emit('imported')
    emit('update:visible', false)
  } catch (err) {
    ElMessage.error(t('app.opFailed').replace('{err}', String(err)))
  } finally {
    applying.value = false
  }
}

function switchKind(kind: ImportKind): void {
  activeKind.value = kind
  filePath.value = ''
  preview.value = null
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="t('app.import')"
    width="560px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="import-kind-tabs">
      <div
        class="import-kind-card"
        :class="{ active: activeKind === 'bastion' }"
        @click="switchKind('bastion')"
      >
        <div class="import-kind-title">堡垒机导入</div>
        <div class="import-kind-desc">齐治堡垒机导出的 Xshell.csv</div>
      </div>
      <div
        class="import-kind-card"
        :class="{ active: activeKind === 'template' }"
        @click="switchKind('template')"
      >
        <div class="import-kind-title">模板导入</div>
        <div class="import-kind-desc">标准 CSV 模板（name,host,port,username,remark）</div>
      </div>
    </div>

    <div v-if="activeKind === 'bastion'" class="import-guide">
      <p>
        请在齐治堡垒机 Web 界面，进入「运维审计系统」→「个人账号」→「账号列表」，选中目标账号后点击「导出透传访问配置」，
        会得到一个 Xshell.csv 文件。将该文件上传到此处即可。
      </p>
      <p class="import-guide-hint">
        导入的服务器地址为堡垒机地址（10.132.0.70），用户名为「工号/目标IP/用户名」格式的透传串。
        所有连接共用下方填写的密码（即堡垒机登录密码）。
      </p>
    </div>

    <div class="import-file-row">
      <el-input v-model="filePath" readonly placeholder="选择 CSV 文件..." />
      <el-button @click="pickFile" :loading="loading">
        <el-icon><Upload /></el-icon>
        选择文件
      </el-button>
    </div>

    <div v-if="preview && preview.ok" class="import-preview">
      <div class="import-preview-summary">
        共 {{ preview.total }} 行，可导入 {{ preview.rows.length }} 条
        <span v-if="preview.duplicates > 0">（跳过重复 {{ preview.duplicates }}）</span>
        <span v-if="preview.invalid > 0">（跳过错误 {{ preview.invalid }}）</span>
      </div>
      <div v-if="preview.samples.length > 0" class="import-preview-samples">
        示例：{{ preview.samples.join('、') }}
      </div>
    </div>
    <div v-else-if="preview && !preview.ok" class="import-preview import-preview-error">
      {{ preview.error }}
    </div>

    <div v-if="activeKind === 'bastion' && preview && preview.rows.length > 0" class="import-password">
      <div class="import-password-label">堡垒机密码（所有连接统一使用）</div>
      <el-input
        v-model="password"
        :type="showPassword ? 'text' : 'password'"
        placeholder="请输入堡垒机登录密码"
      >
        <template #suffix>
          <el-icon class="import-password-eye" @click="showPassword = !showPassword">
            <component :is="showPassword ? Hide : View" />
          </el-icon>
        </template>
      </el-input>
    </div>

    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button
        type="primary"
        :disabled="!preview || !preview.ok || preview.rows.length === 0"
        :loading="applying"
        @click="applyImport"
      >
        确认导入
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.import-kind-tabs {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.import-kind-card {
  flex: 1;
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.import-kind-card:hover {
  border-color: var(--el-color-primary);
}
.import-kind-card.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.import-kind-title {
  font-weight: 500;
  margin-bottom: 4px;
}
.import-kind-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.import-guide {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.6;
}
.import-guide p {
  margin: 0 0 8px;
}
.import-guide p:last-child {
  margin-bottom: 0;
}
.import-guide-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.import-file-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.import-file-row .el-input {
  flex: 1;
}
.import-preview {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 16px;
  font-size: 13px;
}
.import-preview-summary {
  font-weight: 500;
}
.import-preview-samples {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.import-preview-error {
  color: var(--el-color-danger);
}
.import-password {
  margin-bottom: 16px;
}
.import-password-label {
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--el-text-color-regular);
}
.import-password-eye {
  cursor: pointer;
}
</style>
