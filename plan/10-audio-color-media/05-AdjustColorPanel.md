# 10-05 调色面板（AdjustColorPanel）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：10-audio-color-media
> 关联：`06-LutWorkbench.md`、`../08-camera-transitions/01-CameraTrackSurface.md`、`../06-async-objects/README.md`

## 1. 职责

编辑 ADJUST 片段的 59 通道 + 10 曲线 + `blend_mode`，按 `section` 分组呈现，并说明「lane 级 vs master 链」的归属。LUT 的路径/伽马/强度在 06；本文件负责通道/曲线/混合。

承载按[C17](../shared/effect-controls-workspace.md)：AdjustColorPanel是clip.effects中当前ADJUST片段调色组的内部组件，不新增独占调色页。多个section/通道可同时展开并共享局部标尺，ANIMATED通道有各自节点；VALUE曲线只编辑其原STRUCT。快捷属性共用同一字段命令；主轴不画调色节点。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| ADJUST 对象表 | `J:script/schema/TrackSchemas.java — adjustObjects（459-475）` | 59 通道循环 + 10 曲线 + lut/lut_input_gamma/blend_mode |
| 通道名单 | `TrackSchemas.java — ADJUST_CHANNELS（492-504）` | 59 = CAMERA 57 + `lut_strength` + `blend_amount` |
| 通道默认/范围 | `TrackSchemas.java — DEFAULT_ONE_CHANNELS（507-511）`、`ZERO_ONE_CHANNELS（514-518）`、`channelDefault（520-522）`、`channelMin（524-529）`、`channelMax（531-533）` | 强度默认 1；exposure [-5,5]；其余 [-1,1] 或 [0,1] |
| 曲线 | `TrackSchemas.java:466-469` | 10 个 `*_curve` STRUCT |
| LUT 字段 | `TrackSchemas.java:470-473` | `lut`、`lut_input_gamma`、`blend_mode` |
| 驱动 | `J:script/AdjustTrackPlayer.java — onRenderFrame（51-67）`、`onStop（68-75）`、`onScriptReplaced（76-81）`、`findActiveClip（82-）` | `ColorAdjustSampler.sampleObjects` → `MasterColorAdjust.publish` |
| 采样 | `J:script/ColorAdjustSampler.java — sampleObjects（87-143）`、`CurveCache（190-214）`、`ParsedCurves（215-）` | 59 通道 + 曲线 |
| 参数 | `J:client/post/ColorAdjustParams.java — record（21-98）`、`BLEND_*（99-103）`、`blendModeCode（109-122）`、`IDENTITY（123-）`、`isIdentity（142-）` | |
| master 链 | `J:client/post/MasterColorAdjust.java — publish（45-62）`、`publishRuleLayer（63-78）`、`beginFrame（89-98）`、`consume（99-124）`、`clear（125-）` | 按实例顺序叠层；规则层紧随 |
| pass | `J:client/post/ColorAdjustPass.java — render（117-182）`、`applyTo（183-218）`、`pass（219-322）` | 逐层链式；src/dst 不可同纹理；alpha 直通 |
| 挂点 | `J:mixin/GameRendererMixin.java:67`（`beginFrame`）、`:136`（`render`） | postEffect 之后 |
| 曲线 | `J:script/ColorCurve.java — Point（18）`、`LUT_SIZE（21）`、`identityLut（49-）` | PCHIP；256 |
| 校验 | `J:script/object/ObjectValidator.java — checkAdjust（737-751）`、`checkCurves（831-）` | `lut_input_gamma>0`；曲线属性存在 |
| 旧编辑器 | `EDITOR:src/types.ts:8`（无 ADJUST） | 无调色 UI |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| ADJUST 类型 | 不存在 | 新增类型 + 轨道 + 片段 |
| 59 通道 | 无 | 分组表单 + 范围/默认 |
| 10 曲线 | 无 | 曲线编辑器（复用 07/06） |
| `blend_mode` | 无 | 5 种 + 说明 |
| lane vs master | 无 | 归属说明 |
| 预设 | 无 | 可选预设（仅写字段，不是新格式） |

