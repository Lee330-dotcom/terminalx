## Context

现有 AI 能力分两层：只读分析（`aiService` 一次性流式请求）与半自动命令建议（渲染进程解析命令卡片、用户点击插入、不回车）。全自动阶段增加第三层：模型可主动调用执行工具，在受控边界内连续执行只读命令并读取结果。

约束：

- 执行权不能交给模型：所有命令必须经过主进程本地策略，渲染进程无法绕过。
- 不干扰用户终端：复用 MCP `exec_command` 的独立 SSH exec 通道，不调用 `sendInput`。
- 安全默认关闭：设置项 `aiAutoExecute` 默认 `false`，关闭时所有命令都需确认。
- 对话绑定当前活动标签页；切换、关闭标签或断线后清理状态。

## Goals / Non-Goals

**Goals**

- 多轮对话，一次任务内最多 8 次工具调用。
- 只读命令自动执行并回填结果；写操作/未知命令/敏感路径弹确认。
- 用户可批准、拒绝、随时停止；拒绝后模型据此调整。
- 执行输出截断、超时、错误可读。

**Non-Goals**

- 不自动执行写操作。
- 不做多主机并行、定时巡检、文件传输工具。
- 不做对话历史持久化、不跨标签页共享。
- 不新增 MCP 客户端；工具执行直接复用现有 `ctx.ssh.exec`。

## Architecture

### 主进程

- `src/main/ai/commandPolicy.ts`：纯函数策略。
  - 输入命令行，输出 `{ verdict: 'auto' | 'confirm', risk, reason }`。
  - 只读白名单：`ls cat head tail wc grep cut uniq df du free uptime uname whoami id date hostname ps pgrep ss netstat lsof mount findmnt dmesg lsblk blkid stat file readlink realpath dirname basename printenv nproc getconf` 等，带子命令约束的 `journalctl systemctl docker kubectl git timedatectl hostnamectl`。
  - 允许简单管道 `|`、`&&`、`||`、`;`，拆分后每段首命令都必须在白名单内；任一段不满足即需确认。
  - 出现重定向、反引号、`$(`、`${}`、换行、`sudo/su/doas/xargs/eval/exec/source/tee`、后台 `&`、`find -exec/-delete`、`journalctl --vacuum/--rotate/--flush` 等直接判为需确认。
  - 敏感路径命中（`.ssh`、`id_rsa`、`*.pem/key`、`shadow`、`.env`、`credentials`、`token`、`secret`、`.aws`、`.kube/config` 等）一律需确认。
  - 多行或超过 2000 字符直接拒绝执行（返回错误给模型）。
- `src/main/ai/agentService.ts`：
  - 按 `requestId` 管理运行中的任务，按 `sessionId` 保存对话消息。
  - 每轮调用 Chat Completions（`tools: [execute_command]`，流式），累积文本与 tool_calls。
  - 只读且自动开关开启 → `ctx.ssh.exec(connectionId, command, 60_000)`，截断后作为 tool 消息回填，继续下一轮。
  - 需确认 → 发出 `approval-required` 事件并挂起；批准后执行并继续，拒绝则回填「用户拒绝执行」。
  - 第 8 次工具调用后禁用 tools 再请求一轮，要求模型总结；超过仍未结束时以文本收尾。
  - 取消：AbortController 中止请求，标记 pending 审批失效，忽略迟到的执行结果。
- `execute_command` 工具参数：`{ command: string, purpose: string }`。命令必须是单行。

### 数据流

1. 渲染进程 `aiChatStart`（requestId、sessionId、connectionId、text）。
2. 主进程校验会话连接与 AI 配置，追加用户消息并开始循环。
3. 流式事件：`ai-chat-event`，payload 区分 `delta`、`tool-call`、`tool-result`、`approval-required`、`step-limit`、`done`。
4. 用户审批：`aiChatApprove(requestId, callId, approved)`；取消：`aiChatCancel(requestId)`。
5. 会话切换/关闭：`aiChatReset(sessionId)` 清理消息与运行中任务。

### 渲染进程

- `AiPanel` 顶部增加「分析 / 助手」页签；助手页沿用现有宽度拖拽。
- `stores/aiChat.ts`：按当前 session 保存时间线条目；处理流式文本合并、工具卡片状态、审批状态、错误/取消；切换或关闭会话时清空并调用 reset。
- 时间线组件：用户气泡、AI 纯文本、工具卡片（命令、目的、风险徽标、执行中/成功/失败、可展开输出）、审批卡片（执行/跳过）、8 步提示。
- 输入框仅在已连接会话可用；发送中显示停止；新指令先取消上一条。

### 设置

- `Settings.aiAutoExecute: boolean`，默认 `false`。
- 设置页 AI 分区新增开关与说明：开启后只读白名单命令自动执行；写操作仍需确认。

### 错误处理

- 缺少配置、会话不可用、模型 HTTP 错误、工具执行失败、连接断开均以 `done.error` 或工具错误回填展示。
- 审批期间断线：自动取消并提示重连。
- 输出按现有 `truncateExecOutput` 规则截断并标注。

## Testing

- `commandPolicy`：白名单、管道/组合、重定向、命令替换、sudo、敏感路径、多行、超长、子命令约束。
- `agentService`：自动执行只读、需确认后批准、拒绝、8 步上限、取消、模型/执行错误、事件不含密钥。
- e2e：本地 SSH exec + mock OpenAI tools 响应；验证只读自动执行、写命令审批卡与批准执行、拒绝、停止、终端输入事件为 0。
- 真实 DeepSeek：只读自动执行一轮 + 写操作确认卡。
