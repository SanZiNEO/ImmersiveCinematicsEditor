# 07 位置 / 路径 / 曲线（Position, Paths, Curves）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（本页是实施指导；运行时已实现路径集合与位置/朝向求值，编辑器侧无对应界面）
> 合同归属：C09 路径与数值辅助
> 依赖：02（文档模型/身份/序列化/校验）、06（`clip.effects` 片段效果控件、`selection.properties` 快捷属性与统一值/节点控件）
> 下游：08（相机转场）、13（WebUI 验收）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

把位置与朝向的**点源模型**、脚本级 `paths[]` 集合的**端点绑定**、**11 种注册几何**、**两种时间映射**、**11 种数学模型**，以及它们的**预览**做成可编辑界面。

本轮的核心不是"画曲线"，而是：

1. 让编辑器只允许写出运行时能解析的形态（点源五形态、路径端点相邻、几何参数严格）。
2. 让"形状（geometry）/ 运动（timing）/ 数值模型（motion_*）"三件事分开表达，互不伪装。
3. 让离散（step：点源/参考系/轴集合）与连续（位置三轴、角度）在同一片段里各自成立。

一句话验收：**作者在编辑器里选两个相邻位置节点、选 `bezier` 填两个控制点、选 `x/z` 两轴、`timing=keyframes`，保存后运行时沿该路径运动且未选轴仍按自身属性插值；同一脚本在 Forge 真游戏里画面一致。**

## 二、为什么做

### 2.1 现状（运行时已实现，编辑器没有）

| 能力 | 运行时证据 | 编辑器现状 |
|---|---|---|
| 位置 = 点源 + 偏移，两种模式、两种空间 | `J:script/object/position/PositionSpec.java（18–37）`、`PositionEvaluator.evaluate（56–91）` | 无面板；旧 `PositionField.vue` 只编辑 `{dx,dy,dz}` |
| 点源五形态（player/coordinate/block/selector/structure） | `J:script/object/position/PointKinds.java — kindOf（38–45）`、`PointSourceSpec.positionOrigin（60–72）` | 无形态下拉 |
| 方向源（`facing_source` + 载荷） | `FacingSpec（15–42）`、`PositionEvaluator.frame（113–129）` | 无 |
| 朝向：手动/切线/注视 + 基准 + 锁 + 偏移 | `OrientationSpec（18–223）`、`OrientationEvaluator.evaluate（53–78）` | 旧 `DynamicForm.VISIBILITY_RULES` 手写显隐（`23–44`） |
| 脚本级 `paths[]`：目标片段 + 相邻端点 + axes + geometry + timing | `J:script/path/PathEntry.java（28–48）`、`PathCollectionParser.parseEntry（114–189）` | 无（旧 `clip.curve` 一份控制点） |
| 11 种注册几何 | `J:script/schema/PathCurveRegistry.java — static（62–218）` | 旧 `BezierCurveField.vue` 只支持一组控制点 |
| 两种时间映射 | `PathTiming.java（15–40）`、`KeyframeTiming（60–148）` | 无 |
| 11 种数学模型（`motion_*`） | `J:script/schema/MathModelRegistry.java（105–117）` | 无（`motion_*` 是 value-only STRUCT） |
| 路径与未选轴合成、切线 | `J:camera/source/ObjectCameraEvaluator.java — positionSpec（311–338）、tangent（447–457）` | 无 |

### 2.2 目标

1. 位置：`position_mode` / `position_space` / `position_origin` / `position_origin_x/y/z` / `position_origin_freeze` 与三轴联动，非法组合在 UI 上直接禁止（不是等服务端报错）。
2. 朝向：`yaw`/`pitch`/`roll`、`yaw_lock`/`pitch_lock`、`yaw_base`/`pitch_base` + 选择器 + 连线端点、`look_at` 五形态 + 载荷、`orient` + 偏移，按 `requires` 与优先级正确置灰。
3. 路径：只允许"目标片段 + 两个相邻位置节点"；`axes` 至少一项；`geometry` 按注册表参数表渲染；`timing` 两种。
4. 数学模型：`motion_*` 六个通道；按注册表参数表渲染；能表达 `chain`/`blend` 组合；对"未注册类型回落 linear"给出明确警告。
5. 预览：只画编辑器能确定的几何与采样点；不冒充运行时世界求值（点源/实体位置无法在编辑器里解析）。
6. 界面承载：位置/朝向/点源/`motion_*` 作为 CAMERA 片段同一效果控件（`clip.effects`）里的处理组，叶子成行、多组可同时展开；`paths[]` 与数学模型参数是脚本级专用工具，不塞进片段效果控件；主时间轴只选择片段，不出现位置/朝向属性行、节点或汇总标记。

