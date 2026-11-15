# 09-01 OVERLAY 字段面与层类型

## 目标

把 `OVERLAY` 轨道的全部既有字段按 `layer_type` 分成三条互不污染的面：

- `fade`：全屏颜色覆盖层，只有颜色、遮罩、渐变、混合、透明度、层级；
- `image`：图片或视频层，只有素材路径、取材、位置、锚点、缩放、透明度、层级；
- `subtitle`：字幕层，只有文本、字号、位置、锚点、缩放、透明度、层级。

编辑器不提供“给片段添加任意属性”的字段选择器，也不把全部 `OVERLAY` 字段同时铺在一个面板里。字段是否出现，由 `layer_type` 决定。

## 源码事实

`TrackSchemas.overlayObjects()` 的字段面就是本轮的完整字段面：

- 动画字段：`x`、`y`、`anchor_x`、`anchor_y`、`scale_x`、`scale_y`、`source.x`、`source.y`、`source.w`、`source.h`、`opacity`、`font_scale`、`color.r`、`color.g`、`color.b`、`mask_x`、`mask_y`、`mask_width`、`mask_height`、`mask_radius`、`gradient_angle`、`gradient_center_x`、`gradient_center_y`、`gradient_radius`。
- 值字段：`layer_type`、`color`、`gradient`、`mask_shape`、`blend_mode`、`path`、`text`、`z_index`。

`OverlayClipRuntime.compute()` 按 `layer_type` 分支装配：

- `fade` 只读透明度、颜色、遮罩、渐变、层级；`x/y/anchor/scale` 填 `CanvasTransform` 缺省值，不读脚本。
- `image` 只读位置、锚点、缩放、取材、透明度、层级；颜色、遮罩、渐变填缺省。
- `subtitle` 只读位置、锚点、缩放、字号、透明度、层级；颜色、遮罩、渐变填缺省。

`ObjectValidator.checkOverlay()` 对“字段已存在、但该字段的 `appliesTo` 不包含当前 `layer_type`”直接报 issue。`color`、`path`、`text`、`z_index` 没有 `appliesTo`，校验器不会替编辑器清理；编辑器必须主动清理，避免留下运行时永远不读的死字段。

## 字段表

| 字段 | 模式 | 类型/范围 | 默认 | 适用层 | 面板 |
|---|---|---|---|---|---|
| `layer_type` | value | enum `fade/image/subtitle`，required | `fade` | 全部 | 属性 |
| `x` | animated | float，窗口比例 | 0.5 | image / subtitle | 属性 / 效果 |
| `y` | animated | float，窗口比例 | 0.5 | image / subtitle | 属性 / 效果 |
| `anchor_x` | animated | float，常用 0–1；schema 无 min/max | 0.5 | image / subtitle | 属性 / 效果 |
| `anchor_y` | animated | float，常用 0–1；schema 无 min/max | 0.5 | image / subtitle | 属性 / 效果 |
| `scale_x` | animated | float | 1 | image / subtitle | 属性 / 效果 |
| `scale_y` | animated | float | 1 | image / subtitle | 属性 / 效果 |
| `source.x` | animated | float，归一化 | 0 | image（含视频） | 属性 / 效果 |
| `source.y` | animated | float，归一化 | 0 | image（含视频） | 属性 / 效果 |
| `source.w` | animated | float，归一化 | 1 | image（含视频） | 属性 / 效果 |
| `source.h` | animated | float，归一化 | 1 | image（含视频） | 属性 / 效果 |
| `opacity` | animated | float，0–1 | 1 | 全部 | 属性 / 效果 |
| `font_scale` | animated | float | 1 | subtitle | 属性 / 效果 |
| `color.r` | animated | float，0–1 | 0 | fade | 属性 / 效果 |
| `color.g` | animated | float，0–1 | 0 | fade | 属性 / 效果 |
| `color.b` | animated | float，0–1 | 0 | fade | 属性 / 效果 |
| `mask_x` | animated | float，窗口比例 | 0.5 | fade | 属性 / 效果 |
| `mask_y` | animated | float，窗口比例 | 0.5 | fade | 属性 / 效果 |
| `mask_width` | animated | float，min 0 | 1 | fade | 属性 / 效果 |
| `mask_height` | animated | float，min 0 | 1 | fade | 属性 / 效果 |
| `mask_radius` | animated | float，min 0 | 0.5 | fade | 属性 / 效果 |
| `gradient_angle` | animated | float，度 | 0 | fade | 属性 / 效果 |
| `gradient_center_x` | animated | float，窗口比例 | 0.5 | fade | 属性 / 效果 |
| `gradient_center_y` | animated | float，窗口比例 | 0.5 | fade | 属性 / 效果 |
| `gradient_radius` | animated | float，min 0，短边比例 | 0.5 | fade | 属性 / 效果 |
| `color` | value | string `#RRGGBB` | `#000000` | fade | 属性 |
| `gradient` | value | struct `{type,stops}` | null | fade | 属性 |
| `mask_shape` | value | enum `full/rect/circle` | `full` | fade | 属性 |
| `blend_mode` | value | enum `normal/multiply/screen/soft_light/overlay` | `normal` | fade | 属性 |
| `path` | value | string | 空 | image（含视频） | 属性 |
| `text` | value | string | 空 | subtitle | 属性 |
| `z_index` | value | int | 10 | 全部 | 属性 |

