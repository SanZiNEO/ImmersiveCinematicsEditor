# 13 轮 E2E 系统契约（冻结）

> 收口说明（2026-11-19）：按最终口径，旧 `e2e/`、`playwright.config.ts`、`corpus/13/`、`build-evidence/`、`e2e-system/artifacts/` 及纯 node 13 轮校验脚本已清理；自动化测试只保留 `e2e-system/`，产物统一落 `e2e-system/artifacts/`。下文提到旧 e2e、corpus 与 build-evidence 的段落为历史设计记录。

> 状态：契约冻结，实现由并行子代理按本文落地。
> 本文是 13 轮"系统性 E2E"的唯一规范：目录、配置格式、执行模型、插件能力、状态语义与报告。
> 与 `plan/13/13-01` 的关系：覆盖表已按收口要求移除；与 `plan/13/13-02` 的关系：语料已按收口要求移除。
> 偏差声明：`plan/13/13-01` 与 `13-07` 写有"不建立自动化测试工程"，本轮用户明确覆盖该条，理由见 `docs/13-acceptance.md`。

## 一、要解决的问题

旧的 `e2e/*.spec.ts` 是一组手写 Playwright 用例：每加一个场景就要复制一份 `test()`，连接方式、断言语义、证据落盘各写一遍，离线与真游戏两套代码互不复用。13 轮要求它变成一套**配置驱动、模板展开、插件化**的系统：

- 场景是数据（JSON），不是代码；新增场景 = 新增/改配置，不改运行器；
- 场景由模板 + 参数展开，同一模板跑 N 份夹具不需要 N 份 spec；
- 能力来自插件，插件声明自己提供哪些能力，场景声明自己需要哪些能力；
- 缺能力 = `BLOCKED`，不是静默跳过、也不是伪造通过；
- 输出机器可读报告 + 人读报告。

## 二、目录与职责

```
e2e-system/
  config/
    default.json          # 全局默认：artifacts 目录、超时、端口、工作区解析
    suites/*.json         # 套件：选哪些插件、跑哪些场景
    scenarios/*.json      # 场景：模板 + 参数（+ 覆盖项声明）
    templates/*.json      # 模板：步骤序列，参数占位 ${...}
  src/
    cli.ts                # list / dry-run / run
    config.ts             # 加载 + 严格校验（未知模板、未解析参数、缺能力都报错）
    template.ts           # 参数展开
    registry.ts           # 插件注册、能力索引、生命周期
    runner.ts             # 场景执行、状态判定、证据收集
    context.ts            # 运行上下文（产物目录、日志、证据、参数）
    report/json.ts        # run.json
    report/markdown.ts    # report.md
  plugins/
    electron-host/        # 真 Electron 编辑器宿主
    fake-webui/           # 浏览器侧假 WebUI（离线）
    live-webui/           # 真 WebUI 观测（连接/帧/播放头）
    icdev-driver/         # 模组侧真游戏驱动（tools/devtools）
    evidence/             # 证据收集与哈希
  artifacts/<runId>/      # 每次运行的产物（截图、日志、run.json、report.md）
```

旧 `e2e/*.spec.ts` 与 `playwright.config.ts` 已按收口要求删除；`e2e-system` 是唯一自动化入口。

## 三、配置格式

### 3.1 `config/default.json`

```json
{
  "artifactsDir": "e2e-system/artifacts",
  "defaultTimeoutMs": 20000,
  "launchTimeoutMs": 90000,
  "ports": { "vite": 5173, "webui": 8765 },
  "paths": {
    "editorRepo": ".",
    "workspace": "../ImmersiveCinematics/fabric/run/immersive_cinematics",
    "icdev": "../ImmersiveCinematics/tools/devtools"
  },
  "env": { "webuiTokenFile": "%USERPROFILE%/.immersivecinematics/webui-token" }
}
```

`paths.*` 相对 `e2e-system/` 所在仓库根解析；环境变量存在时优先（`IC_WORKSPACE` / `IC_WEBUI_TOKEN_FILE` / `ICDEV_HOME`），保证同一份配置在不同机器上可用。

### 3.2 `config/templates/*.json`

