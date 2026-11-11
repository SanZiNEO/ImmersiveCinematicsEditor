# 14-09 全功能迁移矩阵（WebUI → Forge + AUI）

> 状态：未实现（仅计划；14 是 13 通过后的迁移执行轮，不与 WebUI 同步开发）
> 轮次：14-aui-forge-migration
> 前置：`../13-webui-acceptance-release/README.md` 全部出口通过；14-08 垂直切片通过
> 关联：`README.md`、`14-02-aui-host-screen.md`、`14-03-inprocess-frame-source.md`、`14-04-inprocess-signal-endpoint.md`、`14-05-input-focus-routing.md`、`14-06-flight-mode-inprocess.md`、`14-07-teardown-carrier-consistency.md`、`14-08-forge-vertical-slice-acceptance.md`、`../shared/editor-package-modes.md`、`../shared/contracts.md`、`../shared/product-and-layout.md`

## 1. 职责

把 01–12 轮已在 WebUI 实现并验收的全部编辑能力，逐模块迁移到 Forge 1.20.1 + AUI 游戏内宿主。此文件不是“宿主壳清单”，而是**全功能迁移矩阵**：每个模块必须指明 WebUI 来源任务、AUI 承载/适配类、输入输出、正反例验收；14 轮出口以本矩阵全部行为完成，而不是以 `EditorAuiScreen` 能打开为准。

本任务不新增编辑语义、不改脚本字段、不改消息名、不重写运行时；若 01–12 的某项能力在 WebUI 未验收，14 不得在 AUI 里“顺手补做”，而应回原轮修复后重新进入 14。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| WebUI 能力基线 | `../13-webui-acceptance-release/01-GoldenScriptCorpus.md`、`02-RealGameWorkflowSmoke.md`、`03-ApplicationAndSubtitleParity.md` | 14 迁移的输入是已验收的 WebUI 能力，不是旧设计稿 |
| 七类内置轨道 | `MOD:docs/SCRIPT_FORMAT.md:145-149`；`J:script/track/TrackRegistry.java:227` | `CAMERA/LETTERBOX/AUDIO/EVENT/MOD_EVENT/OVERLAY/ADJUST`，由 schema 驱动，不写死 |
| 共享消息路由 | `J:webui/WebEditorApi.java:21-93` | 消息族来源；14 不新增第二套 |
| 脚本/资源/图服务 | `J:webui/ScriptFileService.java`、`ResourceFileService.java`、`WebRegistryService.java`、`ScriptGraphService.java` | 编辑器共享权威；迁移目标为 `editor.service.*`（提案） |
| 文档/撤销/校验 | 02 轮 `02-ScriptDocument`～`02-DocumentIO` | 迁移后仍由共享文档层执行，不由 AUI 复制 |
| schema 快照 | `J:webui/WebEditorApi.java` 的 `schema.get`；01 轮 `01-SchemaCapabilityIndex` | 字段能力以 schema 为准；未知字段保留 |
| AUI 页面 | `AUI:loader/Loader.java:28-56`、`AUI:screen/ApricityScreen.java:73-101` | classpath `assets/apricityui/apricity/` 或 `<gameDir>/apricity/`；当前只有 `devtools/toast.html` 证据 |
| AUI 元素/DOM | `AUI:init/Element.java`、`AUI:registry/annotation/ElementRegister.java` | 页面元素、事件绑定、自定义元素入口 |
| AUI 纹理 | `AUI:spi/AuiRenderService.java:152-207` | 动态纹理/注册/释放；14-03 消费 |
| AUI 输入 | `AUI:mixin/KeyboardHandlerMixin.java:14-20`、`MouseHandlerMixin.java:14-22`、`AUI:client/Client.java:124-180` | 14-05 消费 |
| AUI 脚本 | `forge/run/logs/latest.log:35` | 无 KubeJS/Rhino，页面脚本跳过；14 的交互必须 Java 侧绑定 |
| 现有编辑器骨架 | `INGAME:forge/src/main/java/com/immersivecinematics/editor/EditorMod.java:6-12` | 只有日志；本文件全部为迁移提案 |

**已核对的缺口**：

1. 没有 `editor/index.html` 工作台，也没有任何面板/控制器；当前 AUI 只渲染自带页面。
2. 没有把 01–12 的 WebUI 组件迁到 AUI 的承载层；AUI 不是浏览器，不能直接跑 Vue/现代 JS 运行时。
3. 没有 AUI 侧的主题/布局/停靠/偏好存储；05.20–23 在 WebUI 已验收，游戏内需要等价承载。
4. 没有 AUI 侧的字幕导入/批量面板；12.20–23 的外部文件输入需要受控路径，而不是浏览器 `<input type=file>`。
5. 没有 AUI 侧的大图/长时间轴性能证据；必须实测，不能假设。
6. 没有“全功能对账”清单；只做宿主壳会漏掉图、异步、七轨、规则、模板、字幕等能力。
7. 没有明确宿主不适用项；系统窗口与 LUT 桌面导出若不说明，会被误认为漏做或被误删。

## 3. 方案

### 3.1 分层与权威

```
AUI 页面（HTML/CSS/DOM，仅视图与本地视图状态）
        ↑↓ Java 侧元素事件/更新
Editor*Controller（独立编辑器模组，视图与创作意图）
        ↑↓
编辑器共享创作核心（文档/命令/撤销/序列化/模板/字幕批次）
        ↑↓ EditorSignalBridge（14-04）
主模组editor共享服务/API（schema/脚本文件/校验/图事务/播放/事实/画面）
```

- 单份创作状态在编辑器仓库核心，迁移保持相同业务语义；主模组不接管撤销、模板或字幕工程。AUI视图不复制第二份可写状态，正常校验/播放结果仍由主模组确认。
- **AUI 只做视图**：页面保存选择、滚动、面板尺寸、主题等视图状态；脚本内容通过消息请求/回执。
- **不新增消息名/字段**：所有请求沿用 03-05/03-06 与 01–12 已冻结的名称；本文件只描述迁移承载。
- **无页面 JS 依赖**：当前 AUI 无 KubeJS/Rhino，交互由 Java 侧 `Element.addEventListener`/DOM 更新完成；页面脚本只能作为可选增强，验收不依赖。

### 3.2 迁移状态图例

| 状态 | 含义 |
|---|---|
| 迁移 | 14 必须实现并在 AUI 可用；有正反例验收 |
| 宿主替换 | 语义保留，载体从浏览器 API 换成 AUI/游戏能力；需说明替换点 |
| 不适用 | 仅宿主能力不存在；必须在 4.13 说明，不得静默删除；本文件只有系统窗口、LUT 桌面导出两类 |

