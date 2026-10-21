<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { AuthType, ConnectionInput } from '@shared/types'
import { useAppStore } from '../stores/app'
import { t } from '../i18n'

const props = defineProps<{
  visible: boolean
  connectionId: string
  cloneFromId?: string
}>()

const emit = defineEmits<{
  'update:visible': [boolean]
  saved: []
}>()

const store = useAppStore()
const saving = ref(false)
const testing = ref(false)

const form = reactive({
  name: '',
  groupId: null as string | null,
  host: '',
  port: 22,
  username: '',
  authType: 'password' as AuthType,
  password: '',
  privateKeyMode: 'file' as 'file' | 'content',
  privateKeyFile: '',
  privateKeyContent: '',
  passphrase: '',
  remark: '',
  color: '#10b981',
  timeoutMs: null as number | null
})

const isEdit = (): boolean => props.connectionId !== ''
const isClone = (): boolean => !isEdit() && Boolean(props.cloneFromId)

watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    Object.assign(form, {
      name: '',
      groupId: null,
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      privateKeyMode: 'file',
      privateKeyFile: '',
      privateKeyContent: '',
      passphrase: '',
      remark: '',
      color: '#10b981',
      timeoutMs: null
    })
    const sourceId = props.connectionId || props.cloneFromId
    if (sourceId) {
      const conn = store.connections.find((c) => c.id === sourceId)
      if (conn) {
        form.name = conn.name
        form.groupId = conn.groupId
        form.host = conn.host
        form.port = conn.port
        form.username = conn.username
        form.authType = conn.authType
        form.remark = conn.remark
        form.color = conn.color
        form.timeoutMs = conn.timeoutMs
      }
    }
  }
)

async function pickKeyFile(): Promise<void> {
  const path = await window.api.openFileDialog()
  if (path) form.privateKeyFile = path
}

function buildInput(): ConnectionInput {
  const input: ConnectionInput = {
    name: form.name.trim(),
    groupId: form.groupId,
    host: form.host.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim(),
    authType: form.authType,
    remark: form.remark,
    color: form.color,
    timeoutMs: form.timeoutMs
  }
  if (form.authType === 'password') {
    // 编辑时留空表示不修改已有密码
    if (form.password) input.password = form.password
  } else {
    if (form.privateKeyMode === 'file') {
      if (form.privateKeyFile) input.privateKeyFile = form.privateKeyFile
    } else {
      if (form.privateKeyContent.trim()) input.privateKeyContent = form.privateKeyContent.trim()
    }
    if (form.passphrase) input.passphrase = form.passphrase
  }
  return input
}

async function save(): Promise<void> {
  if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
    ElMessage.warning(t('form.fillRequired'))
    return
  }
  const input = buildInput()
  saving.value = true
  try {
    if (isEdit()) {
      await window.api.updateConnection(props.connectionId, input)
    } else {
      await window.api.createConnection(input)
    }
    await store.refresh()
    ElMessage.success(t('form.saved'))
    emit('saved')
    emit('update:visible', false)
  } catch (err) {
    ElMessage.error(t('form.saveFailed', { err: String(err) }))
  } finally {
    saving.value = false
  }
}

