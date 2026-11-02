<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Brush,
  Check,
  Close,
  Connection,
  Download,
  Files,
  MagicStick,
  Search,
  Setting
} from '@element-plus/icons-vue'
import { AppInfo, Settings } from '@shared/types'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../stores/settings'
import { t, setLang, Lang } from '../i18n'
import { DEFAULT_THEME, THEME_PRESETS, ThemePreset } from '../theme'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [boolean] }>()

const settingsStore = useSettingsStore()
const { settings } = storeToRefs(settingsStore)
const appInfo = ref<AppInfo | null>(null)
const activeSection = ref('theme')
const showToken = ref(false)
const searchQuery = ref('')

const sections = [
  { id: 'theme', key: 'settings.theme', icon: Brush },
  { id: 'update', key: 'settings.update', icon: Download },
  { id: 'ai', key: 'settings.ai', icon: MagicStick },
  { id: 'mcp', key: 'settings.mcp', icon: Connection },
  { id: 'backup', key: 'settings.backup', icon: Files },
  { id: 'system', key: 'settings.system', icon: Setting }
]

const filteredSections = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return sections
  return sections.filter((s) => t(s.key).toLowerCase().includes(q))
})

const bgPresets = [
  '#0d0d0d',
  '#141414',
  '#0b1526',
  '#101728',
  '#0e1a13',
  '#1c1408',
  '#151020',
  '#0f2020'
]
const themePresets = ['#10b981', '#409eff', '#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444']
const fontOptions = [
  { label: '系统默认', value: '' },
  { label: 'PingFang SC', value: 'PingFang SC' },
  { label: 'Microsoft YaHei', value: 'Microsoft YaHei' },
  { label: 'Helvetica Neue', value: 'Helvetica Neue' }
]

const toolGroups = [
  {
    nameKey: 'mcp.groupSsh',
    tools: [
      { name: 'list_connections', descKey: 'mcp.tool.listConnections' },
      { name: 'list_sessions', descKey: 'mcp.tool.listSessions' },
      { name: 'exec_command', descKey: 'mcp.tool.execCommand' },
      { name: 'read_terminal', descKey: 'mcp.tool.readTerminal' }
    ]
  },
  {
    nameKey: 'mcp.groupFiles',
    tools: [{ name: 'sftp_list', descKey: 'mcp.tool.sftpList' }]
  },
  {
    nameKey: 'mcp.groupTransfer',
    tools: [
      { name: 'sftp_upload', descKey: 'mcp.tool.sftpUpload' },
      { name: 'sftp_download', descKey: 'mcp.tool.sftpDownload' }
    ]
  }
]

const changelog = [
  {
    version: 'v1.0.0',
    date: '2026-09-18',
    items: [
      '全新设置面板：主题色/背景色/字体/不透明度/缩放',
      'MCP 服务工具管理：按分组启用或禁用工具',
      '系统配置：开机自启动、阻止系统休眠、关闭按钮行为'
    ]
  },
  {
    version: 'v0.9.0',
    date: '2026-09-12',
    items: ['连接管理：收藏、最近/常用、真实 TCP 延迟探测', '深色绿色主题界面']
  },
  {
    version: 'v0.8.0',
    date: '2026-09-05',
    items: ['内置 MCP 服务：7 个工具，Streamable HTTP + Bearer 鉴权', 'SSH 终端与 SFTP 文件面板']
  }
]

// 本地编辑态（拖动/输入过程中不落盘，change 时保存）
const windowOpacity = ref(100)
const uiScale = ref(100)
const uiFont = ref('')
const mcpPort = ref(8080)
const closeButtonAction = ref<'quit' | 'hide'>('hide')
const aiBaseUrl = ref('')
const aiModel = ref('')
const aiKeyInput = ref('')
const aiKeySet = ref(false)
const aiTesting = ref(false)

function syncLocalRefs(): void {
  const s = settings.value
  if (!s) return
  windowOpacity.value = s.windowOpacity
  uiScale.value = s.uiScale
  uiFont.value = s.uiFont
  mcpPort.value = s.mcpPort
  closeButtonAction.value = s.closeButtonAction
}

async function save(patch: Partial<Omit<Settings, 'mcpToken'>>): Promise<void> {
  try {
    await settingsStore.update(patch)
  } catch (err) {
    ElMessage.error(t('settings.saveFailed', { err: String(err) }))
  }
}