```json
{
  "id": "editor-script-play",
  "description": "打开脚本 → 校验 → 推送 → 播放 → 观察服务端时间与帧 → 停止",
  "requires": ["host.electron", "editor.doc", "editor.preview", "evidence"],
  "steps": [
    { "op": "editor.open", "with": { "path": "${fixture}" }, "expect": { "truthy": "result.ok" } },
    { "op": "editor.validate", "expect": { "eq": ["result.phase", "有效"] } },
    { "op": "editor.push", "expect": { "truthy": "result.ok" } },
    { "op": "editor.play", "expect": { "truthy": "result.playing" } },
    { "op": "editor.playbackAdvance", "with": { "windowMs": 2000 }, "expect": { "gte": ["result.delta", 1] } },
    { "op": "editor.framesGrew", "with": { "windowMs": 2000 }, "expect": { "gte": ["result.delta", 1] } },
    { "op": "editor.screenshot", "with": { "name": "${slug}-play" } },
    { "op": "editor.stop", "expect": { "eq": ["result.compare", "未播"] } }
  ]
}
```

规则：

- 步骤只有三种键：`op`（必填）、`with`（参数）、`expect`（断言）。
- `expect` 的键是断言种类（`eq|neq|gt|gte|lt|lte|contains|matches|lenGte|truthy|falsy`），值是一个路径或 `[路径, 期望值]`。路径以 `result.` 开头，指向该 op 的返回值。
- 表达式中 `"${name}"` 只从该场景的参数对象取值；整体字符串是 `"${name}"` 时保留原始类型（数字/布尔数组不转字符串）。未解析的占位符 → 配置错误（`E_EXPAND`），不静默留空。
- 模板的 `requires` 是能力声明；运行器解析到具体插件，缺任一能力 → `BLOCKED`。

### 3.3 `config/scenarios/*.json`

```json
{
  "id": "live-play-min-script",
  "title": "真游戏：最小脚本播放",
  "template": "editor-script-play",
  "params": { "fixture": "13/min-tracks.json", "slug": "min-tracks" },
  "covers": ["03-01", "13-04-open-push"]
}
```

### 3.4 `config/suites/*.json`

```json
{
  "id": "offline",
  "title": "离线回归（假 WebUI + 真编辑器）",
  "plugins": ["electron-host", "fake-webui", "evidence"],
  "scenarios": ["offline-open-valid", "offline-invalid-rejected", "offline-offline-status"]
}
```

### 3.5 覆盖表（已移除）

13 轮收口时按用户口径移除了 `config/coverage.json` 与 `report/coverage.ts`；E2E 只保留套件执行与 `run.json` / `report.md`。

## 四、执行模型

1. **加载**：读 `default.json` → 读套件 → 解析场景 → 展开模板 → 校验能力。任何一步失败都中止并给出文件路径与原因。
2. **能力探测**：每个插件提供 `available(ctx)`（如 icdev 需 `.venv` 存在、真 WebUI 需 token 与 8765 监听）。场景声明的能力缺一项 → 该场景 `BLOCKED`，`reason` 写具体缺失项。
3. **执行**：按步骤顺序执行；每步记录 `op`、参数、耗时、结果摘要；断言失败立即中止该场景并标记 `FAIL`（记录 `expected` / `actual` / 步骤序号）。
4. **证据**：每步可产出证据（截图只截编辑器窗口本身，`page.screenshot()`，不截桌面全屏）；证据落 `artifacts/<runId>/`，路径写进报告。
5. **注销**：无论成败，逆序执行插件 `teardown`（关窗口、停服务、停游戏、清定时器）。teardown 抛错计入 `cleanupErrors`，不吞。
6. **状态**：`PASS` / `FAIL` / `BLOCKED`。**没有 SKIP**：不能跑的必须是 `BLOCKED` 并带原因。

## 五、插件能力表（最小集合）

`electron-host`：