本矩阵中除 4.13 明确列出的项外，01–12 的必做能力一律为“迁移”或“宿主替换”，没有“可选/后续”。

### 3.3 执行顺序（14-09 内部）

1. 文档/schema/meta/screen_layers（01–02）→ 2. 图（04）→ 3. 工作台/时间轴/主题/布局（05）→ 4. 异步对象（06）→ 5. 位置/路径/曲线（07）→ 6. 镜头/转场（08）→ 7. 覆盖层/合成（09）→ 8. 音频/调色/媒体（10）→ 9. 触发/规则/事件（11）→ 10. 模板/字幕（12）→ 11. 跨模块与性能验收。
每步完成后运行该模块的正反例；不通过不进入下一步。共享合同（14-04）先冻结，避免各控制器自造请求。

### 3.4 页面与面板注册

- 单页editor/index.html按[C17](../shared/effect-controls-workspace.md)承载：顶栏、预览旁的片段效果控件clip.effects、中央真实预览、独立快捷属性selection.properties、下部片段主时间轴及按需抽屉。两面板可同时可见，不能退回旧窄栏/单属性页；主轴没有对象子行/节点/汇总帧带。
- 面板注册：编辑器模组内 `EditorPanelRegistry`（提案）登记 id、标题、默认停靠位、创建/销毁；05-08 的抽屉协议按 AUI 元素树重实现，不复制 WebUI 组件。
- 布局：05-21 的布局树映射为 AUI 元素尺寸/顺序/可见性；05-22 的拖动/停靠用 AUI 鼠标事件实现；不引入第二套布局格式。
- 主题：05-20 的 token 映射为 AUI CSS 变量/类；切换主题只改根元素 class/token，不重建文档。

### 3.5 适配类清单（提案）

| 适配类 | 归属 | 职责 | 对应来源 |
|---|---|---|---|
| `EditorAuiScreen` | 编辑器 `client` | Screen/页面/生命周期/互斥 | 14-02；05-01 |
| `EditorShellController` | 编辑器 `client` | 顶栏、面板注册、抽屉、图入口、状态栏 | 05-01/02/08/09 |
| `EditorDocumentController` | 编辑器 `client` | schema/meta/screen_layers/文档命令/撤销/保存/校验 | 01、02 |
| `EditorGraphController` | 编辑器 `client` | 图数据、文件夹、悬停、打开、移动/重命名、依赖 | 04 |
| `EditorWorkspaceController` | 编辑器 `client` | 主题、布局树、停靠、偏好、恢复 | 05.20–23 |
| EditorTimelineController | 编辑器client | 仅主时间轴七轨/片段/全局几何/标尺/播放头/标记及片段命令，无对象行或节点命中 | 05 |
| EditorEffectControlsController | 编辑器client | 统一片段上下文、多组/属性行、参数列与独立节点、局部viewport/行同步/虚拟化/轴外、事件/缓动组件 | 06-ClipEffectControlsPanel、06-EffectControlsRows及06其余任务 |
| EditorInspectorController | 编辑器client | selection.properties快捷属性内容/同值控件/目标解析与效果控件定位，不建第二节点轴或Selection | 06-PropertyValueForm，05双宿主 |
| `EditorPathController` | 编辑器 `client` | 位置/点源/朝向/路径/几何/时间/数学模型/曲线预览 | 07 |
| `EditorCameraController` | 编辑器 `client` | 镜头轨、转场、lane、连续性、玩家移动、取景 | 08、12-07 |
| `EditorCompositionController` | 编辑器 `client` | 覆盖层、淡入/遮罩、图像/字幕、视频、遮幅、顺序 | 09 |
| `EditorMediaController` | 编辑器 `client` | 音轨、监听/混音、外部音频、视频音轨、调色、LUT、资源抽屉 | 10 |
| `EditorBehaviorController` | 编辑器 `client` | 触发/条件/requires/事实/规则/绑定/动作/分支/事件/探针 | 11 |
| `EditorTemplateController` | 编辑器 `client` | 模板四层、快捷效果、几何/曲线工具、纯数据模板 | 12.01–12.12 |
| `EditorSubtitleController` | 编辑器 `client` | 字幕导入、批量、编译、面板与 sidecar | 12.20–23 |
| `EditorFrameBinding` | 编辑器 `client` | 帧源订阅/租约/generation/占位 | 14-03 |
| `EditorSignalBridge` | 编辑器 `client` | attach/detach、请求/回执/超时、推送分发 | 14-04 |
| `EditorInputRouter` | 编辑器 `client` | 键鼠/焦点/飞控转发/关闭恢复 | 14-05 |
| `EditorFlightBridge` | 编辑器 `client` | 飞控进入/退出/HUD/写回 | 14-06 |
| `EditorTeardown` | 编辑器 `client` | 唯一释放入口、幂等、载体一致性 | 14-07 |

所有类均为**提案**；实现时若已有等价类，合并而不是新增平行层。控制器不得直接读文件、直接改 JSON、直接访问主模组私有类。

## 4. 技术细节：逐模块迁移矩阵

### 4.1 01 baseline-schema（schema、动态表单、meta、屏幕层）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| schema 能力快照、未知能力状态 | `01-SchemaCapabilityIndex`、`01-OfflineSchemaFixtures` | `EditorDocumentController` 读取 `schema.get` 快照；未知字段显示“不可用/未知” | 输入：`schema.data`；输出：字段描述表、能力状态 | 正：已知字段可编辑、未知字段保留且禁用；反：用旧默认值写入未知字段 |
| 动态表单/字段渲染 | `01-DynamicFormAndFieldRenderer` | AUI DOM 表单构建器；按 `type/requires/appliesTo` 生成元素 | 输入：字段路径/类型/约束；输出：控件与校验状态 | 正：9 类字段正确渲染；反：类型错配/静默丢弃 |
| 标量字段控件 | `01-ScalarFieldControls` | 数值/布尔/枚举/字符串控件；焦点/步进/非法输入 | 输入：当前值；输出：提交命令或本地错误 | 正：范围/NaN/空值有明确提示；反：非法值写入文档 |
| meta 面板 | `01-ScriptMetaPanel` | `EditorDocumentController` 的 meta 区；分组折叠 | 输入：`meta`；输出：文档命令 | 正：全部 meta 组可编辑；反：写 `meta.version`/旧字段 |
| `screen_layers` 策略 | `01-ScreenLayerPolicyPanel` | 屏幕层策略面板；运行时事实只读展示 | 输入：`screen_layers`；输出：策略命令 | 正：HUD/层策略保存并在预览生效；反：编辑器伪造运行时层 |
| 离线 fixture | `01-OfflineSchemaFixtures` | 不直接做 UI；作为 14-08/09 的表单/负例数据 | 输入：fixture；输出：验收记录 | 正：fixture 全部可加载；反：用 fixture 冒充真实 schema |

