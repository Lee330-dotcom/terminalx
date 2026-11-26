# 实施任务（tasks.md）

## 1. 主进程：指纹工具与指纹库

- [x] 1.1 新增 `src/main/ssh/hostKeyUtils.ts`：指纹计算（`SHA256:` + base64 去补位）、公钥 blob 的密钥类型解析、`host:port` 键规范化；验证：`src/main/ssh/__tests__/hostKeyUtils.test.ts` 断言指纹口径与 `ssh-keygen -lf` 一致（固定向量）
- [x] 1.2 新增 `src/main/ssh/hostKeyUtils.ts` 的 known_hosts 解析：解析 `host[,host] keytype base64key`，跳过 `#` 注释与 `@cert-authority`/`@revoked` 标记行，支持 `[host]:port`；验证：单测覆盖多主机一行、非默认端口、标记行跳过、非法行跳过
- [x] 1.3 新增 `src/main/store/hostKeyStore.ts`：指纹库持久化（`hostKeys.json`，原子写入），提供 list / get / trust / forget / import；验证：`src/main/store/__tests__/hostKeyStore.test.ts` 覆盖新增、覆盖、忘记、导入计数与文件损坏降级

## 2. 主进程：校验闸门

- [x] 2.1 新增 `src/main/ssh/hostKeyGate.ts`：`verify(host, port, keyBlob)` 查库判定 match / new / changed；match 静默放行并更新时间；new 与 changed 均发起用户确认
- [x] 2.2 变更场景携带「已记录指纹」并要求显式放行；拒绝时抛出带具体原因的错误；验证：单测覆盖 new / match / changed-接受 / changed-拒绝
- [x] 2.3 并发去重：同一 `host:port` 的并发握手共享同一次确认；等待超时按拒绝处理；验证：单测并发发起两次只触发一次确认

## 3. 主进程：接入握手路径

- [x] 3.1 `src/main/ssh/config.ts`：`buildConnectConfig` 支持注入 `hostVerifier` 与指纹失败原因读取器；`buildConnectConfigFromInput` 同步支持（连接测试走这里）
- [x] 3.2 `src/main/ssh/connectionManager.ts`：握手失败时用具体原因替换 ssh2 的通用错误
- [x] 3.3 `src/main/appContext.ts`：装配指纹库与闸门，向所有窗口广播指纹确认请求，登记应答
- [x] 3.4 `src/main/ipc.ts` + `src/shared/types.ts` + `src/preload/index.ts`：新增 `hostKeyList` / `hostKeyForget` / `hostKeyImport` / `hostKeyRespond` 四个通道与 `ev:host-key-prompt` 事件，补齐 preload 类型声明

## 4. 渲染层：指纹确认与管理界面

- [x] 4.1 新增 `src/renderer/src/stores/hostKeys.ts`：待确认指纹状态、应答、指纹库列表/忘记/导入
- [x] 4.2 新增 `src/renderer/src/components/HostKeyDialog.vue`：新建（信息形态）与变更（危险告警形态，同时展示新旧指纹）两种界面
- [x] 4.3 `src/renderer/src/App.vue` 挂载全局指纹确认弹窗
- [x] 4.4 `src/renderer/src/components/SettingsPanel.vue` 新增「主机指纹」管理区块：列表、忘记、导入 known_hosts
- [x] 4.5 `src/renderer/src/i18n.ts` 增补指纹相关文案（中英文齐全），弹窗样式取自设计令牌

## 5. 验证

- [x] 5.1 `npm run typecheck` 与 `npm run test` 全绿
- [x] 5.2 既有 e2e 适配首次连接的指纹确认弹窗（`app.spec.ts` / `workspace.spec.ts` / `ai.spec.ts`）
- [x] 5.3 新增 `src/e2e/hostKey.spec.ts`：首次连接弹窗 → 信任 → 建连成功 → 二次连接不再询问
- [x] 5.4 `npm run dev` 供用户预览：首次确认、指纹变更告警、指纹库管理与 known_hosts 导入
- [x] 5.5 `openspec validate known-hosts-verification --strict` 通过