| 能力 | 含义 |
|---|---|
| `host.electron` | 起停真 Electron 窗口（dev 模式，渲染进程调试钩子 `__workbench` 可用） |
| `editor.doc` | `editor.open / editor.validate / editor.saveState / editor.localIssues` |
| `editor.ui` | `ui.click / ui.expectText / ui.expectVisible / ui.expectHidden / ui.count` |
| `editor.preview` | `editor.state / editor.playbackAdvance / editor.framesGrew / editor.metrics`（`editor.metrics` 取 `app.getAppMetrics()` 按进程类型聚合的 CPU/内存，作为"预览时主进程与渲染进程没被拉满"的实测证据） |
| `editor.play` | `editor.play / editor.stop / editor.seek / editor.push`（`editor.stop` 发停止后**轮询等服务端 `playback.state` 回执**变成 `playing=false` 才判定，`value={playing,waitedMs}`；发送瞬间读状态必然是 `playing=true`，那不是失败） |
| `editor.lifecycle` | `editor.closeWindow`（可 `repeat` 做关闭幂等）、`editor.waitConnected / editor.waitDisconnected`、`editor.writeToken`（离线无 token 用例）、`editor.retry`（显式重连） |
| `evidence` 依赖 | `editor.screenshot`：截图、窗口尺寸、渲染进程错误收集 |

`fake-webui`：`webui.fake`（`fake.install / fake.offline / fake.reconnect / fake.failSave / fake.requests / fake.pushBinary`）。`fake.pushBinary` 由本插件目录内的 `fakeWebUi.ts` 提供，用于投递真实 18 字节帧头的二进制预览帧，不另建第二套假服务。

`live-webui`：`webui.live`（`live.port / live.token / live.connected / live.frameGrow`）。**不得**自建独立 WS 探针绕过编辑器：所有观测都从编辑器传输层（`transport`）与真实端口/文件读取。

`icdev-driver`：`game.icdev`（`game.up / game.down / game.key / game.cmd / game.logWait / game.status / game.where / game.waitWorld / game.ensureWebUi`），只通过模组自带 `tools/devtools/devtools.py` 驱动，不另造游戏驱动。其中 `game.waitWorld` 必须**同时**满足"`list` 有窗口 `hwnd`"与"`where` 有 `world=` 且 `dim=` 非 None"，单看 `where` 会在客户端刚起时误报就绪；`game.ensureWebUi` 按 F6 后**真实 8765 端口是否监听**判断，未监听才重按（F6 是切换键，盲重按会把它关掉）。

`evidence`：`evidence`（`evidence.note / evidence.file / evidence.hash / evidence.attach`）。

## 六、CLI

```
node --experimental-strip-types e2e-system/src/cli.ts list
node --experimental-strip-types e2e-system/src/cli.ts dry-run --suite offline
node --experimental-strip-types e2e-system/src/cli.ts run --suite offline
node --experimental-strip-types e2e-system/src/cli.ts run --suite live --scenario live-play-min-tracks
node --experimental-strip-types e2e-system/src/cli.ts smoke
node --experimental-strip-types e2e-system/src/cli.ts smoke --exe release/win-unpacked/ImmersiveCinematicsEditor.exe
```

- `list`：打印套件、场景、模板、插件及其能力。
- `dry-run`：完整展开但不执行，打印每个场景展开后的步骤（含解析到哪个插件）；有任何配置/能力/参数问题即非零退出。
- `run`：执行并产出 `run.json` / `report.md`；退出码 `0` 全 PASS、`1` 有 FAIL、`2` 有 BLOCKED 且无 FAIL。
- `smoke`：只验证"应用能不能起来"，不跑业务场景。退出码 `0` 通过、`1` 失败、`2` 环境不满足。
- `review`：交互走查，启动隔离工作台后停住等人工操作；正常关窗口为 `0`。**不进 CI**。
- 退出码与 `run.json` 的 `status` 必须一致，不允许"报告 PASS 但退出码 0 却含 FAIL"。

### 6.1 三层职责（不要混）

| 层 | 谁做 | 说明 |
|---|---|---|
| 构建 / 打包 | `electron-builder` | e2e **不**负责打包，只消费产物 |
| 拉起 | `electron-host` 插件 | 唯一一份启动逻辑，三种模式共用 |
| 验证 | `smoke` / `run` | 断言可观测信号，给退出码 |

`smoke`、`run`、`review` 共用同一套启动代码，区别只在"启动后做什么"。

### 6.2 smoke 的判据

