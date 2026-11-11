# 08-02 六通道转场编辑器（CameraTransitionEditor）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：08-camera-transitions
> 关联：`01-CameraTrackSurface.md`、`04-CameraContinuityPanel.md`、`../05-timeline-workspace/README.md`、`../07-position-path-curves/README.md`

## 1. 职责

编辑 `transition`、`transition_duration`、`transition_curve`、`transition_params`、`transition_interrupt` 五个字段，并把六通道（position/yaw/pitch/roll/fov/zoom）各自的 `mode/duration/curve` 与窗口位置可视化。转场是 CAMERA 片段之间的 morph 语义，不是时间轴上的独立片段。

承载按[C17](../shared/effect-controls-workspace.md)：本编辑器是clip.effects中CAMERA转场组的专用组件，不另建CameraTrackPanel独占页。主轴仅显示合法转场窗口摘要并导航到此组，不显示属性节点；选择转场参数不隐藏其他已展开对象组。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 片段转场字段 | `J:script/schema/TrackSchemas.java:303-311` | `transition` enum `cut/morph`；`transition_duration` min 0 默认 0.5；`transition_curve` STRUCT；`transition_params` STRUCT；`transition_interrupt` enum `blend/snap` |
| 片段级读取 | `J:script/Clip.java — isMorph（107-110）`、`getTransitionDuration（111-122）`、`getTransitionSpec（123-134）`、`declaresTransition（135-141）` | `getTransitionSpec` 是解析后缓存 |
| 解析 | `J:script/ScriptParser.java — parseTransitionParams（858-895）`、`parseTransitionMode（896-905）`、`parseTransitionDuration（906-）` | 非法形态在解析期抛错；未声明通道保留 null/NaN |
| 参数形态 | `J:camera/transition/TransitionParams.java:18-58` | 每通道 `mode`（null=未声明）、`duration`（NaN=未声明）、`curve`（null=未声明） |
| 规格解析 | `J:camera/transition/TransitionSpec.java — resolve（63-68）`、`mode（69-73）`、`duration（74-78）`、`interrupt（79-83）`、`maxDuration（84-88）` | 未声明继承片段缺省；`maxDuration` = 非 CUT 最大 |
| 窗口 | `TransitionSpec.java — windowStart（89-93）`、`windowEnd（94-106）`、`covers（107-115）` | 窗口以交界为中心；`covers` 唯一判据 |
| 曲线实例化 | `TransitionSpec.java — instantiateCurves（116-126）`、`build（127-）` | 每通道曲线只实例化一次 |
| 混合 | `J:camera/transition/CameraTransitionLayer.java — blendInto（90-121）`、`isActive（122-126）`、`reset（127-）` | `frozenFrom/lastOutput`、曲线缓冲、C_POSITION..C_ZOOM |
| 角度/几何混合 | `J:camera/transition/TransitionBlend.java — axis（17）`、`linear（22）`、`angle（27）`、`zoom（33）` | angle 走最短路；zoom 走几何域 |
| 通道位序 | `J:camera/cover/CameraChannels.java:18-36` | `position/yaw/pitch/roll/fov/zoom`，与 `NAMES` 同序 |
| 打断 | `TransitionSpec.interrupt（79-83）`、`CameraTransitionLayer.blendInto` | `blend` 以中间态为新 A 侧、时长重算；`snap` 立即完成 |
| 校验缺口 | `J:script/ScriptValidator.java`（无 `checkTransition`；`TransitionMode` 仅 import 未用） | 实际拦截在 `parseTransitionParams`；编辑器不得假装有校验器 |
| 旧编辑器 | `EDITOR:src/operations.ts:28-39`（单值时长）、`:55-75`（对齐） | 无六通道、无 mode/curve |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 转场开关 | 通用表单里的 `transition` 文本 | ENUM `cut/morph` + 语义说明 |
| 时长 | 单值 `transition_duration` | 片段缺省 + 每通道覆盖 |
| 通道模式 | 无 | 六行 `BLEND/HOLD/CUT` |
| 曲线 | 无 | 每通道 `transition_curve`（复用 07 的曲线控件） |
| 打断 | 无 | `blend/snap` 二选一 + 行为说明 |
| 窗口 | 无 | 时间轴/局部示意图，宽度=该通道时长 |
| 非法形态 | 保存后才在解析期报错 | 提交前本地结构检查（只做形状/范围，不复制语义） |

