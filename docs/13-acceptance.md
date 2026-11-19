# 13 轮验收记录（WebUI 验收发布）

> 收口说明（2026-11-19）：按最终口径，旧 `e2e/`、`playwright.config.ts`、`corpus/13/`、`build-evidence/`、`e2e-system/artifacts/` 及纯 node 13 轮校验脚本已清理；自动化测试只保留 `e2e-system/`，产物统一落 `e2e-system/artifacts/`。下文历史证据路径仅记录当时运行。

- 记录时间：2026-11-19
- 编辑器仓库：`E:\Documents\GitHub\ImmersiveCinematicsEditor`（分支 `webui`，HEAD 9f501c3；本轮改动已按收口口径整理并分批次提交）
- 模组仓库（只读使用）：`E:\Documents\GitHub\ImmersiveCinematics`（Fabric 1.20.1 / 模组 0.3.6 / loader 0.16.10；Forge 侧 ForgeGradle 6、Forge 47.4.16，任务路径 `:forge:Client`）
- 环境：Windows 11 / PowerShell 7.6.4 / Node v22.23.2 / Electron ^43.2.0（以 `package.json` devDependencies 为准）/ 编辑器版本 0.1.0 / ffmpeg 8.1.1-full_build
- **最终判定：本轮范围内自动化验收通过；人工/看图项与用户豁免项单列；Forge 回放、字幕全流程、14 交接不在本轮范围。** 门禁实测：build exit 0（12.16s）、typecheck 0 error、verify:13 正例 12/12 / 负例 10/10、offline 7/7 PASS（§二）。

> 状态口径：PASS / FAIL / BLOCKED / NOT RUN / HUMAN / 待定。DOWNGRADED 单列并写降级理由；不用 WARN 洗白。豁免项不记 PASS，也不记 FAIL，单列并写理由。

## 一、环境与版本

| 项 | 值 | 证据 |
| --- | --- | --- |
| 编辑器版本 | 0.1.0 | live/offline 套件报告 `editorVersion` |
| 模组版本 | 0.3.6 | 套件报告 `modVersion` |
| Fabric loader | 0.16.10 | 套件报告 `loader` |
| Forge | 47.4.16 / FG6，`:forge:Client` | 模组仓库 `forge/run`、`tools/devtools` |
| Node | v22.23.2 | 套件报告 `node` |
| Electron | ^43.2.0 | `package.json` devDependencies |
| ffmpeg | 8.1.1-full_build | 套件报告 `ffmpeg` |

## 二、本轮跑过什么（命令 + 退出码 + 产物路径）

工作目录 `E:\Documents\GitHub\ImmersiveCinematicsEditor`。退出码：全 PASS → 0，任一 FAIL → 1，仅 BLOCKED → 2；无 SKIP 状态。

