## Why

AI 助手的对话目前只活在内存里：切换会话、断开连接、关闭应用，对话内容就消失了。用户排查问题时经常会问「刚才那条命令到底执行了什么、返回了什么」，而那些结论恰恰是在几轮对话之前给出的，只能靠记忆或重新问一遍。

对运维场景更糟的是：助手执行过的只读命令（`systemctl status`、`df -h`、日志检索）与它们的输出，是一次排障过程最有价值的证据。这些内容现在完全没有留痕，也无法回看或复制。

同类工具（ChatGPT/Claude 的会话列表、IDE 里的 Copilot Chat 历史）都提供对话历史，用户可以回看任意一轮会话、继续追问、导出结论。

## What Changes

- **对话持久化**：把 AI 助手（助手页签）的每一轮对话落到本地 `ai-chats.json`，包含用户提问、助手回复、工具调用的命令/风险等级/执行结果与错误信息；应用重启后仍可回看。
- **会话列表**：AI 面板助手页签新增「历史」入口，打开历史抽屉，按更新时间倒序列出历史对话（标题取首条提问摘要、显示时间与消息条数），点击即可在面板中回看该对话。
- **继续追问与新对话**：回看历史对话后发送新消息会自动开一个新对话（不覆盖历史）；「新对话」按钮随时开新话题。
- **清理能力**：单条删除与「清空历史」；最多保留最近 50 条对话，超出按更新时间裁剪。
- **范围界定**：本变更只做助手页签（AI 全自动对话）的历史，不做只读分析页签的结果留痕、不做对话导出为文件、不做搜索、不做跨设备同步。

## Capabilities

### New Capabilities
- `ai-chat-history`: AI 助手对话的持久化与历史浏览——会话列表、回看、继续追问与清理。

### Modified Capabilities
（无：现有 `openspec/specs/` 下没有 AI 对话历史相关的既有能力，本变更只新增能力。）

## Impact

- **主进程**
  - 新增 `src/main/store/aiChatStore.ts`：对话读写、上限裁剪、原子写、损坏降级
  - 修改 `src/main/appContext.ts`：装配 `AiChatStore`
  - 修改 `src/main/ipc.ts`、`src/shared/types.ts`、`src/preload/index.ts`：新增 4 个对话历史通道与 API 面
- **渲染层**
  - 新增 `src/renderer/src/stores/aiChatHistory.ts`：历史列表状态、持久化与清理
  - 修改 `src/renderer/src/stores/aiChat.ts`：对话结束后自动保存、加载历史到时间线
  - 修改 `src/renderer/src/components/AiPanel.vue`：新增「历史」「新对话」入口与历史抽屉
  - 修改 `src/renderer/src/i18n.ts`：新增文案（中英）
- **测试**
  - 新增 `src/main/store/__tests__/aiChatStore.test.ts`：保存/更新/裁剪/删除/清空/损坏降级
