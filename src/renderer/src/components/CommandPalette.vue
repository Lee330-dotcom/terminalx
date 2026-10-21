<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  sessionId: string
}>()

const emit = defineEmits<{
  close: []
  send: [command: string]
}>()

const search = ref('')
const selectedIndex = ref(0)

interface Command {
  label: string
  description: string
  command: string
  category: string
}

const commands: Command[] = [
  { label: 'ls', description: '列出目录内容', command: 'ls -la\n', category: '文件' },
  { label: 'cd', description: '切换目录', command: 'cd ', category: '文件' },
  { label: 'pwd', description: '显示当前目录', command: 'pwd\n', category: '文件' },
  { label: 'cat', description: '查看文件内容', command: 'cat ', category: '文件' },
  { label: 'tail -f', description: '实时查看日志', command: 'tail -f ', category: '日志' },
  { label: 'grep', description: '搜索文本', command: 'grep ', category: '搜索' },
  { label: 'find', description: '查找文件', command: 'find . -name ', category: '搜索' },
  { label: 'ps aux', description: '查看进程', command: 'ps aux\n', category: '系统' },
  { label: 'top', description: '系统资源监控', command: 'top\n', category: '系统' },
  { label: 'df -h', description: '磁盘使用情况', command: 'df -h\n', category: '系统' },
  { label: 'free -h', description: '内存使用情况', command: 'free -h\n', category: '系统' },
  { label: 'netstat', description: '网络连接', command: 'netstat -tulpn\n', category: '网络' },
  { label: 'curl', description: 'HTTP 请求', command: 'curl ', category: '网络' },
  { label: 'ping', description: '测试网络连通', command: 'ping ', category: '网络' },
  { label: 'ssh', description: 'SSH 连接', command: 'ssh ', category: '网络' },
  { label: 'scp', description: '远程复制', command: 'scp ', category: '网络' },
  { label: 'tar', description: '压缩/解压', command: 'tar -czvf ', category: '文件' },
  { label: 'chmod', description: '修改权限', command: 'chmod ', category: '文件' },
  { label: 'chown', description: '修改所有者', command: 'chown ', category: '文件' },
  { label: 'mkdir', description: '创建目录', command: 'mkdir ', category: '文件' },
  { label: 'rm', description: '删除文件', command: 'rm ', category: '文件' },
  { label: 'cp', description: '复制文件', command: 'cp ', category: '文件' },
  { label: 'mv', description: '移动文件', command: 'mv ', category: '文件' },
  { label: 'vim', description: '编辑文件', command: 'vim ', category: '编辑' },
  { label: 'nano', description: '编辑文件', command: 'nano ', category: '编辑' },
  { label: 'git status', description: 'Git 状态', command: 'git status\n', category: 'Git' },
  { label: 'git log', description: 'Git 日志', command: 'git log --oneline\n', category: 'Git' },
  { label: 'git pull', description: 'Git 拉取', command: 'git pull\n', category: 'Git' },
  { label: 'docker ps', description: 'Docker 容器', command: 'docker ps\n', category: 'Docker' },
  { label: 'docker logs', description: 'Docker 日志', command: 'docker logs ', category: 'Docker' },
  { label: 'kubectl get pods', description: 'K8s Pods', command: 'kubectl get pods\n', category: 'K8s' },
  { label: 'systemctl', description: '系统服务', command: 'systemctl ', category: '系统' },
  { label: 'journalctl', description: '系统日志', command: 'journalctl -u ', category: '日志' },
  { label: 'clear', description: '清屏', command: 'clear\n', category: '系统' },
  { label: 'exit', description: '退出', command: 'exit\n', category: '系统' }
]

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return commands
  return commands.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
  )
})

watch(filtered, () => {
  selectedIndex.value = 0
})

function onKeyDown(e: KeyboardEvent): void {
  if (!props.visible) return
  if (e.key === 'Escape') {
    emit('close')
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const cmd = filtered.value[selectedIndex.value]
    if (cmd) {
      emit('send', cmd.command)
      emit('close')
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})

function selectCommand(cmd: Command): void {
  emit('send', cmd.command)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="cmd-palette-overlay" @click.self="emit('close')">
      <div class="cmd-palette">
        <div class="cmd-search">
          <span class="cmd-icon">⌘</span>
          <input
            v-model="search"
            ref="searchInput"
            class="cmd-input"
            placeholder="输入命令关键词..."
            autofocus
          />
          <span class="cmd-hint">ESC 关闭</span>
        </div>
        <div class="cmd-list">
          <div
            v-for="(cmd, idx) in filtered"
            :key="cmd.label"
            class="cmd-item"
            :class="{ active: idx === selectedIndex }"
            @click="selectCommand(cmd)"
          >
            <div class="cmd-item-left">
              <code class="cmd-label">{{ cmd.label }}</code>
              <span class="cmd-desc">{{ cmd.description }}</span>
            </div>
            <span class="cmd-category">{{ cmd.category }}</span>
          </div>
          <div v-if="filtered.length === 0" class="cmd-empty">无匹配命令</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmd-palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  backdrop-filter: blur(4px);
}
.cmd-palette {
  width: 560px;
  max-height: 420px;
  background: var(--tx-card, #1e1e1e);
  border: 1px solid var(--tx-border);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.cmd-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--tx-border);
  background: var(--tx-panel);
}
.cmd-icon {
  color: var(--tx-text-3);
  font-size: 14px;
}
.cmd-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--tx-text);
  font-size: 15px;
  font-family: inherit;
}
.cmd-input::placeholder {
  color: var(--tx-text-3);
}
.cmd-hint {
  font-size: 12px;
  color: var(--tx-text-3);
  background: var(--tx-fill);
  padding: 2px 8px;
  border-radius: 4px;
}
.cmd-list {
  overflow-y: auto;
  max-height: 340px;
  padding: 6px;
}
.cmd-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.cmd-item:hover,
.cmd-item.active {
  background: var(--tx-hover);
}
.cmd-item-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.cmd-label {
  font-size: 13px;
  color: var(--tx-green-hover);
  background: rgba(16, 185, 129, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Menlo, Monaco, monospace';
  white-space: nowrap;
}
.cmd-desc {
  font-size: 13px;
  color: var(--tx-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmd-category {
  font-size: 11px;
  color: var(--tx-text-3);
  background: var(--tx-fill);
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}
.cmd-empty {
  padding: 30px;
  text-align: center;
  color: var(--tx-text-3);
  font-size: 13px;
}
</style>