### 4.2 02 model-contracts（文档、身份、撤销、序列化、校验、IO）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| 顶层文档/时间轴/轨道/片段不变量 | `02-ScriptDocument` | 共享文档层；`EditorDocumentController` 只发命令 | 输入：文档命令；输出：规范文档/错误 | 正：七轨与片段不变量通过；反：片段级 `keyframes` 写回 |
| 异步对象三形态/值编解码 | `02-AnimObject` | `EditorInspectorController`/`EditorTimelineController` 共用 | 输入：属性路径、值；输出：对象命令 | 正：VALUE/ANIMATED/EVENT 往返无损；反：未知扩展被删 |
| 属性路径/轨道注册 | `02-PropertyPathRegistry` | schema 驱动属性树；不硬编码七轨 | 输入：schema tracks/paths；输出：分组/可用性 | 正：第三方轨道按 schema 显示；反：写死轨道列表 |
| schema 快照消费/漂移 | `02-SchemaSnapshot` | `EditorDocumentController` 启动时比对 `schemaHash` | 输入：`hello_ack.schemaHash`；输出：漂移提示/阻断 | 正：漂移时拒绝旧字段写入；反：静默按旧 schema 保存 |
| 文档 store/命令/撤销/派生 | `02-EditorStore` | 共享 store；AUI 只读派生视图 | 输入：命令；输出：状态/撤销结果 | 正：多字段失败全回滚；反：部分写入 |
| 片段身份/选择重映射 | `02-SelectionIdentity` | `EditorTimelineController` 持选择 id，不持下标 | 输入：`clipKey`/对象路径；输出：选择状态 | 正：移动/重命名后选择保持；反：用下标猜邻居 |
| 无损序列化/剥离集合 | `02-SerializationLossless` | 共享序列化；AUI 不拼 JSON | 输入：文档；输出：标准 JSON | 正：未知扩展/顺序无关字段保留；反：键序/空白比较当语义 |
| 本地结构检查 + 服务端校验 | `02-ValidationBridge` | 诊断抽屉；错误定位到字段/对象/时间 | 输入：文档/路径；输出：诊断列表 | 正：错误可定位并跳转；反：只显示“失败”无位置 |
| 打开/新建/保存/推送/并发 | `02-DocumentIO` | `EditorDocumentController` + 共享 IO；保存失败明确 | 输入：路径/文档；输出：保存结果/错误 | 正：保存失败不半写；反：并发保存覆盖 |
| 旧调用方/旧字段清理 | `02-LegacyConsumerCutover` | 迁移后不保留旧字段/旧入口 | 输入：旧脚本；输出：明确错误/迁移提示 | 正：旧 `version/total_duration/keyframes` 被拒绝；反：静默转换 |

### 4.3 03 host-transport（共享服务、消息、宿主合同）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| 消息族/信封/节流/错误 | `03-05-message-router` | `EditorSignalBridge`；无 WebSocket | 输入/输出：与 WebUI 同 `{type,data,id}` | 正：消息名/字段一致；反：新增第二套名/信封 |
| 脚本/资源/注册表/图/schema | `03-06-script-resource-registry` | 共享 `editor.service.*`；AUI 面板只调用 | 输入：请求；输出：脚本/资源/注册表/图 | 正：脚本 CRUD、资源 kind、图数据一致；反：AUI 直接读文件 |
| 端点/推送/挂载 | `03-08-editor-host-contract` §3.1–3.3 | 14-04 的 `InProcessEditorEndpoint`/`EditorSignalBridge` | 输入：JSON；输出：回执/推送 | 正：attach/detach、关键回执可靠；反：静默丢 `save/validate/flight.exit` |
| 公共API/GPU/飞控/开关 | 03-08设计与[14-00](14-00-public-api-prerequisite.md)实际落实 | 14-03/04/06适配 | 输入公共端口，输出真实帧/状态 | 人工正常/关闭/异常使用，无私有字段或空实现 |
| 包/模式/总开关/按需生命周期 | `03-10-editor-package-lifecycle` | `EditorManager` + `EditorHostApi.isEnabled()/modes()` | 输入：开关/模式；输出：可用能力/资源 | 正：关闭不注册/不订阅；反：用 `WebEditorServer.isRunning()` 代表总开关 |
| WebUI 传输/编码器 | `03-01`～`03-04`、`03-07` | **不迁移到 ingame**；只在 WebUI 模式保留 | 输入/输出：RGBA/H.264/WebSocket | 正：WebUI 回归通过；反：把 H.264/WebSocket 塞进进程内 |

### 4.4 04 project-graph（项目关系图）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| 脚本索引/文件夹树 | `04-01-script-index` | `EditorGraphController`；AUI 树/列表 | 输入：`script.list`/`script.graph`；输出：树节点 | 正：文件夹/脚本排序与 WebUI 一致；反：只列平铺文件 |
| 图数据合同 | `04-02-graph-data-contract` | 共享 `ScriptGraphService`；AUI 只绘图 | 输入：`nodes/edges`；输出：节点卡片/边 | 正：悬停摘要/依赖边正确；反：前端自算依赖真值 |
| 图视图壳 | `04-03-graph-view-shell` | AUI 画布/容器；缩放/平移 | 输入：图数据；输出：视图变换 | 正：大图可缩放/平移；反：O(n²) 卡死 |
| 文件夹分区 | `04-04-folder-partitions` | 树/分区视图 | 输入：路径；输出：分区节点 | 正：跨文件夹移动后更新；反：只改 UI 不改文件 |
| 布局引擎/持久化 | `04-05-layout-engine-and-persistence` | `EditorGraphController` 本地布局存储 | 输入：节点位置；输出：布局文件/恢复 | 正：重开恢复；反：把布局写进脚本 |
| 节点卡片/悬停/打开 | `04-06-node-card-hover-open` | AUI 卡片元素/悬停浮层/双击打开 | 输入：节点；输出：摘要/打开文档 | 正：悬停摘要、打开进入工作区；反：打开只改选中不动文档 |
| 依赖边语义 | `04-07-dependency-edge-semantics` | 共享图服务；边只读/受控编辑 | 输入：`requires`/trigger；输出：边/诊断 | 正：依赖变化后边更新；反：任意自由连线写脚本 |
| 移动/重命名事务 | `04-08-move-rename-transaction` | 共享事务；AUI 只发请求 | 输入：旧/新路径；输出：结果/冲突 | 正：文件/引用/选择一致；反：只改显示路径 |
| 旧脚本列表退役 | `04-09-remove-legacy-script-list` | AUI 不实现旧左栏；图是唯一入口 | 输入：入口；输出：图页 | 正：无旧常驻列表；反：恢复旧栏做第二入口 |
| 刷新/规模/诊断 | `04-10-refresh-scale-diagnostics` | 增量刷新/诊断面板 | 输入：变更；输出：刷新/错误 | 正：1000 节点可用；反：全量重建卡死 |
| 图内依赖维护 | 04.11 | 复用受控标准requires事务 | 指定触发器/条目/目标→结果 | 人工检查真实允许/拒绝与冲突恢复，不一概宣称所有环均非法 |

