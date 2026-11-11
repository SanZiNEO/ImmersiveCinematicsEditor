# 12-09 曲线工具（形状生成 / 控制点拾取 / 等距重采样）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：07（`paths[]` 编辑模型、`curveTypes` 消费）；字段契约：`MOD:docs/SCRIPT_FORMAT.md:700–715`。
> 边界：**路径条目的选择、端点绑定、参数表单归 07**；本文件只做「工具」：给一条已存在的路径生成形状、在预览上拾取控制点、把 `timing` 重采样。

## 1. 职责

提供三类操作：
1. **形状预设**：直线 / 圆弧 / 椭圆弧 / 抛物 / S 形 → 生成 `geometry`。
2. **控制点拾取**：在预览上点选世界点，转成 `{x,y,z}` 或 `{dx,dy,dz}`。
3. **等距重采样**：按弧长均匀采样，写出 `timing.type="keyframes"` 的 `[{t,s}]`。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/components/fields/BezierCurveField.vue:26–41` | 只能增删/编辑控制点三轴；无形状、无拾取、无预览 |
| `EDITOR:src/components/fields/BezierCurveField.vue:69` | 提示「dx/dy/dz = 相对段起点；x/y/z = 绝对坐标」——与运行时一致 |
| `MOD:docs/SCRIPT_FORMAT.md:700–715` | `paths[]`：`id/clip/from/to/axes/geometry/timing`；`timing.points = [{t,s}]` |
| `MOD:docs/SCRIPT_FORMAT.md:714` | 示例把 `control_points` 写成 `[[0,0],[4,8],[10,10]]`（**与实现冲突**，见 §2.1） |
| `J:script/schema/PathCurveRegistry.java:408–440` | 控制点必须恰好 `{x,y,z}` 或 `{dx,dy,dz}`；数组 → `PathCurveException` |
| J:script/schema/PathCurveRegistry.java — 注册初始化（62–218） | 11种注册几何：linear/bezier/rational_bezier/arc/ellipse/bspline/nurbs/catmull_rom/hermite/clothoid/fourier；实际能力以curveTypes为准 |
| `J:script/schema/SchemaExporter.java:102–136` | `curveTypes` 导出 `capabilities` + `params`（含 `kind/default/required/enumValues/doc`） |
| J:script/path/PathCollectionParser.java — parseAxes（193–224） | axes允许x/y/z非空子集，至少一项；单轴合法，不按旧设计至少2轴误拒绝；多轴速度说明按实际消费者区分 |

### 2.1 事实核查冲突（必须记录，不得照抄文档示例）

`MOD:docs/SCRIPT_FORMAT.md:714` 的 `control_points: [[0,0],[4,8],[10,10]]` 是**数组**形态；而 `J:script/schema/PathCurveRegistry.java — readPoint（408–425）` 要求元素是恰好 `{x,y,z}` 或恰好 `{dx,dy,dz}` 的对象，`readPointList（427–440）` 也只接受对象数组。数组元素会抛「需要控制点对象」。

**裁决**：编辑器只生成对象形态（`{dx,dy,dz}` 优先）；文档示例视为笔误，本轮不改主模组文档（不可改），但在 `shared/baseline-and-evidence.md` 的冲突表口径下记录。

## 3. 拟新建（提案）

| 文件 | 导出 | 说明 |
|---|---|---|
| `EDITOR:src/curves/shapes.ts` | `arcShape()`、`ellipseShape()`、`parabolaShape()`、`sShape()`、`lineShape()` | 由端点 + 参数生成 `geometry` |
| `EDITOR:src/curves/pick.ts` | `pickWorldPoint(preview, cameraHint)` | 预览点 → 世界点（尽力而为，见 4.3） |
| `EDITOR:src/curves/resample.ts` | `resampleByArcLength(geometry, axes, n)` | 弧长等距采样 → `timing.points` |
| `EDITOR:src/curves/CurveToolPanel.vue` | 组件 | 工具面板（07 的路径页里嵌入） |
| `EDITOR:src/curves/PathOverlay.vue` | 组件 | 预览上的路径折线/控制点可视化 |

## 4. 输入 / 输出 / 字段约束

### 4.1 形状生成

输入：端点 A/B（由 `paths[].from/to` 对应的位置节点值给出）、形状参数（半径/拱高/张力）、`axes`。
输出：`geometry: { type, control_points: Point[] }`，`Point = {dx,dy,dz}`（相对 A）或 `{x,y,z}`。

| 形状 | 生成规则 | 备注 |
|---|---|---|
| `line` | `{type:"line"}` | 无控制点 |
| `arc` | `{type:"arc", center, radius, start_angle, end_angle, normal, reference_axis}` | 用运行时 `arc` 参数（`J:…PathCurveRegistry.java:75–96`），**不**转成 bezier |
| `ellipse` | `{type:"ellipse", center, semi_major, semi_minor, rotation, start_angle, end_angle, normal, reference_axis}` | 同上（97–123） |
| `bezier`（抛物/S 形） | 两个内部点 `{dx,dy,dz}` | 抛物 = 中点抬高；S 形 = 两侧反向偏移 |
| 其他注册曲线 | 按 `curveTypes[type].params` 渲染表单，值原样透传 | 编辑器不硬编码参数名 |

约束：

- `axes` 只有 x/z 时，控制点的 `dy=0`（不生成第三轴变化）；3 轴时按参数给 y。
- 控制点数量：`bezier` 固定 2；`rational_bezier` 1 或 2；`bspline/nurbs/catmull_rom/hermite` 按参数（不含端点）。
- 不写 `from/to`（07 负责）；不改变 `timing`（除 4.4）。

### 4.2 预览可视化

- `PathOverlay` 画折线（采样 64 段）与端点/控制点手柄；只读展示 + 手柄拖拽改控制点。
- 采样用编辑器侧实现的同一曲线数学？**不**——编辑器只做**近似折线**用于显示，明确标注「显示近似，实际以运行时为准」；不得把近似结果写回脚本。

### 4.3 控制点拾取（尽力而为）

- 预览是游戏画面，没有深度缓冲与相机矩阵。拾取只能：
  1. 若当前片段是 `position_mode=absolute` 且 `look_at=none`，用「屏幕射线 + 已知 y 平面」求交（需要相机 yaw/pitch/fov，可从当前采样姿态取）；
  2. 否则退化为「在数值框里输入」。
- UI 必须显示「拾取基于当前视角与固定高度，结果需目视确认」；不允许静默写入错误点。

### 4.4 等距重采样

- 输入：`geometry`、`axes`、采样数 `n`（8–64）。
- 过程：按 `geometry` 求弧长（编辑器侧数值积分），等分 `s∈[0,1]`，得到 `t = s`（线性时间）→ 输出 `timing: {type:"keyframes", points:[{t,s}]}`。
- 约束：`points` 两端必须 `t=0,s=0` 与 `t=1,s=1`；`t` 单调不减；至少 2 点（`MOD:docs/SCRIPT_FORMAT.md:710`）。
- 用途：让「匀速运动」在弧长上均匀，而不是参数均匀（3 轴时才有意义；2 轴仅该平面）。
- 反例：把重采样结果写成位置关键帧（`objects.position.*`）——禁止，那会破坏路径语义。

## 5. 修改步骤

1. 新建 `shapes.ts`：先实现 `line`/`bezier`（抛物、S 形），再按需接 `arc`/`ellipse`（参数直接透传）。
2. resample.ts实现明确重采样；人工使用直线/圆弧调整采样参数、保存并游戏观察，不新增单测或测试脚本。
3. 新建 `CurveToolPanel.vue`，由 07 的路径页嵌入；不独立开抽屉 tab。
4. 新建 `PathOverlay.vue`，挂到 `Preview.vue` 的 `.canvas-wrap`；只读折线 + 手柄。
5. 新建 `pick.ts`：射线-平面求交；失败时返回 `null` 并提示改用数值输入。
6. 替换 `BezierCurveField.vue` 的「只给三轴输入」为「形状下拉 + 控制点表 + 拾取按钮」，但**保留**其作为 07 路径页里的控件（不新建第二份）。

## 6. 禁止修改

- 不实现运行时曲线求值（弧长 LUT、二阶导、周期）——只做显示近似与重采样。
- 不新增曲线类型；类型列表来自 `schema.curveTypes`。
- 不把 `control_points` 写成数组（见 §2.1）。
- 不改 `paths[]` 的 `from/to/axes`（07）。
- 不把编辑器近似结果写回脚本。

## 7. 两分支承载

共享形状/拾取/重采样语义。游戏内Forge输入事件和交互层由14实证适配，可提供等价坐标输入/拾取操作但不得无依据关闭功能；没有证据不能宣称AUI无hover或鼠标精度不足。WebUI跨Forge/Fabric正常，仅游戏内Fabric+AUI适配暂缓。

## 8. 前置

07 的路径页与端点绑定；01 的 `curveTypes` 快照；03 的预览画面尺寸；06 的节点写入（若工具改 `objects`）。

## 9. 验收

**正例**

1. 选一段 x/z 平面路径 → 形状「抛物」→ 生成 `{type:"bezier", control_points:[{dx,dy:0,dz},…]}`；播放呈拱形。
2. 选「圆弧」→ 生成 `{type:"arc", center, radius, start_angle, end_angle, …}`，参数与 `curveTypes.arc.params` 一致；`script.validate` 通过。
3. 等距重采样 n=16 → `timing.points` 16 点，首尾 0/1，`t` 单调不减；播放速度均匀。
4. 拾取失败（片段有 look_at）→ 提示「当前视角不支持拾取」，不写入。
5. 3 轴路径重采样 → 3D 匀速；2 轴路径 → 仅平面内匀速（UI 标注）。

**反例**

1. 生成数组形态控制点 → 不通过（parser 抛错）。
2. 重采样结果写成位置关键帧 → 不通过。
3. 编辑器自算弧长并声称与运行时一致 → 不通过（只做显示近似）。
4. 新增 `curveTypes` 里没有的类型 → 不通过。

**真实冒烟**：对一段真实路径分别应用「抛物」「圆弧」「重采样」，保存 → 游戏内播放确认形状与速度；记录 `script.validate`。

## 10. 完成定义

- 形状生成、拾取、重采样三块落地；控制点形态与运行时一致。
- 预览可视化明确标注「近似」。
- 与 07 的边界清晰：工具在 07 的页面里，不另立路径编辑。
- 控制点对象形态与parser一致，冲突已纳入shared/baseline-and-evidence；显示近似与真实游戏结果明确区分，不留待回写的未分配事项。
