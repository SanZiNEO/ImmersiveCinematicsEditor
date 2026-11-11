# 09-02 覆盖层淡入淡出与遮罩（OverlayFadeAndMask）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：09-overlays-composition
> 关联：`01-OverlayTrackSurface.md`、`06-CompositionOrderPanel.md`、`../06-async-objects/README.md`

## 1. 职责

编辑 fade 形态的颜色/渐变/遮罩/混合四组字段，并把运行时的两条渲染路径（纯色快速路径 vs `ColorMaskRenderer` shader 路径）与颜色校验规则呈现给作者。不实现 image/subtitle（03）、视频（04）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| fade 字段 | `J:script/schema/TrackSchemas.java:418-452` | `color.r/g/b`、`mask_*`、`gradient_*`、`color`（STRING）、`gradient`（STRUCT）、`mask_shape`、`blend_mode`；全部 `appliesTo("fade")` |
| 参数计算 | `J:script/OverlayClipRuntime.java — fadeParams（162-217）` | 读取颜色/遮罩/渐变/混合 |
| 层创建 | `J:script/OverlayTrackPlayer.java — createObjectLayer（140-195）` | `layer_type=fade` → `FadeLayer` |
| 参数应用 | `OverlayTrackPlayer.java — applyObjectParams（196-233）` | `setColor`/`setMaskSpec`/`setMaskGeometry`/`setGradientGeometry`/`setColorRgb` |
| fade 渲染 | `J:overlay/FadeLayer.java — render（67-98）`、`isAdvancedMask（92-98）` | 纯色+full+normal → `GuiGraphics.fill`；否则 `ColorMaskRenderer` |
| 颜色/遮罩写入 | `FadeLayer.java — setColor（154-174）`、`setMaskSpec（175-187）`、`setMaskGeometry（188-196）`、`setGradientGeometry（197-204）`、`setColorRgb（205-211）`、`close（212-）` | `close` 释放 shader 资源 |
| 遮罩规格 | `J:script/ColorMaskSpec.java — forObjects（68-81）`、`rgb（82-94）`、`hasGradient（95-102）`、`gradientType（103-110）`、`stopOffsets（111-118）`、`stopColors（119-123）`、`maskShape（124-131）`、`blendMode（132-）` | 规格对象 |
| 渐变/颜色解析 | `ColorMaskSpec.java — parseGradient（163-237）`、`parseColor（238-266）`、`InvalidColorMaskException（267-）` | 非法颜色/渐变抛异常 |
| 遮罩渲染 | `J:overlay/ColorMaskRenderer.java — SHADER_NAME（52）`、`LUT_SIZE（55）`、形状编码（57-59）、渐变编码（61-63）、混合编码（65-69）、`REQUIRED_UNIFORMS（72-78）`、`render（138-）` | `ic_color_mask`；1024 点渐变 LUT；5 种混合；状态保存/还原；alpha 不写 |
| 校验（不适用字段） | `J:script/object/ObjectValidator.java — checkOverlay（691-721）` | `appliesTo` 不适用报错 |
| 颜色校验缺口 | `J:script/ScriptValidator.java — checkActionOverlaySet（1621-1646）`、`checkHexColor（1974-）` | `checkHexColor` 只在规则动作 `overlay_set`（`:1629`）调用；OVERLAY 轨道 `color` 无服务端校验 |
| 旧编辑器 | `EDITOR:src/components/ClipPanel.vue:8-20` | 无颜色/遮罩/渐变控件 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 颜色 | 无 | 颜色选择器 + `#RRGGBB` 输入；写 `color`（STRING） |
| 渐变 | 无 | 类型/角度/中心/半径 + 色标列表；写 `gradient`（STRUCT） |
| 遮罩形状 | 无 | `full/rect/circle` + 几何 |
| 混合 | 无 | 5 种 + 语义说明 |
| 快速路径 | 无 | 显示「fill / shader」判定与原因 |
| 非法颜色 | 运行期整轨失效 | 编辑期红条 + 不写盘 |
| 资源释放 | 无 | 层删除/切换时 `close` 由运行时负责；UI 不持有 shader |

### 3.2 拟新建（提案）

- `EDITOR:src/components/overlay/FadeColorEditor.vue`（提案）：颜色 + 透明度 + 快速路径提示。
- `EDITOR:src/components/overlay/GradientEditor.vue`（提案）：类型/角度/中心/半径/色标。
- `EDITOR:src/components/overlay/MaskEditor.vue`（提案）：形状/几何/混合。
- `EDITOR:src/lib/colorHex.ts`（提案）：`#RRGGBB` 解析/格式化/校验；与 `ColorMaskSpec.parseColor` 同正则语义，但不复制运行时对象。
- `EDITOR:src/lib/fadePath.ts`（提案）：`isAdvancedMask` 的等价判定（纯色+full+normal），用于 UI 提示；**不是**渲染实现。

## 4. 输入输出与字段约束

**输入**：fade 片段 JSON、`ColorMaskSpec` 的字段语义、当前 `layer_type`。

**输出**：对 `color`/`gradient`/`mask_*`/`gradient_*`/`mask_shape`/`blend_mode` 的编辑意图。

| 字段 | 约束 |
|---|---|
| `color` | STRING `#RRGGBB`（大小写不敏感）；默认 `#000000`；非法值编辑期拦截 |
| `color.r/g/b` | ANIMATED 0–1；与 `color` 字符串不是同一字段；同时存在时运行时以 `ColorMaskSpec.forObjects` 的读取顺序为准（UI 标注） |
| `gradient` | STRUCT：`{type:"linear"|"radial", angle, center_x, center_y, radius, stops:[{offset,color}]}`；`stops` offset 0–1 递增 |
| `mask_shape` | `full/rect/circle`；未知值按 full（`ColorMaskSpec.maskShape`） |
| `mask_x/y/width/height/radius` | 归一化；`width/height/radius` min 0；默认 0.5/0.5/1/1/0.5 |
| `gradient_angle` | 度；默认 0 |
| `gradient_center_x/y` | 归一化；默认 0.5 |
| `gradient_radius` | min 0；默认 0.5 |
| `blend_mode` | `normal/multiply/screen/soft_light/overlay` |

