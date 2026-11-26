## Why

用户在 SFTP 面板下载文件后，底部的传输框只显示「进行中」的传输，任务一完成条目立刻从列表消失。实际体感是：**第一次下载还能看到进度条，第二次下载（比如文件已在服务器缓存、体积小）进度框「闪一下就没了」**，用户完全无法确认文件到底有没有下下来、存到了哪里。

同时，下载行为本身没有任何留痕。用户批量拉取一批文件后想知道「刚才一共下了哪些文件、落在哪个目录、有没有失败」，只能翻系统下载目录，运维场景下（对账、发布包核对）非常低效。

业内同类客户端（FinalShell、WindTerm、Termius）都提供「传输记录 / 下载历史」，可查看历史条目、时间、状态、大小，并支持定位到本地目录。

## What Changes

- **传输条目不再「闪一下就没了」**：SFTP 面板底部传输框改为展示本次会话的全部传输（进行中 / 已完成 / 失败 / 已取消），完成后条目保留并显示状态与大小，可手动清空；不再在完成后 5 秒自动消失。
- **修掉事件竞态**：主进程在传输入队时即广播 `ev:transfer:start`（含 id、方向、路径），渲染进程据此建条目，保证 progress/done 事件到达时条目必然存在；当前实现里「done 事件先于条目入列到达」会被丢弃，导致条目永远卡在进行中。
- **传输记录持久化**：新增 `src/main/store/transferStore.ts`，把每次上传/下载的记录（方向、文件名、远端/本地路径、字节数、状态、错误、起止时间）落盘 `transfers.json`（原子写 + 写锁 + 损坏降级，与既有 store 一致），最多保留最近 200 条。
- **「下载记录」入口**：SFTP 面板工具栏新增可见按钮，打开记录抽屉，可按 全部/下载/上传 过滤，展示时间、文件名、大小、状态与本地路径；下载条目支持「打开位置」（在文件管理器中定位），并可单条删除或清空全部记录。
- **范围界定**：本变更不做传输断点续传、不做记录导出/导入、不做历史记录的多条件搜索、不按连接维度筛选记录。

## Capabilities

### New Capabilities
- `sftp-transfer-history`: 传输过程的可见性与留痕——传输面板保留已完成条目并显示状态、传输记录持久化与「下载记录」浏览/清理能力。

### Modified Capabilities
（无：现有 `openspec/specs/` 下没有传输相关的既有能力，本变更只新增能力。）

## Impact

- **主进程**
  - 新增 `src/main/store/transferStore.ts`：传输记录读写、去重、上限裁剪、原子写
  - 修改 `src/main/ssh/sftpService.ts`：入队时通过 sink 广播 start 事件
  - 修改 `src/main/appContext.ts`：装配 `TransferStore`，在传输 sink 中落库
  - 修改 `src/main/ipc.ts`、`src/shared/types.ts`、`src/preload/index.ts`：新增记录查询/删除/清空与「打开位置」通道
- **渲染层**
  - 修改 `src/renderer/src/stores/transfers.ts`：监听 start 事件建条目、完成后保留条目、维护历史记录列表
  - 修改 `src/renderer/src/components/SftpPanel.vue`：传输框展示全部状态条目、新增「下载记录」入口与记录抽屉
  - 修改 `src/renderer/src/i18n.ts`：新增文案（中英）
- **测试**
  - 新增 `src/main/store/__tests__/transferStore.test.ts`：记录写入/更新/裁剪/损坏降级