全部是可观测信号，不依赖窗口句柄、不依赖截图：

1. `.workspace-shell` 出现 —— Vue 挂载完成、页面真的渲染了
2. `pageerror` 为 0 —— 渲染进程没有抛异常
3. `console.error` 为 0 —— 没有静默错误
4. 主进程无 CDP 积压告警
5. 观察窗口（默认 3s）内进程未退出 —— 抓"启动后几秒崩溃"

**状态不是错误**：游戏未连接时客户端停在 `no-token`，这是正常状态。冒烟模式因此
写入空 token 文件，让客户端不发起连接——写假 token 会让 Chromium 把连接失败记成
`console.error`，把状态误报成故障。

### 6.3 两种启动目标

| 模式 | 命令 | 加载什么 |
|---|---|---|
| 未打包 | `smoke` | `dist/`（`loadFile`），**不**经过 Vite |
| 已打包 | `smoke --exe <path>` | asar 内的 `dist/`，走 `app.isPackaged === true` |

两者都要覆盖："能构建"和"打包后能运行"是两件事。

参考实现：

- `beekeeper-studio/apps/studio/e2e/tests/appLaunch.test.ts` —— smoke 是独立一档
- `electron-fiddle/packages/app/e2e/smoke.e2e.ts` —— 启动 + 每项能力各一条
- `vscode/test/smoke/src/areas/workbench/launch.test.ts` —— 最小启动断言
- `vscode/test/smoke` 的 `--build <path>` —— 同一套测试跑打包产物

## 七、报告

`run.json`：`{ runId, startedAt, finishedAt, suite, status, scenarios: [{ id, status, reason?, steps: [...], evidence: [...] }], cleanupErrors }`。

`report.md`：总表（场景 × 状态 × 耗时）、失败详情（期望/实际/步骤）、证据路径、环境（编辑器版本、模组版本、加载器、ffmpeg 有无）。

## 八、与编辑器优化的共享约定（两处并行实现必须一致）

预览/传输硬化改变了内部实现，但下列**对外行为必须保持不变**，E2E 与优化两边共同遵守：

- `transport.connected(): boolean`、`transport.playback(): {time, playing}`、`transport.stats()`、`transport.lastFrameAt()`、`transport.onFrame(cb): unsubscribe` 语义不变；
- `transport.onFrame` 回调收到的是**已解析**的帧（`{type,width,height,frameId,payload}`），订阅者不得再解析 `payload.buffer`；每帧只在传输层解析一次；
- `WebUiClientOptions.token` 允许返回 `string | Promise<string>`，每次连接/重连都重新取；
- 无 token 时不建立连接，状态原因在界面可见（状态栏文案含"token"字样）；
- 重连退避：base 1500ms、×2、上限 15000ms、连续失败 8 次后停止自动重连并在界面给出可读原因；
- 新增只读状态查询 `connection?(): { status: string; reason: string | null }`（可选方法，缺失时面板回落到 `connected()`）。

## 九、13 轮要跑的套件

| 套件 | 内容 | 需要 |
|---|---|---|
| `offline` | 假 WebUI 下的真编辑器：打开/校验/非法拒绝/断连状态/无 token 状态/预览帧消费/关闭幂等/13-03 可自动化子集 | 无游戏 |
| `corpus` | 12 正例 + 10 负例：真实 `parseDoc` + `validateStructure` 判定与拒绝对照 | 无游戏 |
| `live` | 真 Fabric 客户端 + F6 + 真实 8765：连接、四份脚本打开→校验→推送→播放→时间推进→帧回传→停止、关闭幂等、断连/重连 | 真游戏 |

### 9.1 语料与 E2E 的接口（两侧必须一致）

语料目录：`corpus/13/`。正例文件名固定（真游戏套件直接引用）：

