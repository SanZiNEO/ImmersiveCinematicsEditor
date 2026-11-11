# 12 轮：模板（含纯数据）/ 取景飞控 / 几何与曲线工具 / 快捷效果 / LUT 边界 / 字幕整合

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（本轮只有计划，没有代码改动）。
> 归属：12-templates-flight-tools（交互代理）。
> 前置：01（schema 能力快照）、02（文档命令与事务）、03（宿主端口/受控文件输入）、05（工作台/抽屉/布局与 `clip.effects`/`selection.properties` 宿主）、06（`clip.effects` 效果控件与统一值/行控件）、07（位置/路径/曲线）、08（镜头与转场）、09（覆盖层/遮幅/字幕）、10（音频/调色/LUT）、11（触发/规则/事件）。
> 下游：13（WebUI→Forge、WebUI→Fabric 验收）；14（游戏内 Forge+AUI 迁移）。
> 证据前缀：`EDITOR:` = `E:/Documents/GitHub/ImmersiveCinematicsEditor/`；`MOD:` = `E:/Documents/GitHub/ImmersiveCinematics/`；`J:` = `MOD:common/src/main/java/com/immersivecinematics/immersive_cinematics/`；`INGAME:` = 编辑器仓库 `1.20.1` 分支（只 `git show` 读）。

## 一、摘要

本轮交付五组**生成型工具**、一条取景通道与一条字幕整合链路：三层模板（片段 / 轨道 / 脚本，含**纯数据模板**的加载/校验/展开）把「要什么效果」展开成标准脚本；快捷效果是模板的预设入口；取景飞控把游戏内相机姿态写回选中对象的关键帧；几何/曲线工具做坐标换算、适配、Gizmo 取点与形状生成；LUT 工具定义责任边界与桌面侧修正文件工作流；字幕整合（C14）把外部 SRT/VTT 导入为 cue 批次，编译成标准 OVERLAY/subtitle 片段并支持批量管理与重导入。所有产物都是主模组能直接 `parse`/`validate`/播放的标准 `objects` 脚本；运行时零模板语义、零字幕工程语义，编辑器也不复制播放期求值。

**参考源码怎么用**：[字幕导入与批量](../references/04-import-subtitles-batch.md)逐层对照12.20–23的来源写法与独立实现缺口；[属性关键帧](../references/02-olive-property-keyframes.md)为几何工具的拖动聚合/分量交互提供依据。参考的媒体I帧、SRT导出、ASS渲染或本地字幕track不进入本轮产物；所有生成仍以真实schema和既有事务为准。

## 二、为什么做

### 2.1 问题

- 模板只有一份硬编码：`EDITOR:src/components/PresetsPanel.vue:18–76` 的 `generateOrbitCircle()` 直接产出整份脚本，参数写死在一个 `reactive` 里（9–16），没有参数声明、没有层级、没有嵌套。
- 它产出的还是**旧格式**：`version: 3`（60）、`total_duration`（64）、片段级 `curve`（42–48）、片段级 `keyframes`（49–56）。新格式没有这些键（`MOD:docs/SCRIPT_FORMAT.md:734–755`），产物会被 parser 直接拒绝。也就是说：现有「预设」不是「功能不全」，而是**产物不可用**。
- 飞控写回的是旧模型：`EDITOR:src/store.ts:600–633` 的 `updateKeyframeFromFlight()` 把 `x/y/z/yaw/pitch/roll/fov/zoom` 塞进 `kf.position` / `kf.*`；新模型是 `objects` 里的 `position.x`、`yaw`、`fov` 等**叶子路径各自的时间序列**（`MOD:docs/SCRIPT_FORMAT.md:151–224`），写错位置等于静默丢数据。
- 几何工具没有任何实现：`MOD:plans/0.3.6/Z-editor/geometry-tools.md` 的四项（一键优化、`base_resolution` 表单、预览按 `k`、Gizmo）全部未落地；`meta.base_resolution` 已进 schema（`MOD:docs/SCRIPT_FORMAT.md:32`），但编辑器没有入口。
- 曲线工具缺位：PathCurveRegistry注册11种几何（linear/bezier/rational_bezier/arc/ellipse/bspline/nurbs/catmull_rom/hermite/clothoid/fourier），schema.curveTypes导出实际参数；旧BezierCurveField只有控制点输入，没有完整生成/拾取/重采样。
- LUT 没有边界：`MOD:docs/LUT_WORKFLOW.md` 已被标注「过期、不得作为实施依据」，但「输入域不匹配导致远景不变色」这个真实问题仍在（`MOD:docs/LUT_WORKFLOW.md:12–16` 的现象描述）。工具归属、能否在游戏内做、写不写游戏目录，都没有定。