## 层类型适用矩阵

| 字段组 | fade | image | subtitle |
|---|---|---|---|
| `layer_type` | 显示 | 显示 | 显示 |
| `x/y/anchor/scale` | 不显示、不写盘 | 显示 | 显示 |
| `source.*` | 不显示、不写盘 | 显示 | 不显示、不写盘 |
| `opacity` | 显示 | 显示 | 显示 |
| `font_scale` | 不显示、不写盘 | 不显示、不写盘 | 显示 |
| `color.r/g/b` | 显示 | 不显示、不写盘 | 不显示、不写盘 |
| `mask_*` | 显示 | 不显示、不写盘 | 不显示、不写盘 |
| `gradient_*` | 显示 | 不显示、不写盘 | 不显示、不写盘 |
| `color` | 显示 | 不显示、不写盘 | 不显示、不写盘 |
| `gradient` | 显示 | 不显示、不写盘 | 不显示、不写盘 |
| `mask_shape` | 显示 | 不显示、不写盘 | 不显示、不写盘 |
| `blend_mode` | 显示 | 不显示、不写盘 | 不显示、不写盘 |
| `path` | 不显示、不写盘 | 显示 | 不显示、不写盘 |
| `text` | 不显示、不写盘 | 不显示、不写盘 | 显示 |
| `z_index` | 显示 | 显示 | 显示 |

“不显示、不写盘”不是“显示但标灰”。凡是当前层类型运行时不读的字段，编辑器都不在面板里给它值控件，也不把它写进 `objects`。

## 属性面板与效果面板

### 属性面板

`selection.properties` 对 `OVERLAY` 片段显示：

- `layer_type` 顶部行；
- 当前层类型适用的全部可编辑字段；
- 静态值、未设置值、value-only 字段；
- animated 字段在还没有关键帧时显示当前静态值，并带“开时钟”入口；
- value-only 字段没有时钟，不提供关键帧入口。

属性面板不显示已经有 `keyframes.length > 0` 的 animated 叶子；这些叶子只在效果面板出现，避免同一属性在两个面板同时显示值控件。

### 效果面板

`clip.effects` 只显示 `keyframes.length > 0` 的 animated 叶子：

- 每条叶子只做关键帧列表、时间、值、插值编辑；
- 不显示 `layer_type`、`color`、`gradient`、`mask_shape`、`blend_mode`、`path`、`text`、`z_index`；
- 不提供“添加属性”或“选择字段”入口；
- 空片段显示“在属性面板打开时钟后，这里显示关键帧组”。

### 时钟与回流

- 属性面板中某个 animated 叶子开时钟：创建首帧，该叶子进入效果面板，属性面板不再显示它的值控件。
- 效果面板删除最后一帧：该叶子回流属性面板，按静态值显示。
- 关闭动画：删除该属性的关键帧组，回流属性面板。
- `layer_type`、`color`、`gradient`、`mask_shape`、`blend_mode`、`path`、`text`、`z_index` 永远不进效果面板。

## 层类型切换

`layer_type` 是 `OVERLAY` 片段的结构开关，不是普通枚举值。切换它会改变字段适用面，因此按“一次转换”处理，而不是把旧字段原样保留。

### 打开缺失 `layer_type` 的片段

- 校验器与运行时把空值按 `fade` 处理；
- 编辑器显示“有效层类型：fade（脚本未写）”；
- 只要作者改动任一 fade 字段，编辑器写显式 `layer_type: "fade"`，消除歧义。

### 切换流程

1. 选择新层类型；
2. 显示“将保留 / 将移除”的字段清单；
3. 作者确认后一次提交；
4. 适用新类型的字段保留原值；
5. 不适用新类型的字段从 `objects` 删除；
6. 一次撤销可以回到切换前。

### 字段归属

| 切换 | 保留 | 移除 |
|---|---|---|
| fade → image | `opacity`、`z_index` | `color.*`、`mask_*`、`gradient_*`、`color`、`gradient`、`mask_shape`、`blend_mode`、`text` |
| fade → subtitle | `opacity`、`z_index` | `color.*`、`mask_*`、`gradient_*`、`color`、`gradient`、`mask_shape`、`blend_mode`、`path` |
| image → fade | `opacity`、`z_index` | `x/y/anchor_x/anchor_y/scale_x/scale_y`、`source.*`、`path` |
| image → subtitle | `opacity`、`z_index`、`x/y/anchor/scale` | `source.*`、`path` |
| subtitle → fade | `opacity`、`z_index` | `x/y/anchor/scale`、`font_scale`、`text` |
| subtitle → image | `opacity`、`z_index`、`x/y/anchor/scale` | `font_scale`、`text` |

