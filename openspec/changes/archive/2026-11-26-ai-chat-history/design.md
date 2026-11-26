## 设计说明（design.md）

## 目标

把 AI 助手的每一轮对话（含工具调用与执行结果）持久化到本地，并提供历史列表、回看、继续追问与清理入口。

## 数据模型

```ts
export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant' | 'notice' | 'tool'
  text?: string
  command?: string
  purpose?: string
  risk?: CommandRiskLevel
  status?: string
  error?: string
  result?: AiChatToolResult
}

export interface AiChatConversation {
  id: string
  title: string
  connectionName?: string
  createdAt: number
  updatedAt: number
  messages: AiChatMessage[]
}
```

渲染层的时间线项（`ChatTimelineItem`）比消息多几个纯 UI 字段（`expanded`、`callId`、`requiresApproval`），落盘时只保留消息语义字段即可；回看时不需要审批交互（历史是只读的）。

## 存储

主进程 `src/main/store/aiChatStore.ts`，落盘 `ai-chats.json`：

- 原子写 + 进程内写链锁 + 文件损坏降级为空列表（与 `snippetStore`/`transferStore` 一致）
- 最多保留 50 条对话，超出按 `updatedAt` 裁剪最旧的
- 对话内容不含凭据（命令与输出），明文落盘便于用户自行查看

## 保存时机

在渲染层保存，触发点有两个：

1. 用户发送消息后（先把提问落盘，避免助手还没回完就关应用丢记录）
2. 助手本轮结束（`done` 事件）后（补上助手回复与工具结果）

保存动作幂等：同一 `currentId` 反复写入是覆盖更新，不会产生重复对话。

## 回看与继续追问

历史抽屉点击某条对话 → 用其消息重建时间线并展示（只读）。此时若用户继续发送消息，先「另起新对话」（生成新的 `currentId`），避免把新内容写进历史对话里。

面板上提供显式「新对话」按钮，随时开新话题。

## 入口

AI 面板助手页签底部操作区新增两个按钮：

- 「新对话」：清空当前时间线并开新对话
- 「历史」：打开历史抽屉

历史抽屉内容：标题（首条提问摘要，24 字截断）、更新时间、消息条数；每条右侧「删除」；抽屉底部「清空历史」。

## 边界与降级

- `ai-chats.json` 损坏 → 降级为空列表，不影响 AI 助手使用
- 历史消息里的工具项不提供审批按钮（历史为只读回看），避免误以为能对历史操作重新执行
- 助手未配置时历史入口仍可用（回看不依赖模型服务）

## 测试策略

- 单测 `src/main/store/__tests__/aiChatStore.test.ts`：保存/更新/裁剪/删除/清空/损坏降级/并发写
- 渲染层单测 `src/renderer/src/stores/__tests__/aiChatHistory.test.ts`：保存生成标题、回看重建时间线、删除与清空
- 回归：`npm run typecheck`、`npm run test`、`npm run test:e2e`
- 手工：dev 模式下对话 → 打开历史抽屉看到记录 → 重启应用后记录仍在