### 2.2 目标

1. 三层模板可注册、可嵌套、可校验；产物是标准脚本，与手写等价、可继续编辑。
2. 模板参数只有一处声明，面板表单、帮助文本、错误提示读同一份。
3. 快捷效果（黑场/白场、固定+呼吸、推近/拉远、环绕弧、环绕整圈、双机位切、脚本骨架）都是一层薄入口，不各自硬编码。
4. 飞控进入时用选中对象的**真实姿态**初始化，退出写回该对象的叶子路径，且只在能忠实计算的字段上写。
5. 几何工具把作者的「画一个区域 / 填像素尺寸」翻译成标准字段；预览按 `k` 显示；Gizmo 拖拽双向同步。
6. 曲线工具提供形状生成与取点，产出 `paths[].geometry` 或 `objects.*` 关键帧，不另立曲线语义。
7. LUT 边界写清：谁生成、谁解析、谁应用、谁能写文件；不把游戏目录写权限偷渡给前端。
8. 纯数据模板（资产 JSON + 编辑器解释器）与代码内置模板走**同一**参数声明、展开接口、引用/环检测、装配与事务；模板资产不执行任意代码，不 eval。
9. 字幕整合（C14）完整交付：外部 SRT/VTT → cue 中间模型 → 表格校对/批量操作 → 按 schema 编译成标准 OVERLAY/subtitle 片段 → 一次提交 → 游戏原始画面验证；来源映射、手工修改冲突与重导入由 20–23 管理。
10. 本轮只要求 WebUI 具备完整生成语义（模板/纯数据模板/字幕/飞控写回/几何/曲线）；两宿主同语义完整是 14 迁移要求，不阻塞本轮。「Fabric 暂停」只指游戏内 AUI 宿主，不削弱 WebUI→Fabric 主模组通路；LUT 修正导出是桌面宿主特殊能力，游戏内不伪造文件 API。

### 2.3 非目标

- 不做运行时模板：产物之外运行时不认识任何模板字段（`MOD:plans/0.3.6/Z-editor/templates.md` §0）。
- 不做「生成物与模板保持关联并再生成」：**本条只约束 12-01～12-12 的模板产物**——产物即普通脚本，来源信息只作编辑器侧元数据（可选、不写脚本、不参与校验）。字幕批次的来源映射、手工修改冲突与重导入由 C14/20–23 管理，不属于模板再生成，不受本条禁用。
- 不做通用 DSL/脚本语言：纯数据模板没有循环、用户函数、字符串求值、文件/网络/全局访问；只允许封闭算子与白名单生成器（`12-12`）。
- 不做视频剪辑/合成/转码，不做素材库。
- 不复制 08 的转场（morph/wipe/遮罩）、09 的覆盖层合成、10 的调色与音频编辑：本轮只在需要时**调用**它们的字段契约。
- 不做叠化 hold 补帧（属 08 的转场面板；`templates.md` §7 已把它判为编辑器工具，但归转场面板）。
- 不新增主模组协议、不改 `schema.get`、不改 `.cube` 解析器。
- 不在游戏内宿主实现 LUT 文件读写（见 `12-11`）；不为此伪造游戏内文件 API。
- 不把 `application-and-integration.md` §三表格里的其他整合示例（对白生成音轨、双语排版、标题条、批量转场包、调色预设、触发链脚本包）扩为必做；它们只界定扩展边界。