| 命令 | 结果 | 退出码 | 证据路径 |
| --- | --- | --- | --- |
| `npm run build` | exit 0，`✓ built in 12.16s`（收敛后 fix2 次） | 0 | `build-evidence\final-gates-scope\build-fix2-231228.log` |
| `npm run typecheck`（`vue-tsc --noEmit`） | 0 error | 0 | `build-evidence\final-gates-scope\typecheck-fix2-231228.log` |
| `npm run verify` | summary ok=171 / fail=0 | 0 | `build-evidence\final-gates\npm_run_verify.log` |
| `npm run verify:08` | 08 自检 ok=85 / fail=0 | 0 | `build-evidence\final-gates\npm_run_verify_08.log` |
| `npm run verify:12` | summary ok=568 / fail=0 | 0 | `build-evidence\final-gates\npm_run_verify_12.log` |
| `npm run verify:13` | 清单 `corpus/13/manifest.json`（`manifestHash d4c19c77bed62ced…`）；正例 12/12（15 份文件）、负例 10/10 按预期拒绝、0 类未覆盖 | 0 | `build-evidence\final-gates-scope\verify13-230840.log` |
| `npm run verify:13-contracts` | 43 条：PASS 41 / FAIL 0 / DOWNGRADED 2 | 0 | `build-evidence\13-contracts\{results.json,report.md}` |
| `npm run verify:13-subtitles` | 16 条：PASS 14 / FAIL 0 / DOWNGRADED 2 | 0 | `build-evidence\13-subtitles\{results.json,report.md}` |
| `npm run e2e:system:run -- --suite offline` | 7/7 PASS（open-valid 5413ms、invalid-rejected 30ms、no-token 5988ms、disconnect-status 1369ms、preview-frame 2713ms、timeline-no-objects 21ms、close-idempotent 222ms） | 0 | `e2e-system\artifacts\2026-11-19T15-13-08-568Z\{run.json,report.md,coverage.md}` |
| `npm run e2e:system:run -- --suite corpus` | PASS（corpus-all，35.9s） | 0 | `e2e-system\artifacts\2026-11-19T10-25-31-157Z\{run.json,report.md,coverage.md}` |
| `npm run e2e:system:run -- --suite live`（Fabric） | 7/7 PASS，cleanupErrors []，CLI exit 0；本轮必过口径仅 min-tracks 一份，其余三份 + 重连为既有实测证据 | 0 | `e2e-system\artifacts\2026-11-19T11-48-46-189Z\{run.json,report.md,coverage.md}` |
| `npm run e2e:system:run -- --suite live-forge-probe`（Forge 探针） | PASS：`probe-forge-min-tracks`，接通 + 打开/校验/推送/播放/出帧/停止 | 0 | `e2e-system\artifacts\2026-11-19T14-41-12-674Z\{run.json,report.md,coverage.md}` |
| `npm run e2e:system:run -- --suite live-forge`（Forge 正式套件） | **FAIL，已记录；按用户裁量不纳入本轮判定**（见 §六） | 1 | `e2e-system\artifacts\2026-11-19T14-45-22-280Z\{run.json,report.md,coverage.md}` |
| `npm run electron:build`（基线原配置） | NSIS 安装包 + blockmap 生成 | 0 | `build-evidence\electron-build-baseline.log` |
| `npm run electron:build`（删绝对路径后） | 同上，日志无 `liveget` / `custom unpacked` | 0 | `build-evidence\electron-build-after.log` |
| `node electron/bench-workspace.cjs 2000` | 基准对照见 13-06 §6.3（旧同步 / 新异步两组采样） | 退出码未记录 | `build-evidence\bench-workspace-2000.log` |

