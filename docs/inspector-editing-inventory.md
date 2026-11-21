# 右侧属性面板现状盘点：编辑能力、入口与限制

> 本文盘点现有的编辑入口和限制。逐字段的类型、缺省值、模式、插值、取值范围和适用条件见 [字段目录](./inspector-field-catalog.md)。

标记约定：`[可编辑]` 当前有真实写入入口；`[条件]` 只有特定分支/类型可写；`[会话]` 只进会话或内存，不写文档；`[只读]` 只展示；`[仅目录]` 目录/Schema 有声明但当前无有效 UI；`[未接线]` 组件或纯函数存在但未被注册/引用；`[需注意]` 行为与注释/设计口径不一致。

字段的完整清单应以附录为准；本文中的数量来自当前目录（`src/core/schema/catalog/tracks.ts`、`meta.ts`）。

---

## 1. 当前右栏的页签与面板

`document.right` 是一个 `GroupNode`，所有注册到该槽的面板成为同级 tab，由 [`GroupRenderer.vue`](../src/workbench/host/GroupRenderer.vue) + [`TabStrip.vue`](../src/workbench/host/TabStrip.vue) 渲染；多数面板声明 `keepAlive`，由 `PanelHost` 的 `v-show` 保留内部状态（`demo.panel.properties` 未声明 keepAlive）。当前内置插件清单见 [`builtin.ts`](../src/plugins/builtin.ts)。

| order | 插件 / panelId | tab 标题 | 实际内容 |
|---|---|---|---|
| 10 | `core.selection-properties` / `selection.properties` | 属性 | 按选区显示脚本参数、轨道参数或片段属性 |
| 10 | `demo.kitchen-sink` / `demo.panel.properties` | Demo · 属性槽 | 只读选择快照 |
| 20 | `core.behavior` / `behavior.triggers` | 触发器 | `meta.triggers` 列表与详情 |
| 30 | `core.transition-panel` / `transition.panel` | 转场 | 全脚本 A→B 交界 |
| 90 | `demo.extra` / `demo.extra.panel` | Demo · 额外面板 | 只读文档身份 |

上表中有两个 order=10 项（属性与 Demo·属性槽），先后由注册顺序稳定排序；Demo 仍占用真实 tab 与标签条空间，不是设计参考面板。

- 默认右栏显示「属性」。[`SelectionPanelSync.ts`](../src/workbench/app/SelectionPanelSync.ts) 将 `none / track / clip / object / keyframe` 定位到同一个 `selection.properties` 面板；`path / rule / binding` 保持当前页签。
- 打开脚本不自动选择片段。选中轨道头查看轨道参数；点击轨道空白清选区回到脚本参数。标尺仍用于定位播放头。
- 右栏宽度由布局树约束，可拖动调整；脚本、轨道与片段共用同一右栏槽位。
- 两个 Demo tab 都在 `builtin.ts` 中静态启用，但只展示 `pageId / pluginId / panelId / 文档身份 / 选区快照`；不是真实属性编辑器。

### 1.1 片段属性面板内部结构

[`ClipPropertiesPanel.vue`](../src/plugins/core.selection-properties/panels/ClipPropertiesPanel.vue) 不是整页平铺，而是纵向堆叠：

1. `ClipPropertiesHeader`：选区类型、片段名、全局起止与片内播放头。「到开头」只移动播放头，不改片段；内部标识留在提示里。
2. 有多个功能页时显示页签。相机分为镜头、运动、构图、调色、转场；不同轨道只提供自身适用的页和组。具体划分见[设计稿](./inspector-design.md)。
3. 滚动区内按功能分组。相机位置与朝向使用条件卡片，六个运动模型归入「运动」。事件记录只显示摘要并跳转到行为抽屉；未知字段保留只读入口。
4. 模型编辑器、组合编辑与诊断继续使用各自的入口；媒体与调色横幅由字段面注册提供。

右栏不替代效果面板的完整关键帧轴。可动画标量行可跳到前后帧，并用菱形增删当前帧；命中帧可改帧值，未命中时显示只读采样。

### 1.2 脚本属性 / 触发器 / 转场的内部结构