## 三、方案

### 3.1 用起来是什么样

**模板抽屉**（05 的 `templates` 槽）：

1. 选层：片段 / 轨道 / 脚本。
2. 选模板：列表带一句话说明与产物层级；按来源分组「内置 / 数据模板」，数据模板带包名徽标；不可用模板（缺前置、参数越界）置灰并给出原因。
3. 填参数：表单由参数声明驱动；每个参数有单位、范围、默认值、帮助文本；越界即时提示，不等到生成。
4. 预览：显示「将生成什么」的**结构化摘要**（片段数、时长、轨道、关键帧数量、是否含无限内容），不显示假画面；真实效果用中央预览看。
5. 插入：插入到播放头（片段级）、插入到新轨道（轨道级）、新建文档（脚本级）；插入前显示影响面（会新建哪些轨道/片段 id）。
6. 生成后：产物进入当前文档，一次撤销可整体回滚；抽屉显示「已生成 N 个片段」，并提供「查看来源参数」（编辑器元数据，可关闭）。

**纯数据模板**：抽屉顶部有「导入模板包…」；用户选一个 `ic-templates/1` JSON 文件，经 `DataTemplateLoader` 读取、`DataTemplateValidator` 整包校验后进入列表，与内置模板同一套参数表单、同一套插入流程、同一套引用/环检测/事务。来源徽标显示包名与只读参数；「移除数据模板」只影响后续插入，已生成文档不受影响。资产只能声明数据（封闭算子 + 白名单生成器），编辑器不执行资产里的任何代码；详见 `12-12-DataTemplates.md`。

**快捷效果**：按12-10定义的七个入口（黑场淡入、黑场淡出、固定+呼吸、推近、拉远、环绕90°、环绕整圈）调用同一模板注册表和参数，不复制生成逻辑。

**取景飞控**：通过共享 Selection 在 `clip.effects` 中选中 CAMERA 片段的某个属性节点（或只选片段本身）→ 按 `F7` 或点预览上的「取景」→ 游戏内接管相机 → 调整 → `F7`/按钮退出 → 写回该属性节点，并在效果控件中定位/选中该行。主时间轴只提供片段选择，不展开对象行或关键帧。飞控中预览左上角显示姿态 HUD；退出时若有字段无法忠实写回，弹出「未写回字段」清单（例如相对基准点、look_at、贝塞尔路径、呼吸扰动）。

**几何工具**：预览画布上可切换「区域框选」；框出的矩形换算成 `source/dest` 的 `x/y/w/h`；填「我要 3200×450」自动反解 `scale_x/scale_y`；`meta.base_resolution` 在文档属性里可编辑并支持「用当前窗口尺寸填入」；预览按 `k = 预览尺寸 / base_resolution` 显示。Gizmo 只对 `clip.effects` 中当前选中的叶子生效，拖动产出一条命令；结果回到同一行/节点显示，不新建属性面板，也不落到主时间轴。

**曲线工具**：脚本级路径面板选中一条 `paths[]` 条目 → 形状预设（圆弧/椭圆弧/抛物/直线）→ 生成控制点 → 在预览上拖控制点（Gizmo）→ 可选「按弧长等距重采样」把 `timing` 写成关键帧点。路径面板与曲线手柄是文档级工具；端点/重采样落到的属性节点在 `clip.effects` 中显示与定位。