### 4.5 05 timeline-workspace（工作台、时间轴、主题、布局、偏好）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| 定制工作台/双面板宿主/旧栏退役 | 05-01-WorkspaceShell | EditorShellController + EditorWorkspaceController | 注册clip.effects/selection.properties及其他模块，输出可停靠布局 | 两面板可同时可见、无旧左栏；反：窄栏二选一/单属性独占页 |
| 文档顶栏/脏标记/保存/校验 | `05-02-DocumentHeader` | `EditorShellController`/`EditorDocumentController` | 输入：文档状态；输出：保存/校验命令 | 正：脏标记/未保存切换提示；反：静默丢修改 |
| 时间几何/范围/吸附/选区 | `05-03-TimelineModel` | `EditorTimelineController` 共享几何 | 输入：时间/缩放；输出：视图几何 | 正：吸附/范围正确；反：与 WebUI 时间口径不同 |
| 主时间轴渲染/指针/轨道头 | 05-04-TimelineView | EditorTimelineController/AUI轨道片段元素 | 轨道/片段→编排显示/意图，不消费属性节点 | 七轨+扩展轨正常，100+属性不撑高；反：主轴对象行/节点/汇总点 |
| 片段移动/裁切/分割/复制/循环/波纹 | `05-05-ClipEditing` | 共享片段命令；AUI 拖拽/刀片 | 输入：片段/时间；输出：命令 | 正：循环/波纹正确；反：只改视图不改文档 |
| 标尺/播放头/标记/A-B/缩放 | `05-06-RulerPlayheadMarkers` | AUI 标尺元素；播放头与 `playback.state` 同步 | 输入：播放头；输出：视图/seek | 正：拖动 seek 画面同步；反：只动 UI 不动播放 |
| 效果控件/快捷属性双宿主与上下文 | 05-07-InspectorHost | 独立clip.effects/selection.properties宿主；读同一02选择 | 单片段/多选/失效→上下文与内容槽 | 多组效果控件与快捷属性同时可用；反：选叶子只剩一属性/两套选择 |
| 抽屉容器/面板注册 | `05-08-PanelDrawer` | `EditorPanelRegistry`；AUI 抽屉 | 输入：面板 id；输出：打开/关闭/停靠 | 正：面板可开合/停靠；反：面板互相覆盖/内存泄漏 |
| 关系图入口 | `05-09-GraphEntry` | `EditorShellController` 图入口 | 输入：点击；输出：图页 | 正：图是入口且可回文档；反：入口只显示空页 |
| 快捷键/焦点/键盘可达 | `05-10-KeyboardFocus` | `EditorInputRouter` + AUI 焦点 | 输入：键；输出：命令/焦点 | 正：无双重触发/文本可输入；反：WASD 驱动玩家 |
| 深/浅/跟随系统主题 | `20-ThemeService` | `EditorWorkspaceController`；AUI CSS token | 输入：主题；输出：根 class/token | 正：切换即时/持久化；反：重建文档/硬编码颜色 |
| 布局树/移动/缩放/停靠/预设/恢复 | `21-WorkspaceLayoutService` | AUI 元素树；本地布局存储 | 输入：布局操作；输出：布局文件/恢复 | 正：重启恢复/恢复默认；反：布局写入脚本 |
| 拖动换位/停靠/标签重排/分隔缩放 | `22-DockLayoutController` | AUI 鼠标事件；命中/预览 | 输入：拖动；输出：新布局 | 正：拖动/缩放稳定；反：与 AUI 输入冲突 |
| 偏好/应用命令/窗口状态/草稿恢复 | `23-PreferencesAndWindowState` | 本地偏好存储；窗口状态映射见 4.13 | 输入：偏好；输出：配置/恢复 | 正：偏好与草稿恢复；反：把窗口状态写进脚本/依赖 Electron |

### 4.6 06 async-objects（异步对象、属性关键帧、事件、诊断）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| 对象/功能组目录与左参数列 | 06-ObjectPropertyList | EditorEffectControlsController，schema驱动且复用值控件 | 整片段/schema/统一行布局→完整组/参数行 | 多组同时展开、行内值可编辑；反：只读入口后跳单属性页 |
| 统一片段效果控件容器 | 06-ClipEffectControlsPanel | EditorEffectControlsController，独立面板上下文 | 一个clipKey/共享Selection→全部适用组、共同局部标尺/原命令 | x/yaw不同时间可对照，选x不隐藏yaw；反：合并时间或独占属性页 |
| 关键帧命令/多选/复制粘贴/吸附 | `06-KeyframeEditOps` | 共享命令；AUI 选择/剪贴板 | 输入：关键帧集合；输出：命令/撤销 | 正：多选/粘贴/吸附；反：复制丢失路径 |
| 九类型值控件/目标解析/快捷属性 | 06-PropertyValueForm | EditorInspectorController与效果参数行复用同一控件/命令 | schema+value/node/add目标→提交/错误/回显 | 同值同步、一次撤销、草稿不串写；反：第二节点轴/仅改无效value |
| step/nullable_float/枚举/引用/struct 原文 | `06-StepNullableAndEnum` | AUI 控件 + 原文编辑 | 输入：类型/约束；输出：值 | 正：step/nullable/enum/struct 正确；反：null 被写成 0 |
| 缓动元数据/按属性段烘焙/禁止清单 | 06-EasingAuthoringBake | EditorEffectControlsController中对应属性段详情；共享烘焙 | 明确属性段→作者元数据/显式命令 | 支持段可烘焙、禁止项拒绝；反：主轴曲线/全轨烘焙/保存暗烘焙 |
| EVENT/MOD_EVENT 记录编辑 | `06-EventRecordEditor` | AUI 事件表单；共享对象 | 输入：事件记录；输出：命令 | 正：字段/时间/类型正确；反：丢未知键 |
| 效果控件行/局部视口/节点命中/轴外 | 06-EffectControlsRows | EditorEffectControlsController/AUI行与标尺 | 统一左右行布局、局部窗口→节点显示/选择/拖动意图 | 滚动缩放对齐，轴外可达且不拉长主轴片段；反：只点选不拖动/主轴子行 |
| 异步诊断与reveal | 06-ObjectDiagnostics | 诊断抽屉+EditorEffectControlsController；同一校验 | 标准位置→片段组/叶子/节点定位 | 被折叠/过滤/轴外目标仍可达；反：只报无效或展开主轴对象行 |