- `ScriptPropertiesPanel`：基本信息、播放行为、输入与监听、画布与游戏界面、行为及扩展字段。`TrackPropertiesPanel`：类型、片段数、轨道重命名，以及不改脚本的可见、锁定、静音设置。两者都在「属性」内，不设内部页签。
- `behavior.triggers`：左列触发器列表 + 右列详情（身份 / 动作只读卡 / 时序 / 条件树 / 前置 / 诊断 / 应用草稿），是两栏布局（[`TriggerPane.vue`](../src/plugins/core.behavior/panels/TriggerPane.vue)，约 :402）。列表选中是面板内部 `selectedIdentity`，不写全局选区。
- `transition.panel`：状态统计 + 过滤 + A→B 交界列表 + 选中交界的详情（叠化、参数过渡六通道、共存处理、曲线）；选中是局部 `selectedId`，不依赖剪辑选区。它的“定位”动作会调全局 `requestSelect({domain:'clip'})`，从而可能把右栏切回“属性”tab。

---

## 2. 片段表面的选择状态

`ClipPropertiesPanel` 只认 `SelectionService.state()` 的五分支（[`selectionState.ts`](../src/workbench/host/selectionState.ts)）：

| 状态 | 当前显示 | 可编辑性 |
|---|---|---|
| `clip` | 完整片段属性 | 按行分派，见 §3 |
| `multi` | 片段数量、名称与起点 | `[只读]` 不合并属性、不擅自展开第一个片段 |
| `invalid` | 失效原因、撤销按钮 | 只有撤销恢复 |
| `foreign`（path/rule/binding） | 只提示“当前选择属于 X 域” | `[只读]`，不自动跳别的面板 |
| `none` | 空态提示，不自动选第一个片段 | 无 |

- `object` / `keyframe` 仍映射到所属片段，检查器切到包含该字段的功能页并尝试定位对应行。是否可编辑取决于当前帧和字段分支。
- 外层检查器在无选区时显示脚本参数、在轨道选区时显示轨道参数。Demo 属性槽仍只打印选区快照。

---

## 3. 七轨共同编辑

### 3.1 片段几何、名字与结构

`[可编辑]` 起止/时长/循环的正式入口在时间轴，不在属性行：

- `start_time`、`duration`：拖动片段本体、拖左右边缘裁切、分割、复制/粘贴；属性头和效果面板头只读显示，并给“在时间轴编辑”跳转（[`ClipPropertiesHeader.vue`](../src/plugins/core.selection-properties/panels/ClipPropertiesHeader.vue)）。
- `loop`：时间轴右键“切换循环”/快捷键/命令 `timeline.toggleLoop`；无限片段不能开启循环（[`state.ts`](../src/plugins/core.timeline/state.ts)，约 :1070）。
- `loop_count`、`loop_mode`：命令层有 `clip.setLoop` 的 `loopCount/loopMode`，但当前 UI 没有输入/下拉入口；只能读头徽标/检查面板。`[仅目录/无 UI]`
- 五个 `playControl` 字段被属性面板显式剔除（`CLIP_GEOMETRY_PATHS`，`ClipPropertiesPanel.vue:90`），避免“看起来能改时长实际该去主轴”。
- 时间轴的 A-B 循环（`timeline.loop_start/loop_end`）是文档字段，与片段的 `loop/loop_count/loop_mode` 不是同一件事；A-B 由标尺拖动/右键/命令编辑。
- 其他面也会写片段几何：字幕面板批量写 `clip.setStart/setDuration`，转场叠化/参数过渡会移动 B 的起点，预设新建片段会写 start/duration。它们不是属性面板入口。

`clip.id` 与名字：

- 显示名回退链是 `clip.label → clip.name → clip.id → 未命名片段`（[`DocumentServiceImpl.ts`](../src/workbench/app/DocumentServiceImpl.ts)，约 :49）。
- 当前没有编辑 `clip.label` / `clip.name` 的 UI；属性头、时间轴、效果头都只读。
- `clip.setId` 的真实 UI 入口只在“路径集合”抽屉的“设置片段 id”区，且只列出**还没有 id** 的片段；正则 `^[A-Za-z0-9_]{1,32}$`，一次提交同步引用（[`PathCollectionPanel.vue`](../src/plugins/core.paths/panels/PathCollectionPanel.vue)，约 :214）。已有 id 不能在这个 UI 里改。`[条件]`
- 新建 CAMERA 片段的结构由 `buildMinimalClip` 构造：`start_time`、`duration:5`、`loop:false`、`loop_count:-1`、`loop_mode:'repeat'`；objects 固定写 `position_mode`、`position_space`、`position.y`、`yaw/pitch/roll`、`fov`、`zoom`、`transition`，值优先取目录默认，缺省回退为 relative/world/0/0/0/0/70/1/cut。`[可编辑]`（但新建入口受限，见 §5.1）