### 3.2 拟新建（提案）

- `EDITOR:src/components/camera/TransitionEditor.vue`（提案）：五字段 + 六通道表。
- `EDITOR:src/components/camera/TransitionChannelRow.vue`（提案）：单通道 `mode/duration/curve`。
- `EDITOR:src/components/camera/TransitionWindowPreview.vue`（提案）：窗口示意（SVG/Canvas 均可，纯展示）。
- `EDITOR:src/lib/transitionShape.ts`（提案）：`transition_params` 的结构检查（通道名、mode 枚举、duration ≥ 0、curve 形状），**不**计算混合结果。

## 4. 输入输出与字段约束

**输入**：片段 JSON 的 `transition*` 字段；`CameraChannels.NAMES`（从 schema 或常量快照派生）；当前播放头时间（用于窗口示意）。

**输出**：对 `transition`/`transition_duration`/`transition_curve`/`transition_params.<channel>.<key>`/`transition_interrupt` 的编辑意图。

| 字段 | 约束 |
|---|---|
| `transition` | `cut` 或 `morph`；`cut` 时其余转场字段不生效（但保留值） |
| `transition_duration` | float ≥ 0，默认 0.5；是未声明通道的缺省 |
| `transition_curve` | STRUCT（数学模型）；未声明时用线性 |
| `transition_params` | 对象；键只能是六个通道名；每通道只允许 `mode/duration/curve` |
| `transition_params.<ch>.mode` | `BLEND`/`HOLD`/`CUT`（大小写按解析器；UI 显示大写，写盘用解析器接受的形式） |
| `transition_params.<ch>.duration` | float ≥ 0；`CUT` 通道不参与 `maxDuration` |
| `transition_params.<ch>.curve` | STRUCT；`CUT` 时可省略 |
| `transition_interrupt` | `blend`/`snap` |

**语义约束（必须显示，不可静默）**：

- 窗口以两个片段的交界为中心：`windowStart = boundary - duration/2`、`windowEnd = boundary + duration/2`（`TransitionSpec.java:89-106`）。
- `maxDuration` 取所有非 CUT 通道的最大时长（`:84-88`）；窗口宽度按该值。
- `HOLD` 在窗口内保持 A 侧值；`CUT` 在交界立即切 B 侧；`BLEND` 按曲线混合。
- `zoom` 在几何域混合（`TransitionBlend.zoom（33）`），不是线性。
- `blend` 打断：以当前中间态作为新 A 侧，时长重算；`snap`：立即完成（`CameraTransitionLayer.blendInto（90-121）`）。

## 5. 修改步骤

1. 在clip.effects当前CAMERA片段的转场组挂TransitionEditor；transition=cut时折叠不适用字段但保留原值，不新增独立转场片段/单属性页。
2. 六通道表从 `CameraChannels.NAMES` 生成行，不硬编码通道名/顺序。
3. 每行 `mode` 下拉：`BLEND/HOLD/CUT`；切换 `CUT` 时禁用 `duration/curve` 并标注「不参与 maxDuration」。
4. `duration` 数字框：空 = 继承 `transition_duration`；填值 = 覆盖。显示「继承/覆盖」状态。
5. `curve` 复用 07 的数学模型控件；未填 = 线性。
6. `TransitionWindowPreview`：以交界为中心画六条窗口条；宽度按各通道时长，颜色区分 mode；标注 `maxDuration`。
7. `transition_interrupt` 二选一 + 两行说明（引用 `blendInto` 的行为，不声称有校验器）。
8. `transitionShape.ts`：提交前检查键名/枚举/数值；错误定位到 `transition_params.<ch>.<key>`；**不**检查曲线内部语义（交给解析器）。
9. 在时间轴上（05 的片段块）显示转场窗口的浅色带，仅当 `transition=morph`；点击带跳到本编辑器。
10. 删除旧 `getTransitionDuration/getTransitionStart/applyTransitionAlignment` 对 CAMERA 的单一用法（迁移到六通道模型后不再写单值）。