### 2.3 非目标

- 不做世界内取景（飞控归 12/13）。
- 不做真实渲染预览（画面来自游戏，见共享合同 C06）。
- 不实现路径求值（运行时 `PathEvaluator` 是唯一实现）。
- 不做相机转场/morph（08）。

## 三、方案

从下一节开始是字段、模型与接口的技术合同；以下实现责任统一归本轮，不把其他几何/数学模型推迟到未定义轮次。

**界面承载与选择来源（与[片段效果控件工作区](../shared/effect-controls-workspace.md)同一合同）**：

- 位置、朝向、点源、`motion_*` 是 CAMERA 片段同一效果控件（`clip.effects`）中的处理组。选中片段即展开全部适用组，组内每个叶子一行（名称、值/未设置、模式、秒表、前后节点均在该行）；切换选中行只改高亮与编辑目标，不隐藏其他已展开组，也不重建片段上下文。
- "三轴联动"只是位置组内 `position.x/y/z` 三行同时可见的布局加一条显式的"三轴同时打帧"命令，**不是**只显示三轴的独占面板，不得替换掉该片段的其他组，也不改变三轴各自独立的时间序列。
- `paths[]`、几何参数、`timing`、数学模型参数是脚本级内容：由文档级路径/曲线工具页编辑（05 布局树中可停靠的独立面板），不伪装成片段效果控件组；选中路径条目或其端点时，经共享 Selection 在效果控件中高亮对应位置组与属性节点。
- 快捷属性（`selection.properties`）只复用同一 Selection、同一值控件与同一命令显示当前项摘要并可定位回效果控件，没有自己的关键帧时间轴；主时间轴负责片段选择与编排，不显示属性节点或关键帧汇总。

## 四、技术细节

### 3.1 位置与朝向的"模式 → 可见字段"表

位置（CAMERA 轨；字段来自 `J:script/schema/TrackSchemas.java（113–156）`）：

| `position_mode` | `position_space` | 可见/必填 | 隐藏/禁止 |
|---|---|---|---|
| `absolute` | `world`（唯一合法） | `position.x/y/z` | `position_origin`、`position_origin_x/y/z`、`position_origin_freeze`、`facing_*` |
| `relative` | `world` | `position_origin`（可空 = 玩家激活位置）、`position_origin_x/y/z`（仅 coordinate）、`position_origin_freeze`（仅实体选择器）、`position.x/y/z` | `facing_*` |
| `relative` | `base` | 上述 + `facing_source` + 按来源显示 `facing_target*` / `facing_entity` + `facing_target_freeze` | — |

依据：`ObjectValidator.checkCamera（500–560）`（`absolute` 要求 origin 为空且 space≠base）、`PointSourceSpec.positionOrigin（60–72）`（空 origin 在 `world` = 玩家激活位置，在 `base` = 隐式 `@p`）。

朝向（`TrackSchemas（159–249）`）：

| 模式 | 可见 | 隐藏/置灰 |
|---|---|---|
| `orient=manual` | `yaw`/`pitch`/`roll`、`yaw_lock`/`pitch_lock`、`yaw_base`/`pitch_base` + 对应载荷 | `yaw_offset`/`pitch_offset`（`requires=orient=tangent`） |
| `orient=tangent` | 上述 + `yaw_offset`/`pitch_offset` | — |
| `look_at != none` | 上述 + `look_at_*` 载荷 | 手动 `yaw`/`pitch` 不参与（`OrientationEvaluator 62–75`）；`yaw_offset` 也不参与 |