### 3.2 属性行的真实分派顺序

[`ClipPropertyRow.vue`](../src/plugins/core.selection-properties/panels/ClipPropertyRow.vue)（约 :218）的分支顺序是：

1. `[只读]` `row.unknown || row.mode === 'unknown'`：显示原始 JSON，不提供帧或记录控件。
2. `[事件]` `mode === 'event'`：摘要列表 + `N 条记录` + “在行为页打开”；无记录时只提示“可在行为页新建”，本体没有新建记录表单。
3. `[条件]` 对声明了 `hideWhenFramed` 的组合型字段，有帧时显示「在效果面板」入口；普通标量不受此限制。
4. 静态行优先使用已注册的专用控件；其余行使用支持检查器模式的 `PropertyValueForm`。
5. 结构值不显示标量关键帧按钮；事件行不进入值控件。

普通可动画标量通过 `PropertyValueForm` 的检查器模式编辑：没有帧时写静态值；命中帧只写该帧；未命中显示只读采样。静态专用控件在字段有帧时不会接管标量写入；需要专用结构编辑的动画字段仍可跳到效果面板。

### 3.3 关键帧能力与专用控件

- 十种值控件：`int → integer`、`float → number`、`nullable_float → nullable-number`、`bool → boolean`、`enum → enum`、`ref → ref`、`struct → struct`、`string → text`、事件 → `event`、未知 → `readonly`（`valueControls.ts:18`）。
- `[可编辑]` 菱形在当前片内时间创建或删除帧；无帧时也用它创建首帧。初值回退顺序为采样、静态值、目录默认值。前后箭头只移动播放头；关闭整行的动画仍在效果面板。
- `[需注意]` 插件注册的专用值控件只在对应面板生效（音频/调色/OVERLAY 在属性面板，`meta.listener` 在脚本属性）；效果面板的行统一使用 `PropertyValueForm`，不会复用这些专用控件。
- `[可编辑]` 效果面板（左栏 `clip.effects`）只显示 `leaf` 策略下有帧的行，是精细值/节点/段编辑处：双击添加节点、拖动/框选节点、删除节点、关闭动画、复制路径、缓动编辑与烘焙（[`ClipEffectsPanel.vue`](../src/plugins/core.clip-effects/panels/ClipEffectsPanel.vue)、[`EasingEditor.vue`](../src/plugins/core.clip-effects/panels/EasingEditor.vue)）。它没有“新增属性”入口：属性只因第一次出现关键帧而进入动画。
- `[条件]` 效果面板的 `struct`/事件行仍不能走通用值控件；事件行只给记录入口。段缓动只对非事件、非 step 的相邻节点段开放；线性/贝塞尔把手在会话存储，烘焙提交 `object.bakeEasing`。

### 3.4 组编辑 / 批量 / 未知 / 条件隐藏

- `[可编辑]` 有组合入口的属性组可同刻建帧、抓取当前值、批量改值或删除该时刻帧。自定义组合定义只在内存，不保存到脚本；组合操作仅作用于当前片段。
- `[只读]` 多选显示数量、片段名与起点；时间轴仍支持多选移动、删除与复制，属性面板不合并编辑。
- `[只读]` 未知路径归入「未知 / 扩展」，保留原始值查看，不提供帧或记录控件。
- `[条件]` `requires` 未满足：行仍在，控件禁用并显示“依赖未满足”与原因；已有值/帧保留。
- `[条件]` 必填缺失：行内“必填未设置”和错误边框，不弹对话框；诊断 `block` 行会禁用控件并染错误底。
- `[条件]` 位置/朝向的分支隐藏：现有值保留并显示“当前分支不读取该字段（值保留）”；空值行直接隐藏。详见 §4.1。

---

## 4. 各轨实际入口与分组（共同模型之上）

共同点：`playControl` 五字段在时间轴；其余字段按 schema `objects` 生成行；属性面板对每轨列“适用叶子（含未设置）”，专有控件、显示分组、合并行隐藏来自插件贡献。目录数量（对象字段 / 其中 animated）：

