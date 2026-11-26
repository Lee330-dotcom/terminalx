## Why

需求文档 A4（known_hosts 主机指纹校验，P0 安全短板）要求：首次连接展示主机指纹供用户确认、指纹持久化、指纹变更时强告警且不可绕过，并支持导入 OpenSSH known_hosts。

现状是**完全没有主机身份校验**：ssh2 未配置 `hostVerifier`，因此任何中间人只要能截获 22 端口流量，就能用自己���密钥完成握手，terminalX 会照常把凭据送出去。用户以为连的是目标主机，实际可能连的是攻击者的机器。与"安全可审计"的定位直接冲突——这是需求文档里唯一被标注为"安全短板"的 P0 项。

指纹校验必须落在 SSH 握手层（ssh2 的 `hostVerifier` 回调），而不是应用层事后比对：事后比对无法阻止凭据外泄。难点在于 `hostVerifier` 回调发生在主进程，而"用户是否信任这台主机"需要人来回答，因此需要一条主进程 → 渲染进程的确认通道，以及一个把确认结果回传主进程的应答通道。

## What Changes

- **指纹库**：新增 `hostKeys.json` 持久化已信任主机（host + port → SHA256 指纹 + 密钥类型 + 首次信任时间 + 最近确认时间），原子写入，模式与现有 `jsonFile.ts` 一致。
- **握手期校验**：所有 SSH 握手（终端会话、SFTP、命令执行、连接测试）统一走 `hostVerifier`；指纹匹配则静默放行；首次遇到（库里没有）弹窗阻塞确认，用户点「信任并继续」才写入指纹库并放行；拒绝则连接失败且给出明确原因。
- **指纹变更告警**：已信任主机的指纹与库中记录不一致时，弹窗同时展示「已记录指纹」与「本次指纹」，用户必须显式选择「仍要继续」（更新指纹库）或「拒绝并断开」，该告警不可被任何设置项绕过。
- **known_hosts 导入**：支持导入 OpenSSH known_hosts 文件，解析 `host[,host] keytype base64key` 行格式，换算为 SHA256 指纹入库；导入前预览条目数与冲突项，冲突项按 OpenSSH 语义取第一条并提示。
- **指纹管理界面**：设置面板新增「主机指纹」区块，可查看已信任主机、忘记某台主机的指纹、导入 known_hosts 文件。
- **范围界定**：本变更只做"证书/密钥指纹"级别的 TOFU 校验，不做证书吊销列表（OCSP）、不做 agent 转发（`known_hosts` 里的 `@cert-authority` / `@revoked` 标记仅解析不生效）、不做 SSH 证书认证（`ssh2` 的 `hostVerifier` 只覆盖主机密钥）。

## Capabilities

### New Capabilities
- `host-key-verification`: SSH 主机指纹的采集、持久化与校验能力——首次连接的信任确认、指纹变更的强告警与显式放行、known_hosts 导入、指纹库管理。

### Modified Capabilities
（无：现有 `openspec/specs/` 下没有与主机身份校验相关的既有能力，本变更只新增能力，不改变其它能力的对外契约。）

## Impact

- **主进程**
  - 新增 `src/main/ssh/hostKeyUtils.ts`：指纹计算（SHA256/base64，与 `ssh-keygen -lf` 一致）、密钥类型解析、known_hosts 解析等纯函数
  - 新增 `src/main/store/hostKeyStore.ts`：指纹库持久化（`hostKeys.json`）
  - 新增 `src/main/ssh/hostKeyGate.ts`：校验闸门（查库 → 判定 new/changed/match → 发起确认 → 落库/拒绝）
  - 修改 `src/main/ssh/config.ts`：`buildConnectConfig` 支持注入 `hostVerifier` 与指纹失败原因读取器
  - 修改 `src/main/ssh/connectionManager.ts`：握手失败时把 ssh2 的通用错误替换为具体原因（如"用户拒绝了主机指纹"）
  - 修改 `src/main/appContext.ts`：装配指纹库与闸门，向所有窗口推送指纹确认请求
  - 修改 `src/main/ipc.ts`：新增 `hostKeyList` / `hostKeyForget` / `hostKeyImport` / `hostKeyRespond` 四个通道
- **共享类型与 preload**
  - `src/shared/types.ts`：新增 `HostKeyRecord` / `HostKeyPrompt` / `HostKeyImportResult` 与四个 IPC 通道常量
  - `src/preload/index.ts`（及 `index.d.ts`）：暴露指纹查询、忘记、导入、应答与事件订阅
- **渲染层**
  - 新增 `src/renderer/src/stores/hostKeys.ts`：待确认指纹弹窗状态、应答、指纹库管理
  - 新增 `src/renderer/src/components/HostKeyDialog.vue`：全局指纹确认弹窗（新建 / 变更两种形态）
  - 修改 `src/renderer/src/components/SettingsPanel.vue`：新增「主机指纹」管理区块
  - 修改 `src/renderer/src/App.vue`：挂载全局指纹确认弹窗
  - `src/renderer/src/i18n.ts`：增补指纹相关文案（中英文）
- **测试**
  - 新增 `src/main/ssh/__tests__/hostKeyUtils.test.ts`（指纹计算、密钥类型、known_hosts 解析）
  - 新增 `src/main/store/__tests__/hostKeyStore.test.ts`（持久化、信任、忘记、导入）
  - 新增 `src/main/ssh/__tests__/hostKeyGate.test.ts`（首次确认、匹配放行、变更告警、拒绝、并发去重）
  - 新增 `src/e2e/hostKey.spec.ts`（首次连接弹窗 → 信任 → 建连 → 二次连接不再询问）
  - 既有 e2e（`app.spec.ts` / `workspace.spec.ts` / `ai.spec.ts`）需适配首次连接的指纹确认弹窗
- **依赖**：无新增第三方依赖；不涉及数据迁移（`hostKeys.json` 为新文件）