### 4.7 07 position-path-curves（位置、点源、朝向、路径、数学）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| 位置模式/空间/原点/冻结/三轴/切换对齐 | `07-PositionEditor` | `EditorPathController`；AUI 轴控件 | 输入：位置字段；输出：命令 | 正：切换模式保留可迁移字段；反：静默丢轴 |
| 点源五形态/EntityPoint 百分比/偏移空间 | `07-PointSourceForms` | AUI 表单；schema 驱动 | 输入：点源；输出：命令 | 正：五形态/百分比/偏移正确；反：实体真值由编辑器计算 |
| 朝向三轴/锁/基准/注视/模式/偏移/优先级 | `07-OrientationEditor` | AUI 朝向表单 | 输入：朝向；输出：命令 | 正：look_at/切线/优先级正确；反：覆盖运行时求值 |
| 脚本级 `paths[]` 列表/端点绑定 | `07-PathCollectionEditor` | AUI 路径列表；共享引用校验 | 输入：paths；输出：添加/删除/绑定 | 正：悬空引用报错；反：删除仍被引用路径不报 |
| 11 种几何参数/能力标记 | `07-PathGeometryForms` | AUI 几何表单；schema 能力 | 输入：几何类型/参数；输出：命令 | 正：11 种可选/参数校验；反：硬编码子集 |
| `timing` 两形态 | `07-PathTimingEditor` | AUI 时间表单 | 输入：timing；输出：命令 | 正：两形态往返；反：把时间写死 |
| 11 种数学模型/chain/blend | `07-MathModelEditor` | AUI 模型表单/组合 | 输入：模型/链；输出：命令 | 正：11 种+组合可编辑；反：只支持线性 |
| 几何/采样/切线预览/2 轴限制 | `07-CurvePathPreview` | AUI 画布/覆盖层；采样来自共享/运行时只读 | 输入：路径/模型；输出：预览 | 正：预览与采样口径一致；反：另写一套求值当真值 |

### 4.8 08 camera-transitions（镜头、lane、转场、连续性、玩家移动、取景）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| CAMERA 轨表面/片段/镜头字段 | `08-01-CameraTrackSurface` | `EditorCameraController` + `EditorTimelineController` | 输入：CAMERA 片段；输出：命令 | 正：镜头字段/片段操作正确；反：与对象时间混成整帧 |
| 转场编辑器/模式/参数/中断 | `08-02-CameraTransitionEditor` | AUI 转场表单/时间轴 | 输入：转场；输出：命令 | 正：模式/参数/中断往返；反：丢弃未知转场 |
| lane 合成面板 | `08-03-LaneCompositionPanel` | AUI lane 列表/权重 | 输入：lanes；输出：命令 | 正：顺序/权重/叠加正确；反：只改 UI 不写脚本 |
| 相机连续性面板 | `08-04-CameraContinuityPanel` | AUI 连续性诊断；共享求值只读 | 输入：相邻片段；输出：诊断/跳转 | 正：不连续可定位；反：编辑器伪造运行时结果 |
| 玩家移动面板 | `08-05-PlayerMovementPanel` | AUI 表单；运行时事实只读 | 输入：玩家移动字段；输出：命令 | 正：字段/模式正确；反：复制玩家运动算法 |
| 取景直控 | `08-06-FramingDirectControl`、`12-07-FlightFraming` | `EditorFlightBridge` + `EditorFrameBinding` | 输入：飞控姿态；输出：写回/取景参数 | 正：取景采样/写回与 12-07 一致；反：第二套采样公式 |

### 4.9 09 overlays-composition（覆盖层、图像/字幕/视频、遮幅、顺序）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| OVERLAY 轨表面/片段 | `09-01-OverlayTrackSurface` | `EditorCompositionController` + 时间轴 | 输入：OVERLAY 片段；输出：命令 | 正：叠加/片段操作正确；反：与 CAMERA 混轨 |
| 淡入淡出/遮罩 | `09-02-OverlayFadeAndMask` | AUI 表单/预览叠加 | 输入：fade/mask；输出：命令 | 正：参数/时间正确；反：丢弃遮罩类型 |
| 图像/字幕覆盖层 | `09-03-OverlayImageAndSubtitle` | AUI 资源选择/字幕引用 | 输入：图像/字幕路径；输出：命令 | 正：资源存在性/引用校验；反：任意文件读取 |
| 视频覆盖层 | `09-04-VideoOverlay` | AUI 视频字段/时间；运行时播放只读 | 输入：视频引用/参数；输出：命令 | 正：视频参数/时间轴正确；反：编辑器自带视频解码器 |
| 遮幅面板 | `09-05-LetterboxPanel` | AUI 遮幅表单/预览 | 输入：宽高比/边距；输出：命令 | 正：遮幅在预览生效；反：只改 CSS 不改脚本 |
| 合成顺序面板 | `09-06-CompositionOrderPanel` | AUI 顺序列表/拖动 | 输入：层顺序；输出：命令 | 正：顺序影响预览；反：顺序只存视图 |