| 轨道 | 字段数 | 分组（目录 section 或字段面覆盖） | 当前实际入口与限制 |
|---|---:|---|---|
| CAMERA | 218 / 185 | position 21、orientation 44、camera 2、composite 16、color 67、motion 6、breath 7、transition 5、modifier 2、selector 48 | 属性面板 + 位置/朝向控制条 + 6 模型行 + 调色专用控件 + 转场 tab；见 §4.1 |
| LETTERBOX | 2 / 2 | `aspect_ratio`、`opacity` | `aspect_ratio` 专用控件 + 预设/几何示意；`opacity` 通用值；最多一条遮幅轨 |
| AUDIO | 13 / 4 | 音源、音量、包络、空间（字段面覆盖） | 13 个音频专用控件；只有 `volume/x/y/z` animated；见 §4.3 |
| EVENT | 2 / 0 | `event` 事件记录、`event_type` value | 事件行摘要 + 行为抽屉记录编辑；不能新建事件片段 |
| MOD_EVENT | 3 / 0 | `mod_event` 事件记录、`event_type`、`data` struct | 同上；`data` 是通用树/JSON 编辑 |
| OVERLAY | 32 / 24 | layout 6、source 4、composite 1、text 1、color 3、mask 5、gradient 4、layer 8 | 按 `layer_type` 过滤字段面；8 个专用控件；见 §4.4 |
| ADJUST | 72 / 59 | color 59、curve 10、lut 2、blend 1 | 调色专用控件 + 曲线抽屉；无位置/朝向条；见 §4.5 |

### 4.1 CAMERA（相机）

- `[可编辑]` 位置卡片将位置模式、坐标轴和三轴值放在一起；相对位置的基准轴分支提供原点与方向配置。兼容值按分支提示，切换不会隐式清除。
  - 条件：`absolute` 锁 world，原点不读取；`relative+world` 不读取方向源；`auto` 若 target/entity 同时非空会阻止提交；切 `position_mode/position_space` 的非零时刻缺三轴会要求补齐（同一 commit）。
- `[可编辑]` 朝向控制条（[`OrientationGroupEditor.vue`](../src/plugins/core.selection-properties/panels/OrientationGroupEditor.vue)）：`look_at`（none/player/coordinate/entity/block）、entity 的 part XYZ、yaw/pitch base（world/entity/line）、选择器、线起终点及冻结、yaw/pitch 锁。`orient=tangent` 的切线偏移依赖不满足时禁用但保留已有关键帧；优先级链压住的字段由 `unavailableReason` 标注。
- `[可编辑]` 六个 `motion_*` 通道在「运动」中显示摘要，由 `ModelEditorDrawer` 编辑。应用或重置各产生一次撤销；模型定义不支持关键帧。
- `[可编辑]` 调色字段由 `core.audio` 提供专用控件。合并控件在静态时显示，拆开的可动画标量在当前帧可用通用检查器编辑。曲线定义由曲线抽屉处理，见 §4.5。
- `[条件]` 合成/遮罩：16 个 `composite` 字段（`dest.*`、`source.*`、`mask_*`、`mask_shape`、`dimension`、`opacity`）目前都是通用行/通用值控件；没有注册专用合成矩形或遮罩几何控件。目录存在的 `CompositeRectEditor.vue`、`MaskGeometryEditor.vue` 未被任何插件 import/注册。`[未接线]`
- `[可编辑]` 「运动」中的镜头呼吸独立管理配置存在、启停与折叠。停用不删除参数；切换运动形态不会清除已有冲击衰减值。
- `[条件]` 修饰/接管：`modifier`（struct）+ `suppress_modifiers`（bool）目前通用 struct/布尔控件；`ModifierEditor.vue` 未接线。`[未接线]`
- `[条件]` 选择器 48 字段全部 animated，目前通用行；`SelectorEditor.vue` 未接线。`[未接线]`
- `[条件]` 5 个 `transition*` 字段在属性面板仍有通用行（`transition`、`transition_duration`、`transition_curve`、`transition_params`、`transition_interrupt`）；`features/camera/fieldSurface.ts` 的 `isHiddenRow/rowOmittingPredicate` 未被任何面板引用；`propertyRowsFor` 实测会返回这 5 行。`[需注意]` 同一语义也在“转场”tab 里按 A→B 交界编辑；两条入口并存。`transition_params`/`transition_curve` 是 struct，可用树/原文 JSON 编辑。
- `[只读]` 镜头检查面板（`camera.inspect`，抽屉）四个只读 tab：lane、连续性、玩家移动、回放；只定位片段/播放，不写文档。

### 4.2 LETTERBOX（遮幅）