**优先级必须显示**（否则作者会以为偏移生效）：`look_at` > `tangent` > 手动（`OrientationEvaluator.evaluate 62–77`）。

### 3.2 路径条目的作者形态

```text
路径列表（脚本级）
┌ p1  clip=c1  端点 0.0 → 3.0  轴 x,z  几何 bezier   时间 linear   [编辑] [删除]
│ p2  clip=c1  端点 3.0 → 6.0  轴 x,y,z 几何 arc      时间 keyframes [编辑] [删除]
└ [+ 添加路径]（先选目标片段 → 再选两个相邻节点）
```

- 端点下拉的选项 = 目标片段 `position.x/y/z` 关键帧时间的并集（去重升序）：`PathCollectionParser.positionNodeTimes（336–374）`。
- 端点 B 的选项 = 端点 A 的**下一个**节点（相邻性在并集内判定，`parseEntry 160–165`）。
- 同一片段不能有重复端点对（`parseEntry 178–186`）；部分重叠合法。
- `axes` 至少一项；缺省三轴（`parseAxes 200–225`、`PathEntry` 构造校验 41–43）。

### 3.3 形状 / 运动 / 模型的分离

| 概念 | 载体 | 编辑入口 | 运行期语义 |
|---|---|---|---|
| 形状 | `paths[].geometry` | 07-PathGeometryForms | `geometry(s)`，`s = timing(t) * L`（`PathBindingResolver.progress 107–120`、`PathEvaluator.position 27–34`） |
| 运动 | `paths[].timing` | 07-PathTimingEditor | `u → s ∈ [0,1]` 单调（`PathTiming 15–40`） |
| 数值模型 | `objects.motion_*`（value-only STRUCT） | 07-MathModelEditor | 相机参数运动模型（`MathModelRegistry` + `ClipModifier`/motion 消费方） |
| 轴选择 | `paths[].axes` | 07-PathCollectionEditor | 选中的轴取路径，未选轴取采样属性（`ObjectCameraEvaluator.positionSpec 324–336`） |

**禁止**用"插入位置关键帧 + 复用旧控制点"伪造保形（`MOD:plans/0.3.6/Z-editor/object-model.md §3.6`）。形状只由 `geometry` 决定；改形状不改 `timing`，反之亦然。

### 3.4 离散与连续

| 类别 | 例子 | 编辑方式 |
|---|---|---|
| 连续 | `position.x/y/z`、`yaw/pitch/roll`、`fov/zoom`、`opacity` | 关键帧 + `interp`（linear/angle/geometric） |
| 离散（step） | `position_mode`、`position_space`、`position_origin`、`position_origin_freeze`、`facing_source`、`look_at`、`yaw_base`、`pitch_base`、`orient`（value-only） | 值/关键帧 + `interp=step`；切换点必须与三轴位置帧对齐（`ObjectValidator.checkSwitches 602–636`） |
| 轴集合 | `paths[].axes` | 三个复选框（`x/y/z`），不是关键帧 |
| 几何参数 | `control_points` 等 | 值（`paths[]` 条目内，不在 `objects`） |

### 3.5 本轮文件与职责

| 文件 | 职责 | 承载 |
|---|---|---|
| [07-PositionEditor.md](07-PositionEditor.md) | 位置模式/空间/原点/冻结 + 三轴；切换对齐 | `clip.effects` 的位置组（组渲染器，非独立页） |
| [07-PointSourceForms.md](07-PointSourceForms.md) | 点源五形态表单 + `EntityPoint` 百分比 + 偏移空间 | 同上，位置组的子表单 |
| [07-OrientationEditor.md](07-OrientationEditor.md) | 朝向三轴/锁/基准/注视/模式/偏移与优先级 | `clip.effects` 的朝向组，可与位置组同时展开 |
| [07-PathCollectionEditor.md](07-PathCollectionEditor.md) | 脚本级 `paths[]` 列表与端点绑定 | 文档级路径面板，不在片段效果控件内 |
| [07-PathGeometryForms.md](07-PathGeometryForms.md) | 11 种注册几何的参数表单与能力标记 | 路径条目内的几何子表单 |
| [07-PathTimingEditor.md](07-PathTimingEditor.md) | `timing` 两种形态 | 路径条目内的时间映射子表单 |
| [07-MathModelEditor.md](07-MathModelEditor.md) | 11 种数学模型 + `chain`/`blend` 组合 | `clip.effects` 的运动组（`motion_*` 为 value-only 结构，无节点） |
| [07-CurvePathPreview.md](07-CurvePathPreview.md) | 几何/采样点/切线预览与 2 轴限制说明 | 路径面板内的只读视图 |

