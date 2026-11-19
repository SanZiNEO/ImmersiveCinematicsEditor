# 13 WebUI 验收发布

> 收口说明（2026-11-19）：按最终口径，黄金语料 `corpus/13/`、旧 `e2e/` 与纯 node 13 轮校验脚本已移除；自动化测试只保留 `e2e-system/`，产物统一落 `e2e-system/artifacts/`。下文相关段落为历史设计记录。

13 是 WebUI 的发布闸门，不是又一轮功能设计。

它做四件事：

1. 用一套全量验收账，把 01～12 已写下的合同逐项落到可执行场景；
2. 用黄金脚本和真实游戏冒烟，证明编辑器产物能被模组解析、校验、播放、保存、重开；
3. 收掉 WebUI 传输的三项小硬化：预览档位 UI 与服务端固定值一致、资源视频扩展名、关闭幂等；
4. 冻结发布基线，并把 AUI 需要的输入交给 14。

13 通过后，才启动 14 AUI 迁移。AUI 的界面、进程内端点、GPU 帧源、游戏内输入不在 13 实现，也不作为 13 的阻塞项。

## 文档

| # | 文档 | 内容 |
|---|---|---|
| 1 | `README.md` | 定位、边界、顺序、出口 |
| 2 | `13-01-acceptance-matrix.md` | 01～12 覆盖账、证据规则、执行记录 |
| 3 | `13-02-golden-corpus.md` | 黄金脚本与负例、夹具清单、期望行为 |
| 4 | `13-03-workspace-application.md` | 工作台、布局、主题、窗口、IME、恢复、双面板 |
| 5 | `13-04-real-game-smoke.md` | WebUI → Forge/Fabric 真实游戏连续路径 |
| 6 | `13-05-subtitle-e2e.md` | 字幕导入、批次、编译、游戏播放、重开/重导入 |
| 7 | `13-06-transport-preview-hardening.md` | 预览固定值、资源扩展名、关闭幂等、传输/帧消费验收 |
| 8 | `13-07-release-security.md` | 构建、打包、版本号、权限、已知限制、发布说明 |
| 9 | `13-08-r14-handoff.md` | 冻结给 14 的合同、场景、缺口与顺序 |

## 设计基线

13 只认下面这些事实：

- 模组当前代码：`plans/0.3.6` 现行合同、`common/src/main/java/...` 的运行时、WebUI 服务端、预览流、资源服务、校验器；
- 编辑器当前代码：`package.json`、`electron/`、`src/store.ts`、`src/components/Preview.vue`、`src/lib/previewProtocol.ts`，只用来确认当前基线、硬化点和不可伪造项；
- 01～12 已写下的目标合同，是验收对象；
- 冻结轮次地图 13 行：全量黄金脚本、端到端、WebUI→Forge/Fabric 真实验证、发布；出口“WebUI 稳定发布 + 迁移基线”。

旧 `plan/13-webui-acceptance-release` 只取路线，不照搬旧写法。旧文档里的“未实现/本次仅文档/未来执行者填”不作为 13 的句式；旧文档里与 12 冲突的字幕样式批处理、拆分合并、纯数据模板，不进入 13 的必过项。

## 三条硬边界

### 1. 验收对象是目标合同，不是当前旧界面

13 验收 01～12 的目标 UI 合同。当前 `App.vue`、`store.ts`、旧 `rightTab`、旧对象行不是目标界面，只作为“硬化前基线”的证据。

### 2. 真实验收，不用构建成功代替运行

`npm run build` 只证明前端能产物化；`npm run electron:build` 只证明能打包。两者都不能替代：

- Electron 真窗口启动；
- 真实游戏 Forge/Fabric 进入世界；
- 真实预览出帧；
- 真实播放/暂停/seek；
- 真实保存/重开/断连/关闭。

没有执行的项目写“待执行”，不写“通过”。

### 3. 13 只修三项，其他失败回原轮

13 允许直接修的只有：

