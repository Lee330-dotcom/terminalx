<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { AuthType, ConnectionInput } from '@shared/types'
import { useAppStore } from '../stores/app'

const props = defineProps<{
  visible: boolean
  connectionId: string
}>()

const emit = defineEmits<{
  'update:visible': [boolean]
  saved: []
}>()

const store = useAppStore()
const saving = ref(false)

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
  color: '#10b981'
})

const isEdit = (): boolean => props.connectionId !== ''

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
      color: '#10b981'
    })
    if (isEdit()) {
      const conn = store.connections.find((c) => c.id === props.connectionId)
      if (conn) {
        form.name = conn.name
        form.groupId = conn.groupId
        form.host = conn.host
        form.port = conn.port
        form.username = conn.username
        form.authType = conn.authType
        form.remark = conn.remark
        form.color = conn.color
      }
    }
  }
)

async function pickKeyFile(): Promise<void> {
  const path = await window.api.openFileDialog()
  if (path) form.privateKeyFile = path
}

async function save(): Promise<void> {
  if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
    ElMessage.warning('请填写名称、主机和用户名')
    return
  }
  const input: ConnectionInput = {
    name: form.name.trim(),
    groupId: form.groupId,
    host: form.host.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim(),
    authType: form.authType,
    remark: form.remark,
    color: form.color
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
  saving.value = true
  try {
    if (isEdit()) {
      await window.api.updateConnection(props.connectionId, input)
    } else {
      await window.api.createConnection(input)
    }
    await store.refresh()
    ElMessage.success('已保存')
    emit('saved')
    emit('update:visible', false)
  } catch (err) {
    ElMessage.error(`保存失败：${String(err)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="isEdit() ? '编辑连接' : '新建连接'"
    width="480px"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form label-width="90px" label-position="left">
      <el-form-item label="名称" required>
        <el-input v-model="form.name" placeholder="连接名称" />
      </el-form-item>
      <el-form-item label="分组">
        <el-select v-model="form.groupId" placeholder="未分组" clearable style="width: 100%">
          <el-option v-for="g in store.groups" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="主机" required>
        <el-input v-model="form.host" placeholder="IP 或域名" />
      </el-form-item>
      <el-form-item label="端口">
        <el-input-number v-model="form.port" :min="1" :max="65535" style="width: 100%" />
      </el-form-item>
      <el-form-item label="用户名" required>
        <el-input v-model="form.username" placeholder="root" />
      </el-form-item>
      <el-form-item label="认证方式">
        <el-radio-group v-model="form.authType">
          <el-radio value="password">密码</el-radio>
          <el-radio value="privateKey">私钥</el-radio>
        </el-radio-group>
      </el-form-item>
      <template v-if="form.authType === 'password'">
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="isEdit() ? '留空表示不修改' : ''"
          />
        </el-form-item>
      </template>
      <template v-else>
        <el-form-item label="私钥来源">
          <el-radio-group v-model="form.privateKeyMode">
            <el-radio value="file">私钥文件</el-radio>
            <el-radio value="content">粘贴内容</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.privateKeyMode === 'file'" label="私钥文件">
          <div class="key-file-row">
            <el-input v-model="form.privateKeyFile" placeholder="~/.ssh/id_rsa" />
            <el-button @click="pickKeyFile">浏览</el-button>
          </div>
        </el-form-item>
        <el-form-item v-else label="私钥内容">
          <el-input
            v-model="form.privateKeyContent"
            type="textarea"
            :rows="4"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </el-form-item>
        <el-form-item label="口令">
          <el-input
            v-model="form.passphrase"
            type="password"
            show-password
            placeholder="私钥口令（可选）"
          />
        </el-form-item>
      </template>
      <el-form-item label="标签色">
        <el-color-picker v-model="form.color" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.key-file-row {
  display: flex;
  gap: 6px;
  width: 100%;
}
</style>
