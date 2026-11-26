# multi-tab-split Specification

## Purpose
主窗口的多标签工作区与标签内分屏能力：允许多个 SSH 会话并行存在并可同时观察，标签内可按水平/垂直方向拆分出独立窗格，每个窗格持有自己的会话且互不串扰。

## Requirements

### Requirement: 多标签工作区

系统 SHALL 支持主窗口同时打开多个会话标签；每个标签 SHALL 维护各自独立的窗格布局，切换标签 MUST NOT 影响其它标签的会话与布局。

#### Scenario: 打开多个标签

- **WHEN** 用户先后从连接中心打开两个不同连接
- **THEN** 标签栏 SHALL 同时显示两个标签
- **AND** 两个标签各自的会话 SHALL 同时保持连接，互不影响

#### Scenario: 切换标签

- **WHEN** 用户点击标签栏中的某个标签
- **THEN** 主工作区 SHALL 显示该标签的窗格布局
- **AND** 其它标签的会话 SHALL 保持后台连接，不被断开

#### Scenario: 关闭标签

- **WHEN** 用户关闭某个标签
- **THEN** 该标签下所有窗格持有的会话 SHALL 全部关闭
- **AND** 若关闭的是当前激活标签，焦点 SHALL 转移到相邻标签；若无标签剩余，主区域 SHALL 回到连接中心

#### Scenario: 同一连接重复打开

- **WHEN** 用户对同一个连接再次发起连接
- **THEN** 系统 SHALL 复用已打开该连接的标签并聚焦之，MUST NOT 产生重复标签

### Requirement: 标签内分屏

系统 SHALL 支持在单个标签内拆分出多个窗格，窗格数量上限为 4；每个窗格 SHALL 独立持有一个会话。

#### Scenario: 拆分窗格

- **WHEN** 用户对当前焦点窗格执行分屏操作并选择分屏轴向
- **THEN** 该窗格 SHALL 被替换为一个包含两个窗格的分屏节点
- **AND** 原窗格 SHALL 保留在新布局中，其会话不中断
- **AND** 新窗格 SHALL 处于空态并获得焦点

#### Scenario: 分屏数量上限

- **WHEN** 标签内已有 4 个窗格，用户再次请求分屏
- **THEN** 系统 SHALL 拒绝该操作并给出提示
- **AND** 现有窗格与布局 MUST NOT 发生变化

#### Scenario: 调整分屏比例

- **WHEN** 用户拖拽两个窗格之间的分隔条
- **THEN** 两个窗格的尺寸占比 SHALL 按拖拽位置实时调整
- **AND** 比例 SHALL 被约束在使任一窗格保持可见的范围内

#### Scenario: 关闭窗格合并布局

- **WHEN** 用户关闭某个分屏中的窗格
- **THEN** 该窗格 SHALL 被移除，其会话 SHALL 关闭
- **AND** 分屏节点 SHALL 被折叠为其兄弟节点，剩余窗格 SHALL 继续正常显示

### Requirement: 空窗格的会话来源

拆分产生的空窗格 SHALL 提供连接选择入口；用户在空窗格选择连接后，该窗格 SHALL 开启独立会话。

#### Scenario: 空窗格选择连接

- **WHEN** 用户在空窗格中选择一个连接并确认
- **THEN** 该窗格 SHALL 显示该连接的新会话终端
- **AND** 该会话 SHALL 独立于其它窗格已有的同名连接会话，输入与输出互不串扰

#### Scenario: 取消选择

- **WHEN** 用户在空窗格的连接选择器中取消
- **THEN** 该窗格 SHALL 保持空态，MUST NOT 发起连接

### Requirement: 焦点窗格与联动

每个标签 SHALL 有且仅有一个焦点窗格；键盘输入、终端搜索、SFTP 文件工作区与 AI 会话上下文 SHALL 跟随焦点窗格。

#### Scenario: 点击切换焦点

- **WHEN** 用户点击某个窗格
- **THEN** 该窗格 SHALL 成为焦点窗格并显示焦点标识
- **AND** 终端搜索、SFTP 侧栏与 AI 会话上下文 SHALL 切换到该窗格对应的会话

#### Scenario: 焦点窗格会话断开

- **WHEN** 焦点窗格的会话断开
- **THEN** 该窗格 SHALL 显示断开状态与重连入口
- **AND** 分屏布局 SHALL 保持不变，重连后该窗格 SHALL 回到原位

### Requirement: 多会话下的连接生命周期隔离

同一连接被多个窗格各自持有会话时，关闭或重连其中一个窗格的会话 MUST NOT 影响其它窗格的会话。

#### Scenario: 关闭其中一个会话

- **WHEN** 同一连接的两个窗格中，关闭其中一个窗格
- **THEN** 另一个窗格的会话 SHALL 保持连接且可继续输入输出

#### Scenario: 重连其中一个会话

- **WHEN** 同一连接的两个窗格中，对其中一个窗格发起重连
- **THEN** 另一个窗格的会话 SHALL 保持连接
- **AND** 被重连的窗格 SHALL 建立可用会话并回到原位