### 4.10 10 audio-color-media（音频、监听、调色、LUT、媒体抽屉）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| AUDIO 轨/片段/音量/淡入淡出 | `10-01-AudioTrackPanel` | `EditorMediaController` + 时间轴 | 输入：音频片段；输出：命令 | 正：音频字段/片段正确；反：播放器重采样当真值 |
| 监听/混音 | `10-02-AudioListenerAndMix` | AUI 表单；运行时只读状态 | 输入：listener/mix；输出：命令 | 正：字段/预览状态正确；反：复制混音算法 |
| 外部音频解码 | `10-03-ExternalAudioDecode` | 宿主替换：AUI 无 WebAudio；走主模组受控音频能力或明确阻塞 | 输入：音频文件；输出：波形/时长/诊断 | 正：真实文件可读/错误明确；反：假波形/静默不支持 |
| 视频音轨 | `10-04-VideoAudioTrack` | AUI 状态/字段；运行时只读 | 输入：视频音轨信息；输出：展示/命令 | 正：状态与运行时一致；反：新增第二套音轨字段 |
| ADJUST/调色面板 | `10-05-AdjustColorPanel` | `EditorMediaController`；AUI 调色表单 | 输入：ADJUST 字段；输出：命令 | 正：七轨含 ADJUST；反：仍只显示 6 轨 |
| LUT 工作台 | `10-06-LutWorkbench`、`12-11-LutToolBoundary` | AUI LUT 选择/应用/预览；桌面导出不适用（4.13） | 输入：LUT/参数；输出：命令/预览 | 正：选择/应用/校验；反：承诺桌面导出或删除 LUT 能力 |
| 媒体资源抽屉 | `10-07-MediaResourceDrawer` | AUI 抽屉；`resource.list` | 输入：kind/目录；输出：资源列表/插入 | 正：图像/音频/视频/lang 分类；反：直接扫描任意磁盘 |

### 4.11 11 triggers-rules-events（触发、事实、规则、事件、分支、探针）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| 触发身份 | `11-01-trigger-identity` | `EditorBehaviorController`；稳定 id | 输入：触发；输出：命令 | 正：复制/移动保持身份；反：用下标 |
| 触发公共字段 | `11-02-trigger-common-fields` | AUI 表单 | 输入：公共字段；输出：命令 | 正：字段/默认值正确；反：旧字段 |
| 触发类型目录 | `11-03-trigger-type-catalog` | schema/注册表驱动下拉 | 输入：类型；输出：表单 | 正：全部类型可选；反：硬编码子集 |
| 条件编辑器 | `11-04-trigger-condition-editors` | AUI 条件表单 | 输入：条件；输出：命令 | 正：类型/操作数/错误；反：自由文本当条件 |
| requires 编辑器 | `11-05-trigger-requires-editor` | AUI 引用选择/校验 | 输入：requires；输出：命令 | 正：悬空引用报错；反：静默忽略 |
| 组合器 | `11-06-combinators` | AUI 嵌套条件树 | 输入：AND/OR/NOT；输出：树 | 正：嵌套/优先级正确；反：拍平丢失结构 |
| 连续性与事实 | `11-07-continuity-and-facts` | 事实只读面板；共享事实查询 | 输入：事实键；输出：值/诊断 | 正：事实来源/时效可见；反：编辑器缓存当真值 |
| 触发校验诊断 | `11-08-trigger-validation-diagnostics` | 诊断抽屉；跳转 | 输入：触发；输出：错误/位置 | 正：定位到字段；反：只报整体失败 |
| 规则定义 | `11-09-rules-definition-editor` | AUI 规则表单/列表 | 输入：规则；输出：命令 | 正：规则字段/顺序正确；反：丢未知动作 |
| 规则绑定 | `11-10-rule-bindings-editor` | AUI 绑定/引用 | 输入：bindings；输出：命令 | 正：绑定/解绑/校验；反：悬空绑定 |
| 规则动作/调度/释放 | `11-11-rule-actions-and-release` | AUI 动作表单；运行时状态只读 | 输入：动作/释放；输出：命令 | 正：动作/调度/释放正确；反：复制运行时 ledger |
| 条件树 | `11-12-rules-condition-tree` | AUI 树编辑器 | 输入：条件树；输出：命令 | 正：嵌套/求值顺序正确；反：递归无限/丢节点 |
| 循环/退出/分支归因 | `11-13-loop-exit-branch-attribution` | AUI 诊断/归因面板 | 输入：执行记录；输出：归因/跳转 | 正：循环/退出/分支可解释；反：伪造运行时归因 |
| 事件归因 | `11-14-event-attribution` | AUI 事件面板；运行时只读 | 输入：EVENT/MOD_EVENT；输出：展示/编辑 | 正：事件来源/对象正确；反：把运行时事件当脚本字段 |
| 验证与探针 | `11-15-verification-and-probes` | AUI 探针面板/日志 | 输入：探针；输出：结果/证据 | 正：探针真实执行；反：UI 假成功 |
| 事实查询面板 | `11-16-fact-query-panel` | AUI 查询表单/结果 | 输入：事实键/查询；输出：值/来源 | 正：查询走共享事实源；反：本地假数据 |

### 4.12 12 templates-flight-tools + 字幕批次（模板、纯数据、工具、字幕）

| 能力 | WebUI 来源任务 | AUI 承载/适配类 | 输入/输出 | 验收（正例/反例） |
|---|---|---|---|---|
| 模板引擎/参数/展开/错误 | `12-01-TemplateEngine` | `EditorTemplateController`；共享展开器 | 输入：模板/参数；输出：标准片段/错误 | 正：参数/错误模型正确；反：AUI 自写第二套展开 |
| 三层嵌套/传参/命名空间/环检测 | `12-02-TemplateNesting` | AUI 模板选择/嵌套 | 输入：嵌套模板；输出：展开结果 | 正：环检测/命名空间；反：无限递归 |
| 片段模板（fade/static_breath/dolly/orbit_arc） | `12-03-ClipTemplates` | AUI 模板抽屉/插入位置 | 输入：模板/目标；输出：片段 | 正：四种规格正确；反：硬编码默认 |
| 轨道模板（环绕/双机位） | `12-04-TrackTemplates` | AUI 模板抽屉 | 输入：模板/轨道；输出：轨道 | 正：整圈/切机位正确；反：破坏既有轨道 |
| 脚本模板（meta/触发器/默认转场） | `12-05-ScriptTemplates` | AUI 新建脚本 | 输入：模板；输出：脚本 | 正：七轨空轨/无旧字段；反：写 `version/total_duration` |
| 模板抽屉 UI/预览/来源 | `12-06-TemplatePanel` | AUI 抽屉 | 输入：模板；输出：预览/插入 | 正：来源/参数/插入可见；反：只列名字无参数 |
| 飞控取景采样/写回 | `12-07-FlightFraming` | `EditorFlightBridge` + `EditorFrameBinding` | 输入：姿态/片段；输出：写回 | 正：采样/写回一致；反：第二套公式 |
| 区域/像素/k/Gizmo | `12-08-GeometryTools` | AUI 辅助层/数值 | 输入：几何；输出：参数/命令 | 正：区域/像素换算正确；反：编辑器自算世界真值 |
| 曲线形状/拾取/重采样 | `12-09-CurveTools` | AUI 曲线画布 | 输入：曲线；输出：命令/预览 | 正：拾取/重采样正确；反：改动运行时采样 |
| 快捷效果入口/默认参数 | `12-10-QuickEffects` | AUI 快捷按钮/表单 | 输入：效果；输出：命令 | 正：默认参数/可撤销；反：不可撤销批量写入 |
| LUT 工具边界 | `12-11-LutToolBoundary` | 同 10-06；桌面导出不适用（4.13） | 输入：LUT；输出：命令/说明 | 正：边界说明可见；反：删掉 LUT 或假装导出 |
| 纯数据资产/Loader/Validator/Expander/表达式/作用域/引用 | `12-12-DataTemplates` | `EditorTemplateController`；共享纯数据层 | 输入：数据模板；输出：展开/诊断 | 正：纯数据引用/重映射/错误；反：把数据模板当脚本/执行任意表达式 |
| 外部字幕导入/编码/格式/逐 cue 诊断 | `20-SubtitleImportService` | `EditorSubtitleController`；受控文件输入 | 输入：SRT/VTT 路径；输出：cue/诊断 | 正：真实文件/编码/错误；反：浏览器 file input/任意路径 |
| 字幕批量编辑/来源映射/重导入/手改冲突 | `21-SubtitleBatchSession` | AUI 批量表格/sidecar | 输入：cue 批次；输出：编辑/冲突 | 正：批量时间/文本/样式/重导入；反：静默覆盖手改 |
| 字幕 schema 编译/ID 重映射/重叠分轨/一次提交 | `22-SubtitleScriptCompiler` | 共享编译器；AUI 只触发 | 输入：批次；输出：标准 OVERLAY/subtitle | 正：重叠分轨/失败无半写；反：AUI 自拼脚本 |
| 字幕导入向导/批量面板/完整流程 | `23-SubtitleBatchPanel` | AUI 抽屉/向导；05 停靠/主题 | 输入：文件/批次；输出：导入→管理→差异→播放→重开 | 正：完整流程；反：只有导入按钮无批次 |