function isPresetActive(p: ThemePreset): boolean {
  const s = settings.value
  if (!s) return false
  return (
    s.themeColor === p.themeColor &&
    s.backgroundColor === p.backgroundColor &&
    s.navColor === p.navColor
  )
}

async function restoreDefault(): Promise<void> {
  await save({
    themeColor: DEFAULT_THEME.themeColor,
    backgroundColor: DEFAULT_THEME.backgroundColor,
    navColor: DEFAULT_THEME.navColor,
    uiFont: '',
    followSystemTheme: false
  })
  uiFont.value = ''
  ElMessage.success(t('theme.restored'))
}

async function changeLanguage(lang: Lang): Promise<void> {
  setLang(lang)
  await save({ language: lang })
}

const enabledToolCount = computed(() => {
  const total = toolGroups.reduce((n, g) => n + g.tools.length, 0)
  const disabled = (settings.value?.mcpDisabledTools ?? []).filter((name) =>
    toolGroups.some((g) => g.tools.some((tool) => tool.name === name))
  ).length
  return total - disabled
})

function isToolEnabled(name: string): boolean {
  return !(settings.value?.mcpDisabledTools ?? []).includes(name)
}

async function toggleTool(name: string, enabled: boolean): Promise<void> {
  const disabled = new Set(settings.value?.mcpDisabledTools ?? [])
  if (enabled) disabled.delete(name)
  else disabled.add(name)
  await save({ mcpDisabledTools: [...disabled] })
}

async function syncAiState(): Promise<void> {
  try {
    const status = await window.api.aiStatus()
    aiBaseUrl.value = status.baseUrl
    aiModel.value = status.model
    aiKeySet.value = status.keySet
  } catch (err) {
    ElMessage.error(t('ai.statusFailed', { err: String(err) }))
  }
}

async function saveAi(): Promise<void> {
  await save({ aiBaseUrl: aiBaseUrl.value.trim(), aiModel: aiModel.value.trim() })
  ElMessage.success(t('ai.saved'))
}

async function saveKey(): Promise<void> {
  const key = aiKeyInput.value.trim()
  if (!key) return
  const status = await window.api.setAiKey(key)
  aiKeySet.value = status.keySet
  aiKeyInput.value = ''
  ElMessage.success(t('ai.keySavedMsg'))
}

async function clearKey(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('ai.clearConfirm'), t('ai.key'), { type: 'warning' })
  } catch {
    return
  }
  const status = await window.api.setAiKey(null)
  aiKeySet.value = status.keySet
  ElMessage.success(t('ai.keyClearedMsg'))
}

async function testAi(): Promise<void> {
  aiTesting.value = true
  try {
    // 输入框里尚未保存的 Key/地址/模型先落盘，避免「看起来配好了但测试说没配置」
    if (aiKeyInput.value.trim()) {
      const status = await window.api.setAiKey(aiKeyInput.value.trim())
      aiKeySet.value = status.keySet
      aiKeyInput.value = ''
    }
    const saved = settings.value
    const baseUrl = aiBaseUrl.value.trim()
    const model = aiModel.value.trim()
    if (saved && (saved.aiBaseUrl !== baseUrl || saved.aiModel !== model)) {
      await save({ aiBaseUrl: baseUrl, aiModel: model })
    }
    const result = await window.api.testAi()
    if (result.ok) {
      ElMessage.success(t('ai.testOk', { ms: String(result.durationMs ?? 0) }))
    } else {
      ElMessage.error(t('ai.testFailed', { err: result.error ?? '' }))
    }
  } finally {
    aiTesting.value = false
  }
}

async function copyUrl(): Promise<void> {
  await navigator.clipboard.writeText(`http://127.0.0.1:${mcpPort.value}/mcp`)
  ElMessage.success(t('mcp.urlCopied'))
}

async function copyToken(): Promise<void> {
  if (!settings.value) return
  await navigator.clipboard.writeText(settings.value.mcpToken)
  ElMessage.success(t('mcp.tokenCopied'))
}

async function regenerate(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('mcp.regenerateConfirm'), t('mcp.regenerateTitle'), {
      type: 'warning'
    })
    await window.api.regenerateToken()
    await settingsStore.load()
    ElMessage.success(t('mcp.tokenUpdated'))
  } catch {
    /* 取消 */
  }
}