| # | 文件 | 覆盖 |
|---|---|---|
| 1 | `min-tracks.json` | 最小 meta + 七轨 |
| 2 | `camera-lane-transition.json` | CAMERA lane、叠化、morph |
| 3 | `async-objects-keyframes.json` | 异步对象、关键帧、事件记录 |
| 4 | `paths-curves.json` | 路径端点、几何、曲线 |
| 5 | `overlay-subtitle-letterbox.json` | 覆盖层、字幕、画幅 |
| 6 | `audio-grade-media.json` | 音频、调色、LUT、媒体 |
| 7 | `triggers-rules-events.json` | 触发器、规则、事件 |
| 8 | `templates-flight-subtitle-workflow.json` | 模板、飞控、字幕工作流产物 |
| 9 | `full-showcase.json` | 全量展示 |
| 10 | `graph-refs/*.json` | 图引用脚本集（3–5 份 requires 关系） |
| 11 | `ui-stress.json` | UI 压力 |
| 12 | `recovery-errors.json` | 恢复与错误 |

正例装进游戏工作区时写到 `<workspace>/scripts/13/<文件名>`（`graph-refs` 写到 `scripts/13/graph-refs/`），只覆盖自己写的 `13/` 前缀文件，不删除任何用户脚本。

语料校验入口 `corpus/13/verify.ts --json` 输出（E2E `corpus` 套件通过 `corpus.verify` op 调用并断言）：

```json
{
  "ok": true,
  "positives": { "total": 12, "passed": 12, "files": 15 },
  "negatives": { "total": 10, "rejected": 10, "uncovered": 0, "passed": 10 },
  "fixtures": [
    { "id": "min-tracks", "kind": "positive", "path": "corpus/13/positive/min-tracks.json",
      "sha256": "…", "status": "pass", "checks": ["parseDoc", "validateStructure"] },
    { "id": "neg-missing-author", "kind": "negative", "path": "corpus/13/negative/neg-missing-author.json",
      "sha256": "…", "status": "pass", "rejectionLayer": "structural", "issueCodes": ["L04"] }
  ],
  "manifestHash": "…"
}
```

口径：`positives.total` 数是"组"（12 组），`files` 是实际文件数（`graph-refs` 一组多文件）；`negatives.rejected` 与 `passed` 是"按预期被某一层拒掉的份数"，`uncovered` 是"三层都没有拦住、属检查缺失"的份数，两者之和不得冒充通过——`uncovered > 0` 时 `ok` 仍可为 true（语料本身无误），但 E2E `corpus` 套件必须断言 `negatives.uncovered == 0`，否则该场景判 FAIL。


## 十、验收

- `list` / `dry-run` 在离线下可跑；`dry-run` 输出的步骤与模板/参数一一对应，没有硬编码场景。
- 新增一个场景只需改 JSON：`dry-run` 能展开、`run` 能执行。
- 缺能力（无游戏、无 token）时报 `BLOCKED` 与具体原因，退出码 2。
- `offline` 与 `live` 各有一份真实运行记录，`report.md` 与 `run.json` 状态一致。

## 十一、原生文件对话框在 E2E 中的处理方式

字幕导入通道 `files:pick-subtitle`（`electron/main.cjs` handler，`preload.cjs` `pickSubtitleFile()`）现状走 Electron 原生 `dialog.showOpenDialog`，Playwright 无法驱动系统级对话框；E2E 又必须在无人工点击下把夹具路径送进面板。

**方案（环境变量开启的路径覆盖，默认行为不变）**：

- 在 `files:pick-subtitle` 处理器内加一个仅由环境变量（拟用名 `IMC_E2E_SUBTITLE_PATH`，最终名以实现为准）开启的覆盖分支：变量存在且指向可读文件时，跳过 `showOpenDialog`，直接返回该路径；变量未设置或为空时，走现有原生对话框，行为与默认路径完全一致。
- 覆盖只作用于 `files:pick-subtitle` 这一个通道；不新增第二套文件 IPC，不给其它文件选择通道加桩，不改 `files:read-subtitle` 的读取与编码判定。
- 变量只在 E2E 启动子进程时注入，指向 `corpus/13/subtitles/` 下的真实落盘夹具；不进渲染层、不打进发布包。
- 若后续评审出更干净的命令式 IPC 测试替身，再替换该覆盖分支；替换前默认行为不得变化。

**现状**：该分支本轮尚未实现（第二阶段）；因此字幕抽屉导入、向导与 cue 表交互在本轮记 NOT RUN，纯函数层由 `verify:13-subtitles` 覆盖。