- 字段只有 `aspect_ratio`、`opacity`；`aspect_ratio` 走专用控件（预设、几何示意、校验；写入静态 `object.setValue`），`opacity` 是通用滑杆/数值。
- `[可编辑]` `aspect_ratio` 有帧时改用通用检查器值控件：命中帧可改，未命中时只读采样。无帧时仍用静态专用控件。
- 最多一条遮幅轨：添加轨道时重复 LETTERBOX 被禁用（“遮幅轨道已存在”）。

### 4.3 AUDIO（音频）

- 13 个字段全部有专用控件（`core.audio/index.ts` + panel `Audio*Field`）：`sound`（类型感知的路径/注册表搜索 + 资源浏览）、`source`/`attenuation`/`position_mode`/`category`（枚举）、`file_loop`、`fade_in`/`fade_out`（合并包络控件，`fade_out` 行被字段面隐藏）、`volume/x/y/z/pitch`（滑杆+数值）。
- `[可编辑]` 只有 `volume/x/y/z` 是 animated；`pitch` 虽是数值但 value-only；`fade_in/fade_out` 也是 value-only，包络控件静态写入。
- `[条件]` 有帧的 `volume/x/y/z` 在右栏采用通用检查器值控件；完整节点和缓动编辑仍在效果面板。
- `[只读]` 顶部横幅提示片段间重叠、file_loop、fade 总长超过 duration（运行时整段跳过）、监听从 player 回落等；资源抽屉“检查”页签提供媒体检查。都不是字段编辑。
- `[只读]` 时间轴静音是会话值，只影响预览推送。

### 4.4 OVERLAY（叠加层与字幕分支）

- `[条件]` `layer_type` 缺省/非法回退 `fade` 字段面；显式非法值保留并给“运行时不建层”警告；字段面由 `appliesTo` + 有效层类型门控（`features/overlay/layers.ts`）：fade 19 行、image 14 行、subtitle 11 行。不属于当前层类型的字段不显示；未知路径只在属性面板只读诊断。
- `[可编辑]` 静态专用控件包括层类型及其预设、颜色、渐变、遮罩形态、混合模式、素材路径、字幕文本与层级。可动画标量有帧时改用通用值控件；需专用结构编辑的动画值保留效果面板入口。
- `[可编辑]` 便利预设面板嵌在层类型/画幅/层级控件内，按预设自身的 `apply/new/both` 模式支持“应用到当前片段”或“新建片段”（写 start/duration 与一组字段，一次提交/一次撤销）；`new/both` 预设也是 OVERLAY/LETTERBOX 的一个新建片段入口。
- `[只读]` `OverlayOrderList` 只列播放头处活跃层级、重叠/负层级警告，点击只选中片段，不改层级。
- `[可编辑]` 图片/视频的 `source.x/y/w/h`、布局 `x/y/anchor/scale`、`opacity` 等仍是通用值控件；字幕层文本与 `font_scale` 分开（文本专用、字号为通用）。
- 字幕面板（`subtitles` 抽屉）负责导入/编辑 cue、编译为 OVERLAY 字幕片段并批量写 `clip.setStart/setDuration` 与 `text`；这是一条独立入口，不是属性行。

### 4.5 ADJUST（调整层调色）与 CAMERA 调色

- `[可编辑]` 目录共 72 个字段，其中 59 个是可动画的调色通道，包括 LUT 强度和混合强度。其余为 10 个静态曲线定义、`lut`、`lut_input_gamma` 与 `blend_mode`。
- 专用控件（`core.audio` 注册）：矩阵、六色带、Lift/Gamma/Gain 三联、RGB 曲线摘要、LUT 路径（相对资源根、`.cube`、拒绝绝对路径/盘符/`..`）、LUT 输入 gamma、LUT 强度、曲线强度、blend_mode。
- `[条件]` 静态时合并行列隐藏其余通道；任一通道有帧则拆回逐通道，有帧行在属性面板指路效果面板。矩阵/色带/三联控件对“有帧但播放头不在帧上”的多格写入会拒绝并提示去效果面板（`commitPathValue`）。
- `[可编辑]` 曲线定义在“调色曲线”抽屉（10 条曲线共用点集编辑）；点集要求 0..1、x 严格递增、至少 2 点；写入静态曲线；强度可静态写，或在强度已有帧且播放头正好在帧上时写节点。
- `[只读]` 调色横幅提示：多 ADJUST 轨同实例覆盖、LUT 强度非 0 但没有 LUT 会被运行时强制为 0、同轨重叠只有第一个活跃片段参与调色。
- 无独立 ADJUST 面板；入口全部在片段属性和曲线抽屉/资源抽屉。

---

## 5. 时间轴、轨道与事件

