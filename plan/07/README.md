# 07 位置 / 路径 / 曲线

## 目标

把 CAMERA 片段的位置、朝向、脚本级路径、11 种几何、时间映射、6 个 `motion_*` 数学模型和路径预览做成可落地编辑界面。所有便利能力都在编辑器侧完成，写盘只生产现有模组可读的 `objects` / `paths` 固定格式。

07 的核心不是“画一条曲线”，而是四件事同时成立：

1. 作者可以用组合编辑一次给 `position.x/y/z`、`yaw/pitch/roll` 在同一个时刻建帧、抓取当前值、批量改值；写盘仍是独立 `AnimObject` 关键帧，运行时不出现组。
2. 作者只需要给圆心、半径、起止角、平面，编辑器就生成可直接播放的圆形路径：贝塞尔分段或精确数学两种模式。
3. 路径条目只能从目标片段的位置节点里选相邻端点，几何参数来自 `curveTypes`，时间映射只影响推进、不改形状。
4. 预览在编辑器内本地采样 11 种几何，形状、控制多边形、端点、切线、`s(u)` 都可看；最终手感用现有 `editor.pushScript` / `editor.seek` 进游戏校验。

## 设计基线

07 按全新编辑器设计：页面结构、关键帧模型、表单和面板都由本轮的插件/布局/双面板合同定义。设计输入只有：

- 02 字段目录：字段路径、形态、默认值、`requires`、`section`、`group`。
- 03 文档模型：`clips` / `objects` / `paths`、`AnimObject`、`Selection`、`commit`、序列化剥离。
- 04 插件与布局：`pluginId`、`layout tree`、`PanelContext`、`document.drawer`。
- 05 面板槽位：`selection.properties`、`clip.effects`、`paths.collection` 的 slot 与选择定位。
- 06 双面板：属性面板 / 效果面板按 `keyframes.length > 0` 分区，`PanelMembershipMode` 默认 `leaf`。

07 新增的 `AuthoringGroup`、`PathShapeGenerator`、`PathPreviewKernel` 都是编辑器模块；它们消费上述合同，不反向定义运行时结构。

## 交付物

| 文档 | 交付内容 |
|---|---|
| [07-01-authoring-groups](07-01-authoring-groups.md) | 编辑组合层、默认窄组、配置扩展口、同刻建帧/抓取/批量改值/删除、单 commit |
| [07-02-position-group](07-02-position-group.md) | 位置字段、模式/空间/原点/冻结、base 三轴语义、切换对齐、双面板归属 |
| [07-03-point-source-forms](07-03-point-source-forms.md) | 点源五形态、`ref` 字符串、block 半径、选择器、结构 id、`look_at` 分支、偏移与冻结 |
| [07-04-orientation-group](07-04-orientation-group.md) | 朝向优先级、手动/tangent/look_at、锁、基准、线端点、切线偏移、角度语义 |
| [07-05-path-collection](07-05-path-collection.md) | `paths[]` 条目模型、端点并集/相邻/容差、默认 id、重复端点对、axes、引用完整性、`paths.collection` 面板 |
| [07-06-geometry-forms](07-06-geometry-forms.md) | 11 种几何参数表单、`curveTypes` 驱动、`line` 别名、控制点形态、`FREE/START/ENDPOINTS` 锚点 |
| [07-07-path-shape-generators](07-07-path-shape-generators.md) | 圆形/圆弧/椭圆生成器、Bezier 分段公式、精确 `arc/ellipse`、同刻三轴键、现有节点分段/替换、重新生成 diff |
| [07-08-timing-editor](07-08-timing-editor.md) | `linear/keyframes`、`points[{t,s}]`、端点 0/1、单调、同刻跳变、改 timing 不改 geometry |
| [07-09-math-model-editor](07-09-math-model-editor.md) | 6 个 `motion_*`、11 种模型、`chain/blend`、domain、深度/节点上限、回落警告 |
| [07-10-path-preview](07-10-path-preview.md) | 11 种本地采样、2D 投影、axes、端点、FREE 偏差、`s(u)` 折线、切线、现有 push/seek 游戏检查 |
| [07-11-r7-acceptance](07-11-r7-acceptance.md) | 组合同刻建帧、圆形两种模式、路径引用联动、双面板归属、预览 fixture、模组零改动 |
| `README.md` | 入口、顺序、面板职责、覆盖索引、完成定义 |

## 三条主线

### 组合编辑

`AuthoringGroup` 是编辑器内存里的组合定义，不是模组结构，不写脚本：

- 默认窄组：`position.xyz`、`orientation.ypr`。
- 配置扩展：`src/config/authoring-groups.json` 可以给默认组加成员，或新增默认组；改配置即可拓宽组合，不改内核代码。
- 自定义组合：作者在属性面板/效果面板里勾选任意叶子，组合定义存 `doc.authoring.groups`，保存时剥离。
- 组合操作只做四件事：同一时刻建帧、抓取当前值、批量改值、删除该时刻帧。一次 `commit`、一次撤销。
- 写盘仍是多条独立 `AnimObject` 关键帧；`position.x@2.35`、`position.y@2.35`、`position.z@2.35` 是三条记录，不是一个组帧。