**LUT**：ADJUST 的调色组（10）里选择 `.cube`、调 `lut_strength`、`lut_input_gamma`；「修正 LUT」按钮打开**桌面宿主**工具：导入捕获帧 + `.cube` → 调输入域/分区 → 预览对比 → 导出修正后的 `.cube`（保存对话框），由作者自己放进 `resource/`。这是桌面文件能力的宿主特殊项：WebUI 与游戏内 Forge 都不伪造游戏内文件 API；游戏内不提供该导出入口，并显示原因。模板/字幕/飞控/几何/曲线的生成语义不因这项差异缩水。

**字幕整合（C14）**：模板抽屉之外的独立工作流——`SubtitleImportWizard` 选 SRT/VTT → 解析为 cue 并显示逐条诊断 → 表格校对/筛选/多选 → 批量时间偏移/比例、样式预设、文本替换、排序/拆分/合并 → 显示将生成的 OVERLAY/subtitle 片段与轨道分配差异 → 一次提交 → 主模组 `script.validate` → 游戏原始画面验证。cue 与片段的双向定位使用共享 Selection：主时间轴只定位/选择片段，片段内的字幕参数在 `clip.effects` 的覆盖层字幕组显示。来源批次、手工修改冲突与重导入由 `SubtitleBatchSession`/`SubtitleProvenanceStore` 管理；保存/重开后可从编辑器 sidecar 继续管理，sidecar 丢失时脚本仍可播放并可重新编组。详见 `20`–`23`。

### 3.2 边界（与 08/09/10 的分工）

| 能力 | 12 负责 | 不负责（归属） |
|---|---|---|
| 转场 morph/wipe/遮罩 | 无（只允许模板在脚本级设默认 `transition*` 值） | 08 |
| 叠化 hold 补帧 | 无 | 08（转场组） |
| 覆盖层 fade/image/subtitle/pip | 模板可生成 OVERLAY 片段，字段取值按 09 契约 | 09（字段语义与合成预览） |
| 遮幅 LETTERBOX | 模板可生成遮幅片段 | 09 |
| ADJUST/LUT 字段编辑 | 无 | 10（调色组） |
| LUT 修正文件生成 | 是（桌面宿主工具；游戏内不提供入口） | 10 负责把生成的文件引用进脚本 |
| 音频/监听 | 无 | 10 |
| 触发/规则/事件 | 脚本级模板可生成 `meta.triggers` 骨架与 `rules/rule_bindings` 引用 | 11（语义与编辑器） |
| 路径几何/曲线编辑 | 形状生成、取点、重采样（工具） | 07（路径集合编辑与曲线手柄本体） |
| 位置点源/朝向 | 飞控写回按 07 的字段契约 | 07 |
| 纯数据模板 | 资产格式、加载、校验、展开、与内置模板统一接口 | 12-12；不接管运行时、不做再生成 |
| 外部字幕导入/批次/编译/面板 | 是（C14，20–23 全链路） | 09 负责字幕字段语义与单片段编辑；运行时不解析字幕工程 |

### 3.3 字幕任务、前置与出口

| 必做任务 | 前置 | 当轮出口 |
|---|---|---|
| [20-SubtitleImportService](20-SubtitleImportService.md) | 03受控文件输入、02标准模型、09字幕元能力 | SRT/VTT真实读取、cue中间模型、格式/编码/有损信息诊断与取消 |
| [21-SubtitleBatchSession](21-SubtitleBatchSession.md) | 20、02事务/身份、05恢复/工作区 | 多选批量时间/文本/样式、来源映射、手改冲突、重导入与sidecar恢复 |
| [22-SubtitleScriptCompiler](22-SubtitleScriptCompiler.md) | 20–21、01 schema、09单轨活动语义、12共享ID装配 | 标准OVERLAY/subtitle、重叠分轨、真实校验、一次提交/失败无半写 |
| [23-SubtitleBatchPanel](23-SubtitleBatchPanel.md) | 20–22、05停靠/主题、06参数控件 | 导入→批量管理→生成差异→游戏播放→重开/重导入完整流程 |

以上是本轮必做，与12-01～12-12共同清零；不能用普通模板生成即脱离条款禁止字幕批次管理。