### 3.6 运行时类 → 归属

| 运行时类（`J:`） | 归属 | 说明 |
|---|---|---|
| `script/object/position/PositionSpec` / `PositionEvaluator` | 07-PositionEditor 的语义镜像 | 编辑器只做形态与组合校验，不求值 |
| `script/object/position/PointSourceSpec` / `PointKinds` / `EntityPoint` / `PointOffset` | 07-PointSourceForms | 形态词汇表与百分比契约 |
| `script/object/position/FacingSpec` | 07-PositionEditor | 方向源 |
| `script/object/position/OrientationSpec` / `OrientationEvaluator` / `LookAtSpec` / `BaseSource` / `Orient` | 07-OrientationEditor | 优先级与 `requires` |
| `script/object/position/FreezeStore` / `WorldContext` / `PointFrame` | **引擎内部，只依赖** | 冻结桶与世界查询；编辑器不实现 |
| `script/object/position/SampledPathTangent` / `PathTangent` | **引擎内部，只依赖** | 中心差分切线；编辑器不复制 |
| `script/path/PathEntry` / `PathCollection` / `PathCollectionParser` | 07-PathCollectionEditor | 端点/相邻/重复判定 |
| `script/path/PathBindingResolver` / `PathCollectionSource` / `PathBinding` | **引擎内部，只依赖** | 运行期解析与选轴合并 |
| `math/path/*`（11 种 Spec + `PathEvaluator` + `ArcLengthTable` + `AxisConstraint`） | 07-PathGeometryForms 的只读语义 + 07-CurvePathPreview 的预览实现参考 | 编辑器不实现弧长/求值；预览可用简化采样 |
| `script/schema/PathCurveRegistry` | 07-PathGeometryForms 的数据源（经 `schema.get` 的 `curveTypes`） | 不硬编码参数表 |
| `script/schema/MathModelRegistry` | 07-MathModelEditor 的数据源（经 `schema.get` 的 `models`） | 同上 |
| `math/*`（`Curves`/`SpringModel`/`InertiaModel`/`ExponentialSmoothModel`/`ChainModel`/`BlendModel`/`CubicBezierCurve`/`ValueDomain`） | **引擎内部，只依赖** | 模型求值在运行时；编辑器只编辑定义 |

### 3.7 两分支承载

| 载体 | 承载 | 现状 |
|---|---|---|
| WebUI | 主实现：`clip.effects` 的位置/朝向/运动组（组渲染器）+ 文档级路径/曲线面板；`components/objects/` + `model/` | 无路径/位置面板；旧 `PositionField.vue`/`BezierCurveField.vue` |
| 游戏内 Forge 1.20.1 | 同一契约的 AUI 面板（提案） | 仅骨架（`INGAME:` 32 文件） |

本轮可先以位置三轴/点源/line/linear建立垂直片段，再完成所有已注册几何、两种timing与数学模型并清零；不以line/bezier能跑作为整轮完成。WebUI→Forge/Fabric均正常验收，游戏内Forge复用同合同是14迁移要求，仅游戏内Fabric+AUI适配暂缓。两载体都不得把位置/朝向组做成"只显示三轴"的独占页，也不得把 `paths[]` 条目塞进片段效果控件。

### 3.8 轮次出口