`path` 和 `text` 没有 `appliesTo`，校验器不会因为层类型不匹配而报错；编辑器仍然按上表移除，避免死字段。

上表列的是主要字段组，不是完整清单。切换时统一按目标类型的完整字段面处理：

- 目标类型适用的字段：源类型已有值就保留；源类型没有就按默认值初始化，不把运行时的填充值写死；
- 目标类型不适用的字段：无论是否出现在上表，一律从 `objects` 删除，包括历史残留的 `color.*`、`mask_*`、`gradient_*`、`color`、`gradient`、`mask_shape`、`blend_mode`、`path`、`text`、`font_scale`、`source.*`、`x/y/anchor/scale` 中不适用当前目标的部分；
- 一次切换是一个 commit，一次撤销回退整个字段面。

## 本地校验

在写盘、推送前执行：

| 检查 | 处理 |
|---|---|
| `layer_type` 缺失 | 允许打开；显示 effective fade；首次层类型相关编辑写显式值 |
| `layer_type` 非 `fade/image/subtitle` | block，定位到 `objects.layer_type` |
| 存在 `appliesTo` 字段但当前类型不匹配 | block，提示“字段 X 不适用于 layer_type=Y” |
| `image` 的 `path` 扩展名不是 `png/gif/mp4/webm/mkv` | block；视频扩展名进入 09-04 的识别 |
| `color` 非 `#RRGGBB`（`#` 可省） | block；运行时会回退黑色，但编辑器不应把错误写盘 |
| `gradient` 结构不合法 | block，详见 `09-02` |
| `mask_shape` / `blend_mode` 不在枚举内 | block |
| `opacity` / 颜色通道超出 0–1 | block |
| `mask_width/height/radius` 或 `gradient_radius` 小于 0 | block |
| `source.*` 非有限数，或 `source.w/h < 0` | block |
| `z_index` 非整数 | block |

## 组件

### `OverlayLayerTypeField`

- 位置：属性面板顶部；
- 显示当前值；缺失时显示 effective fade；
- 切换前调用 `previewLayerTypeConversion()`，返回保留/移除清单；
- 确认后调用 `applyLayerTypeConversion()`，一次 commit；
- 不做“保留旧值并标注不生效”。

### `OverlayFieldGroup`

- 只接收当前层类型适用的字段描述；
- 不接收“全部 OVERLAY 字段”再由组件自己判断；
- 字段描述来自 `TrackSchemas.overlayObjects()` 的 `appliesTo` 与 `section`；
- 对 `color/path/text` 这类没有 `appliesTo` 的字段，用本文件的层类型矩阵补上门控。

## 验收

| # | 场景 | 通过条件 |
|---|---|---|
| A1 | 选中 fade | 只显示 `layer_type`、`opacity`、`color`、`color.r/g/b`、`gradient`、`gradient_*`、`mask_shape`、`mask_*`、`blend_mode`、`z_index` |
| A2 | 选中 image | 只显示 `layer_type`、`x/y/anchor/scale`、`source.*`、`opacity`、`path`、`z_index` |
| A3 | 选中 subtitle | 只显示 `layer_type`、`x/y/anchor/scale`、`font_scale`、`opacity`、`text`、`z_index` |
| A4 | 缺失 `layer_type` | 显示 effective fade；不报错；首次编辑写显式 fade |
| A5 | fade→image | 确认清单正确；`color/mask/gradient/blend/text` 从 JSON 移除；`opacity/z_index` 保留；一次撤销回退 |
| A6 | image→fade | `x/y/anchor/scale/source/path` 从 JSON 移除；`opacity/z_index` 保留 |
| A7 | subtitle→image | `font_scale/text` 移除；`x/y/anchor/scale` 保留 |
| A8 | `color.r` 打帧 | 属性面板不再显示 `color.r` 值控件；效果面板出现该叶子；删除最后一帧后回流 |
| A9 | value-only 字段 | `layer_type/color/gradient/mask_shape/blend_mode/path/text/z_index` 在效果面板 0 命中 |
| A10 | `ObjectValidator` | 切换后不再出现“字段不适用于 layer_type”的 issue |
| A11 | 未知键 | 不属于 `OVERLAY` 字段面的键保留供诊断；不静默删除，不进入 UI；推送前 `ObjectValidator` 会报“未知对象路径”，编辑器定位到键，由作者决定删除或保留 |
| A12 | 保存重开 | 字段值、关键帧、层类型、未知键原样保留 |

## 完成定义

- `OVERLAY` 三条层类型的字段面与源码一致；
- 属性面板/效果面板归属与 06 一致；
- 层类型切换不留下死字段；
- 本地校验能在推送前拦住 `ObjectValidator` 会报的形态错误；
- 没有新增字段、没有新增消息、没有改模组。