### 路径与形状

`paths[]` 是脚本顶层数组，和 `clips` 并列：

- 条目：`{id, clip, from, to, axes, geometry, timing?}`。
- 端点只能从目标片段 `position.x/y/z` 的关键帧时间并集里下拉，A 与 B 必须相邻；容差 `1e-4`。
- 几何类型、参数、默认值、能力全部来自 `schema.curveTypes`；`line` 是 `linear` 的别名。
- 圆形路径由 `PathShapeGenerator` 生成：作者给圆心/半径/起止角/平面/模式，编辑器写多段 `bezier` 或一条/多条精确 `arc`；同时给三轴在同一时刻建帧。
- 生成器只写 `objects` 和 `paths`，不新增曲线类型、不修改 `PathCurveRegistry`、不修改 `PathEvaluator`。

### 预览

- 11 种注册几何在编辑器内实现只读参数采样：`linear`、`bezier`、`rational_bezier`、`arc`、`ellipse`、`bspline`、`nurbs`、`catmull_rom`、`hermite`、`clothoid`、`fourier`。
- 采样按参数 `u` 走，画形状、控制多边形、端点、采样点、切线示意；弧长/速度以运行时为准，预览不冒充运行时权威。
- 每种类型用模组固定测试向量做 golden fixture；编辑器采样与运行时同一参数定义对齐。
- 真游戏检查继续用现有 `editor.pushScript` / `editor.seek`；`WebEditorApi` 的消息清单保持不变。

## 面板与视图

| 内容 | 面板/位置 | 规则 |
|---|---|---|
| 位置静态字段、未打帧三轴、朝向静态字段、`motion_*` | `selection.properties` | 属性面板；`motion_*` 只有行内摘要 + 模型侧编辑面板，没有时钟 |
| 已有关键帧的位置/朝向叶子、已有关键帧的 step 字段 | `clip.effects` | 效果面板；默认 `leaf` 模式只列 `keyframes.length > 0` 的叶子；不出现“位置全字段组” |
| 路径集合、条目、几何、timing、预览 | `paths.collection` | 脚本级独立面板；默认 `document.drawer`，可停靠到任意 slot，不属于 `clip.effects` |
| 路径端点定位 | 共享 `Selection` → `clip.effects` 位置行 | 主时间轴不出现路径端点、路径标记或属性节点 |
| 主时间轴 | `timeline.main` | 只编排轨道/片段/标记；不画对象行、节点菱形或路径端点 |

## 固定格式

07 写入的内容只有：

```text
script
  clips[]
    objects[path] = AnimObject { value?, keyframes?, authoring? }
  paths?[]
    { id, clip, from, to, axes, geometry, timing? }
```

- `authoring`、`clipKey`、组合定义、预览 UI 状态不写盘。
- 不写版本号、总时长、片段级关键帧、片段级曲线。
- `geometry` 的 `type` 和参数必须能被 `PathCurveRegistry.create` 解析；未知类型/参数严格报错。
- `timing` 只接受 `linear` / `keyframes`。

## 实施顺序

1. 先落 `07-01` 的组合层与配置扩展口，再接 `07-02` / `07-04` 的位置、朝向组。
2. 用 `07-03` 把点源、方向源、`look_at` 载荷做成受约束表单；位置/朝向共用。
3. 接 `07-05` 的 `paths.collection` 面板和端点下拉；先把 `line` 条目跑通。
4. `07-06` 接 11 种几何参数表；`07-08` 接两种 timing。
5. `07-07` 落圆形路径生成器，先 Bezier 分段，再精确 `arc/ellipse`；同一提交写三轴键和 `paths[]`。
6. `07-09` 接 6 个 `motion_*` 的模型侧编辑面板。
7. `07-10` 接本地预览采样与 golden fixture；`07-11` 跑全矩阵和真游戏冒烟。

## 完成定义

- 作者点“同一时刻建帧”，三轴在同一精确时间各生成一条独立关键帧；改值、删除、撤销都不产生运行时组。
- 作者给圆心/半径/起止角，选 Bezier 或精确数学，编辑器写出 `script.validate` 通过的 `paths[]` 和位置关键帧。
- `bezier` 圆是分段逼近，`arc` 圆是精确圆弧；路径面板能识别锚点差异，端点移动时给正确提示。
- 11 种几何都能在路径面板选到、填参数、保存；未知类型/参数在本地 block。
- 预览能画形状、控制多边形、端点、`s(u)` 和切线；`FREE` 端点偏差可见；游戏检查走现有 push/seek。
- 属性面板/效果面板按 06 双面板归属；`paths.collection` 不混进 `clip.effects`；主时间轴无属性节点。
- 模组仓库 `.java` 零改动；编辑器只新增自己的 authoring/path/preview 模块。

## 覆盖索引

| 主题 | 07 落点 |
|---|---|
| 位置编辑器 | 07-02、07-01 |
| 点源表单 | 07-03 |
| 朝向编辑器 | 07-04 |
| 路径集合 | 07-05 |
| 路径几何 | 07-06 |
| 路径时间 | 07-08 |
| 数学模型 | 07-09 |
| 曲线预览 | 07-10 |
| 轮次入口 | 本 README、07-11 |