收敛后门禁日志目录：`build-evidence\final-gates-scope\`（build / typecheck / verify13 / offline 各 fix2 次记录）。Fabric min-tracks 单场景复跑（当前工作区代码，runId `2026-11-19T15-19-19-037Z`）结果 **PASS**（11.7s，CLI exit 0）：advance 2.083s、帧增量 96、inkRatio 79.61%、nonUniform 43.48%、1920×1080、stop `playing=false`；截图 `min-tracks-play.png` 同目录。`2026-11-19T11-48-46-189Z` 保留为同一解码代码的四份脚本历史证据。

live 套件截图（只截编辑器 viewport，不截桌面）：`min-tracks-play.png`、`camera-lane-transition-play.png`、`subtitles-play.png`、`full-showcase-play.png`、`reconnect-after.png`，均在 `2026-11-19T11-48-46-189Z\` 目录下。

### 2.1 本轮三道门的实测断言

**门一：接通游戏。** Fabric `live-connect` PASS（8261ms，`transport.connected()=true`，连真实 8765）；Forge 探针 `editor.waitConnected` PASS（`connected=true`），正式套件 `live-forge-connect` PASS（7705ms）。

**门二：脚本能正常播放（Fabric min-tracks 一份）。** 证据 `2026-11-19T15-19-19-037Z\run.json`（收敛后按当前工作区代码单场景复跑，runId `2026-11-19T15-19-19-037Z`，status PASS，11.7s）的 `live-play-min-tracks` 步骤链：

| 断言 | 实测 |
| --- | --- |
| 已连接 | `open` 摘要 `connected=true` |
| 打开文档 | `editor.open` ok=true，`blocking=0`、`issueCount=0` |
| 校验 | `editor.validate` ok=true，`issues=[]` |
| 推送 | `editor.push` ok=true |
| 播放 | `editor.play` playing=true（200ms） |
| 时间推进 | `playbackAdvance` delta=2.057s（>0） |
| 出帧 | `framesGrew` delta=85 |
| 画面非空（功能断言，非画质判断） | `canvasInk` ink=true，inkRatio 79.61%（非均匀 43.48%、两采样变化 98.58%），1920×1080 |
| 停止回执 | `editor.stop` playing=false（200ms） |

**门三：预览非空。** H.264 预览解码落地（WebCodecs），真机连接后 canvas 非空：min-tracks `canvasInk.ink=true`（inkRatio 79.61%，runId `2026-11-19T15-19-19-037Z`）；offline `offline-preview-frame` PASS（2713ms，onFrame 帧数增长、`lastFrameAt` 变化，runId `2026-11-19T15-13-08-568Z`）。

## 三、本轮范围内已执行项与证据

本轮通过条件按用户划定的三道门（接通游戏 + 脚本能正常播放 + 预览非空）+ 门禁绿。**111 条覆盖账逐条落点不在本轮自动化范围**（用户豁免，见 §五）；本节只列本轮真实跑过并出结论的项。

| 已执行段 | 结论 | 证据 |
| --- | --- | --- |
| 门禁 `build` / `typecheck` / `verify` / `verify:08` / `verify:12` / `verify:13` | build exit 0（12.16s）、typecheck 0 error；171/0、85/0、568/0、正例 12/12（15 文件）/ 负例 10/10 / uncovered 0 | `build-evidence\final-gates-scope\`、`build-evidence\final-gates\*.log` |
| 纯 node 合同校验 43 条 | PASS 41 / FAIL 0 / DOWNGRADED 2 | `build-evidence\13-contracts\{results.json,report.md}` |
| 纯 node 字幕校验 16 条 | PASS 14 / FAIL 0 / DOWNGRADED 2（作为已执行证据保留；字幕全流程不在本轮必过范围） | `build-evidence\13-subtitles\{results.json,report.md}` |
| offline 套件 | 7/7 PASS | `2026-11-19T15-13-08-568Z` |
| corpus 套件 | PASS | `2026-11-19T10-25-31-157Z` |
| Fabric live 套件 | 7/7 PASS；必过仅 min-tracks，其余为既有证据 | `2026-11-19T11-48-46-189Z` |
| Forge 探针 | PASS（能接通） | `2026-11-19T14-41-12-674Z` |

### 3.1 两条合同 DOWNGRADED

- `11-01`：factIndex / summary 只给条目事实，不暴露抽屉根作用域；待补行为抽屉只读钩子。
- `01-07`：Java 共享服务静态方法在 node 进程内不可执行；重名新建、截断列表、scriptRoot 归一化只做源码对账，未做 JVM 文件系统往返；待补只读钩子或 JVM 测试桩。

### 3.2 两条字幕 DOWNGRADED

- `SUB-02C`：缺 key 只有预览分类 `kind=missing`，parse/compile 链路无指向 cueOrdinal 的 issue；语言资源 IPC（`resources.list("lang")`）未接。
- `SUB-10`：cue↔clip 纯数据映射已证；面板选中/高亮 IPC（`requestSelect` / `revealInEffectControls`）留第二阶段。

### 3.3 覆盖账口径说明

`e2e-system/config/coverage.json` 共 111 条（P0=70 / P1=39 / P2=2，与 13-01 §4.3 一致）。本轮**不以逐条覆盖落点作为通过条件**；未在本轮执行的条目统一归入 §五豁免或 §六已记录事项，不再写成"待下一轮缺口"。

> 证据产物级别列偏差（待对方修，本轮不改证据文件）：`build-evidence\13-contracts\results.json` / `report.md` 的级别列与 `coverage.json` 不一致，共 29 条——28 条报告标 P1、账为 P0，1 条（`01-03`）报告标 P0、账为 P1。分级一律以 `coverage.json`（即 13-01 §4.3 账）为准。

## 四、逐份文档结论摘要

| 文档 | 本轮范围内状态 | 结论摘要 |
| --- | --- | --- |
| 13-01 验收总账 | 范围内通过 | 本轮已执行项逐条有证据（见 §三）；111 条逐条覆盖不在本轮范围；未执行项按豁免单列。 |
| 13-02 黄金语料 | 范围内通过 | 12 组正例（15 份）/10 负例/25 期望/清单哈希落地，`verify:13` 12/12、10/10、uncovered 0；字幕 17 个字节夹具与 `verify:13-subtitles` 为已执行证据。 |
| 13-03 工作台应用层 | 人工项豁免 | offline 静态子集 7/7 PASS；六类手工界面场景与跨重启恢复按豁免单列（§五）。 |
| 13-04 真游戏冒烟 | 范围内通过（Fabric min-tracks）；Forge 能接通 PASS、回放豁免 | Fabric min-tracks 全链路断言见 §2.1；Forge 探针 PASS；正式套件回放 FAIL 已记录、按豁免不纳入本轮判定（§六）。 |
| 13-05 字幕端到端 | 纯 node 段已执行；全流程豁免 | 纯 node 16 条 14 PASS / 2 DOWNGRADED 保留为证据；SRT/VTT 导入全流程与真机播放不在本轮范围（§五）。 |
| 13-06 传输/预览/关闭硬化 | 范围内通过 | 预览黑屏根因修复并在 offline + Fabric 真机复验，min-tracks 画面非空；异步 IO/token/退避有基准；人工目视项按豁免单列。 |
| 13-07 发布基线与安全 | 打包配置已验证；安装首启豁免 | 打包配置删构建机绝对路径，两次 `electron:build` exit 0；进程边界复核通过；安装/卸载/首启不在本轮范围。 |
| 13-08 向 14 交接 | 豁免：只冻结清单 | 冻结件已备齐；按用户豁免本轮不向 14 交接，14 未启动。 |

## 五、人工项与用户豁免清单

### 5.1 用户豁免（本轮不做、不算缺口；不记 PASS，也不记 FAIL）

| # | 豁免项 | 理由 |
| --- | --- | --- |
| E1 | **14 轮交接**：13-08 只冻结清单，不启动 14 | 用户明确豁免本轮不向 14 交接；13 内未提前实现 AUI。 |
| E2 | **画面质量判断** | 本轮只做"画面非空"的功能断言（canvasInk ink=true）；叠化/morph/字幕/覆盖层/调色/音频观感不做结论。 |
| E3 | **看图/人工操作项** | 需拖拽会话、目视排版、IME 手感、跨重启文件副本比对、双窗口飞控；自动化不可信，单列 HUMAN。 |
| E4 | **111 条覆盖账逐条落点** | 用户原话：不要求 111 条覆盖账；未执行条目不记为本轮缺口。 |
| E5 | **字幕 SRT/VTT 导入全流程 + 字幕真机播放** | 不在本轮范围；纯 node 段 14 PASS / 0 FAIL / 2 DOWNGRADED 作为已执行证据保留，不列为本轮必过项。 |
| E6 | **Forge/Fabric 双加载器全量四脚本** | 不在本轮范围；Fabric 四份脚本既有实测记录保留为证据，本轮必过口径只是 min-tracks 一份；Forge 只要求"能接通"。 |

### 5.2 HUMAN 项（`e2e-system/config/manual-items.json`）

| 编号 | 项 | 必须人工的原因 |
| --- | --- | --- |
| 13-03-A | 六类工作台界面：布局拖动、停靠换位、抽屉拖出、小窗无重叠裁切、主题切换、IME 输入与撤销手感 | 自动化只能断言静态 DOM 计数，覆盖不了拖拽手感、目视无重叠/无裁切、输入法不串命令 |
| 13-03-B | 重启后布局/窗口位置/主题/最近项目恢复；偏好/布局/窗口/草稿四文件分离且坏一个只恢复一个 | 需跨重启操作并比对状态文件前后副本；离线套件无重启流程 |
| 13-06-A | 双窗口：关 A 后 B 继续出帧；捕获中心未被关闭；他人飞控未被取消 | 需两个 Electron 窗口同挂播飞控；现有 e2e 单窗口 |
| 13-06-B | 世界退出与总开关关闭后端口、捕获消费者、按键冷却、token 残留 | 需真实世界退出/总开关操作并逐项核对；live 只覆盖 rig-down 杀进程后的离线与重连 |
| 13-06-C | 资源抽屉四类类型列举扩展名、越界拒绝、超限截断、无 ffmpeg 音频状态 | 缺样例资源夹具；抽屉交互与截断目视归人工 |
| 13-06-D | 档位选择器移除、状态栏只读固定规格、回执尺寸异常可见不静默换档 | 界面目视项，需连接前后与重连后核对文案 |
| 13-05 | 字幕抽屉导入、cue 表交互、批次拆轨操作、cue↔clip 定位高亮 | 需字幕抽屉交互与向导；纯函数层已由 `verify:13-subtitles` 覆盖 |

## 六、已记录但不纳入本轮判定的事项

| 事项 | 记录 | 处置口径 |
| --- | --- | --- |
| Forge 正式套件回放 FAIL | runId `2026-11-19T14-45-22-280Z`：`live-forge-connect` PASS（7705ms）；`live-forge-min-tracks` 在 `playbackAdvance` delta=0 失败；`live-forge-full-showcase` 在 `framesGrew` 阶段失败（`page.evaluate: Target page, context or browser has been closed`，轮询 791028ms）。定性：Forge 帧流下 Playwright 的 CDP 通道积压到 270MB（超 256MB 上限）导致 `page.evaluate` 饿死，回放断言无法采集。 | **按用户裁量不再追因、不作为本轮阻塞项**；记录在案，不写成"环境不具备"。Forge 路径本轮口径：**能接通 PASS（探针）／回放未验证（用户豁免）**。 |
| Forge 服务侧事实 | 客户端可启动并进世界（`latest.log` 有 `Preparing start region`）；F6 后 `[IC-WebUI] server started at 127.0.0.1:8765`；netstat 8765 归属 Forge pid；token 文件 mtime 刷新；forge 工作区两份脚本四方哈希一致；资源补齐后 L92 归零。 | 服务侧 PASS 记录；证据见台账 `13-progress-notes.md` 与 `forge/run` 目录。 |
| offline 首跑 3 条 FAIL（已修复并复验） | offline 套件第一次重跑时 `offline-no-token` / `offline-disconnect-status` / `offline-preview-frame` 3 条 FAIL；根因为产品侧通知缺口（见 §八.6），后两条是第一条失败后 token 未复原的级联，不是独立失败。 | 产品侧补通知与展示后，offline 收敛后 7/7 PASS（runId `2026-11-19T15-13-08-568Z`）；断言一字未改，非测试放宽。 |
| 无 ffmpeg 回退 RGBA 路径、外部音频"可列举不可播放" | 本机 ffmpeg 8.1.1 可用，缺无 ffmpeg 环境与音频夹具 | 不在本轮范围。 |
| 安装/卸载/首启、包内清单核验、显示名一致性、发布说明 | 本机无无副作用的干净安装环境 | 不在本轮范围；不伪造通过证据。 |
| 面板/预览/校验只读钩子缺口 | 清单见 `build-evidence\13-contracts\report.md`「需要新增只读调试钩子才能断言的条目」节（03-08、08-02、08-04、10-01、10-03、10-06、11-01、11-05、11-10、01-07） | 纯 node 校验已在现有钩子下出结论；缺口条目随对应原轮处理。 |

## 七、最终判定与豁免项去向

### 7.1 最终判定

本轮范围 = 接通游戏 + 脚本能正常播放（Fabric min-tracks）+ 预览非空，加门禁绿。实测：`npm run build` exit 0（12.16s）、`typecheck` 0 error、`verify`/`verify:08`/`verify:12`/`verify:13` 全绿、offline 7/7 PASS；Fabric min-tracks 全链路断言 PASS（§2.1）；Forge 探针接通 PASS；预览 H.264 落地且真实连接后 canvas 非空（inkRatio 79.61%，96 帧增量 / advance 2.083s，runId `2026-11-19T15-19-19-037Z`）。**本轮范围内自动化验收通过；人工/看图项与用户豁免项单列；Forge 回放、字幕全流程、14 交接不在本轮范围。**

### 7.2 豁免项去向（不记为本轮缺口）

| 豁免项 | 去向 |
| --- | --- |
| Forge 回放（CDP 背压） | 已记录；按用户裁量不追因、不纳入本轮判定。后续是否复测由用户决定。 |
| 字幕 SRT/VTT 导入全流程、真机播放、删源文件后播放、z_index/alpha | 不在本轮范围；`files:pick-subtitle` 路径覆盖方案见 `docs/13-e2e-system.md` 追加节。 |
| 14 交接 | 本轮豁免，14 未启动；冻结清单见 13-08。 |
| 六类界面场景、双窗口、世界退出残留、资源抽屉列举、档位目视 | HUMAN 走查项，不在本轮自动化范围。 |
| 安装/卸载/首启、包内清单、发布说明 | 不在本轮范围。 |

## 八、本轮发现的真实缺陷清单

1. **旧预览面板黑屏真因**：旧 `PreviewPanel.vue` 对非 RGBA 帧直接 `return`（H.264 进不来），且对所有帧写 `lastFrameInfo` 却没有对应绘制路径；H.264 到达后占位消失、画布无帧可画，表现为黑 canvas。本轮已修复（WebCodecs 解码、队列上限、PTS 重整、VideoFrame 逐条释放、状态语义改为只记录真正上屏过的帧）。
2. **L93 缺检查**：已登记但仅适用于特定层的字段（subtitle 写 `color` / `color.r`）此前结构检查不拦截；本轮在 `src/core/doc/structural.ts` 新增错层适用性检查 L93，复用 `features/overlay/layers.ts` 的字段面矩阵；fade 层合法 color 不误报，未登记路径仍由 L34 拦截。
3. **verify-09 模组零改动检查未分桶**：此前不能区分受保护运行时/协议面、授权 devtools 改动、其他改动；本轮加固为三桶判定（受保护前缀出现即红；`tools/devtools` 按显式授权清单六条路径放行；其余归 otherHits 判红）。四组反证（protected `common/src` 红、protected `forge/src` 红、清单外 devtools 文件红、未分类 `tools/script-migrate` 红）过程见台账 `13-progress-notes.md`；恢复后 `verify-09 fail=0`（证据 `build-evidence\final-gates\npm_run_verify_12.log`）。检查被加固，未被放宽。
4. **Forge 侧语料/资源缺失**：15 份正例装入 `forge/run` 后，`1_reverb_part1.ogg`（30195B）与 `AZUL.cube`（116240B）初始缺失，L92 未归零；补齐到 Forge 资源根（资源根 5→7 文件）后复校验 min-tracks 与 full-showcase 的 L92 归零。
5. **台账核对中纠正的三处事实**（文档/台账与代码冲突，以代码为准）：
   - `10-01` AUDIO 同轨重叠校验真实位于 `plugins/core.audio/shared/audioSpec.ts#overlappingAudioClips`；structural 层无 block 级 jsonPath 诊断。
   - `09-05` 门控字段是 `appliesTo`，不是 `requires`。
   - `07-07` 形状生成夹具需两个位置关键帧。
