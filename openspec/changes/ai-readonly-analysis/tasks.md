# 实施任务（tasks.md）

## 1. 配置与存储

- [x] 1.1 共享类型新增 AI 设置字段（`aiBaseUrl`、`aiModel`）、AI 请求/事件/状态类型与 IPC 通道；验证：`npm run typecheck` 通过
- [x] 1.2 `SecretPayload` 增加 `apiKey`，设置存储补默认值（Base URL 默认 OpenAI 官方，模型名留空）；验证：设置存储单测覆盖默认值且序列化不含 apiKey

## 2. 主进程 AI 服务

- [x] 2.1 实现提示词构造器（选段解释/会话摘要/连接诊断 + 只读 system prompt）；验证：单测断言三种输入均含对应内容、诊断输入不含凭据字段
- [x] 2.2 实现 SSE 解析与 OpenAI 兼容流式调用（fetch、增量回调、AbortSignal、120s 超时）；验证：单测 mock fetch 覆盖正常流、分片 data、`[DONE]`、HTTP 错误
- [x] 2.3 实现 AI 服务编排：读取配置与密钥、按 kind 组装上下文（摘要走 `sessions.readLines(…, 300)`）、请求去重与取消；验证：单测覆盖未配置、会话不存在、取消
- [x] 2.4 接入 IPC：`ai:status`、`ai:analyze`、`ai:cancel`、`ai:set-key`、测试连接，流式事件推送到所有窗口；验证：`npm run typecheck` 通过，手动调用返回 requestId

## 3. 渲染进程界面

- [x] 3.1 新增 AI Pinia store（可见性、流式文本、错误、运行状态、取消）；验证：单测或手动验证 chunk 追加与 done 收尾
- [x] 3.2 新增右侧 AI 抽屉组件（流式文本、停止、复制、未配置引导、发送范围标注）；验证：dev 版打开抽屉展示占位与引导
- [x] 3.3 终端选段浮钮：选中非空文本显示「AI 解释」，点击发起解释并打开抽屉；验证：dev 版选段出现按钮、取消选中消失
- [x] 3.4 标签栏「AI 摘要」与错误态「AI 诊断」入口；验证：dev 版摘要/诊断分别发起请求
- [x] 3.5 设置页新增 AI 分区（Base URL、模型名、API Key 保存/清除、测试连接）及中英文案；验证：保存后重启仍在、Key 不回显

## 4. 验证

- [x] 4.1 `npm run typecheck`、`npm test` 全绿
- [x] 4.2 验证三种分析的流式与只读约束：e2e 覆盖三种类型（真实 Electron + 本地 SSH + mock 模型）；真实 DeepSeek 端点验证测试连接、选段解释与连接诊断；分析期间终端输出事件为 0
- [x] 4.3 `openspec validate ai-readonly-analysis --strict` 通过
