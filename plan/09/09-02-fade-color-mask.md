# 09-02 fade 颜色、遮罩、渐变与混合

## 目标

把 `layer_type=fade` 的全屏颜色覆盖层编辑完整。

这里的“调色”是覆盖层自身的颜色编辑：基色、逐通道颜色、渐变、遮罩、混合模式和透明度。它不是 `ADJUST` 轨道的底图调色，不包含 LUT、曲线、曝光、对比度，也不在编辑器里做像素合成。

## 源码事实

- `FadeLayer` 是全屏颜色覆盖层，兼做淡入淡出与高级颜色遮罩。
- `x/y/anchor/scale` 对 `fade` 不生效；脚本写了也不读取。09-01 已规定 fade 不显示、不写这些字段。
- 纯色 + `mask_shape=full` + `blend_mode=normal` 走 `GuiGraphics.fill` 快路径，铺满窗口。
- 渐变、非 `full` 遮罩、非 `normal` 混合，任一成立就走 `ColorMaskRenderer` 的 `ic_color_mask` shader。
- 有效透明度 = 关键帧 `opacity` × 退场系数。退场渐出固定 0.5 秒，是 `FadeLayer` 内部常量，不是脚本字段。
- `color` 是 value-only 基色，`#RRGGBB`，`#` 可省，不支持 ARGB。运行时非法颜色会 warn 并回退黑色；编辑器不应把非法值写盘。
- `color.r/g/b` 是三个独立的 animated 通道，0–1，默认 0。只有作者显式声明了某个通道，运行时才用该通道的采样值；未声明的通道回落 `color` 基色的对应通道。
- `gradient` 是 value-only 结构，只接受 `{type: linear|radial, stops: [{offset, color}, ...]}`。至少 2 个 stop；offset 有限、0–1、严格递增；颜色 `#RRGGBB`；首尾不必 0/1，范围外保持端点；不设数量上限。
- `gradient_angle`、`gradient_center_x/y`、`gradient_radius` 是 animated 几何。`linear` 读角度 + 中心；`radial` 读中心 + 半径。渐变存在时，纯色 `color` 不参与该层颜色，颜色由 stops 决定。
- `mask_shape` 是 value-only enum：`full` / `rect` / `circle`。`rect` 的 `mask_x/y` 是中心，`mask_width/height` 是窗口宽高比例；`circle` 的 `mask_x/y` 是中心，`mask_radius` 是短边比例。`full` 不读遮罩几何。
- `blend_mode` 是 value-only enum：`normal` / `multiply` / `screen` / `soft_light` / `overlay`。非 `normal` 会把主画面复制到同尺寸 scratch framebuffer 再采样；主 framebuffer 的 alpha 不写，只改 RGB。

## 编辑面结构

`fade` 的属性面板按下面五组显示，顺序固定：

1. 基色 / 颜色通道；
2. 渐变定义 / 渐变几何；
3. 遮罩形状 / 遮罩几何；
4. 混合模式；
5. 透明度 / 层级。

`opacity`、`z_index` 的规则见 `09-01` 与 `09-07`。本文件只定义颜色、渐变、遮罩、混合。

## 基色与颜色通道

### 基色

- 控件：色板 + `#RRGGBB` 输入；
- 只写 `color`，不写 `color.r/g/b`；
- 不提供 alpha 输入；透明度统一走 `opacity`；
- 默认 `#000000`；
- 非法 hex、少于/多于 6 位、ARGB 八位：本地 block；
- 选色只改基色，不会自动创建通道关键帧。

### 颜色通道

- 三行：R / G / B；
- 每行 0–1，默认 0；
- 每行是 animated 叶子，带时钟；打帧后进效果面板；
- 只有显式声明的通道参与采样；未声明通道回落基色对应通道；
- 例如：只给 R 打帧，G/B 仍用基色；
- 基色与通道同时存在时，按通道逐个回落，不是整组替换。

### 基色与渐变的关系

`gradient` 存在时，运行时颜色由 stops 采样，纯色 `color` 与 `color.r/g/b` 不参与该层渲染。

编辑器按互斥模式处理：

- 纯色模式：显示基色与通道；
- 渐变模式：隐藏基色/通道编辑，显示“颜色由渐变 stops 决定”；
- 从纯色切到渐变：已有基色/通道值保留为回退值，不自动删除；不再显示编辑控件；
- 从渐变切回纯色：恢复基色/通道编辑；
- 新建 `gradient` 时，不自动创建 `color` 或通道字段；
- 删除 `gradient` 时，恢复纯色模式；若没有任何基色/通道，按默认黑色。

这个互斥只影响编辑面，不改变脚本结构：`color` 与 `gradient` 可以同时存在于 JSON，运行时有渐变就按渐变。