6. **状态原因推不到面板（setStatus 不通知订阅者）**：`WebUiClient.setStatus()` 只改 `status`/`reason` 字段、不通知订阅者；未连上时 `connectedFlag` 恒为 false，`setConnected()` 的去重早退使面板收不到任何通知，于是「缺少 WebUI token：…」这条可读原因推不到 `.preview-panel`，面板只显示无信息量的「预览未接入（游戏 WebUI 未连接）」——正是 13-06 合同要求「状态区给出可读原因」的缺口。修复：① `setStatus` 在状态码变化时通知订阅者；② `PreviewPanel` 的状态订阅改为同时比较连接态与状态码；③ 面板无归类状态但服务端有 `reason` 时直接展示 reason。断言一字未改，是产品侧补的通知与展示，不是测试用例放宽或断言调整；修复后 offline 7/7 全绿。
7. **证据产物级别列偏差（证据侧缺陷，本轮未改证据文件）**：`build-evidence\13-contracts\results.json` / `report.md` 的级别列与 `coverage.json` 不一致，共 29 条——28 条报告标 P1、账为 P0，1 条（`01-03`）报告标 P0、账为 P1。分级一律以 `coverage.json`（13-01 §4.3 账）为准；报告级别列待对方修正。

## 九、顺带修正的过期事实