## 四、技术细节

### 4.1 核心模型（提案）

| 概念 | 职责 | 归属文件 |
|---|---|---|
| `TemplateDef` | 层（clip/track/script）、id、说明、参数表、展开器引用 | `12-01-TemplateEngine.md` |
| `TemplateParam` | 复用 `ObjectDef`/`FieldDef` 同形声明（type/default/min/max/enum/unit/section） | `12-01` |
| `TemplateRegistry` | 注册顺序 = 展示顺序；层内 id 唯一；层间命名空间隔离 | `12-01` |
| `TemplateExpander` | `(params, ctx) => JsonFragment`（纯函数，无状态） | `12-01` |
| `TemplateAssembler` | 把片段/轨道/脚本片段装进目标文档，分配 id、处理引用 | `12-01` |
| `TemplateRef` | 轨道级/脚本级对下层的 id 引用 + 逐层传参 | `12-02` |
| `DataTemplateLoader` | 资产来源、严格解析、上限、整包原子装载、来源指纹 | `12-12-DataTemplates.md` |
| `DataTemplateValidator` | 结构/schema/引用/环/表达式/编译干跑校验 | `12-12` |
| `DataTemplateExpander` | 封闭算子 + 白名单生成器 → `TemplateFragment`，绑定为统一 `TemplateExpander` | `12-12` |
| `SubtitleImportService` | 外部 SRT/VTT → cue 中间模型 + 逐条诊断 | `20-SubtitleImportService.md` |
| `SubtitleBatchSession` | cue 批次、批量时间/文本/样式操作、来源映射 | `21-SubtitleBatchSession.md` |
| `SubtitleScriptCompiler` | cue → 标准 OVERLAY/subtitle 片段 + 重叠分轨 | `22-SubtitleScriptCompiler.md` |
| `SubtitleBatchPanel` | 导入向导、批次表格、重导入冲突对照 | `23-SubtitleBatchPanel.md` |
| `FlightSession` | 进入/退出/取消、姿态采样、写回计划、未写回清单 | `12-07-FlightFraming.md` |
| `GeometryTool` | 区域→`source/dest`、像素→`scale`、`k` 预览、Gizmo | `12-08-GeometryTools.md` |
| `CurveTool` | 形状预设、控制点拾取、等距重采样 | `12-09-CurveTools.md` |
| `QuickEffect` | 模板 id + 默认参数 + 入口按钮 | `12-10-QuickEffects.md` |
| `LutCorrectionTool` | 捕获帧 + cube 解析 + 输入域修正 + 导出 | `12-11-LutToolBoundary.md` |

### 4.2 契约