### 5.1 轨道结构 / 会话值（与 clip selection 独立）

- `activeTrack` 是控制器/交互会话态（`TimelineController.activeTrackId`），点击轨道头或轨道行设置；它与 SelectionService 的 `clipKeys` **互相独立**：点轨道头不会选中/清空片段，工具栏“添加片段”作用于 activeTrack，属性面板作用于 clip selection（[`state.ts`](../src/plugins/core.timeline/state.ts)，约 :493）。
- `[可编辑]` 轨道名：双击轨道头或右键“重命名”，走 `timeline.renameTrack`；空名/重名被拒；第三方轨道（type 含 `:`）名字只读。
- `[可编辑]` 轨道顺序：拖动轨道头或右键上移/下移，`timeline.reorderTracks`。
- `[可编辑]` 删除轨道：右键删除，只允许空轨；有片段时禁用并说明“只能删除空轨道”。
- `[可编辑]` 添加轨道：内置七轨 + 目录发现的第三方类型；LETTERBOX 已存在时重复项禁用。
- `[会话]` 可见/锁定/静音三键只写 `documents.setTrackView` → `store.session.trackView`；默认 `{visible:true, locked:false, muted:false}`，不写文档、不参与撤销。锁定后仍可选中片段，但拖动/裁切/分割/删除/切换循环/顺排被控制器或菜单拒绝；静音只影响预览推送。
- `[只读]` 工具栏显示被隐藏轨道的恢复入口（“显示 X”）；它是会话可见性，不是文档结构。

### 5.2 新建/删除/切割片段

- `[条件]` 时间轴“添加片段”（工具栏、轨道头 +、空白/片段右键菜单）只允许 **CAMERA**；EVENT/MOD_EVENT 明确“不能凭空生成，请复制已有片段”；其他类型返回“需要该轨道的构造默认值”。因此 AUDIO/ADJUST/LETTERBOX/OVERLAY 不能从时间轴 + 新建。
- `[可编辑]` 其他片段来源：OVERLAY/LETTERBOX 预设面板的 new/both 模式；字幕面板编译（必要时 `timeline.addTrack` + `clip.add`）；模板面板当前只提供 CAMERA / OVERLAY / LETTERBOX 的 clip/track/script 模板；复制/粘贴（仅同类型轨道）、复制一份。事件片段不能新建，只能复制已有片段后编辑记录。AUDIO/ADJUST 在编辑器内没有新建入口，只能来自已有文档/外部数据或复制现有片段。
- `[可编辑]` 复制/剪切/粘贴/复制一份/分割/删除/波纹删除；分割要求距端点 ≥0.01s，被引用片段不能分割（`references > 0`），无限片段不能分割/波纹删除；删除被路径引用时先给受影响路径确认，再 `clip.removeWithReferences`/compound。

### 5.3 事件与模组事件

- EVENT 只有 `event`（event_record，mode=event）+ `event_type`（string，value）；MOD_EVENT 有 `mod_event`（event_record）+ `event_type` + `data`（struct，value）。
- `[可编辑]` 片段属性/效果面板只显示事件摘要与“在行为页打开”；记录编辑只在行为抽屉“事件”页签的 `EventRecordDetail`：时间、command、position（绝对 `{x,z}` / 相对 `{dx,dz}`）、id、event_type、data，以及删除/复制记录；最后一条记录删除被拒。`EventRecordEditor.vue` 文件仍在但未被引用，verify-11 明确断言了这一点。`[未接线]`
- `[可编辑]` 时间轴事件标记来自文档记录，拖动标记按局部时间移动记录（会写文档）；单击标记打开行为抽屉并选中记录，双击 seek 到记录时间，悬停卡只给“定位到事件/预览此事件”。与工具栏的会话标记（只存在 session、可加/移/删/清）是两套东西。事件标记层本身没有内容编辑菜单。

---

## 6. 其他专用入口（不属于右栏 clip 行）

脚本级 `script_structure`（13 段 / 50 字段）当前没有通用表单或属性页；它的可编辑面被拆到已有专用入口：轨道内片段在时间轴，`rules`/`rule_bindings`/`exit` 在行为抽屉，`paths` 在路径集合，模板可生成脚本/轨道/片段；独立 `clips[]` 未发现专用编辑表单（既有事件/路径按 id 引用它）。目录里有这些字段的 schema，不等于存在一个“脚本结构表单”。`[仅目录]`

