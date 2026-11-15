# 09-06 LETTERBOX 画幅层

## 目标

把 `LETTERBOX` 轨道编辑完整。

画幅层只在画面上覆盖黑边，不裁切画面、不改变相机、不改变 `ADJUST`、不改变 `OVERLAY` 的坐标。它是一条独立轨道，只有两个字段：`aspect_ratio` 与 `opacity`。

## 源码事实

- `LetterboxLayer` 是独立的画幅层，固定 `z = 0`，不在脚本 `z_index` 口径内。
- 每个 `LETTERBOX` 轨道各持一层：构造时 `OverlayManager.addLayer`，`onStop` 时移除；不同实例的层各自持有，清理按 owner，不会误删其他实例的层。
- 无素材，铺满窗口；`x/y/anchor/scale` 对它不生效；不乘分辨率转义 `k`。
- `aspect_ratio <= 0`：不绘制任何黑边。
- 目标画幅比更宽：`contentHeight = 窗口宽 / aspect_ratio < 窗口高` → 上下黑边。
- 目标画幅比更窄：`contentHeight > 窗口高`，`contentWidth = 窗口高 × aspect_ratio` → 左右黑边（pillarbox）。
- 两者相等：一条黑边都不画。
- 黑边 alpha = `opacity × 渐出系数 × 255`；alpha 为 0 不绘制。
- 退场渐出固定 0.5 秒，是 `LetterboxLayer` 内部常量，不是脚本字段。
- `LetterboxTrackPlayer` 空档时把 `aspect_ratio` 归 0、`opacity` 复位到 1；不残留前一片段的透明度。
- 同一 `LETTERBOX` 轨道同一时刻只有一个活跃片段：`findActiveClip` 返回 `clips()` 顺序里的第一个活跃片段；同轨后一个片段与前一个重叠时，后一个不会成层。

## 字段面

| 字段 | 模式 | 默认 | 范围 | 语义 |
|---|---|---|---|---|
| `aspect_ratio` | animated float | 2.35 | min 0 | 目标画幅比；宽/高 |
| `opacity` | animated float | 1 | 0–1 | 黑边整体透明度 |

没有 `layer_type`、`path`、`text`、`color`、`gradient`、`mask_shape`、`blend_mode`、`z_index`、`x/y/anchor/scale`。

## 画幅计算

以窗口宽 `W`、高 `H`、目标画幅比 `R` 计：

```text
contentHeight = W / R
```

- `contentHeight < H`：上下黑边；单边高度 = `(H - contentHeight) / 2`，四舍五入到像素；
- `contentHeight > H`：左右黑边；内容宽 = `H × R`，单边宽 = `(W - contentWidth) / 2`，四舍五入到像素；
- `contentHeight == H`：无黑边；
- `R <= 0`：无黑边。

`R` 是宽/高，不是高/宽：

| 目标 | 典型画面 |
|---|---|
| 2.35 | 宽银幕，上下黑边 |
| 2.39 | 宽银幕，上下黑边 |
| 1.85 | 遮幅宽银幕，上下黑边 |
| 16:9 ≈ 1.778 | 常见横屏，接近无黑边 |
| 4:3 ≈ 1.333 | 左右 pillarbox |
| 1:1 | 左右 pillarbox |
| 9:16 ≈ 0.5625 | 左右 pillarbox |

画幅层不裁切底图。底图仍然是整窗画面；黑边只是盖在上面的 GUI 层。相机取景、`ADJUST` 调色和世界渲染都不因画幅层改变。

## 透明度与退场

- `opacity` 0–1，默认 1；
- 黑边 alpha = `opacity × 渐出系数 × 255`；
- 0.5 秒渐出发生在**脚本实例退场**时：`PlaybackLifecycle.deactivate()` 调 `OverlayManager.startFadeOut(instance)`，`LetterboxLayer` 实现 `isAnimating()`，所以本层会渐出；
- 同一 `LETTERBOX` 轨道内 clip 结束/空档时，`LetterboxTrackPlayer` 直接把 `aspect_ratio` 设为 0，黑边立即消失，不走 0.5 秒层渐出；
- 渐出期间 `aspect_ratio` 不变，只降 alpha；
- 空档时 `aspect_ratio=0`、`opacity=1`；
- 编辑器不提供“渐出时长”字段；
- 手动淡入淡出用 `opacity` 关键帧；不要把 0.5 秒内部渐出当成脚本字段。