- 预览档位 UI 与服务端固定 1920×1080@60 一致；
- 资源列举补视频扩展名，并与运行时能力对齐；
- `WebPreviewScreen` 关闭幂等，`onClose()` / `removed()` 共用 teardown。

其他业务语义、字段、面板、模板、字幕、转场、飞控问题，验收失败就回 01～12 对应轮修复，再回 13 复验。13 不把原轮的设计问题用“验收补丁”掩盖。

## 执行顺序

1. 13-01 先把覆盖账和证据规则定死；没有账外功能，没有“看起来可以”的口头通过。
2. 13-02 准备黄金脚本与负例；所有脚本先过真实 `ScriptParser` / `ScriptValidator`。
3. 13-03 验工作台与应用层；先不接游戏，确认编辑器自身可用。
4. 13-04 接 Forge/Fabric 真游戏；先跑最小脚本，再跑黄金脚本全集。
5. 13-05 单独跑字幕全流程；字幕是 12 的出口，不能混在普通覆盖层里草草带过。
6. 13-06 收三项硬化，并复验预览/帧消费/关闭；硬化后重跑 13-04 的关键路径。
7. 13-07 出发布基线；构建、打包、安装、首启、连接、已知限制。
8. 13-08 冻结给 14 的输入；13 未通过前不启动 14。

## 通过标准

13 通过必须同时满足：

- 13-01 的 blocker 项全部 PASS，且有证据；
- 黄金脚本正例全部被真实解析/校验接受，负例按预期拒绝或报 issue；
- 工作台六类界面场景全部通过；
- Forge 与 Fabric 两条真实游戏路径都通过；
- 字幕全流程通过，且无 sidecar、无工程内字幕副本；
- 三项硬化完成并复验；
- 发布包可构建、可安装、可首启、可连接；
- 14 交接清单冻结。

任一 blocker 为 FAIL 或 BLOCKED，13 不发布，也不启动 14。

## 本轮不做

- 不做 AUI 界面、游戏内输入、进程内 GPU 帧源；
- 不做纯数据模板、模板包、模板 DSL；
- 不做字幕样式批处理、拆分合并、ASS 样式映射；
- 不做本地像素合成、本地音频混音、第二套运行时；
- 不新增脚本字段、消息名、预览协议头；
- 不虚构自动化测试工程；当前没有 `npm test`，13 不新增测试脚本冒充门禁。

## 本轮实际执行（用户覆盖）

状态：**本轮范围内自动化验收通过；人工/看图项与用户豁免项单列；Forge 回放、字幕全流程、14 交接不在本轮范围。** 逐项结果见各文档"六、实现结果"，完整验收记录见 `docs/13-acceptance.md`。

本轮真实跑过的自动化段（命令、退出码、产物路径见验收记录 §二/§三）：