## 渐变定义

### 结构

```json
{
  "type": "linear",
  "stops": [
    { "offset": 0.0, "color": "#000000" },
    { "offset": 1.0, "color": "#FFFFFF" }
  ]
}
```

- `type` 只能是 `linear` / `radial`；
- `stops` 至少 2 项；
- `offset` 必须是有限数字，0–1，严格递增；
- `color` 必须是 `#RRGGBB`，`#` 可省，大小写均可，不支持 ARGB；
- 首尾 offset 不必是 0/1；范围外保持端点颜色；
- 不设 stop 数量上限；
- `gradient` 是 value-only，没有时钟，不进效果面板；
- 只写 `type` 与 `stops`；已有未知键保留供 round-trip，但不出现在 UI，也不参与运行时解析。

### 编辑器

- 类型下拉：线性 / 径向；
- stop 表：offset、颜色、删除；
- “添加色标”：在末尾追加；新 stop 的 offset 默认落在最后一段中间，颜色默认取当前末尾颜色；
- 删除：至少保留 2 个；删除中间 stop 后重新检查严格递增；
- 色标颜色使用 `#RRGGBB` 色板；
- 渐变条预览：按 stops 在 0–1 上插值显示；只是编辑控件，不是游戏画面；
- 任何 offset 非递增、越界、颜色非法、stop 少于 2：本地 block。

### 渐变几何

只有 `gradient` 存在时才显示几何行；`gradient` 为 null 时不显示、不写 `gradient_*`。

| 类型 | 显示 | 隐藏 | 语义 |
|---|---|---|---|
| `linear` | `gradient_angle`、`gradient_center_x/y` | `gradient_radius` | 角度 0 = 向右，90 = 向下；中心是窗口比例 |
| `radial` | `gradient_center_x/y`、`gradient_radius` | `gradient_angle` | 中心是窗口比例；半径是短边比例 |

- `gradient_angle` 是度，不是弧度；
- `gradient_center_x/y` 是 0–1 窗口比例；
- `gradient_radius` 是短边比例，必须大于 0 才可见；
- 切换 `linear` ↔ `radial` 时，移除另一类型不用的几何字段；一次 commit；
- 删除 `gradient` 时，一并移除全部 `gradient_*` 字段；避免留下运行时永远不读的几何；
- 几何字段都是 animated；有帧进效果面板；
- 没有 `gradient` 时，即使 JSON 里有 `gradient_*`，运行时也不读；编辑器不制造这种状态。

## 遮罩

`mask_shape` 是 value-only，三态：

| 形状 | 显示几何 | 语义 |
|---|---|---|
| `full` | 无 | 整窗口；纯色 + normal 走 fill 快路径 |
| `rect` | `mask_x/y`、`mask_width/height` | `mask_x/y` 是矩形中心，`mask_width/height` 是窗口宽高比例 |
| `circle` | `mask_x/y`、`mask_radius` | `mask_x/y` 是圆心，`mask_radius` 是短边比例 |

### 规则

- `full`：不显示、不写任何 `mask_*`；如果从 rect/circle 切到 full，移除已有几何；一次 commit。
- `rect`：显示 `mask_x/y`、`mask_width/height`；隐藏 `mask_radius`；`mask_width/height` 必须 ≥ 0；为 0 时运行时不绘制该层。
- `circle`：显示 `mask_x/y`、`mask_radius`；隐藏 `mask_width/height`；`mask_radius` 必须 ≥ 0；为 0 时运行时不绘制该层。
- `mask_x/y` 可以是窗口外的值；编辑器不自动夹，超界给 warning；运行时按 shader 几何处理。
- 几何字段都是 animated；有帧进效果面板。
- 遮罩只决定“颜色覆盖在窗口的哪块区域”，不改变底层画面像素，也不是抠图。

### 几何示意

`OverlayGeometrySketch` 在 16:9 画布上画：

- 窗口边框；
- rect 的中心点与宽高框；
- circle 的圆心与半径圈；
- full 只画整窗填充示意。

示意只表达几何，不采样素材、不合成最终颜色，不给“游戏画面已预览”的错觉。

## 混合模式

`blend_mode` 是 value-only，五态：

| 值 | 语义 |
|---|---|
| `normal` | 直接覆盖；纯色 + full 时走 fill 快路径 |
| `multiply` | 与下方画面相乘 |
| `screen` | 与下方画面滤色 |
| `soft_light` | 柔光 |
| `overlay` | 叠加 |

- 非 `normal` 会读取下方画面；运行时把主画面复制到同尺寸 scratch framebuffer 再采样；
- 只影响 RGB，主 framebuffer 的 alpha 不写；
- 编辑器只提供下拉，不提供“混合强度”字段；脚本没有这个字段；
- 非 `normal` + `full` + 纯色也会走 shader，不走 fill 快路径。

