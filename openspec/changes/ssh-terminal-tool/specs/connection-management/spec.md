# 连接管理

## ADDED Requirements

### Requirement: 连接配置模型

连接配置 SHALL 包含：名称、分组、主机、端口、用户名、认证方式（密码/私钥）、备注、标签色。
连接元数据 SHALL 存储在 `connections.json`，凭据（密码/私钥内容）SHALL NOT 出现在该文件中。
私钥 SHALL 支持引用本地私钥文件路径或直接录入私钥内容两种方式。

#### Scenario: 创建密码认证的连接

- **WHEN** 用户填写主机、端口、用户名、密码并保存
- **THEN** 连接出现在连接列表中，且 `connections.json` 中该连接记录不包含密码字段

#### Scenario: 编辑连接

- **WHEN** 用户修改主机地址并保存
- **THEN** 连接列表显示更新后的主机地址，凭据不受影响

### Requirement: 连接的增删改查

用户 SHALL 能在界面创建、编辑、删除连接。

#### Scenario: 删除连接

- **WHEN** 用户删除一个连接
- **THEN** 连接从列表移除，其凭据加密记录同时清除

### Requirement: 分组管理

连接 SHALL 支持两级树形结构（分组 → 连接）。用户 SHALL 能创建/重命名/删除分组、拖拽连接在分组间移动。

#### Scenario: 删除包含连接的分组

- **WHEN** 用户删除含连接的组
- **THEN** 系统 SHALL 提示确认；确认后分组删除，连接移动至未分组

### Requirement: 凭据加密存储

密码与私钥内容 SHALL 使用 AES-256-GCM 加密后落盘。加密密钥 SHALL 由 macOS keychain 生成并托管，凭据文件不包含解密密钥。

#### Scenario: 应用重启后凭据仍可用

- **WHEN** 应用重启后用户连接该服务器
- **THEN** 连接成功且用户无需重新输入密码