- 门禁：`npm run build` exit 0（12.16s）、`typecheck` 0 error、`verify` 171/0、`verify:08` 85/0、`verify:12` 568/0、`verify:13` 正例 12/12（15 文件）、负例 10/10、uncovered 0；收敛后日志见 `build-evidence\final-gates-scope\`。
- 纯 node 合同校验 `verify:13-contracts`：43 条，PASS 41 / FAIL 0 / DOWNGRADED 2，exit 0。
- 纯 node 字幕校验 `verify:13-subtitles`：16 条，PASS 14 / FAIL 0 / DOWNGRADED 2，exit 0（作为已执行证据保留，字幕全流程不在本轮必过范围）。
- E2E 套件：offline 7/7 PASS（runId `2026-11-19T15-13-08-568Z`）、corpus PASS、Fabric live 7/7 PASS；Forge 探针 `live-forge-probe` PASS（能接通）。
- `electron:build` 基线与改后各一次 exit 0（证据 `build-evidence\electron-build-*.log`）。

用户在开工前明确覆盖了本文档的两处原始约束，理由记在这里，以免后来者以为基线被悄悄改过：

1. **"不虚构自动化测试工程 / 不新增测试脚本"（上面"本轮不做"第 5 条）被覆盖**。用户要求把验收做成一套可复跑的配置驱动 E2E 系统，而不是一次性手点。落地为 `e2e-system/`（JSON 套件/场景/模板 + 插件注册与能力声明 + CLI `list`/`dry-run`/`run` + JSON/Markdown 报告 + 契约覆盖表），契约写在 `docs/13-e2e-system.md`；`package.json` 因此新增了 `typecheck`/`bench:workspace`/`verify:13`/`verify:13-contracts`/`verify:13-subtitles`/`fixtures:13`/`e2e:system*` 几个 script。系统里没有 SKIP/WARN 洗白状态。
2. **"13 只修三项"（本轮不做 + 三条硬边界第 3 条）被扩大到 13-06 的传输/预览热路径**。用户带来的《Electron 出现 CPU 100% 卡死》问题要求把主进程同步 IO、token 取值链路、预览帧消费一起硬化；另外为了让两类负例真的落到三层之一，新增了 L91（同轨字幕重叠）、L92（资源文件缺失）两条本地检查，以及 L93（OVERLAY 字段错层适用性）。这些都是**有意偏差**，逐条写在 13-02、13-05、13-06 与 `docs/13-acceptance.md`。

## 通过标准（本轮实测结论）

本轮范围 = 接通游戏 + 脚本能正常播放（Fabric min-tracks 一份）+ 预览非空，加门禁绿。证据路径见 `docs/13-acceptance.md` §二/§2.1。

| # | 本轮必过门 | 结论 | 依据 |
|---|---|---|---|
| 1 | 门禁绿：`build` / `typecheck` / `verify` / `verify:08` / `verify:12` / `verify:13` | **满足** | build exit 0（12.16s）、typecheck 0 error；171/0、85/0、568/0、正例 12/12（15 文件）/ 负例 10/10 / uncovered 0 |
| 2 | 接通游戏 | **满足** | Fabric `live-connect` PASS（真实 8765，connected=true）；Forge 探针 `waitConnected` PASS，正式套件 `live-forge-connect` PASS（7705ms） |
| 3 | 脚本能正常播放（Fabric min-tracks） | **满足** | 复跑 `2026-11-19T15-19-19-037Z`：connected=true → open(244ms)/validate(64ms)/push(17ms) 成功 → play playing=true → playbackAdvance 2.083s>0 → framesGrew +96 → canvasInk ink=true → stop playing=false |
| 4 | 预览非空（功能断言，非画质判断） | **满足** | min-tracks `canvasInk` ink=true（inkRatio 79.61%，非均匀 43.48%，1920×1080，复跑 `2026-11-19T15-19-19-037Z`）；offline `offline-preview-frame` PASS（2713ms，`2026-11-19T15-13-08-568Z`） |

### 用户豁免（本轮不做、不算缺口，不记 PASS 也不记 FAIL）

| # | 豁免项 | 理由 |
|---|---|---|
| E1 | 14 轮交接（13-08 只冻结清单，不启动 14） | 用户明确豁免；13 内未提前实现 AUI。 |
| E2 | 画面质量判断 | 只做"画面非空"功能断言，观感不判。 |
| E3 | 看图/人工操作项（六类界面、双窗口、世界退出残留、资源抽屉、档位目视、跨重启恢复） | 自动化不可信，单列 HUMAN。 |
| E4 | 111 条覆盖账逐条落点 | 用户原话：不要求 111 条覆盖账；未执行条目不记为本轮缺口。 |
| E5 | 字幕 SRT/VTT 导入全流程 + 字幕真机播放 | 不在本轮范围；纯 node 14/0/2 保留为已执行证据。 |
| E6 | Forge/Fabric 双加载器全量四脚本 | 不在本轮范围；Fabric 四份既有记录保留为证据，必过仅 min-tracks；Forge 只要求能接通。 |

**最终判定：本轮范围内自动化验收通过；人工/看图项与用户豁免项单列；Forge 回放、字幕全流程、14 交接不在本轮范围。14 未启动。**