1. **Electron 版本**：旧记录写 "Electron 33"；以 `package.json` devDependencies 为准为 `^43.2.0`（43.x）。
2. **Forge 环境口径**：旧记录写"只备了 Fabric 开发运行目录，起 Forge 需另备环境"。实际模组仓库存在 `forge/run/` 完整实例目录；`tools/devtools` 默认指向 `fabric/run`。本轮 Forge 客户端已真起并进世界、探针接通 PASS。
3. **E2E 规模口径**：旧记录写"3 套件 13 场景 11 模板"。实际（按目录清点）：19 个场景配置文件，其中 15 个挂进正式套件（offline 7 / corpus 1 / live 7）；4 个未并入正式结果——3 个 `live-forge-*` 全链路场景 + 1 个 `probe-forge-min-tracks` 定性探针（挂在独立 `live-forge-probe` 套件，不与 Fabric 结果混算）；模板 13 个；插件 5 个。
4. **调色通道数**：旧文档写 "CAMERA 57 通道 / ADJUST 59 通道"，与编辑器字段目录和模组校验器实测叶子数对不上；按代码实测为准，不在文档保留未核对的 57/59 数字。
5. **"不建自动化测试工程"已被用户覆盖**：`e2e-system/`（配置 + 源码 + 5 插件 + 报告产物契约）落地，`package.json` 新增 `typecheck` / `verify:13` / `verify:13-contracts` / `verify:13-subtitles` / `fixtures:13` / `e2e:system*` / `bench:workspace` 等 script。
6. **旧运行记录已被取代**：旧 offline `2026-11-19T10-24-46-268Z`、`2026-11-19T11-53-40-824Z` 为本轮早期记录；本轮权威产物为 offline `2026-11-19T15-13-08-568Z` 与 live 单场景复跑 `2026-11-19T15-19-19-037Z`；`2026-11-19T11-48-46-189Z` 为同一解码代码的四份脚本历史证据（7/7）。
7. **`docs/13-e2e-system.md` 既有条目与代码的出入**（context.ts 目录条目、`live.frameGrow` 命名、模板断言返回值、示例场景 id/套件名、capability 与 op 分列、产物目录路径等）已登记在 `13-coverage-map.md` §5（C2～C7、C12）；本轮按范围未改该契约文档，仅追加对话框方案一节。

## 十、复跑指引

```powershell
cd E:\Documents\GitHub\ImmersiveCinematicsEditor
npm run verify:13                  # 语料：12 正例 + 10 负例，不需要游戏
npm run verify:13-contracts         # N1/N3/N6 纯 node 合同校验
npm run verify:13-subtitles         # 字幕纯函数段校验
npm run e2e:system:list
npm run e2e:system:dry -- --suite offline
npm run e2e:system:run -- --suite offline
npm run e2e:system:run -- --suite corpus
# 真游戏前置：客户端在跑（icdev rig-status 退出 0）、已在世界、F6 开预览屏（8765 监听）、token 文件非空
npm run e2e:system:run -- --suite live
```

注意点（本轮踩过）：`--suite` 前必须加 `--`；`live-close-idempotent` 排最后；`live-reconnect` 会杀客户端重启，其后只能跑不依赖游戏的场景；`game.waitWorld` 必须同时满足窗口存在与世界已加载；`game.ensureWebUi` 按真实 8765 监听判定，未监听才重按；`editor.stop` 必须等 playback 回执；Playwright `outputDir` 会清空 `e2e-system/artifacts`，证据日志另存 `build-evidence/`。