- **模板无状态**：每次展开产出全新 JSON，不缓存、不复用；产物所有权交给调用方（当前文档）。
- **统一展开接口**：内置模板是 `TemplateDef.expand(params, ctx)`；数据模板由 `DataTemplateExpander.bind(def)` 返回**同签名**函数。注册表、12-02 引用/环检测、12-06 参数表单、12-01 装配器都不区分来源，不存在第二套参数/引用/校验。
- **纯数据安全**：资产是 JSON，不是代码；只允许封闭算子表 + 白名单生成器；禁止 `eval`/`new Function`/`import()`/`require`/`fetch`/文件/全局对象；原型键拒绝；文件/模板/参数/深度/节点/关键帧/实例有上限。详见 `12-12`。
- **一次事务**：展开 + 装配 + 引用重写 + id 分配在一次文档事务内完成；失败全回滚（`shared/contracts.md` C11）。
- **产物即标准**：只写 parser 白名单字段；不写 `meta.version`、`timeline.total_duration`、片段级 `keyframes/curve/rules`。
- **来源元数据**：可选的 `{templateId, params, generatedAt}` 存在编辑器侧（不写脚本、不进校验）；用于「查看来源参数」，不提供自动再生成。
- **模板脱离 vs 字幕批次**：上一条「不提供再生成」只约束 12-01～12-12 的模板产物；C14 字幕批次的来源映射、手工修改冲突与重导入由 20–23 管理——重导入先列差异，默认不覆盖手工修改、不重复插入同批，用户逐项确认后一次原子提交。不得用「生成即脱离」这类无关联条款禁用字幕批次管理。
- **飞控真值在宿主**：编辑器只发进入/退出/取消，姿态由 `flight.state`（约 10Hz）与 `flight.exit` 回推（`MOD:plans/0.3.6/Z-editor/flight-mode.md` §四）。
- **几何/曲线工具只产出标准字段**：不引入 `scale_x` 之外的中间表达，不在脚本里存「像素尺寸」。
- **LUT 工具不写游戏目录**：只导出到用户选择的位置；游戏内不提供入口，也不伪造游戏内文件 API。
- **宿主范围**：本轮只验 WebUI 具备完整生成语义（模板/纯数据模板/字幕/飞控写回/几何/曲线）；游戏内 Forge 的同语义完整是 14 迁移要求，不阻塞本轮。「Fabric 暂停」仅指游戏内 Fabric AUI 宿主适配，**不**约束 WebUI 的 Fabric 主模组连接，也不得据此少做 WebUI 功能。
- **选择与定位统一**：`clip.effects`（片段效果控件）与 `selection.properties`（快捷属性）是属性/节点的唯一选择来源；主时间轴只提供片段选择与编排。飞控写回、几何 Gizmo、字幕 cue 双向定位都通过共享 Selection 定位到效果控件中的组/行/节点，不得要求主时间轴展开对象行或关键帧，也不得另建属性面板。工具产物仍是标准 `objects` 字段与既有命令，不存在第二份值或节点历史。

### 4.3 数据形态

- 模板定义有两种来源、同一接口：TS内置TemplateDef与ic-templates/1纯数据JSON资产；后者经Loader/Validator/Expander绑定为同签名展开器。12-01/12-12同轮完成，不存在只做TS而纯数据留后续的中间态。
- 参数值：`Record<string, JsonValue>`，经声明归一（缺省填充、类型校验、越界拒绝、未声明键报错）。
- 产物：`{ clips?: TimelineClip[], tracks?: Track[], script?: {meta, timeline, clips?, rules?, rule_bindings?, paths?} }`。
- 飞控写回：`WritebackPlan = { clipId, objectPath, value }[]`，只含能忠实计算的路径。

### 4.4 边界（禁止）

- 模板不得生成运行时未知字段、不得生成编辑器私有字段。
- 模板不得自动改写**用户已有**的片段/路径/规则（只能新增；引用冲突时报告并让用户选择）。
- 飞控不得写 `look_at`/`facing_*`/贝塞尔路径/呼吸参数的「推测值」。
- 几何工具不得改变 `objects` 之外的结构。
- LUT 工具不得声称「自动匹配输入域」；只做作者显式选择的变换。

### 4.5 宿主与统一包