### 3.2 拟新建（提案）

- EDITOR:src/components/color/AdjustColorPanel.vue（提案）：片段效果控件的调色组组合组件，不独占工作区、不再创建新color页。
- `EDITOR:src/components/color/ColorChannelGroup.vue`（提案）：按 section 的通道组。
- `EDITOR:src/components/color/ColorCurveEditor.vue`（提案）：10 曲线（PCHIP 语义，复用 07 的曲线控件）。
- `EDITOR:src/lib/colorChannels.ts`（提案）：从 schema 派生 59 通道的分组/范围/默认；**不是**通道表。
- `EDITOR:src/lib/colorPresets.ts`（提案）：预设值集合（可选，写字段）。

## 4. 输入输出与字段约束

**输入**：`schema.tracks.ADJUST.objects`、ADJUST 片段 JSON、当前播放头。

**输出**：对象叶子编辑意图（59 通道 + 10 曲线 + `blend_mode`）。

| 组 | 通道 | 约束 |
|---|---|---|
| 基础 | exposure/contrast/highlights/shadows/whites/blacks | exposure [-5,5]；其余 [-1,1] |
| 色彩 | hue/saturation/vibrance/lightness/temperature/tint/red/green/blue | [-1,1] |
| 混合 | mix_rr/rg/rb/gr/gg/gb/br/bg/bb | [-1,1] |
| 曲线强度 | curve_strength/r/g/b + hv_h/hv_s/hv_l/lv_s/sv_s/sv_l | [0,1]，默认 1 |
| Lift/Gamma/Gain | lift_r/g/b、gamma_r/g/b、gain_r/g/b | [-1,1] |
| HSL 分区 | hue_red/sat_red … hue_magenta/sat_magenta | [-1,1] |
| 风格化 | grayscale/invert | [0,1] |
| LUT | lut_strength/blend_amount | [0,1]，默认 1 |
| 曲线 | rgb/r/g/b + hv_h/hv_s/hv_l/lv_s/sv_s/sv_l | STRUCT；PCHIP；LUT 256 |
| 混合模式 | blend_mode | normal/multiply/screen/soft_light/overlay |

**必须显示的边界**：

- ADJUST 是 master 链（整屏之后）；CAMERA 的 57 通道在 lane 合成前（08-01）。两者都写 `color.*` 但归属不同。
- `MasterColorAdjust.consume` 按实例顺序叠层，规则层紧随；ADJUST 不是「覆盖」而是「叠加」。
- `ColorAdjustPass` 逐层链式 `applyTo`，src/dst 不能同纹理；alpha 直通（不调透明度）。
- 12 采样器上限与 LUT 单表烘焙见 06；本文件不重复。
- 曲线是 value-only STRUCT，不产生关键帧；通道是 ANIMATED。
- `lut_input_gamma` 必须 >0；`ObjectValidator.checkAdjust` 会报错。

## 5. 修改步骤

1. 02/05迁移前端TrackType、轨道列表/添加/色条/标签，消费01能力索引中的tracks.ADJUST.objects。主模组TrackSchemas.all（33）和SchemaExporter.exportAll（48–55）已支持ADJUST，不要求再向模组添加一遍。
2. 新建 `colorChannels.ts`：从 schema 的 `section/min/max/default` 派生分组；不硬编码 59 名单。
3. 新建 `AdjustColorPanel`：按组折叠；每组用 06 的数值控件（ANIMATED）；曲线用 `ColorCurveEditor`。
4. `ColorCurveEditor`：10 条曲线；点编辑/PCHIP 预览；`VALUE` 不显示关键帧按钮。
5. `blend_mode`：5 种 + 说明；与 06 的 LUT `blend_amount` 区分。
6. 归属说明：顶部「ADJUST = master；CAMERA 自带调色 = lane」；链接 08-01。
7. 预设（可选）：基础/电影/黑白等只写字段值；不新增脚本键。
8. 在clip.effects挂ADJUST适用调色组，选片段只切换片段上下文，不因选中某通道隐藏其他已展开组。需要LUT/曲线专门工具时用同一Selection导航，不能重建一套关键帧视口。
9. 保存后重载：59 通道 + 曲线 + blend_mode 逐值一致；游戏内调色与 UI 一致。

