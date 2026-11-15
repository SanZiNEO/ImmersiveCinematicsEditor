# 09-08 覆盖层便利脚本组件

## 目标

09 的便利组件只做一件事：把常用结构写成现有字段。

它们不是运行时，不是合成器，不是“效果模板引擎”。每个预设都输出一段可被游戏解析的 `OVERLAY` / `LETTERBOX` 片段结构；应用后仍然是普通脚本，作者可以逐字段继续改。

## 原则

- 只写 `OVERLAY` / `LETTERBOX` 已有字段；
- 不新增字段、不新增消息、不改模组；
- 不写 `authoring`、`lane`、`composition`、UI 选中态、播放状态；
- 不自动改 CAMERA、`transition`、`ADJUST`；
- 不自动改其他片段，除非作者显式选择“新建片段”；
- 应用前显示字段 diff：新增/修改/删除；
- 一次应用 = 一个 commit；一次撤销全部回退；
- 预设本身不序列化；脚本里只有字段；
- 预览只做色板、渐变条、几何示意；不做像素合成；
- 图片/视频预设只给“起始位置/缩放/取材”，不承诺按素材尺寸精确适配；素材实际尺寸由运行时决定。

## 预设注册结构

```ts
type OverlayPreset = {
  id: string;
  label: string;
  target: "fade" | "image" | "subtitle" | "letterbox" | "any";
  mode: "new-clip" | "apply-to-selected" | "both";
  fields: Record<string, unknown>;
  keyframes?: Array<{
    path: string;
    frames: Array<{ time: number; value: number; interp?: "linear" | "step" }>;
  }>;
  remove?: string[];
};
```

约束：

- `fields` 的键必须出现在 `TrackSchemas.overlayObjects()` / `letterboxObjects()`；
- `keyframes` 的 `path` 必须是 animated 字段；
- `remove` 只能删除当前层类型不适用的字段；
- 应用时保留未知键、保留未涉及的字段；
- 不写默认值填充；只有预设明确给出的字段才写。

表中的 `anchor` 是 `anchor_x/anchor_y` 的简写，`scale` 是 `scale_x/scale_y`，`source=a/b/c/d` 是 `source.x=a, source.y=b, source.w=c, source.h=d`；落盘时写完整字段名，不写简写。

## fade 预设

| id | 名称 | 写入 | 说明 |
|---|---|---|---|
| `fade.in` | 淡入 | `layer_type=fade`、`color=#000000`、`mask_shape=full`、`blend_mode=normal`、`opacity` 0→1 | 片段前 0.5 秒淡入；片段短于 0.5 秒时用片段时长 |
| `fade.out` | 淡出 | 同上；`opacity` 1→0 | 片段后 0.5 秒淡出；片段短于 0.5 秒时用片段时长 |
| `fade.flash` | 闪白 | `color=#FFFFFF`、full、normal、`opacity` 0→1→0 | 中段峰值 1；起止 0 |
| `fade.wash` | 纯色罩 | `color` 由作者选；full、normal、`opacity` 静态 0.25 | 不做关键帧；适合常驻色调 |
| `fade.linear-wash` | 线性渐变罩 | `gradient={type:"linear", stops: [...]}`；`gradient_angle=0`；`gradient_center_x/y=0.5`；`mask_shape=full`；`blend_mode=normal` | stops 至少 2；默认黑→白；不写 `gradient_radius` |
| `fade.radial-wash` | 径向渐变罩 | `gradient={type:"radial", stops: [...]}`；`gradient_center_x/y=0.5`；`gradient_radius=0.7`；full、normal | 不写 `gradient_angle` |
| `fade.rect` | 矩形色块 | `mask_shape=rect`；`mask_x/y=0.5`；`mask_width/height=0.6`；纯色、normal | 只覆盖中间矩形；不是裁切 |
| `fade.circle` | 圆形色块 | `mask_shape=circle`；`mask_x/y=0.5`；`mask_radius=0.3`；纯色、normal | 只覆盖圆形区域；不是抠图 |

### fade 预设的边界