主模组editor统一管理共享服务和webui/ingame模式及总开关，见[独立包设计](../shared/editor-package-modes.md)。本轮创作算法/模板资产/字幕工程仍在独立编辑器仓库，不因该包调整搬入主模组；J:webui引用只证明当前事实。两模式保持完整生成语义，但本轮只验 WebUI 对接 Forge/Fabric；ingame 模式为 14 迁移要求，游戏内Fabric+AUI适配暂缓。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 运行时模板（旧 `script/template/`） | Java 侧展开并落盘 | 运行时承担创作运算，与「只读只执行」冲突 | 已判定越界；当前工作树已无该包，只剩 `ScriptTemplate` 骨架 |
| 每个效果一个硬编码面板 | 继续堆 `PresetsPanel` 式组件 | 每加效果改前端；参数与 schema 两套 | 模板引擎 + 参数声明 |
| 纯数据模板推迟 | 只做TS内置，数据资产以后再加 | 留下本轮未完工作并分叉参数/引用入口 | 同轮完成ic-templates/1资产和安全解释器，共用注册表/装配器 |
| 生成物保持模板关联并可再生成 | 存模板 id + 参数，模板升级后重放 | 需要版本化、冲突合并、部分重生成语义 | 生成即脱离；只留只读来源信息 |
| 飞控直接改脚本（游戏端写盘） | 游戏内直接落盘 | 破坏「编辑器是唯一作者工具」；与协议冲突 | 飞控只回推姿态，写回由编辑器事务完成 |
| 预览canvas内部直接绘制Gizmo | 画布绘制与命中测试 | 需坐标/缩放/输入桥；AUI等价能力尚未实证 | WebUI可叠交互层，游戏内按14实证适配；不得无依据宣称AUI无hover或将工具降为只读 |
| LUT 工具直接写 `resource/` | 前端拿游戏目录路径 | 编辑器不知道游戏目录；越权写文件 | 导出到用户选择位置，人工放置 |

**本方案的缺点**：

- 内置与纯数据有两种创作来源，必须维护同一参数/引用/校验/装配合同；用共享行为向量和注册表防漂移，不能靠延期规避。
- 参数声明与运行时字段仍需人工核对来源，实际填参/生成/保存/播放发现差异，不建设CI或自动对拍。
- 飞控写回「只写能算的字段」会让作者觉得「飞了半天只写回一半」；必须把未写回清单做得清楚。
- 几何工具的 `k` 预览与真实播放仍有差异（预览固定 1080p60，`base_resolution` 不同则缩放行为不同），需要在 UI 明示。
- LUT 工具是 WebUI 专属，两宿主能力不完全对等；这是文件系统能力的客观差异，不是语义差异。

## 六、实现结果

状态：未实现。

| 设计目标 | 当前事实 | 说明 |
|---|---|---|
| 三层模板 | 只有 `PresetsPanel.vue` 一个硬编码整圈生成（18–76） | 未开始；且产物为旧格式 |
| 参数声明驱动表单 | 无；`PresetsPanel` 参数写死（9–16） | 未开始 |
| 模板产物 = 标准脚本 | `generateOrbitCircle` 写 `version:3`（60）、`total_duration`（64）、片段级 `curve`（42–48）/`keyframes`（49–56） | 与现行 parser 白名单冲突，必须重写 |
| 飞控绑定选中片段 | `store.ts:553–598` 采样 `clip` 旧结构；`600–633` 写回 `kf.position`/`kf.yaw` | 语义在，模型错；需按 `objects` 重写，并用共享 Selection 定位到 `clip.effects` 行 |
| 几何工具 | 无（`BezierCurveField.vue` 只有三轴输入框） | 未开始 |
| 曲线工具 | 无形状生成/拾取/重采样 | 未开始 |
| LUT 边界 | 运行时解析与合成已实现（`J:script/CubeLut.java`、`J:script/CubeLutLoader.java`、`J:client/post/ColorAdjustPass.java:474–540`）；编辑器无工具 | 边界未定，工具未开始 |
| 运行时模板 | `J:script/template/` 包不存在于当前工作树；`ScriptTemplate.java` 仍被 `ScriptFileService.newScriptJson()`（80–82）使用 | 片段级模板已不在；骨架仍存，`script.new` 链路归 02/03 处理 |
| 控制点形态冲突 | SCRIPT_FORMAT的个别示例仍用数组，PathCurveRegistry.readPoint（408–425）只接受{x,y,z}或{dx,dy,dz}对象 | 编辑器只生成parser实际接受的对象形态，见12-09，不改主模组格式 |

### 6.1 本轮出口（无遗留）

