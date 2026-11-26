## 设计说明（design.md）

## 问题定位

### 现象一：第二次下载时传输框「闪一下就没了」

`SftpPanel.vue` 的传输框条件是 `v-if="runningTransfers.length > 0"`，而 `runningTransfers` 只保留 `status === 'running'` 的条目。传输一完成，`onTransferDone` 把状态改成 `done`，条目立刻被过滤掉，传输框随之消失。

第一次下载体感正常，是因为首次读取（尤其是走堡垒机跳转）耗时较长，用户来得及看到进度条；第二次下载文件已在服务器侧缓存，几百毫秒内就完成，于是「进度框闪一下就没了」。**这不是时序 bug，而是 UI 语义问题：完成状态没有出口。**

### 现象二：done 事件可能早于条目入列

渲染层当前在 `await window.api.sftpDownload(...)` 返回后才把条目 push 进列表，而主进程在入队后即开始传输。文件很小时，`ev:transfer:done` 有可能先于 `invoke` 的回包被渲染进程处理，此时 `onTransferDone` 里的 `if (!item) return` 会把这条完成事件丢弃，条目永远停留在「进行中」，进度条卡住不动。

## 方案

### 1. 主进程在入队时广播 start 事件

`TransferEventSink` 增加 `emitStart`，`SftpService.enqueue` 时同步调用。主进程 → 渲染进程的 IPC 消息保序，因此渲染进程必然先收到 start、再收到 progress/done，条目永远先于事件存在。

渲染层收到 start 时直接建条目（含方向与路径），不再依赖 `sftpDownload` 的回包顺序。

### 2. 传输框展示全部状态

`transfers` 列表保留全部条目（含已完成/失败/已取消），不再有 5 秒自动移除。传输框展示：

- 进行中：进度条 + 已传/总量 + 取消按钮
- 已完成：文件名 + 「完成」标记 + 大小 + 「打开位置」（下载）
- 失败/已取消：文件名 + 状态 + 错误信息

面板头部提供「清空」按钮，一键移除已结束的条目（进行中的条目不受影响）。

### 3. 传输记录持久化

新增 `src/main/store/transferStore.ts`：

```ts
export interface TransferRecord {
  id: string
  direction: 'upload' | 'download'
  name: string
  remotePath: string
  localPath: string
  transferred: number
  total: number
  status: 'running' | 'done' | 'error' | 'canceled'
  error?: string
  startedAt: number
  finishedAt?: number
}
```

写入时机由主进程 sink 统一负责：start → `recordStart`，progress → `recordProgress`，done → `recordFinish`。落盘文件 `transfers.json`，原子写 + 进程内写链锁，读取失败降级为空列表。列表上限 200 条，超出按 `startedAt` 丢弃最旧的。

### 4. 「下载记录」入口

SFTP 面板工具栏新增按钮（图标 + 悬停提示「下载记录」），点击打开抽屉：

- 过滤：全部 / 下载 / 上传
- 列表列：时间、文件名、大小、状态、本地路径
- 操作：下载条目「打开位置」（`shell.showItemInFolder`）、单条删除、底部「清空记录」

记录是全局的（不按连接分组），因为运维常常需要跨连接核对一次批量拉取。

## 数据流

```
SftpService.enqueue
   └─ sink.emitStart ──► 渲染进程：新建传输条目
                          主进程：TransferStore.recordStart → transfers.json
SftpService 传输中
   └─ sink.emitProgress ─► 渲染进程：更新进度
                            主进程：TransferStore.recordProgress
SftpService 完成
   └─ sink.emitDone ────► 渲染进程：置为 done/error/canceled（不再自动移除）
                            主进程：TransferStore.recordFinish
```

## 边界与降级

- `transfers.json` 损坏 → 降级为空列表，不影响传输功能
- 记录超过 200 条 → 按开始时间裁剪最旧记录
- 「打开位置」在文件不存在时（下载失败/被取消）→ 主进程忽略并返回 `false`，界面不弹错误
- 取消传输时主进程会删除本地残留文件，记录状态标记为 `canceled`

## 测试策略

- 单测 `src/main/store/__tests__/transferStore.test.ts`：start/progress/finish 写入、状态流转、上限裁剪、损坏降级、并发写不互相覆盖
- 回归：`npm run typecheck`、`npm run test`、`npm run test:e2e`
- 手工：dev 模式下连续下载两个文件，确认第二个文件的传输框保持可见并显示「完成」；打开「下载记录」确认两条记录都在