## 6. 禁止修改

- 不得改 `TransitionSpec`/`TransitionBlend`/`CameraTransitionLayer` 的算法或窗口定义。
- 不得在前端实现 `covers()` 的第二套判据；示意只用于定位，不参与播放。
- 不得把 `transition_params` 写成数组或平铺键（必须是六通道对象）。
- 不得把 `HOLD` 解释成「暂停整个脚本」；它是通道级保持。
- 不得声称 `ScriptValidator` 会校验转场（它没有 `checkTransition`）。
- 不得新增通道或改变 `CameraChannels.NAMES` 顺序。

## 7. 两分支承载

- **WebUI**：六通道表 + 窗口示意 + 结构检查；提交走 02 命令。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同字段/同操作面板，经03公共端口消费真实转场，不只交合同；本轮 WebUI 对接 Forge/Fabric 正常，只有游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `ScriptParser.parseTransitionParams`；编辑器不产生第二种转场 JSON。

## 8. 前置

- 01：`schema.get` 的 `transition*` 字段元数据。
- 02：对象叶子路径 + 原子提交。
- 05：片段块与时间轴窗口带。
- 07：曲线/数学模型控件。

## 9. 验收

**正例**

- `transition=morph`、`transition_duration=0.5`，`yaw.mode=HOLD`、`yaw.duration=1.0`、`position.mode=BLEND`、`position.duration=0.25`：窗口示意显示两条不同宽度，`maxDuration=1.0`。
- `fov.mode=CUT`：该行 `duration/curve` 禁用，窗口示意不把它计入最大宽度。
- `transition_interrupt=snap`：说明文字指出「立即完成，不重算时长」；切到 `blend` 说明变为「以中间态为新 A 侧」。
- 未填 `yaw.duration`：显示「继承 0.5」，保存后 JSON 不出现 `yaw.duration`。
- 写 `transition_params.yaw.foo`：提交前报错并定位到 `yaw.foo`。
- 保存后重载：六通道值逐字段一致；游戏内转场表现与窗口示意一致（允许亚帧差异）。

**反例**

- 六通道名在 TS 里硬编码 → 失败。
- `CUT` 通道仍参与 `maxDuration` 计算 → 失败。
- 把 `HOLD` 显示成「暂停脚本」→ 失败。
- 前端自己判断「转场是否生效」并阻止保存（与 `covers()` 不一致）→ 失败。
- `transition_params` 写成 `[{...}]` → 失败。
- 声称「校验器已通过」但实际只有本地结构检查 → 失败（文案必须区分）。

## 10. 真实冒烟

1. 造两个相邻 CAMERA 片段：A 到 B，`transition=morph`，`yaw` 用 `HOLD` 0.8s，`position` 用 `BLEND` 0.3s，`fov` 用 `CUT`。
2. 编辑器：窗口示意宽度/颜色正确；保存后 `ScriptParser` 接受。
3. 游戏内播放：交界前 0.4s yaw 保持 A、position 开始混合、fov 在交界瞬间切换；与示意一致。
4. 把 `transition_interrupt` 改 `snap`，在转场中触发另一个实例/循环：转场立即完成，不出现中间态拖尾。
5. 写一个非法 `transition_params`（未知通道/负时长）：解析器拒绝；编辑器在提交前已提示。

## 11. 完成定义

- 五个转场字段 + 六通道表全部可编辑；未声明/继承/覆盖状态可见。
- 窗口示意与 `TransitionSpec` 的窗口定义一致；不实现第二套判据。
- `HOLD/CUT/BLEND` 与 `blend/snap` 的语义可读，文案与运行时行为一致。
- 非法形态在提交前被结构检查拦截；语义仍以解析器为准。
- 旧单值转场对齐逻辑已迁移/删除，不留双模型。