1. 三层模板引擎（注册/参数/展开/装配/嵌套/环检测）落地，产物通过 `script.validate`。
2. 四个片段模板 + 两个轨道模板 + 一个脚本模板按规格实现，参数表与 Z 文档一致。
3. 快捷效果入口与模板一一对应，无第二套生成逻辑。
4. 飞控进入姿态采样与退出写回全部走 `objects` 路径，未写回清单可见。
5. 几何四项（区域→source/dest、像素→scale、base_resolution、按 k 预览）落地，Gizmo 至少覆盖 `dest`。
6. 曲线形状预设 + 控制点拾取 + 等距重采样落地，产出 `paths[].geometry/timing`。
7. LUT 边界文档化并实现 WebUI 工具最小闭环（导入 cube + 捕获帧 → 导出修正 cube）；游戏内入口隐藏且说明原因。
8. 所有原任务与补充任务的正反例和真实冒烟在实施当轮通过，14做全量复核，不以步骤已写算完成。
9. 纯数据模板Loader/Validator/Expander、封闭算子/引用/环/限额与作用域完整实现，和内置模板共用参数表/注册/装配/事务；不执行资产代码。
10. 20–23字幕整合完整实现并经游戏验证，来源/手改冲突/重导入可恢复；本轮要求 WebUI→Forge/Fabric 生成语义一致，游戏内Forge 同语义一致是 14 迁移要求；只有明确列出的桌面LUT导出属于宿主特殊能力。
11. 飞控写回、几何 Gizmo、字幕 cue 双向定位都经共享 Selection 落在 `clip.effects` 的组/行/节点；主时间轴始终只显示/选择片段，未因任何工具新增对象行或关键帧汇总。

### 6.2 任务文件

| 文件 | 覆盖 |
|---|---|
| [12-01-TemplateEngine.md](12-01-TemplateEngine.md) | 参数声明、注册表、展开器、装配器、错误模型 |
| [12-02-TemplateNesting.md](12-02-TemplateNesting.md) | 三层嵌套、逐层传参、id 命名空间、环检测 |
| [12-03-ClipTemplates.md](12-03-ClipTemplates.md) | fade / static_breath / dolly / orbit_arc 规格 |
| [12-04-TrackTemplates.md](12-04-TrackTemplates.md) | 环绕整圈、双机位切 |
| [12-05-ScriptTemplates.md](12-05-ScriptTemplates.md) | 脚本骨架（meta/触发器/默认转场） |
| [12-06-TemplatePanel.md](12-06-TemplatePanel.md) | 模板抽屉 UI、预览摘要、插入位置、来源 |
| [12-07-FlightFraming.md](12-07-FlightFraming.md) | 取景飞控采样与写回 |
| [12-08-GeometryTools.md](12-08-GeometryTools.md) | 区域/像素/`k`/Gizmo |
| [12-09-CurveTools.md](12-09-CurveTools.md) | 曲线形状、拾取、重采样 |
| [12-10-QuickEffects.md](12-10-QuickEffects.md) | 快捷效果入口与默认参数 |
| [12-11-LutToolBoundary.md](12-11-LutToolBoundary.md) | LUT 责任边界与 WebUI 工具 |
| [12-12-DataTemplates.md](12-12-DataTemplates.md) | 纯数据资产、Loader/Validator/Expander、安全表达式/作用域/引用与统一展开 |
| [20-SubtitleImportService.md](20-SubtitleImportService.md) | 外部字幕导入、编码/格式/逐cue诊断 |
| [21-SubtitleBatchSession.md](21-SubtitleBatchSession.md) | 批量编辑、来源映射、重导入与手改冲突 |
| [22-SubtitleScriptCompiler.md](22-SubtitleScriptCompiler.md) | schema编译、ID重映射、重叠分轨、标准产物 |
| [23-SubtitleBatchPanel.md](23-SubtitleBatchPanel.md) | 字幕导入向导/批量面板与完整工作流 |

美术规范见 [`../shared/art-direction.md`](../shared/art-direction.md)；不计入必做的增强项见 [`../shared/editor-recommendations.md`](../shared/editor-recommendations.md)。