**必须显示的路径判定**：

- 快速路径：`mask_shape=full`、`blend_mode=normal`、无渐变、颜色为纯色（无 `color.r/g/b` 动画或值等于 `color`）→ `GuiGraphics.fill`。
- shader 路径：其余 → `ColorMaskRenderer`（`ic_color_mask`），1024 点渐变 LUT；混合 5 种；alpha 不写（`render` 状态保存/还原）。
- `ColorMaskRenderer` 的资源由 `FadeLayer.close()` 释放；UI 不创建/持有 shader。

## 5. 修改步骤

1. 新建 `colorHex.ts`：解析 `#RGB`/`#RRGGBB`（按运行时实际接受范围，至少 `#RRGGBB`）、格式化、校验；错误消息定位到 `color`。
2. 新建 `FadeColorEditor`：颜色选择器 + 十六进制输入；显示 `color.r/g/b` 动画通道（若存在）与 `color` 字符串的关系；非法值红条。
3. 新建 `GradientEditor`：类型 `linear/radial`；角度/中心/半径；色标列表（添加/删除/排序/颜色/offset）；校验 offset 递增、至少 2 个色标（若运行时要求）。
4. 新建 `MaskEditor`：形状三选一；`rect` 显示 x/y/w/h；`circle` 显示 x/y/radius；`full` 隐藏几何；混合下拉 + 说明。
5. 新建 `fadePath.ts`：按 §4 判定快速/shader，并在 UI 显示「为什么走 shader」（例如「有渐变」「混合非 normal」「遮罩非 full」）。
6. 在 `OverlayTrackPanel` 的 fade 分支挂三个编辑器；`appliesTo` 门禁由 01 提供。
7. 校验：颜色/渐变/色标在提交前检查；`mask_shape`/`blend_mode` 枚举由 schema 提供，不硬编码。
8. 保存后重载：字段逐值一致；游戏内 fade 的颜色/遮罩/渐变/混合与 UI 一致。

## 6. 禁止修改

- 不得改 `FadeLayer`/`ColorMaskRenderer`/`ColorMaskSpec` 的渲染或解析语义。
- 不得在前端实现 shader/渐变 LUT 的本地渲染。
- 不得把 `color`（STRING）与 `color.r/g/b`（ANIMATED）合并为一个字段。
- 不得把 `gradient` 写成字符串或平铺键。
- 不得声称 `ScriptValidator` 会校验 OVERLAY 轨道颜色（它不会）。
- 不得在 UI 中创建/释放 shader 资源（归 `FadeLayer.close`）。

## 7. 两分支承载

- **WebUI**：颜色/渐变/遮罩/混合编辑器 + 路径提示；提交走 02 命令。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时完整实现同颜色/渐变/遮罩/混合控件，真实画面由公共端口提供，不复制运行时渲染；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `ColorMaskSpec` + `FadeLayer` + `ColorMaskRenderer`。

## 8. 前置

- 01：fade 字段面与 `appliesTo` 门禁。
- 02：对象叶子路径 + 原子提交。
- 06：异步属性控件（`color.r/g/b`、`mask_*`、`gradient_*` 的关键帧）。
- 03：真实画面（颜色/遮罩最终效果）。

## 9. 验收

**正例**

- `color=#ff0000`、`mask_shape=full`、`blend_mode=normal`：显示「快速路径 fill」；游戏内全屏红。
- 加 `gradient`（linear，两色标）：显示「shader 路径：有渐变」；游戏内渐变正确。
- `mask_shape=circle`、`mask_radius=0.3`：显示圆形遮罩；`full` 时几何隐藏。
- `blend_mode=multiply`：显示「shader 路径：混合非 normal」。
- 输入 `color=red`：红条，不写盘；改 `#00ff00` 后保存。
- 删除 fade 层：`FadeLayer.close` 释放 shader；再次创建不泄漏（运行时行为，编辑器不干预）。

**反例**

- 颜色非法仍写盘，保存后整轨失效 → 失败。
- 把 `color` 与 `color.r/g/b` 合并 → 失败。
- UI 本地渲染渐变/遮罩并称为真实画面 → 失败。
- 前端自己实现 `ColorMaskRenderer` 的混合 → 失败。
- 声称服务端会校验颜色 → 失败。
- `mask_shape` 写成 `shape` → 失败。

## 10. 真实冒烟

1. 造 fade 片段：纯色 + full + normal；游戏内全屏色。
2. 改渐变 linear/radial、加色标；游戏内渐变方向/色标正确。
3. 改 `mask_shape=rect` + 几何；游戏内矩形遮罩。
4. 改 `blend_mode=soft_light`；游戏内混合正确。
5. 写非法颜色：编辑器拦截；手工改成非法值保存，游戏内报错/整轨失效（确认编辑器提示的必要性）。
6. 删除/重建层多次：无 shader 泄漏/崩溃。

## 11. 完成定义

- 颜色/渐变/遮罩/混合全部可编辑；字段约束与 `ColorMaskSpec` 一致。
- 快速路径 vs shader 路径可解释；不本地渲染。
- 非法颜色编辑期拦截；不冒充服务端校验。
- 资源生命周期由运行时负责；UI 不持有 shader。
- 正例/反例/冒烟全部通过。
