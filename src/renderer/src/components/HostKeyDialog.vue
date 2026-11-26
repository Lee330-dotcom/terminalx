<script setup lang="ts">
import { computed } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'
import { useHostKeyStore } from '../stores/hostKeys'
import { t } from '../i18n'

const hostKeys = useHostKeyStore()

const visible = computed({
  get: () => hostKeys.pending !== null,
  set: (v: boolean) => {
    if (!v && hostKeys.pending) void hostKeys.respond(false)
  }
})

const changed = computed(() => hostKeys.pending?.status === 'changed')

async function trust(): Promise<void> {
  await hostKeys.respond(true)
}

async function reject(): Promise<void> {
  await hostKeys.respond(false)
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="host-key-dialog"
    :width="520"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    :title="changed ? t('hostKey.changedTitle') : t('hostKey.newTitle')"
  >
    <div v-if="hostKeys.pending" class="host-key-body">
      <div v-if="changed" class="host-key-warning">
        <el-icon class="host-key-warning-icon"><WarningFilled /></el-icon>
        <span>{{ t('hostKey.changedWarning') }}</span>
      </div>

      <p v-else class="host-key-intro">{{ t('hostKey.newIntro') }}</p>

      <dl class="host-key-fields">
        <div class="host-key-field">
          <dt>{{ t('hostKey.host') }}</dt>
          <dd>{{ hostKeys.pending.host }}:{{ hostKeys.pending.port }}</dd>
        </div>
        <div class="host-key-field">
          <dt>{{ t('hostKey.keyType') }}</dt>
          <dd>{{ hostKeys.pending.keyType }}</dd>
        </div>
        <div class="host-key-field">
          <dt>{{ t('hostKey.fingerprint') }}</dt>
          <dd class="host-key-fingerprint">{{ hostKeys.pending.fingerprint }}</dd>
        </div>
        <div v-if="changed" class="host-key-field">
          <dt>{{ t('hostKey.storedFingerprint') }}</dt>
          <dd class="host-key-fingerprint stored">{{ hostKeys.pending.storedFingerprint }}</dd>
        </div>
      </dl>
    </div>

    <template #footer>
      <el-button @click="reject">{{ t('hostKey.reject') }}</el-button>
      <el-button :type="changed ? 'danger' : 'primary'" @click="trust">
        {{ changed ? t('hostKey.acceptChanged') : t('hostKey.trust') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.host-key-body {
  display: flex;
  flex-direction: column;
  gap: var(--tx-space-3);
}
.host-key-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--tx-space-2);
  padding: var(--tx-space-3);
  border: 1px solid var(--tx-danger);
  border-radius: var(--tx-radius-md);
  background: var(--tx-danger-soft);
  color: var(--tx-danger);
  font-size: var(--tx-font-sm);
  line-height: 1.6;
}
.host-key-warning-icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 16px;
}
.host-key-intro {
  margin: 0;
  color: var(--tx-text-2);
  font-size: var(--tx-font-sm);
  line-height: 1.6;
}
.host-key-fields {
  display: flex;
  flex-direction: column;
  gap: var(--tx-space-2);
  margin: 0;
  padding: var(--tx-space-3);
  border: 1px solid var(--tx-border);
  border-radius: var(--tx-radius-md);
  background: var(--tx-fill);
}
.host-key-field {
  display: flex;
  align-items: baseline;
  gap: var(--tx-space-3);
}
.host-key-field dt {
  flex-shrink: 0;
  width: 88px;
  color: var(--tx-text-3);
  font-size: var(--tx-font-sm);
}
.host-key-field dd {
  margin: 0;
  min-width: 0;
  color: var(--tx-text);
  font-size: var(--tx-font-sm);
  word-break: break-all;
}
.host-key-fingerprint {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--tx-font-xs);
}
.host-key-fingerprint.stored {
  color: var(--tx-danger);
}
</style>
