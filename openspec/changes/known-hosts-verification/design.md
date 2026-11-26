## Context

ssh2 在密钥交换阶段拿到服务端主机公钥（与 OpenSSH known_hosts 中 base64 解码后完全相同的字节序列），并把校验责任交给 `config.hostVerifier(key: Buffer, verify: (permitted: boolean) => void)`。当前代码没有设置 `hostVerifier`（ssh2 内部会打印 "Host accepted by default (no verification)"），因此不存在任何主机身份校验。

关键约束：

- `hostVerifier` 的 `verify` 回调**可以延后调用**（ssh2 内部有 `checked` 标志，允许异步应答），因此"等用户在弹窗里点确认"是可行的；但回调必须**异步调用**（返回 `undefined`），否则 ssh2 会把返回值当作同步结论。
- ssh2 只提供通用握手错误 `Host denied (verification failed)`，用户看到这句无法判断是"用户拒绝了"还是"指纹变了"，需要我们自己在握手失败时替换错误原因。
- 指纹必须是 OpenSSH 口径：`SHA256:` + base64(sha256(公钥 blob))（去掉 `=` 补位），与 `ssh-keygen -lf` 输出一致，才能和用户已有的 known_hosts 对照。
- 指纹确认需要人参与，而握手发生在主进程：必须新建主进程 → 渲染进程的请求通道 + 渲染进程 → 主进程的应答通道。
- 需求文档全局约束：新增主进程服务必须有 Vitest 单测；UI 文案进 `i18n.ts`；颜色/间距取自设计令牌。

## Goals / Non-Goals

**Goals:**
- 所有 SSH 握手统一校验主机指纹，不存在"绕过指纹校验"的连接入口
- 首次连接：弹窗展示 host/port/密钥类型/指纹，用户显式信任后写入指纹库并放行
- 指纹变更：强告警（同时展示旧指纹与新指纹），必须显式选择才能继续，无任何设置项可以关闭该告警
- 指纹库持久化，支持查看、忘记、导入 OpenSSH known_hosts
- 同一主机的并发连接只弹一次窗（去重），不重复打扰用户

**Non-Goals:**
- 不做 SSH 证书认证（ssh2 的 `hostVerifier` 只覆盖主机密钥）
- 不做 OCSP 吊销检查
- 不解析 `known_hosts` 里的 `@cert-authority` / `@revoked` 标记语义（仅当普通条目解析并跳过带标记的行）
- 不支持自定义端口以外的主机别名归并（`known_hosts` 的通配符 `*.example.com` 不参与匹配，仅原样导入展示）
- 不做"全局信任模式"开关（会削弱告警，属于明确不做）

## Decisions

### D1. 校验点放在 ssh2 的 hostVerifier，而不是应用层事后比对

**选择**：在 `buildConnectConfig` 里注入 `hostVerifier`，由 ssh2 在密钥交换阶段调用。

**理由**：只有握手期校验才能阻止凭据外泄。应用层"连上后再比对"时，密码/私钥已经发出去了。

**取舍**：`hostVerifier` 是回调式 API，需要把"用户确认"这种异步人工动作接进来，实现上要维护待确认请求表与超时。

### D2. 指纹口径与 OpenSSH 对齐（SHA256 + base64，无补位）

**选择**：`SHA256:` + `base64(sha256(keyBlob))` 去掉末尾 `=`。

**理由**：与 `ssh-keygen -lf`、OpenSSH known_hosts 完全一致，用户可以直接对照现有资产；导入 known_hosts 时也只需对 base64 解码后的 blob 做同一个哈希。

**备选**：MD5 指纹（老式 `ssh-dss 96:xx:xx`）。已被 OpenSSH 标记为弱哈希，不采用。

### D3. 指纹库以 host + port 为键，独立文件 `hostKeys.json`

**选择**：`HostKeyRecord = { host, port, fingerprint, keyType, addedAt, lastSeenAt }`，存 `userData/hostKeys.json`，原子写入。

**理由**：同一台主机的不同端口可能是不同机器（容器/多实例），用 host+port 区分才不会误判"指纹变更"。独立文件便于用户整体清空，也避免与 `connections.json` 的写入竞争。

### D4. 指纹确认走"主进程请求 + 渲染进程应答"的双向通道

**选择**：主进程在 `hostVerifier` 中挂起握手，向所有窗口广播 `ev:host-key-prompt`（携带 requestId、host、port、指纹、密钥类型、已记录指纹、状态 new/changed）；渲染层弹模态框，用户选择后调用 `hostKey:respond` 回传 `accept: boolean`；主进程据此放行或拒绝。