async function exportSettings(): Promise<void> {
  try {
    const path = await window.api.exportSettings()
    if (path) ElMessage.success(t('backup.exportSuccess', { path }))
  } catch (err) {
    ElMessage.error(t('backup.exportFailed', { err: String(err) }))
  }
}

async function importSettings(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('backup.importDesc'), t('backup.import'), {
      type: 'warning',
      confirmButtonText: t('backup.importBtn'),
      cancelButtonText: t('common.cancel')
    })
  } catch {
    return
  }
  const result = await window.api.importSettings()
  if (result.ok) {
    await settingsStore.load()
    syncLocalRefs()
    ElMessage.success(t('backup.importSuccess'))
  } else {
    ElMessage.error(t('backup.importFailed', { err: result.error ?? '' }))
  }
}

async function checkUpdate(): Promise<void> {
  ElMessage.info(t('update.latest'))
}

async function load(): Promise<void> {
  await settingsStore.load()
  syncLocalRefs()
  await syncAiState()
  appInfo.value = await window.api.getAppInfo()
}

watch(
  () => props.visible,
  (v) => {
    if (v) void load()
  }
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.visible) emit('update:visible', false)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="visible" class="settings-overlay" @click.self="emit('update:visible', false)">
    <div class="settings-window">
      <aside class="settings-sidebar">
        <div class="sidebar-title">{{ t('settings.title') }}</div>
        <el-input
          v-model="searchQuery"
          class="sidebar-search"
          :placeholder="t('settings.searchPlaceholder')"
          :prefix-icon="Search"
          clearable
        />
        <div
          v-for="sec in filteredSections"
          :key="sec.id"
          class="nav-item"
          :class="{ active: activeSection === sec.id }"
          @click="activeSection = sec.id"
        >
          <el-icon :size="15"><component :is="sec.icon" /></el-icon>
          <span>{{ t(sec.key) }}</span>
        </div>
        <div v-if="filteredSections.length === 0" class="nav-hint">无匹配项</div>
      </aside>

      <div class="settings-content">
        <header class="settings-header">
          <span class="header-title">
            {{ t(sections.find((s) => s.id === activeSection)?.key ?? '') }}
          </span>
          <div class="header-actions">
            <el-button v-if="activeSection === 'theme'" size="small" text @click="restoreDefault">
              {{ t('theme.restoreDefault') }}
            </el-button>
            <el-button text circle class="close-btn" @click="emit('update:visible', false)">
              <el-icon :size="16"><Close /></el-icon>
            </el-button>
          </div>
        </header>

        <div class="settings-scroll">
          <!-- 主题界面 -->
          <template v-if="activeSection === 'theme' && settings">
            <div class="settings-card">
              <div class="card-title">{{ t('theme.bgPresets') }}</div>
              <div class="setting-desc">{{ t('theme.bgPresetsDesc') }}</div>
              <div class="preset-grid">
                <div
                  v-for="p in THEME_PRESETS"
                  :key="p.id"
                  class="preset-tile"
                  :class="{ active: isPresetActive(p) }"
                  @click="
                    save({
                      themeColor: p.themeColor,
                      backgroundColor: p.backgroundColor,
                      navColor: p.navColor
                    })
                  "
                >
                  <div class="preset-preview" :style="{ background: p.backgroundColor }">
                    <span class="preset-nav" :style="{ background: p.navColor }" />
                    <span class="preset-dot" :style="{ background: p.themeColor }" />
                  </div>
                  <span class="preset-name">{{ t('preset.' + p.id) }}</span>
                </div>
              </div>
            </div>

            <div class="settings-card">
              <div class="card-title">{{ t('theme.themeColor') }}</div>
              <div class="setting-desc">{{ t('theme.themeColorDesc') }}</div>
              <div class="swatch-row">
                <div
                  v-for="c in themePresets"
                  :key="c"
                  class="swatch"
                  :class="{ active: settings.themeColor === c }"
                  :style="{ background: c }"
                  @click="save({ themeColor: c })"
                >
                  <el-icon v-if="settings.themeColor === c" :size="13" color="var(--tx-text)">
                    <Check />
                  </el-icon>
                </div>
                <el-color-picker
                  :model-value="settings.themeColor"
                  @change="(v) => v && save({ themeColor: v })"
                />
                <span class="color-value">{{ settings.themeColor }}</span>
              </div>
            </div>

            <div class="settings-card">
              <div class="card-title">{{ t('theme.bgColor') }}</div>
              <div class="setting-desc">{{ t('theme.bgColorDesc') }}</div>
              <div class="swatch-row">
                <div
                  v-for="c in bgPresets"
                  :key="c"
                  class="swatch"
                  :class="{ active: settings.backgroundColor === c }"
                  :style="{ background: c }"
                  @click="save({ backgroundColor: c })"
                >
                  <el-icon v-if="settings.backgroundColor === c" :size="13" color="var(--tx-text)">
                    <Check />
                  </el-icon>
                </div>
                <el-color-picker
                  :model-value="settings.backgroundColor"
                  @change="(v) => v && save({ backgroundColor: v })"
                />
                <span class="color-value">{{ settings.backgroundColor }}</span>
              </div>
            </div>

            <div class="settings-card">
              <div class="card-title">{{ t('theme.navColor') }}</div>
              <div class="setting-desc">{{ t('theme.navColorDesc') }}</div>
              <div class="swatch-row">
                <div
                  v-for="c in themePresets"
                  :key="c"
                  class="swatch"
                  :class="{ active: settings.navColor === c }"
                  :style="{ background: c }"
                  @click="save({ navColor: c })"
                >
                  <el-icon v-if="settings.navColor === c" :size="13" color="var(--tx-text)">
                    <Check />
                  </el-icon>
                </div>
                <el-color-picker
                  :model-value="settings.navColor"
                  @change="(v) => v && save({ navColor: v })"
                />
                <span class="color-value">{{ settings.navColor }}</span>
              </div>
            </div>

            <div class="settings-card">
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('theme.followSystem') }}</div>
                  <div class="setting-desc">{{ t('theme.followSystemDesc') }}</div>
                </div>
                <el-switch
                  :model-value="settings.followSystemTheme"
                  @change="(v) => save({ followSystemTheme: v as boolean })"
                />
              </div>
            </div>

            <div class="settings-card">
              <div class="card-title">{{ t('theme.ui') }}</div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('theme.uiFont') }}</div>
                  <div class="setting-desc">{{ t('theme.uiFontDesc') }}</div>
                </div>
                <el-select
                  v-model="uiFont"
                  :placeholder="t('theme.systemDefault')"
                  style="width: 180px"
                  @change="save({ uiFont })"
                >
                  <el-option
                    v-for="f in fontOptions"
                    :key="f.label"
                    :label="f.label"
                    :value="f.value"
                  />
                </el-select>
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('theme.opacity') }}</div>
                  <div class="setting-desc">{{ t('theme.opacityDesc') }}</div>
                </div>
                <div class="slider-wrap">
                  <el-slider
                    v-model="windowOpacity"
                    :min="60"
                    :max="100"
                    style="width: 220px"
                    @change="save({ windowOpacity })"
                  />
                  <span class="slider-value">{{ windowOpacity }}%</span>
                </div>
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('theme.scale') }}</div>
                  <div class="setting-desc">{{ t('theme.scaleDesc') }}</div>
                </div>
                <div class="slider-wrap">
                  <el-slider
                    v-model="uiScale"
                    :min="80"
                    :max="140"
                    :step="5"
                    style="width: 220px"
                    @change="save({ uiScale })"
                  />
                  <span class="slider-value">{{ uiScale }}%</span>
                </div>
              </div>
            </div>
          </template>

          <!-- 软件更新 -->
          <template v-if="activeSection === 'update'">
            <div class="settings-card">
              <div class="card-title">{{ t('update.currentVersion') }}</div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">
                    terminalX {{ appInfo ? `v${appInfo.version}` : '…' }}
                  </div>
                  <div class="setting-desc">{{ t('update.channel') }}</div>
                </div>
                <el-button type="primary" @click="checkUpdate">{{ t('update.check') }}</el-button>
              </div>
            </div>
            <div class="settings-card">
              <div class="card-title">{{ t('update.log') }}</div>
              <div v-for="item in changelog" :key="item.version" class="changelog-item">
                <div class="changelog-head">
                  <span class="changelog-version">{{ item.version }}</span>
                  <span class="changelog-date">{{ item.date }}</span>
                </div>
                <ul class="changelog-list">
                  <li v-for="line in item.items" :key="line">{{ line }}</li>
                </ul>
              </div>
            </div>
          </template>

          <!-- MCP 服务 -->
          <template v-if="activeSection === 'mcp' && settings">
            <div class="settings-card">
              <div class="card-title">{{ t('mcp.basic') }}</div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('mcp.enable') }}</div>
                  <div class="setting-desc">{{ t('mcp.enableDesc') }}</div>
                </div>
                <el-switch
                  :model-value="settings.mcpEnabled"
                  @change="(v) => save({ mcpEnabled: v as boolean })"
                />
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('mcp.port') }}</div>
                  <div class="setting-desc">{{ t('mcp.portDesc') }}</div>
                </div>
                <el-input-number
                  v-model="mcpPort"
                  :min="1024"
                  :max="65535"
                  @change="save({ mcpPort })"
                />
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('mcp.url') }}</div>
                  <div class="setting-desc">{{ t('mcp.urlDesc') }}</div>
                </div>
                <div class="url-row">
                  <code class="url-text">http://127.0.0.1:{{ mcpPort }}/mcp</code>
                  <el-button size="small" @click="copyUrl">{{ t('mcp.copy') }}</el-button>
                </div>
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('mcp.token') }}</div>
                  <div class="setting-desc">{{ t('mcp.tokenDesc') }}</div>
                </div>
                <div class="token-row">
                  <code class="token-text">
                    {{ showToken ? settings.mcpToken : '•'.repeat(32) }}
                  </code>
                  <el-button size="small" text @click="showToken = !showToken">
                    {{ showToken ? t('mcp.hide') : t('mcp.show') }}
                  </el-button>
                  <el-button size="small" @click="copyToken">{{ t('mcp.copy') }}</el-button>
                  <el-button size="small" type="danger" plain @click="regenerate">
                    {{ t('mcp.regenerate') }}
                  </el-button>
                </div>
              </div>
            </div>

            <div class="settings-card">
              <div class="card-title-row">
                <span class="card-title">{{ t('mcp.tools') }}</span>
                <span class="tool-count">
                  {{ t('mcp.enabledCount', { n: enabledToolCount, total: 7 }) }}
                </span>
              </div>
              <div class="setting-desc" style="margin-bottom: 6px">
                {{ t('mcp.toolsDesc') }}
              </div>
              <div v-for="group in toolGroups" :key="group.nameKey">
                <div class="tool-group-name">{{ t(group.nameKey) }}</div>
                <div v-for="tool in group.tools" :key="tool.name" class="tool-row">
                  <div class="tool-info">
                    <span class="tool-name">{{ tool.name }}</span>
                    <span class="tool-desc">{{ t(tool.descKey) }}</span>
                  </div>
                  <el-switch
                    :model-value="isToolEnabled(tool.name)"
                    @change="(v) => toggleTool(tool.name, v as boolean)"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- AI 只读分析 -->
          <template v-if="activeSection === 'ai' && settings">
            <div class="settings-card">
              <div class="card-title">{{ t('ai.provider') }}</div>
              <div class="setting-desc" style="margin-bottom: 8px">
                {{ t('ai.providerDesc') }}
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('ai.baseUrl') }}</div>
                  <div class="setting-desc">{{ t('ai.baseUrlDesc') }}</div>
                </div>
                <el-input
                  v-model="aiBaseUrl"
                  style="width: 300px"
                  placeholder="https://api.openai.com/v1"
                  @change="saveAi"
                />
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('ai.model') }}</div>
                  <div class="setting-desc">{{ t('ai.modelDesc') }}</div>
                </div>
                <el-input
                  v-model="aiModel"
                  style="width: 300px"
                  placeholder="gpt-4o-mini"
                  @change="saveAi"
                />
              </div>
            </div>

            <div class="settings-card">
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('ai.autoExecute') }}</div>
                  <div class="setting-desc">{{ t('ai.autoExecuteDesc') }}</div>
                </div>
                <el-switch
                  :model-value="settings.aiAutoExecute"
                  @change="(v) => save({ aiAutoExecute: v as boolean })"
                />
              </div>
            </div>

            <div class="settings-card">
              <div class="card-title">{{ t('ai.key') }}</div>
              <div class="setting-desc" style="margin-bottom: 8px">
                {{ aiKeySet ? t('ai.keySaved') : t('ai.keyMissing') }}
              </div>
              <div class="token-row">
                <el-input
                  v-model="aiKeyInput"
                  type="password"
                  show-password
                  :placeholder="t('ai.keyPlaceholder')"
                  style="width: 280px"
                />
                <el-button
                  size="small"
                  type="primary"
                  :disabled="!aiKeyInput.trim()"
                  @click="saveKey"
                >
                  {{ t('common.save') }}
                </el-button>
                <el-button v-if="aiKeySet" size="small" type="danger" plain @click="clearKey">
                  {{ t('ai.clearKey') }}
                </el-button>
              </div>
            </div>

            <div class="settings-card">
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('ai.test') }}</div>
                  <div class="setting-desc">{{ t('ai.testDesc') }}</div>
                </div>
                <el-button size="small" :loading="aiTesting" @click="testAi">
                  {{ t('ai.testBtn') }}
                </el-button>
              </div>
            </div>

            <div class="settings-card">
              <div class="setting-desc">{{ t('ai.readonlyNote') }}</div>
            </div>
          </template>

          <!-- 备份恢复 -->
          <template v-if="activeSection === 'backup'">
            <div class="settings-card">
              <div class="card-title">{{ t('backup.export') }}</div>
              <div class="setting-desc">{{ t('backup.exportDesc') }}</div>
              <div style="margin-top: 12px">
                <el-button type="primary" @click="exportSettings">
                  {{ t('backup.exportBtn') }}
                </el-button>
              </div>
            </div>
            <div class="settings-card">
              <div class="card-title">{{ t('backup.import') }}</div>
              <div class="setting-desc">{{ t('backup.importDesc') }}</div>
              <div style="margin-top: 12px">
                <el-button @click="importSettings">{{ t('backup.importBtn') }}</el-button>
              </div>
            </div>
          </template>

          <!-- 系统配置 -->
          <template v-if="activeSection === 'system' && settings">
            <div class="settings-card">
              <div class="card-title">{{ t('system.startup') }}</div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('system.autoLaunch') }}</div>
                  <div class="setting-desc">{{ t('system.autoLaunchDesc') }}</div>
                </div>
                <el-switch
                  :model-value="settings.autoLaunch"
                  @change="(v) => save({ autoLaunch: v as boolean })"
                />
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('system.blockSleep') }}</div>
                  <div class="setting-desc">{{ t('system.blockSleepDesc') }}</div>
                </div>
                <el-switch
                  :model-value="settings.blockSystemSleep"
                  @change="(v) => save({ blockSystemSleep: v as boolean })"
                />
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('system.noHardwareAccel') }}</div>
                  <div class="setting-desc">{{ t('system.noHardwareAccelDesc') }}</div>
                </div>
                <el-switch
                  :model-value="settings.disableHardwareAcceleration"
                  @change="(v) => save({ disableHardwareAcceleration: v as boolean })"
                />
              </div>
            </div>

            <div class="settings-card">
              <div class="card-title">{{ t('system.window') }}</div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('system.closeAction') }}</div>
                  <div class="setting-desc">{{ t('system.closeActionDesc') }}</div>
                </div>
                <el-radio-group v-model="closeButtonAction" @change="save({ closeButtonAction })">
                  <el-radio value="hide">{{ t('system.hideToDock') }}</el-radio>
                  <el-radio value="quit">{{ t('system.quit') }}</el-radio>
                </el-radio-group>
              </div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('system.confirmOnClose') }}</div>
                  <div class="setting-desc">{{ t('system.confirmOnCloseDesc') }}</div>
                </div>
                <el-switch
                  :model-value="settings.confirmOnClose"
                  @change="(v) => save({ confirmOnClose: v as boolean })"
                />
              </div>
            </div>

            <div class="settings-card">
              <div class="setting-row">
                <div>
                  <div class="setting-label">{{ t('system.language') }}</div>
                  <div class="setting-desc">{{ t('system.languageDesc') }}</div>
                </div>
                <el-select
                  :model-value="settings.language"
                  style="width: 140px"
                  @change="(v) => changeLanguage(v as Lang)"
                >
                  <el-option label="中文" value="zh-CN" />
                  <el-option label="English" value="en-US" />
                </el-select>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  background: color-mix(in srgb, #000 42%, transparent);
}
.settings-window {
  display: flex;
  width: min(1120px, calc(100vw - 96px));
  height: min(760px, calc(100vh - 96px));
  min-height: 420px;
  overflow: hidden;
  border: 1px solid var(--tx-border);
  border-radius: 12px;
  background: var(--tx-bg);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
}
.settings-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--tx-border);
  background: var(--tx-panel);
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sidebar-title {
  padding: 4px 12px 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--tx-text);
}
.sidebar-search {
  margin: 0 2px 10px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--tx-text-2);
  cursor: pointer;
}
.nav-item:hover {
  background: var(--tx-hover);
}
.nav-item.active {
  background: color-mix(in srgb, var(--tx-green) 14%, transparent);
  color: var(--tx-green-hover);
  font-weight: 600;
}
.nav-hint {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--tx-text-3);
}
.settings-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--tx-border);
  flex-shrink: 0;
}
.header-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--tx-text);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.close-btn {
  color: var(--tx-text-2);
}
.close-btn:hover {
  color: var(--tx-green-hover);
}
.settings-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.settings-card {
  background: var(--tx-card);
  border: 1px solid var(--tx-border);
  border-radius: 10px;
  padding: 18px 20px;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--tx-text);
  margin-bottom: 10px;
}
.card-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card-title-row .card-title {
  margin-bottom: 6px;
}
.tool-count {
  font-size: 12px;
  color: var(--tx-green-hover);
  margin-bottom: 6px;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 11px 0;
}
.setting-row + .setting-row {
  border-top: 1px solid var(--tx-border);
}
.setting-label {
  font-size: 13px;
  color: var(--tx-text);
}
.setting-desc {
  font-size: 12px;
  color: var(--tx-text-3);
  margin-top: 3px;
}
.preset-grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 10px;
  margin-top: 12px;
}
.preset-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 4px 0;
  border-radius: 8px;
}
.preset-tile:hover {
  background: var(--tx-hover);
}
.preset-tile.active {
  background: color-mix(in srgb, var(--tx-green) 12%, transparent);
}
.preset-preview {
  width: 44px;
  height: 34px;
  border-radius: 6px;
  border: 1px solid var(--tx-border);
  position: relative;
  overflow: hidden;
}
.preset-nav {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 10px;
}
.preset-dot {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 3px;
}
.preset-name {
  font-size: 11px;
  color: var(--tx-text-2);
  white-space: nowrap;
}
.preset-tile.active .preset-name {
  color: var(--tx-green-hover);
}
.swatch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.swatch {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}
.swatch:hover {
  border-color: var(--tx-border-strong);
}
.swatch.active {
  border-color: var(--tx-green);
}
.color-value {
  font-size: 12px;
  color: var(--tx-text-3);
  font-family: ui-monospace, Menlo, monospace;
}
.slider-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
}
.slider-value {
  width: 44px;
  text-align: right;
  font-size: 12px;
  color: var(--tx-text-2);
  font-family: ui-monospace, Menlo, monospace;
}
.url-row,
.token-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  max-width: 560px;
}
.url-text,
.token-text {
  flex: 1;
  background: var(--tx-fill);
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-group-name {
  font-size: 12px;
  color: var(--tx-text-3);
  margin: 14px 0 4px;
}
.tool-group-name:first-child {
  margin-top: 6px;
}
.tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid var(--tx-border);
}
.tool-row:last-child {
  border-bottom: none;
}
.tool-info {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.tool-name {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 13px;
  color: var(--tx-green-hover);
  flex-shrink: 0;
}
.tool-desc {
  font-size: 12px;
  color: var(--tx-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.changelog-item {
  padding: 10px 0;
}
.changelog-item + .changelog-item {
  border-top: 1px solid var(--tx-border);
}
.changelog-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.changelog-version {
  font-size: 13px;
  font-weight: 600;
  color: var(--tx-green-hover);
}
.changelog-date {
  font-size: 12px;
  color: var(--tx-text-3);
}
.changelog-list {
  padding-left: 18px;
}
.changelog-list li {
  font-size: 12px;
  color: var(--tx-text-2);
  line-height: 1.9;
  list-style: disc;
}
</style>