| 入口 | 位置 / id | 当前实际可编辑内容 | 性质 |
|---|---|---|---|
| 时间轴 | `document.bottom` / `timeline.main` | 片段几何、轨道结构、复制粘贴分割、A-B、会话标记、事件标记拖动 | `[可编辑]`，部分 `[会话]` |
| 效果面板 | `document.left` / `clip.effects` | 有帧叶子的值/节点/段、缓动、烘焙、关闭动画、事件摘要 | `[可编辑]`，无新增属性 |
| 转场 | 右栏 tab `transition.panel` | A→B 叠化、参数过渡六通道、共存、curve；独立边界选择 | `[可编辑]`，不依赖 clip selection |
| 触发器 | 右栏 tab `behavior.triggers` | `meta.triggers` 列表/新建/删除/排序、id/type、时序/连续性、条件树、内置前置 | `[可编辑]` 草稿 + 应用；动作卡只读 |
| 行为抽屉 | `document.drawer` tab `behavior` | 规则/绑定/事件记录/事实的结构树与详情 | `[可编辑]`；事件记录唯一完整编辑器 |
| 资源抽屉 | `document.drawer` tab `resources` | 浏览资源并回填当前字段（audio/image/video/lut）、文件引用、媒体检查、语言只读 | `[条件]` 回填写 `object.setValue` |
| 调色曲线抽屉 | `document.drawer` tab `color-curves` | 10 条曲线点集、强度；曲线定义静态，强度可节点 | `[可编辑]` |
| 路径集合 | `document.drawer` / `paths.collection` | 路径 CRUD、几何/时间映射/生成器、给无 id 片段设 id、定位端点 | `[可编辑]`，路径状态独立 |
| 字幕 | `document.drawer` / `subtitles` | 导入/七步向导、cue 表、批量改时间/文本/删除/移动、编译为 OVERLAY 片段 | `[可编辑]` |
| 模板 | `document.drawer` / `templates` | 按 layer（clip/track/script）插入/应用模板、快捷效果、参数与 pose | `[可编辑]`，写文档命令 |
| 几何工具 | `document.drawer` / `geometry.tools` | 基准分辨率表单（`meta.base_resolution`，正整数字段，可清除回缺省）、素材检查、区域规划、相机合成矩形、Gizmo | `[可编辑]` |
| 镜头检查 | `document.drawer` / `camera.inspect` | 四个只读 tab；命令定位片段/播放 | `[只读]` |
| 脚本图 | 页面 `script-graph`（非右栏） | 节点/规则/绑定图、依赖、诊断、重命名 id | 独立页面能力，不在属性面板 |

`document.drawer` 默认是隐藏/收起的（默认高度 280，`visible:false`）；上述抽屉/面板不是右栏的一部分。

---

## 7. 结构化 `meta` 的实际可改性（重点）

脚本参数从目录读取 `meta` 字段。普通值使用目录校验；基准分辨率与监听点使用专用控件，屏幕层和其他没有专用编辑入口的结构值只读。

| 字段 | 目录类型 | 当前 UI / 实际能力 | 结论 |
|---|---|---|---|
| `id` | string | 检查器只读，提供「打开脚本页」入口，在脚本页走引用安全的重命名 | `[条件]` |
| `name` | string | meta 行文本；命令校验 1..上限 | `[可编辑]` |
| `author` / `description` / `dimension` | string | meta 行文本 | `[可编辑]` |
| `base_resolution` | object | 脚本参数的宽、高输入复用几何工具校验，可清回默认的 1920 × 1080 | `[可编辑]` |
| `listener` | enum | 专用卡：player/camera 下拉 + 当前文档的回落判定 + 跳 CAMERA/时间轴 | `[可编辑]` |
| `block_keyboard` / `block_mouse` / `block_mob_ai` / `pause_when_game_paused` / `interruptible` / `skippable` / `hold_at_end` / `macro_loop` | bool | 复选 | `[可编辑]` |
| `play_mode` / `macro_loop_mode` | enum | 下拉 | `[可编辑]` |
| `macro_loop_count` | int | 数字 | `[可编辑]`（可负） |
| `priority` | int | 数字 | `[可编辑]` |
| `skip_vote_ratio` | int，可省略 | 缺省显示为空。空输入被 `onNumber` 拒绝，可写 10 到 100 | `[条件]`，当前控件无法清回缺省 |
| `screen_layers` | object | 只读摘要和原值；不提供逐层写入 | `[只读]` |
| `triggers` | array | 脚本参数提供跳转；编辑仍在专用行为界面（§6） | `[条件]` |
| `trigger_poll_interval` | int，可省略 | 可写 1 到 600 tick。触发器时序区显示生效值的继承来源 | `[条件]`，当前控件无法清回缺省 |