**理由**：主进程不能直接弹窗（Electron 的 `dialog` 是阻塞式原生框，无法展示指纹对比细节，也拿不到"仍要继续"这种语义），渲染层弹窗可以做到与 A11 设计令牌一致的双形态界面。

**取舍**：窗口未打开时无人应答 → 设置 120s 超时，超时按拒绝处理并给出明确错误，避免连接无限挂起。

### D5. 指纹变更告警不可绕过

**选择**：库中已有指纹且与本次不一致时，弹窗为"危险"形态，同时列出「已记录指纹」与「本次指纹」，只有「仍要继续」（覆盖库记录）与「拒绝并断开」两个出口；**不提供任何设置项可以关闭或降级该告警**。

**理由**：需求文档明确要求"变更告警不可绕过"。一旦提供"忽略变更"的开关，MITM 就获得了永久后门。

### D6. 并发连接同一主机只弹一次窗

**选择**：闸门内部按 `host:port` 维护待确认请求表；同一主机的并发握手共享同一个待确认 promise，第一个应答即对所有等待方生效。

**理由**：终端会话、SFTP、命令执行可能同时对同一主机发起握手，逐个弹窗会让用户连续点多次同一条确认。

### D7. 失败原因通过握手配置携带，覆盖 ssh2 的通用错误

**选择**：`buildConnectConfig` 除注入 `hostVerifier` 外，还注入一个 `hostKeyFailure()` 读取器；`ConnectionManager.connect()` 在捕获 'error' 事件时优先用该读取器返回的具体错误。

**理由**：ssh2 只会给 `Host denied (verification failed)`。用户需要知道是"用户拒绝了"还是"指纹与记录不符"。

### D8. known_hosts 导入：解析常见条目，忽略标记行

**选择**：逐行解析 `host[,host2] keytype base64key`；以 `#` 开头或含 `@cert-authority` / `@revoked` 标记的行跳过并计入"已跳过"；非 22 端口的 `[host]:port` 形式按括号解析；导入时同一 `host:port` 已存在则以导入项覆盖并计入"已更新"，否则计入"已导入"。

**理由**：覆盖绝大多数真实 known_hosts 文件的用法；标记行涉及证书信任策略，超出本轮范围（Non-Goals），但跳过时必须可见，不能静默丢弃。

## Risks / Trade-offs

- **指纹库被本地篡改** → 攻击者若能改本地文件，本就能改程序；指纹库只防网络中间人，不防本机 root（与 OpenSSH known_hosts 的威胁模型一致）
- **首次连接多一步操作，可能被用户嫌烦** → 弹窗只展示必要信息并默认聚焦"信任并继续"；同一主机只需确认一次
- **既有 e2e 用例会因新弹窗超时** → 既有 e2e 增加"信任弹窗"处理步骤，并在专用的 `hostKey.spec.ts` 中覆盖首次确认与二次连接免确认
- **指纹库文件损坏** → `readJson` 解析失败按空库处理并提示（降级容忍：不阻断终端主链路，但会在首次连接时重新询问）
- **known_hosts 里同一主机多条记录** → 取第一条（OpenSSH 语义），其余计入"已跳过"并在预览中提示

## Migration Plan

1. 新增 `hostKeyUtils.ts`（纯函数）与 `hostKeyStore.ts`（持久化），补齐单测（可独立发布，不改变现有连接行为）
2. 新增 `hostKeyGate.ts`（校验闸门）与 `hostKeyStore` 单测
3. `buildConnectConfig` / `ConnectionManager` 注入 verifier 与失败原因
4. `appContext` 装配闸门并广播确认请求；`ipc.ts` 增加四个通道；preload 暴露 API
5. 渲染层：指纹弹窗组件 + store + 设置面板指纹管理区块 + i18n 文案
6. e2e：适配既有用例 + 新增 `hostKey.spec.ts`
7. 回滚策略：主进程注入点在 `buildConnectConfig`，移除即可退回"默认接受"；指纹库文件为独立新增文件，回滚后遗留不影响运行

## Open Questions

无。首次确认方式、指纹变更处置、known_hosts 导入范围、校验覆盖范围均已确认（首次弹窗阻塞确认 / 变更强告警后可显式继续 / 本轮支持导入 / 全部 SSH 握手统一校验）。
