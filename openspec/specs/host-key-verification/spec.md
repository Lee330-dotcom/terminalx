# host-key-verification Specification

## Purpose
SSH 主机身份校验能力：terminalX 在密钥交换阶段校验服务端主机公钥指纹，首次连接由用户显式信任，指纹变更时以强告警拦截，所有 SSH 入口（终端会话、SFTP、命令执行、连接测试）统一走同一条校验路径，并支持导入 OpenSSH known_hosts。

## Requirements

### Requirement: 握手期主机指纹校验

系统 SHALL 在 SSH 密钥交换阶段校验服务端主机公钥指纹；指纹口径 SHALL 为 `SHA256:` + base64(SHA256(公钥 blob))（与 `ssh-keygen -lf` 一致）；校验 SHALL 覆盖全部发起 SSH 握手的入口（终端会话、SFTP、命令执行、连接测试）。

#### Scenario: 已信任主机直接放行

- **WHEN** 用户连接一台指纹已记录在指纹库中的主机
- **THEN** 握手 SHALL 直接通过，MUST NOT 打断用户
- **AND** 该主机的最近确认时间 SHALL 被更新

#### Scenario: 校验失败给出具体原因

- **WHEN** 主机指纹校验未通过
- **THEN** 连接 SHALL 失败
- **AND** 错误信息 SHALL 说明具体原因（用户拒绝 / 指纹与记录不符），MUST NOT 仅显示通用的握手失败

### Requirement: 首次连接的信任确认

首次连接某台主机（指纹库中无记录）时，系统 SHALL 在建立连接前阻塞并向用户展示主机指纹供确认；用户显式信任后该指纹 SHALL 被持久化。

#### Scenario: 首次连接弹窗确认

- **WHEN** 用户首次连接一台不在指纹库中的主机
- **THEN** 系统 SHALL 展示确认界面，内容包含主机地址、端口、密钥类型与指纹
- **AND** 连接 SHALL 在用户确认前保持未建立状态

#### Scenario: 信任后放行并记住

- **WHEN** 用户在首次确认界面选择信任并继续
- **THEN** 连接 SHALL 继续建立
- **AND** 该主机的指纹 SHALL 被写入指纹库，之后再次连接 SHALL 不再询问

#### Scenario: 拒绝首次连接

- **WHEN** 用户在首次确认界面选择拒绝
- **THEN** 连接 SHALL 失败且给出明确原因
- **AND** 该主机 MUST NOT 被写入指纹库

### Requirement: 指纹变更告警

已信任主机的指纹与指纹库记录不一致时，系统 SHALL 以强告警形式同时展示已记录指纹与本次指纹，并要求用户显式选择方可继续；该告警 MUST NOT 被任何设置项绕过或关闭。

#### Scenario: 指纹变更后的选择

- **WHEN** 用户连接一台指纹库中已有记录但本次指纹不同的主机
- **THEN** 系统 SHALL 以危险告警形态展示「已记录指纹」与「本次指纹」
- **AND** 用户选择仍要继续时，连接 SHALL 继续且指纹库 SHALL 被更新为本次指纹
- **AND** 用户选择拒绝时，连接 SHALL 失败

#### Scenario: 不可静默降级

- **WHEN** 用户查阅设置
- **THEN** 系统 MUST NOT 提供关闭或降级指纹变更告警的选项

### Requirement: 并发连接去重

同一主机的多个并发握手 SHALL 只向用户展示一次确认，且所有等待方 SHALL 采用同一确认结果。

#### Scenario: 同时连接同一主机

- **WHEN** 用户对同一主机并发发起多个连接
- **THEN** 系统 SHALL 只展示一次指纹确认界面
- **AND** 所有等待中的连接 SHALL 采用同一次确认结果

### Requirement: 指纹库管理与 known_hosts 导入

系统 SHALL 提供已信任主机的查看与忘记能力，并支持导入 OpenSSH known_hosts 文件。

#### Scenario: 查看与忘记指纹

- **WHEN** 用户打开设置中的主机指纹管理
- **THEN** 系统 SHALL 列出已信任主机及其指纹、密钥类型与信任时间
- **AND** 用户忘记某台主机后，该主机下次连接 SHALL 重新走首次确认

#### Scenario: 导入 known_hosts

- **WHEN** 用户导入一个 OpenSSH known_hosts 文件
- **THEN** 系统 SHALL 解析其中的主机条目并换算为 SHA256 指纹入库
- **AND** 导入结果 SHALL 报告新增、覆盖与跳过的条目数量
- **AND** 带 `@cert-authority` / `@revoked` 标记的行 SHALL 被跳过且计入跳过数量，MUST NOT 静默丢弃

#### Scenario: 非默认端口条目

- **WHEN** known_hosts 中存在 `[host]:port` 形式的主机条目
- **THEN** 系统 SHALL 按该主机与端口入库