- `fade.in` / `fade.out` / `fade.flash` 只写 `opacity` 关键帧，不写 0.5 秒内部渐出字段；
- `fade.linear-wash` / `fade.radial-wash` 的 stops 颜色必须是 `#RRGGBB`，不能带 alpha；
- 不提供“透明渐变 / 暗角 / 反向聚光灯”预设：脚本的 stop 颜色没有 alpha，遮罩只决定覆盖区域，不是透明度渐变；
- 不提供 LUT / 曲线 / 曝光预设：那是 `ADJUST` 轨，不属于 09。

## image / video 预设

| id | 名称 | 写入 | 说明 |
|---|---|---|---|
| `image.center` | 居中 1:1 | `x=0.5`、`y=0.5`、`anchor=0.5`、`scale=1`、`source=0/0/1/1` | 素材原始像素 × k，居中 |
| `image.lower-third` | 下方居中 | `x=0.5`、`y=0.82`、`anchor=0.5`、`scale=1`、source 整幅 | 字幕/角标起始位置 |
| `image.corner` | 左上角 | `x=0.18`、`y=0.18`、`anchor=0.5`、`scale=1`、source 整幅 | 角标起始位置；不保证贴边 |
| `image.crop-center` | 中央裁切 | `source=0.25/0.25/0.5/0.5` | 只改 source，不改几何 |
| `image.crop-top` | 上半裁切 | `source=0/0/1/0.5` | 只改 source |
| `image.half` | 半尺寸 | `scale=0.5` | 相对素材像素缩半 |
| `video.center` | 视频居中 | 与 `image.center` 相同 | 视频层仍 `layer_type=image` |
| `video.pip` | 画中画起始 | `x=0.82`、`y=0.82`、`anchor=0.5`、`scale=0.35`、source 整幅 | 起始位置；实际大小随源分辨率 |
| `video.crop-center` | 视频中央裁切 | `source=0.25/0.25/0.5/0.5` | 只改 source |

### 媒体预设的边界

- 预设不写 `path`，路径由作者选择；
- 视频预设不写视频音量、淡入、空间化字段；不存在这些字段；
- 不提供“铺满屏幕”预设：脚本没有 fit/cover 字段，是否铺满取决于素材像素、`scale` 与 `k`；
- 不提供“自动裁黑边/智能构图”预设：编辑器不分析素材内容。

## subtitle 预设

| id | 名称 | 写入 | 说明 |
|---|---|---|---|
| `subtitle.lower-third` | 下方字幕 | `x=0.5`、`y=0.85`、`anchor=0.5`、`font_scale=1`、`scale=1` | 文本由作者填写 |
| `subtitle.center-title` | 居中标题 | `x=0.5`、`y=0.5`、`anchor=0.5`、`font_scale=2`、`scale=1` | 大字号标题 |
| `subtitle.top-note` | 上方注释 | `x=0.5`、`y=0.12`、`anchor=0.5`、`font_scale=1`、`scale=1` | 顶部说明 |
| `subtitle.two-line` | 两行字幕 | 同上位置；`text` 写两行占位文本 | 两行由 `\n` 分隔；不是自动换行 |

### 字幕预设的边界

- 不写颜色、字体家族、描边、背景框；
- 不写 `@lang:` 译文；预设只写带 `@lang:key` 的占位或普通文本；
- 不自动把长文本拆行；`\n` 由作者控制；
- 不自动调整 `font_scale` 去适配窗口宽度。

## letterbox 预设

| id | 名称 | 写入 |
|---|---|---|
| `letterbox.235` | 2.35:1 | `aspect_ratio=2.35`、`opacity=1` |
| `letterbox.239` | 2.39:1 | `aspect_ratio=2.39`、`opacity=1` |
| `letterbox.185` | 1.85:1 | `aspect_ratio=1.85`、`opacity=1` |
| `letterbox.169` | 16:9 | `aspect_ratio≈1.7778`、`opacity=1` |
| `letterbox.43` | 4:3 | `aspect_ratio≈1.3333`、`opacity=1` |
| `letterbox.11` | 1:1 | `aspect_ratio=1`、`opacity=1` |
| `letterbox.916` | 9:16 | `aspect_ratio=0.5625`、`opacity=1` |
| `letterbox.fade-in` | 黑边淡入 | 目标比值 + `opacity` 0→1 |