## 透明度与退场

- `opacity` 是 animated 0–1，默认 1；属于 09-01 的通用字段；
- 有效透明度 = 关键帧 `opacity` × 退场系数；
- 0.5 秒渐出发生在**脚本实例退场**时：`PlaybackLifecycle.deactivate()` 调 `OverlayManager.startFadeOut(instance)`；只有实现了 `isAnimating()` 的 `FadeLayer` / `LetterboxLayer` 会叠加 0.5 秒线性渐出；
- `ImageLayer` / `VideoLayer` / `SubtitleLayer` 没有渐出实现：`startFadeOut()` 是空操作；片段结束/切换时由 `OverlayTrackPlayer` 直接移除，若实例退场时仍在活跃则保持当前透明度直到实例清理；
- 同一 `OVERLAY` 轨道内的 clip 切换不走这个渐出：`OverlayTrackPlayer` 直接 `removeLayer` 旧层，再建新层；
- 0.5 秒是内部常量，编辑器不提供“渐出时长”字段；
- 不要在 `fade` 上创建 `x/y/anchor/scale` 或 `font_scale`；运行时不会读；
- `isVisible()` 以有效透明度 > 0.001 为可见阈值；低于该值不绘制。

## 本地校验

| 检查 | 处理 |
|---|---|
| `color` 非 `#RRGGBB` | block |
| `color.r/g/b` 非有限数或超出 0–1 | block |
| `gradient` 非对象、缺 `type`、`type` 非 linear/radial | block |
| `stops` 少于 2、非数组 | block |
| stop 非对象、缺 offset/color | block |
| offset 非有限、越界、非严格递增 | block |
| stop color 非 `#RRGGBB` | block |
| `gradient_radius` < 0 | block |
| `mask_shape` 非 full/rect/circle | block |
| `mask_width/height/radius` < 0 | block |
| `blend_mode` 非五态之一 | block |
| 当前 `layer_type` 不是 fade，却存在 fade 字段 | block；由 09-01 的层类型清理处理 |

## 验收

| # | 场景 | 通过条件 |
|---|---|---|
| B1 | 纯黑淡入 | `color=#000000`、`mask_shape=full`、`blend_mode=normal`、opacity 0→1；游戏为整屏黑色渐入 |
| B2 | 纯白闪一下 | `color=#FFFFFF`、opacity 0→1→0；无渐变、无遮罩；走 fill 快路径 |
| B3 | 只给 R 打帧 | JSON 只有 `color.r` 关键帧；G/B 回落基色；游戏颜色按 R 变化 |
| B4 | 三通道都打帧 | 三通道都进效果面板；基色不参与采样；颜色按三通道合成 |
| B5 | 线性渐变 | `gradient.type=linear`；至少 2 stops；角度/中心可打帧；`gradient_radius` 不写 |
| B6 | 径向渐变 | `gradient.type=radial`；中心/半径可打帧；`gradient_angle` 不写 |
| B7 | 渐变 stop 边界 | offset 0.2/0.8 合法；0–1 外保持端点；少于 2 stop、非递增、ARGB 颜色 block |
| B8 | 删除渐变 | `gradient` 与全部 `gradient_*` 移除；恢复纯色编辑；一次撤销回退 |
| B9 | rect 遮罩 | `mask_x/y` 中心、`mask_width/height` 窗口比例；`mask_radius` 不写 |
| B10 | circle 遮罩 | `mask_x/y` 中心、`mask_radius` 短边比例；`mask_width/height` 不写 |
| B11 | full 遮罩 | 全部 `mask_*` 移除；纯色 + normal 走 fill |
| B12 | 非 normal 混合 | 下拉写五态之一；游戏读取下方画面；主画面 alpha 不变 |
| B13 | 0.5 秒退场 | 脚本实例退场时 fade/letterbox 层渐出约 0.5 秒；image/video/subtitle 不渐出，片段结束即移除，实例退场时仍活跃则保持到清理；同轨 clip 切换旧层直接移除；JSON 无渐出时长字段 |
| B14 | x/y 不生效 | fade 面板 0 命中 `x/y/anchor/scale`；JSON 不写这些字段 |
| B15 | 保存重开 | 基色、通道关键帧、stops、渐变几何、遮罩几何、混合模式原样保留 |

## 完成定义

- `fade` 的颜色、渐变、遮罩、混合全部由既有字段表达；
- 纯色/渐变互斥、遮罩形状/几何互斥、渐变类型/几何互斥在编辑面上无死控件；
- 0.5 秒退场不被误写成脚本字段；
- 编辑器不实现 shader、不做本地合成；
- 生成脚本可被 `ColorMaskSpec` / `FadeLayer` 直接消费。