## 6. 禁止修改

- 不得改 `AdjustTrackPlayer`/`ColorAdjustSampler`/`MasterColorAdjust`/`ColorAdjustPass` 的采样/叠层/链式语义。
- 不得在 TS 里复制 59 通道名单/范围；必须从 schema 派生。
- 不得把曲线写成关键帧容器。
- 不得把 ADJUST 的 `blend_mode` 与 LUT 的 `blend_amount` 混为一个字段。
- 不得新增调色通道/曲线。
- 不得在前端实现调色渲染或 LUT 采样。

## 7. 两分支承载

- **WebUI**：片段效果控件调色组+原通道/曲线/混合语义；提交走02原命令，快捷属性同值回显。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时完整实现同调色通道/曲线/混合控件，主模组实际执行调色；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `ColorAdjustSampler` + `MasterColorAdjust` + `ColorAdjustPass`。

## 8. 前置

- 01：`adjust.objects` schema 与 `tracks.ADJUST`。
- 02：`ADJUST` 类型迁移、对象叶子路径、原子提交。
- 05：时间轴/检查器支持 ADJUST。
- 06：异步属性控件（59 通道）。
- 07：曲线控件（10 曲线）。
- 09：合成顺序（master 在整屏之后）。

## 9. 验收

**正例**

- 选中ADJUST片段：效果控件按真实schema.section展示全部59通道、10曲线与blend_mode；多个组可同时展开，左值右独立节点对齐。不把“固定8组/10组”当硬编码界面合同，所有通道/曲线覆盖不变。
- `exposure=2`：范围 [-5,5] 接受；`exposure=6` 被范围拦截。
- `saturation=0`、`grayscale=1`：游戏内去色；UI 值一致。
- `blend_mode=multiply`：与 normal 视觉不同；说明正确。
- 10 曲线可编辑；`curve_strength=0` 时曲线不生效（说明）。
- `lut_input_gamma=0`：红条；`ObjectValidator` 报错一致。
- 与 CAMERA 自带调色同时存在：lane 调色先、master 后；说明正确。

**反例**

- 59 通道名单在 TS 里硬编码 → 失败。
- 曲线出现关键帧按钮 → 失败。
- 把 `blend_mode` 与 `blend_amount` 混为一谈 → 失败。
- 前端渲染调色预览并称真实画面 → 失败。
- 新增通道/曲线 → 失败。
- `lut_input_gamma=0` 仍允许保存且无提示 → 失败。

## 10. 真实冒烟

1. 造 ADJUST 片段：exposure/saturation/contrast；游戏内整屏变化。
2. 加曲线（rgb S 曲线）；游戏内对比变化；`curve_strength` 0/1 对比。
3. `grayscale=1`、`invert=1`：效果正确。
4. `blend_mode=soft_light`：与 normal 对比。
5. 同时有 CAMERA lane 调色：先 lane 后 master；效果叠加。
6. `lut_input_gamma=0`：编辑器红条；`/icinematics validate` 报错。

## 11. 完成定义

- ADJUST 类型存在；59 通道 + 10 曲线 + `blend_mode` 全部可编辑。
- 分组/范围/默认与 schema 一致；无第二份通道表。
- lane vs master 归属清晰；曲线不产生关键帧。
- 不本地渲染；不新增字段；LUT 细节归 06。
- 正例/反例/冒烟全部通过。