### 4.13 宿主不适用项（只说明，不删除其他能力）

| 项 | WebUI 现状 | AUI 处理 | 保留/不删除 |
|---|---|---|---|
| 系统窗口/OS 窗口状态 | `23-PreferencesAndWindowState` 可保存 Electron 窗口位置/大小/最大化；05-21/22 布局依赖窗口容器 | AUI 是游戏内 `Screen`，没有 OS 窗口句柄。映射为：屏幕分辨率/`viewport`/`zoom`、布局预设、面板尺寸/停靠；不提供最小化/最大化/多窗口。保存的是布局/缩放/预设，不是 OS 窗口状态 | 保留 05-21/22 的布局、停靠、缩放、恢复；05-23 的偏好/草稿恢复保留；只去掉 OS 窗口专属字段与按钮，并在设置页说明 |
| LUT 桌面导出 | `10-06-LutWorkbench`/`12-11-LutToolBoundary` 在 WebUI 可导出桌面文件（OS 保存对话框） | 游戏内保留 LUT 选择/应用/校验/预览；不提供桌面导出/另存为。若需要把 LUT 放进游戏资源目录，走受控资源写入（03-06/12-11），不弹出 OS 对话框；无该能力时明确提示“仅 WebUI 提供桌面导出”，不假装成功 | 保留 LUT 编辑/应用/预览/校验；不删 10-06/12-11 的其他能力 |

**其他边界**：

- 外部字幕/LUT 的“选择文件”不依赖浏览器 `<input type=file>`；使用受控路径输入/资源列表/导入服务（12-20、03-06）。这是宿主替换，不是删除导入能力。
- 不把 WebUI 的 Electron 菜单、托盘、自动更新、开发者工具当作编辑器功能迁移；它们不属于 01–12 的编辑能力。
- 不因 AUI 不支持某项 CSS/JS 就删除面板；改用 AUI 支持的布局/Java 绑定实现，必要时在 14-09 记录限制与替代。

### 4.14 全量对账与跨模块验收

1. **任务覆盖对账**：01–12 的每个必做任务在 4.1–4.12 至少出现一次；状态除 4.13 两项外均为“迁移/宿主替换”。缺一项即 14 未完成。
2. **黄金脚本**：用 `../13-webui-acceptance-release/01-GoldenScriptCorpus.md` 的黄金脚本语料，在 ingame 打开→编辑→撤销→保存→重载；与 WebUI 产物做语义比较（不比较键序/空白），字段/对象/时间/引用必须一致。
3. **跨模块场景**：图 → 打开脚本 → 改 meta/screen_layers → 七轨片段 → 异步对象/关键帧 → 位置/路径/数学 → 镜头/转场/lane → 覆盖层/遮幅 → 音频/ADJUST → 触发/规则/事件 → 模板/数据模板 → 字幕导入/批量/编译 → 校验 → 保存 → 播放 → 关闭/重开。
4. **错误路径**：未知 schema 字段、非法枚举/模式、悬空引用、重复时间、路径非相邻、非法规则/动作、字幕编码错误、保存失败、请求超时；每项断言具体错误与不半写。
5. **性能**：1000 节点图、长脚本（多轨多对象）、长时间轴滚动、面板拖动/缩放；记录帧率/卡顿；不达标回 14-02/14-05/14-09 优化，不用“能打开”放过。
6. **载体一致性**：与 WebUI 同时打开，分别编辑/保存/关闭；不互相覆盖、不互相取消飞控、不互相停服务；脚本语义一致。
7. **无壳检查**：每个面板有真实数据/空状态原因/错误状态；没有 TODO、占位按钮、“后续实现”、假 mock；菜单项都能到达对应能力。

## 5. 为什么不选别的

| 备选 | 问题 | 本方案 |
|---|---|---|
| 只做宿主壳，功能后续补 | 用户明确要全功能迁移；壳无法验收图/异步/七轨/规则/模板/字幕 | 14-09 逐模块矩阵 + 全量对账 |
| 把 Vue/WebUI 塞进 AUI iframe/WebView2 | 跨进程像素/生命周期复杂；违背进程内画面；WebView2 仅 Windows | AUI 原生 HTML/CSS + Java 控制器 |
| 为 AUI 另写一套模型/消息 | 两套字段/撤销/校验会漂移 | 共享 02/03 服务与消息；AUI 只做视图 |
| 把系统窗口/LUT 桌面导出也硬搬 | AUI 无 OS 窗口/桌面文件对话框；假实现会骗验收 | 4.13 明确边界，保留其余能力 |
| 等游戏内 Fabric AUI 一起做 | 扩大故障范围；用户明确暂缓 | 先 Forge；Fabric AUI 不纳入 14，WebUI→Fabric 仍回归 |