补充事实：

- `meta.set` 命令层对已知 key 基本接受任意 JSON，只专门校验 `id`/`name`/`author`；界面在提交前先 `checkValue`，所以“命令能写”不等于“当前面板能写”。
- `base_resolution` 与 `screen_layers` 都是文档级对象；前者影响叠加图层的几何，后者不在检查器里写入。
- `meta.triggers` 的编辑不是“改一个数组字段”，而是触发器面板的列表/详情/草稿/应用；类型切换会保留不适用旧字段并放入“旧字段/不适用字段（只读）”，需点名清理。

---

## 8. 不要误认的“已实现”与当前限制清单

- `[条件]` 可动画标量在帧间只显示采样值；当前帧可以在右栏编辑。结构、事件记录和复杂缓动仍走各自入口。
- `[未接线]` 组合矩形、遮罩几何、修饰器与选择器等专用组件尚未注册；现有对应行仍使用通用控件。不包括已接入的镜头呼吸卡片。
- `[未接线]` `EventRecordEditor.vue` 未被任何面板挂载；完整事件记录编辑在行为抽屉里的 `EventRecordDetail.vue`。
- `[需注意]` `features/camera/fieldSurface.ts` 的 `transition*` 行隐藏谓词未接入；`propertyRowsFor` 实测返回 5 行，因此 CAMERA 的 5 个 transition 字段同时出现在属性通用行和转场 tab。这是当前事实，不是设计意图。
- `[仅目录/无 UI]` `screen_layers`、片段 `loop_count`/`loop_mode`、clip 名字/标签没有当前编辑入口。`clip.setLoop` 命令支持 loopCount/loopMode，但没有 UI 调用。
- `[条件]` `clip.id` 只能给“尚无 id”的片段赋值，不能改已有 id；`clip.setId(updateReferences:true)` 的引用同步只在路径面板入口发生。
- `[条件]` 时间轴只能新建 CAMERA 片段；OVERLAY/LETTERBOX 通过预设面板、字幕通过字幕面板、模板只覆盖 CAMERA/OVERLAY/LETTERBOX；AUDIO/ADJUST 没有编辑器内新建入口，事件只能复制已有片段。不要把“目录有七轨字段”当成“七轨都能 + 新建”。
- `[只读]` 多选、失效、外部域、事件摘要、诊断条、Demo 面板、镜头检查、层级预览、约束横幅都不是编辑入口。
- `[会话]` 轨道可见、锁定、静音、活动轨道、播放头、会话标记、检查器页签/折叠/滚动、模型草稿和自定义组合定义均不写入脚本；A–B 区间不在此列。

---

## 9. 当前已存在、应保留为独立入口的实际事实

这些入口不是因为“字段多”而独立，而是当前已经有独立交互状态/事务/校验，无法用单个 clip 行控件等价替代：

- **触发器 tab**：列表选中、草稿脏标记、应用/放弃、切换前“应用并切换/放弃/取消”、删除确认、移动缺 id 的身份确认、条件树递归、前置内置类型限制、诊断区；状态都独立于 clip selection。
- **转场 tab**：边界过滤/选中、叠化与参数过渡草稿、切类型确认、共存三选一、channel 级 mode/duration/curve、结构错误阻止应用；选中边界不是片段选择。
- **行为抽屉**：规则/绑定/事件记录/事实的结构树与详情；事件记录修改时间/command/position/id/event_type/data，最后一条删除被拒；它持有自己的 `RecordRef` 选择与 focus 请求。
- **调色曲线抽屉**：点集编辑、曲线选中、强度与曲线定义的联动；属性行只给摘要/强度入口。
- **资源抽屉**：填充目标、文件分类/引用/检查、语言只读矩阵；字段内的“浏览”只设置填充目标，不是内联文件选择器。
- **路径集合**：路径列表/条目/几何/时间/生成器/端点定位，以及无 id 片段的 `clip.setId`；与片段属性不是同一事务。
- **字幕面板**：导入向导、cue 表、批量移动/删除/改时间、编译；会写片段几何与文本，但操作单位是 cue/批量。
- **模板/几何/镜头检查**：分别以模板计划、几何计量/Gizmo、只读检查为单位，均不是单字段行编辑。

这些是后续重排右栏时必须保住的事实边界；本文不提出新的分类或原型。