## 编辑面

### 属性面板

`LETTERBOX` 片段只显示：

1. `aspect_ratio`；
2. `opacity`。

不显示轨道类型、路径、文本、颜色、遮罩、渐变、混合、`z_index`、位置/锚点/缩放。

### `LetterboxAspectField`

- 数字输入：宽/高比；
- 预设按钮：2.35 / 2.39 / 1.85 / 16:9 / 4:3 / 1:1 / 9:16；
- 0 表示“不画黑边”；
- 小于 0 block；
- 允许小数；
- 不提供“上下/左右方向”开关：方向由窗口比例与 `R` 自动决定；
- 不提供“裁切”开关：画幅层不裁切。

### 预览示意

`OverlayGeometrySketch` 在 16:9 示意窗口里画：

- 目标画幅的内容框；
- 上下黑边或左右黑边；
- `R=0` 时不画黑边；
- 只表示遮幅几何，不表示最终画面，不采样底图。

### 效果面板

`aspect_ratio` 与 `opacity` 都是 animated；有 `keyframes.length > 0` 时进效果面板。value-only 字段没有。

## 多轨规则

- 每个 `LETTERBOX` 轨道各有一层，z 都是 0；
- 多层同时有画幅时，它们都按自己的 `aspect_ratio` 画黑边，后加入的层后绘制；
- 同一 z、稳定排序的结果是“后加入的层覆盖先加入的层”；
- 多层画幅叠加可能产生更厚的黑边或互相覆盖；编辑器在层级预览里给 warning；
- 推荐同一时刻只让一条 `LETTERBOX` 轨道有活跃片段；
- 同一轨道内后一个片段与前一个重叠时，后一个不会成层；要做画幅切换，请让前一个片段结束，或用另一条轨道并在编辑器确认叠加结果。

## 本地校验

| 检查 | 处理 |
|---|---|
| `aspect_ratio` 非有限数 | block |
| `aspect_ratio < 0` | block |
| `aspect_ratio = 0` | 允许；运行时不画黑边 |
| `opacity` 非有限数或超出 0–1 | block |
| 存在 `x/y/anchor/scale/z_index/path/text/...` | block；`LETTERBOX` 没有这些字段 |
| 同轨片段重叠 | warning；后一个片段不会成层 |
| 多条 LETTERBOX 轨道同时活跃 | warning；黑边可能叠加/覆盖 |

## 验收

| # | 场景 | 通过条件 |
|---|---|---|
| F1 | 2.35 画幅 | 16:9 窗口上下黑边；黑边高度正确；不裁切底图 |
| F2 | 4:3 画幅 | 16:9 窗口左右 pillarbox；内容宽 = H × 1.333 |
| F3 | 16:9 画幅 | 16:9 窗口无黑边 |
| F4 | `aspect_ratio=0` | 无黑边；不报错；不残留上一片段 |
| F5 | `opacity=0.5` | 黑边半透明；底图可见 |
| F6 | opacity 打帧 | 黑边淡入/淡出；效果面板出现 `opacity` |
| F7 | 脚本实例结束 | 实例退场时本层 0.5 秒渐出；JSON 无渐出时长字段 |
| F8 | 空档 | `aspect_ratio` 归 0、`opacity` 归 1；黑边立即消失，不走层渐出 |
| F9 | 多轨叠加 | 每轨各一层 z=0；后加入者后绘制；编辑器 warning |
| F10 | 同轨重叠 | 后一个重叠片段不成层；编辑器 warning |
| F11 | 字段边界 | JSON 不出现 `x/y/anchor/scale/z_index`；只写 `aspect_ratio/opacity` |
| F12 | 保存重开 | 两字段值/关键帧原样保留；无 UI 字段写盘 |

## 完成定义

- 画幅层只由 `aspect_ratio` / `opacity` 表达；
- 遮幅方向由窗口比例自动决定，不新增方向/裁切字段；
- 固定 z=0、0.5 秒退场、空档复位与代码一致；
- 多轨叠加与同轨重叠在编辑器有明确提示；
- 编辑器不做黑边合成，只做字段编辑与几何示意。