**代价**：AUI 的 CSS/输入/性能需要逐项实测；控制器层会增加翻译代码；但避免第二套模型与“壳验收”。

## 6. 实现结果

状态：未实现（仅计划）。当前 `1.20.1` 分支只有加载器日志骨架与 AUI 依赖；没有 `editor/index.html`、没有控制器、没有 01–12 能力的 AUI 承载。本文件不声称任何面板已迁移，也不预填验收。

| 原设计 | 实际实现 | 偏离原因 |
|---|---|---|
| 全功能 AUI 工作台 | 无页面/无控制器 | 14 尚未实施 |
| 共享模型/消息 | WebUI 已有；ingame 未接 | 14-04/14-09 待实现 |
| 七轨/异步/图/规则/模板/字幕 | WebUI 已验收；AUI 未迁移 | 本矩阵待执行 |
| 系统窗口/LUT 桌面导出 | 不适用 | 宿主能力边界，见 4.13 |
| 游戏内 Fabric AUI | 暂缓 | 用户裁决；不阻塞 WebUI→Fabric |

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `1.20.1` | AUI 页面、`Editor*Controller`、输入/帧/飞控桥、布局/主题/偏好存储 |
| 编辑器 `webui` | 01–12 的能力基线；14 只读其合同/黄金语料，不改 WebUI 实现 |
| 主模组main | editor共享运行服务、schema/文件/校验/图事务、api/editor端口/GPU/飞控/开关；不搬入编辑器撤销/模板/字幕工程核心 |

## 8. 前置

- 13 的全部出口通过；01–12 的 WebUI 能力有验收记录。
- 14-08 垂直切片通过（宿主链真实可用）。
- 14-03/14-04/14-06 的端口实现与 14-07 的释放路径可用。
- AUI 页面/元素/输入/纹理能力已按 14-01/14-02 验证；无 KubeJS/Rhino 也能交互。
- 共享服务（03-06/03-10）已实现；没有第二套消息/字段。

## 9. 正反例验收

**正例 A**：按 4.14 的跨模块场景走通；每个模块至少一个正例；保存/重开语义与 WebUI 一致；七轨含 ADJUST。
**正例 B**：图 1000 节点可缩放/悬停/打开；移动/重命名后引用与选择一致；布局重开恢复。
**正例C**：完整片段效果控件同时展示位置/朝向等多个组与各自节点，快捷属性独立且同值回显；主轴仅片段，100+属性不撑高。VALUE/ANIMATED/EVENT、独立时间、STEP/null/enum、段烘焙允许/禁止项均正确，轴外仅扩展局部视口。
**正例 D**：路径 11 几何/11 数学模型/点源五形态/朝向/时间两形态可编辑，预览不伪造运行时真值。
**正例 E**：触发→事实→规则→动作/释放→分支/出口→事件归因全链路可编辑/校验/播放。
**正例 F**：模板四层/纯数据/快捷效果/几何/曲线工具可插入且可撤销；字幕 SRT/VTT 导入→批量→编译→播放→重开/重导入冲突。
**正例 G**：主题切换、面板移动/缩放/停靠、偏好/草稿恢复；系统窗口字段按 4.13 说明。
**正例 H**：LUT 选择/应用/预览可用；桌面导出按钮不存在且有说明；其他调色能力不删。

**反例 A**：只完成 `EditorAuiScreen` + 空面板就宣布 14 完成 → 不通过。
**反例 B**：AUI 另存一份文档/撤销栈，保存时与主模组不一致 → 不通过。
**反例 C**：七轨只显示 6 轨（漏 ADJUST）或用旧片段级 `keyframes` → 不通过。
**反例 D**：规则/模板/字幕只做入口无真实编辑/编译 → 不通过。
**反例 E**：系统窗口/LUT 桌面导出静默删除且无说明 → 不通过。
**反例 F**：用 WebUI 验收记录代替 ingame 真实运行 → 不通过。
**反例 G**：把 01–12 未完成的能力在 14 里临时补做，导致语义漂移 → 不通过；应回原轮。
**反例H**：把WebUI的新工作区迁回主轴对象行/汇总节点、单属性独占页，或省略效果控件局部视口/左右行同步/节点拖动/轴外reveal → 不通过；AUI小窗不能成为缩水理由。

## 10. 真实游戏冒烟（未执行）

前置：14-01～14-08 全部通过；Forge 1.20.1 + AUI 1.3.1；真实脚本/资源/字幕文件。

1. 按 4.14 的跨模块场景在真实客户端走一遍；记录每步消息/画面/文件。
2. 逐模块执行 4.1–4.12 的正例与至少一个反例；记录错误定位。
3. 用 `../13-webui-acceptance-release/01-GoldenScriptCorpus.md` 的黄金语料做 ingame↔WebUI 语义对比；记录差异。
4. 做大图/长脚本/面板拖动性能记录；不达标回对应任务。
5. 同时开 WebUI 与 ingame，验证编辑/保存/关闭/飞控隔离。
6. 按 4.13 验证系统窗口/LUT 桌面导出说明可见、其他能力未删。
7. 全流程后关闭/重开/退出世界；确认无残留（14-07）。
8. 同屏展开至少两个对象组和常量/动画混合属性，操作单属性节点、冲突/取消/撤销；再从快捷属性改同一值、从诊断定位轴外节点，验证主轴片段宽度不变。局部/全局视口独立、真实播放头映射、小窗停靠/恢复和中文输入均人工记录。

**本轮未执行**：14 尚未实施，无 Forge 运行环境；不得预填通过。

## 11. 完成定义

- 4.1–4.12 每个模块都有“迁移/宿主替换”状态、适配类、输入输出、正反例；没有“后续/可选”漏项。
- 01–12 的必做任务全部能在矩阵中定位；除 4.13 两项外没有静默删除。
- 七轨、异步对象、图、路径/数学、镜头/转场、覆盖层、音频/调色、规则/事实/事件、模板/纯数据、字幕批次均有真实 AUI 承载与验收。
- 共享模型/消息/校验/撤销只有一份；AUI 不直接读写文件、不拼 JSON、不复制运行时求值。
- 黄金语料 ingame↔WebUI 语义一致；保存/重开/错误路径/性能/载体隔离通过。
- 没有空壳、TODO、占位按钮、假 mock；每个面板有真实数据或明确空状态原因。
- 系统窗口/LUT 桌面导出按 4.13 说明；Fabric AUI 暂缓但不阻塞 WebUI→Fabric 回归。