async function test(): Promise<void> {
  if (!form.host.trim() || !form.username.trim()) {
    ElMessage.warning(t('form.fillTestRequired'))
    return
  }
  if (form.authType === 'password' && !form.password && !isEdit()) {
    ElMessage.warning(t('form.fillPassword'))
    return
  }
  testing.value = true
  try {
    const result = await window.api.testConnection(
      buildInput(),
      isEdit() ? props.connectionId : undefined
    )
    if (result.ok) {
      ElMessage.success(t('form.testOk', { ms: result.durationMs ?? 0 }))
    } else {
      ElMessage.error(t('form.testFailed', { err: result.error ?? '' }))
    }
  } catch (err) {
    ElMessage.error(t('form.testFailed', { err: String(err) }))
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="isEdit() || isClone() ? t('form.editTitle') : t('form.newTitle')"
    width="660px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="conn-dialog">
      <div class="conn-side">
        <div class="nav-item active">{{ t('form.basicInfo') }}</div>
      </div>
      <div class="conn-body">
        <el-form label-width="120px" label-position="left">
          <el-form-item :label="t('form.name')" required>
            <el-input v-model="form.name" :placeholder="t('form.namePlaceholder')" />
          </el-form-item>
          <el-form-item :label="t('form.group')">
            <el-select
              v-model="form.groupId"
              :placeholder="t('form.groupPlaceholder')"
              clearable
              style="width: 100%"
            >
              <el-option v-for="g in store.groups" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('form.address')" required>
            <div class="address-row">
              <el-input
                v-model="form.host"
                :placeholder="t('form.hostPlaceholder')"
                class="host-input"
              />
              <el-input-number
                v-model="form.port"
                :min="1"
                :max="65535"
                :controls="false"
                class="port-input"
              />
            </div>
            <div class="form-hint">{{ t('form.addressHint') }}</div>
          </el-form-item>
          <el-form-item :label="t('form.authType')">
            <el-select v-model="form.authType" class="auth-select">
              <el-option value="password" :label="t('form.password')" />
              <el-option value="privateKey" :label="t('form.privateKey')" />
            </el-select>
            <div class="form-hint">
              {{
                form.authType === 'password' ? t('form.authHintPassword') : t('form.authHintKey')
              }}
            </div>
          </el-form-item>
          <el-form-item :label="t('form.loginUser')" required>
            <el-input v-model="form.username" placeholder="root" />
          </el-form-item>
          <template v-if="form.authType === 'password'">
            <el-form-item :label="t('form.loginPassword')">
              <el-input
                v-model="form.password"
                type="password"
                show-password
                :placeholder="isEdit() ? t('form.passwordEditHint') : t('form.passwordCloneHint')"
              />
            </el-form-item>
          </template>
          <template v-else>
            <el-form-item :label="t('form.keySource')">
              <el-radio-group v-model="form.privateKeyMode">
                <el-radio value="file">{{ t('form.keyFile') }}</el-radio>
                <el-radio value="content">{{ t('form.pasteContent') }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="form.privateKeyMode === 'file'" :label="t('form.keyFile')">
              <div class="key-file-row">
                <el-input v-model="form.privateKeyFile" placeholder="~/.ssh/id_rsa" />
                <el-button @click="pickKeyFile">{{ t('form.browse') }}</el-button>
              </div>
            </el-form-item>
            <el-form-item v-else :label="t('form.keyContent')">
              <el-input
                v-model="form.privateKeyContent"
                type="textarea"
                :rows="4"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
            </el-form-item>
            <el-form-item :label="t('form.passphrase')">
              <el-input
                v-model="form.passphrase"
                type="password"
                show-password
                :placeholder="t('form.passphrasePlaceholder')"
              />
            </el-form-item>
          </template>
          <el-form-item :label="t('form.remark')">
            <el-input v-model="form.remark" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item :label="t('form.timeout')">
            <el-input-number
              v-model="form.timeoutMs"
              :min="1000"
              :max="600000"
              :step="1000"
              :controls="false"
              :placeholder="t('form.timeoutPlaceholder')"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item :label="t('form.colorTag')">
            <el-color-picker v-model="form.color" />
          </el-form-item>
        </el-form>
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <el-button :loading="testing" @click="test">{{ t('form.testConnection') }}</el-button>
        <div class="dialog-footer-right">
          <el-button @click="emit('update:visible', false)">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="saving" @click="save">{{
            t('common.save')
          }}</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
:deep(.el-dialog__body) {
  padding: 0;
}

.conn-dialog {
  display: flex;
  align-items: stretch;
  min-height: 440px;
}

.conn-side {
  width: 140px;
  flex-shrink: 0;
  padding: 12px 8px;
  border-right: 1px solid var(--tx-border);
  background: var(--tx-fill);
}

.nav-item {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--tx-text-2);
  cursor: pointer;
}

.nav-item.active {
  background: color-mix(in srgb, var(--tx-green) 14%, transparent);
  color: var(--tx-green);
}

.conn-body {
  flex: 1;
  padding: 18px 20px 4px;
  overflow-y: auto;
  max-height: 520px;
}

.address-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.host-input {
  flex: 1;
}

.port-input {
  width: 96px;
}

.auth-select {
  width: 180px;
}

.form-hint {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--tx-text-3);
}

.key-file-row {
  display: flex;
  gap: 6px;
  width: 100%;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.dialog-footer-right {
  display: flex;
  gap: 6px;
}
</style>