### 画幅预设的边界

- 不写方向；上下/左右由窗口比例自动决定；
- 不写 `z_index`；`LETTERBOX` 固定 z0；
- 不写 `x/y/anchor/scale`；
- 不做裁切；预设只改黑边，不改底图。

## 层级预设

| id | 名称 | 写入 |
|---|---|---|
| `overlay.z.default` | 默认层 | `z_index=10` |
| `overlay.z.background` | 背景覆盖层 | `z_index=20` |
| `overlay.z.subtitle` | 字幕层 | `z_index=30` |

- 只改选中片段的 `z_index`；
- 不建立全局 z 表；
- 不按预设自动重排其他片段；
- 同 z 仍按 `09-07` 的稳定插入顺序。

## 应用流程

1. 选择预设；
2. 选择“新建片段”或“应用到当前片段”；
3. 显示 diff：
   - 新增字段；
   - 修改字段（旧值 → 新值）；
   - 删除字段；
   - 新增关键帧；
4. 作者确认；
5. 一次 commit；
6. 撤销一次全部回退。

### 新建片段

- 写入 `start_time`、`duration`；
- 写入 `objects`；
- 轨道类型由预设决定：`OVERLAY` 或 `LETTERBOX`；
- 不自动选择轨道；由作者指定目标轨道；
- 不自动移动相邻片段。

### 应用到当前片段

- 只改预设涉及的字段；
- 保留无关字段；
- 保留未知键；
- 如果当前 `layer_type` 与预设 `target` 不符：
  - `target=any`：直接应用；
  - 否则先走 `09-01` 的层类型转换，再应用；
  - 转换与预设应用合并为一次 commit。

## 本地校验

| 检查 | 处理 |
|---|---|
| 预设字段不在 schema | 开发期报错；不注册该预设 |
| `target` 与当前层类型不符且未转换 | block |
| `keyframes` 路径不是 animated | 开发期报错 |
| `keyframes` 时间非有限/负数 | block |
| 写入 `gradient` 但 stops 少于 2/颜色非法 | block |
| 写入 `mask_shape` 但几何非法 | block |
| 写入 `path` 为空 | 允许；层不绘制 |
| 写入 `z_index` 非整数 | block |
| 预设试图写 `authoring/lane/composition` | 开发期报错 |
| 预设试图写 `ADJUST/transition/CAMERA` 字段 | 开发期报错 |

## 验收

| # | 场景 | 通过条件 |
|---|---|---|
| H1 | fade.in | 生成 `layer_type=fade`、黑、full、normal、opacity 0→1；无渐出时长字段 |
| H2 | fade.linear-wash | `gradient` 合法；linear 写 angle/center；不写 radius |
| H3 | fade.radial-wash | `gradient` 合法；radial 写 center/radius；不写 angle |
| H4 | fade.circle | `mask_shape=circle`；只写 radius；不写 width/height |
| H5 | image.center | 只写几何/source；不写 path |
| H6 | image.crop-center | 只改 source；几何不变 |
| H7 | video.pip | 仍 `layer_type=image`；无视频专属字段 |
| H8 | subtitle.lower-third | 只写位置/字号；无颜色/字体字段 |
| H9 | letterbox.235 | 只写 `aspect_ratio/opacity`；无方向/裁切字段 |
| H10 | overlay.z.subtitle | 只改 `z_index=30`；不重排其他片段 |
| H11 | diff | 新增/修改/删除/关键帧四类可见；应用前可见 |
| H12 | 撤销 | 一次应用=一个 commit；一次撤销全部回退 |
| H13 | 未知键 | 应用预设不删除片段里已有的未知键 |
| H14 | 无新字段 | 所有预设字段都能在 `TrackSchemas` 找到 |
| H15 | 无消息 | 不新增 WebSocket 消息；预设只在编辑器内运行 |

## 完成定义

- 预设只写既有字段；
- 预设不碰 CAMERA / transition / ADJUST；
- 预设不实现合成，不做像素预览；
- 应用/撤销是原子的；
- 所有预设都能被游戏现有解析器消费。