1. 八个任务文件落地。
2. 编辑器不再有 `clip.curve` 概念（旧 `types.ts 151` 删除）。
3. `paths[]` 只能通过下拉选端点，不能手输时间。
4. `geometry` 参数表来自 `curveTypes`，`models` 参数表来自 `models`。
5. 各文件正反例通过。
6. Forge 真游戏冒烟：`line` 与 `bezier` 两条路径可见运动；未选轴独立插值；`timing=keyframes` 有可观察的加速段。
7. 位置与朝向组在同一 CAMERA 片段的效果控件内可同时展开；选中其中一行不隐藏另一组，也不重建片段上下文。
8. 主时间轴只显示/选择片段，不出现位置/朝向属性行、节点或关键帧汇总；路径端点定位经共享 Selection 落在效果控件行上。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 继续用片段级 `clip.curve` | 一份控制点套所有段 | 不同段不能不同形状；同片段不能多条路径；插入关键帧会改变其余段 | 脚本级 `paths[]`（运行时已实现） |
| 路径端点用"第 N 个关键帧" | 下标引用 | 插入/删除后静默指错；与运行时（时间引用）不一致 | 时间 + 相邻性 |
| 端点自由输入时间 | 数字输入框 | 极易写出未命中节点的时间 → 加载期报错 | 下拉选节点时间 |
| 把 timing 写进 geometry | 一个对象里既有形状又有速度 | 改速度会改形状语义；无法表达"直线也能加速" | 分离（运行时已分离） |
| 编辑器本地求值路径 | 复刻 `PathEvaluator`/弧长表 | 双实现漂移；3D 弧长与解析弧长难对齐 | 只画简化预览，真值来自游戏 |
| 2 轴路径承诺 3D 匀速 | 用 3D 弧长参数化 2 轴 | 未选轴由自身属性插值，3D 速度不可控 | 2 轴只保证平面内 2D 弧长（`MOD:plans/0.3.6/I-script-core/path-collection.md §3.3`） |
| 数学模型用自由 JSON | 不做表单 | 参数名拼错被静默忽略（`MathModelRegistry.normalizeParams 243–248`），作者以为生效 | 按 `models` 参数表渲染 |
| 模型未知类型报错 | 像路径一样严格 | 运行时是"回落 linear 不阻断"（`MathModelRegistry.create 201–205`），编辑器报错会造成"编辑器拒绝、游戏能跑" | 显示"已回落"警告，不阻断 |

**本方案的缺点**：

- 点源形态是自由字符串（`ref` 无枚举），编辑器必须自己约束；schema 不表达形态，属于表达力缺口。
- 路径端点下拉依赖"位置节点时间并集"，作者若只想在 `position.x` 上打帧，端点仍按三轴并集算，可能觉得选项比预期多。
- 11 种几何的参数差异大（角度制/世界单位/权重/节点向量），表单校验只能覆盖结构，语义仍靠服务端。
- 数学模型"未知参数忽略"与路径"未知参数报错"两套口径，UI 必须分别提示，容易让作者困惑。
- 预览不是真值：实体/结构/方块位置在编辑器里无法解析，预览只能画"几何形状 + 采样点"，不能画真实世界轨迹。

## 六、实现结果

状态：未实现。

| 设计目标 | 运行时 | 编辑器 |
|---|---|---|
| 点源五形态 + 偏移空间 | 已实现（`PointSourceSpec`、`PositionEvaluator`） | 未实现 |
| 方向源（auto/world/entity/line） | 已实现（`PositionEvaluator.frame`） | 未实现 |
| 朝向优先级（look_at > tangent > manual） | 已实现（`OrientationEvaluator`） | 未实现（只有硬编码显隐） |
| 脚本级路径集合（端点相邻） | 已实现（`PathCollectionParser`，I4-8 关闭） | 未实现 |
| 11 种几何 | 已实现（`PathCurveRegistry`） | 未实现（只有旧一组控制点） |
| 两种 timing | 已实现（`PathTiming`） | 未实现 |
| 11 种数学模型 | 已实现（`MathModelRegistry`） | 未实现 |
| 路径与未选轴合成 | 已实现（`ObjectCameraEvaluator.positionSpec`） | 未实现 |
| 预览 | 游戏画面 | 未实现（旧 `Preview.vue` 只显示视频流） |
