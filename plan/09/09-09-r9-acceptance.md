# 09 验收

## 目标

按“编辑器写固定格式脚本 → 通过现有通道推给游戏 → 游戏播放真实结果”验收 09。验收覆盖：

- `OVERLAY` / `LETTERBOX` 字段面；
- `fade` 颜色、遮罩、渐变、混合；
- `image` 图片/GIF；
- `video` 视频；
- `subtitle` 字幕；
- `LETTERBOX` 画幅；
- `z_index` 与多轨；
- 便利脚本组件；
- 双面板归属；
- 数据 round-trip；
- 消息面与模组零改动；
- 构建与真游戏冒烟。

## 文档完整性

| 检查 | 通过条件 |
|---|---|
| 09 文件数 | 10：`README.md` + 9 份任务文档 |
| README 链接 | 9 个任务链接全部指向存在的文件；无死链 |
| 单 H1 | 每份文档恰好一个一级标题 |
| 任务边界 | 每份文档有目标、字段面/数据合同、编辑面、验收；没有“只写 README”的轮次 |
| 面板归属 | `selection.properties` / `clip.effects` / `OverlayOrderPopover` 职责不重叠 |
| 可写字段 | 只写 `OVERLAY` / `LETTERBOX` 既有字段；无 UI/宿主/版本字段 |
| 实现基线 | 09 文档只引用当前字段面与现行合同 |

## A. 字段面

| # | 场景 | 通过条件 |
|---|---|---|
| A1 | 选中 fade | 只显示 fade 字段组；0 命中 `x/y/anchor/scale/source/path/text/font_scale` |
| A2 | 选中 image | 只显示 image 字段组；0 命中颜色/遮罩/渐变/文本/字号 |
| A3 | 选中 subtitle | 只显示 subtitle 字段组；0 命中素材/颜色/遮罩/渐变 |
| A4 | `layer_type` 缺失 | 显示 effective fade；不报错；首次编辑写显式 fade |
| A5 | fade→image | 保留 `opacity/z_index`；移除 fade 字段；一次撤销回退 |
| A6 | image→fade | 保留 `opacity/z_index`；移除 `x/y/anchor/scale/source/path` |
| A7 | subtitle→image | 保留 `x/y/anchor/scale/opacity/z`；移除 `text/font_scale` 及颜色/遮罩/渐变残留 |
| A8 | `color.r` 打帧 | 属性面板不再显示该值控件；效果面板出现该叶子；删最后一帧回流 |
| A9 | value-only | `layer_type/color/gradient/mask_shape/blend_mode/path/text/z_index` 在效果面板 0 命中 |
| A10 | `ObjectValidator` | 切换后不再出现“字段不适用于 layer_type”的 issue |
| A11 | 未知键 | 保留供诊断；不静默删除；不进入 UI；推送前校验报未知对象路径并定位 |
| A12 | 保存重开 | 字段值、关键帧、层类型、未知键原样保留 |

## B. fade

| # | 场景 | 通过条件 |
|---|---|---|
| B1 | 纯黑淡入 | `color=#000000`、full、normal；opacity 0→1；游戏整屏黑色渐入 |
| B2 | 纯白闪 | `color=#FFFFFF`；opacity 0→1→0；无渐变/遮罩 |
| B3 | 只给 R 打帧 | JSON 只有 `color.r`；G/B 回落基色；游戏按 R 变化 |
| B4 | 三通道打帧 | 三通道进效果面板；基色不参与采样 |
| B5 | linear 渐变 | 至少 2 stops；写 angle/center；不写 radius |
| B6 | radial 渐变 | 至少 2 stops；写 center/radius；不写 angle |
| B7 | 渐变边界 | offset 0.2/0.8 合法；范围外保持端点；少于 2/非递增/ARGB block |
| B8 | 删除渐变 | `gradient` 与 `gradient_*` 移除；恢复纯色编辑；一次撤销 |
| B9 | rect 遮罩 | `mask_x/y` 中心、`mask_width/height` 窗口比例；不写 radius |
| B10 | circle 遮罩 | `mask_x/y` 中心、`mask_radius` 短边比例；不写 width/height |
| B11 | full 遮罩 | 全部 `mask_*` 移除；纯色+normal 走 fill |
| B12 | 非 normal 混合 | 五态之一；游戏读取下方画面；主画面 alpha 不变 |
| B13 | 0.5 秒退场 | 脚本实例退场时 fade/letterbox 层渐出约 0.5 秒；image/video/subtitle 不渐出，片段结束即移除；JSON 无渐出时长字段 |
| B14 | x/y 不生效 | fade 面板 0 命中 `x/y/anchor/scale`；JSON 不写 |

## C. 图片

| # | 场景 | 通过条件 |
|---|---|---|
| C1 | PNG | `path` 写入；游戏按素材像素 × k × scale 绘制 |
| C2 | GIF | 标记 GIF；游戏按局部时间轮播；无 GIF 速度/循环字段 |
| C3 | 空路径 | 层保留；游戏不绘制；不占位 |
| C4 | 文件不存在 | 编辑器 warning；游戏不绘制；无错误占位 |
| C5 | x/y | 0.5/0.5 居中；0/0 左上；1/1 右下；不自动夹 |
| C6 | anchor | 0.5 绕中心；0/0 绕左上；1/1 绕右下 |
| C7 | scale | 1=1:1；2=双倍；0/负数 warning 且不绘制 |
| C8 | source 整幅 | 不写多余字段 |
| C9 | source 裁切 | 只画裁切区；越界钳制；负宽高 block |
| C10 | base_resolution | 缺省 1920×1080；meta 改变时 k 改变；片段面板不新增字段 |
| C11 | 打帧 | `x/y/scale/source/opacity` 有帧进效果面板；`path/z_index` 不进 |

## D. 视频

| # | 场景 | 通过条件 |
|---|---|---|
| D1 | mp4 | `layer_type=image` + mp4；创建 VideoLayer；无视频专属字段 |
| D2 | 大写 `.MP4` | 仍识别；扩展名大小写不敏感 |
| D3 | 缺 ffmpeg | 游戏不显示、不占位；不画棋盘格；编辑器无假状态 |
| D4 | 坏文件 | 游戏画 1920×1080 黑洋红棋盘格；按图层几何 |
| D5 | 空路径 | 不创建视频层；不报视频错误 |
| D6 | 几何 | 与图片层同一公式；按源分辨率参与几何 |
| D7 | source | 裁切视频；越界钳制；负宽高 block |
| D8 | 4K 上限 | 8K 等比缩到 4096×2160 内；不放大 |
| D9 | 暂停 | 时间不变停帧；恢复继续 |
| D10 | seek 回退 | >0.05s 重开；小抖动不重开 |
| D11 | seek 前进 | >1.0s 重开；正常推进不重开 |
| D12 | 音轨 | 含音轨自动播放；固定 MASTER；无音量/淡入/空间化字段 |
| D13 | 错误纹理 | 1920×1080 虚拟素材；source 仍作用 |
| D14 | 保存重开 | 路径/几何/source/opacity/z 保留；无视频专属字段 |

## E. 字幕

| # | 场景 | 通过条件 |
|---|---|---|
| E1 | 单行 | 白色 9px 基准；无颜色字段 |
| E2 | 多行 | `\n` 分行；行高正确；末尾空行增加高度；不自动换行 |
| E3 | 中英混排 | 最长行决定文字块宽 |
| E4 | `font_scale=2` | 文字块与字号同时放大；锚点不偏 |
| E5 | `scale_x/y` | 与 `font_scale` 叠加 |
| E6 | `@lang:` 命中 | 预览译文；保存仍为引用串 |
| E7 | `@lang:` 未命中 | 回退 en_us；再未命中显示引用串 |
| E8 | `@@lang:` | 字面显示 `@lang:key` |
| E9 | 非法 key | 原样显示；编辑器提示 |
| E10 | 空文本 | 不绘制；不占位 |
| E11 | 低透明度 | opacity < 0.016 不绘制；warning |
| E12 | 文本打帧 | 效果面板 0 命中 `text` |
| E13 | 保存重开 | 文本/`\n`/引用串/关键帧原样保留 |

## F. LETTERBOX

| # | 场景 | 通过条件 |
|---|---|---|
| F1 | 2.35 | 上下黑边；高度正确；不裁切底图 |
| F2 | 4:3 | 左右 pillarbox；内容宽 = H × 1.333 |
| F3 | 16:9 | 16:9 窗口无黑边 |
| F4 | ratio=0 | 无黑边；不报错；不残留 |
| F5 | opacity=0.5 | 半透明黑边；底图可见 |
| F6 | opacity 打帧 | 黑边淡入/淡出 |
| F7 | 脚本实例结束 | 本层 0.5 秒渐出；JSON 无渐出时长 |
| F8 | 空档 | ratio 0、opacity 1；无黑边 |
| F9 | 多轨 | 每轨一层 z0；后加入者后画；warning |
| F10 | 同轨重叠 | 后一个不成层；warning |
| F11 | 字段边界 | JSON 无 `x/y/anchor/scale/z_index` |

## G. 层级与多轨

| # | 场景 | 通过条件 |
|---|---|---|
| G1 | 单轨 z10 | 一个层；按 z 排序 |
| G2 | 两条 z10/30 | 10 在下、30 在上 |
| G3 | 同 z | 稳定排序；warning；显示插入顺序 |
| G4 | OVERLAY + LETTERBOX | 黑边 z0 在下；覆盖层在上 |
| G5 | z=-1 | 画在黑边下面；warning |
| G6 | z=0 | 与黑边同 z；按插入；warning |
| G7 | 同轨重叠 | 后一个不成层；标出重叠区；提示拆轨 |
| G8 | 片段切换 | 旧层移除、新层创建；z 只在建层读 |
| G9 | 多轨 | 每轨一层；层级预览列出全部 |
| G10 | 多 LETTERBOX | 每轨一层 z0；warning 叠加 |
| G11 | 层级预览 | 跟随播放头、只读、不写盘、不建第二时钟 |
| G12 | 与 CAMERA | 不显示 lane；不共享 z 表 |

## H. 便利组件

| # | 场景 | 通过条件 |
|---|---|---|
| H1 | fade.in | 生成 fade/黑/full/normal/opacity 0→1；无渐出时长 |
| H2 | fade.linear-wash | 合法 gradient；linear 几何；不写 radius |
| H3 | fade.radial-wash | 合法 gradient；radial 几何；不写 angle |
| H4 | fade.circle | circle 只写 radius；不写 width/height |
| H5 | image.center | 只写几何/source；不写 path |
| H6 | image.crop-center | 只改 source |
| H7 | video.pip | 仍 layer_type=image；无视频字段 |
| H8 | subtitle.lower-third | 只写位置/字号；无颜色/字体 |
| H9 | letterbox.235 | 只写 aspect/opacity；无方向/裁切 |
| H10 | overlay.z.subtitle | 只改 z；不重排其他片段 |
| H11 | diff | 新增/修改/删除/关键帧四类可见 |
| H12 | 撤销 | 一次应用=一个 commit；一次撤销全部回退 |
| H13 | 未知键 | 应用预设不删除未知键 |
| H14 | 字段来源 | 所有预设字段都能在 schema 找到 |
| H15 | 消息 | 不新增 WebSocket 消息 |

## I. 数据与序列化

| # | 检查 | 通过条件 |
|---|---|---|
| I1 | `objects` | 所有字段在 `objects` 内，不扩到片段顶层 |
| I2 | 缺省 | 不把默认值补进 JSON；清除覆盖删除空对象 |
| I3 | 未知键 | 保留供诊断；不静默删除 |
| I4 | round-trip | 保存→重开→再保存，值/关键帧/结构/未知键一致 |
| I5 | 无新顶层字段 | 不写版本号、总时长、UI 选中态、lane、composition |
| I6 | 无新脚本字段 | 不写 `video_*`、`subtitle_color`、`fit`、`letterbox_direction` |
| I7 | `authoring` | 不写编辑器视图状态、播放头、面板 tab、预览开关 |
| I8 | 预设 | 预设本身不写盘；只写字段 |

## J. 消息面

| # | 检查 | 通过条件 |
|---|---|---|
| J1 | 校验 | 使用既有 `script.validate`；`doc` 是对象 |
| J2 | 推送 | 使用既有 `editor.pushScript`；`script` 是字符串 |
| J3 | seek | 使用既有 `editor.seek`；time 为主时间轴播放头 |
| J4 | 播放控制 | 使用既有 `editor.play/pause/stop` |
| J5 | 状态 | 以 `playback.state` 为准；不伪造 |
| J6 | 资源 | 使用既有 `resource.list`；图片 `kind=image`、视频 `kind=all`、语言 `kind=lang` |
| J7 | 无新增 type | 不新增消息类型；不新增字段；不新增本地运行时 |

## K. 模组零改动

在 `E:\Documents\GitHub\ImmersiveCinematics`：

```text
git status --porcelain
```

通过条件：

- 没有 09 引入的 `.java` 修改；
- `OverlayTrackPlayer` / `OverlayClipRuntime` / `LetterboxTrackPlayer` / `OverlayManager` / `FadeLayer` / `ImageLayer` / `VideoLayer` / `SubtitleLayer` / `LetterboxLayer` / `ColorMaskSpec` / `ColorMaskRenderer` / `TrackSchemas` / `ObjectValidator` 保持原样；
- 没有新增消息类型；没有新增脚本字段；没有新增资源状态消息；
- 编辑器仓库只新增 09 文档/09 模块；不改 08 文档结论。

## L. 构建

| # | 检查 | 通过条件 |
|---|---|---|
| L1 | `npm run build` | 通过；无 TypeScript 错误 |
| L2 | 面板懒加载 | 新组件不全部进首屏包 |
| L3 | 主题 | token 化；无写死 hex；深浅色可读 |
| L4 | 无障碍 | 输入/下拉/按钮有标签；键盘可操作；错误不只靠颜色 |
| L5 | 实现基线 | 09 文档与代码只使用当前字段面/现行合同 |

## M. 真游戏冒烟

### 准备

在 `E:\Documents\GitHub\ImmersiveCinematics` 的资源目录准备：

- `resource/r9-test.png`：一张可辨认的静态图；
- `resource/r9-test.gif`：小尺寸 GIF，帧数 ≤ 256、单边 ≤ 1024；
- `resource/r9-test.mp4`：约 3 秒、含音轨、分辨率不超过 4K；
- `resource/lang/en_us.json` 增加 `r9.test` 译文；
- 确保 `<gameDir>/ffmpeg/` 下有 `ffmpeg` 与 `ffprobe`。

### 脚本

```text
meta.base_resolution = 1920x1080

LETTERBOX 1
  start_time = 0, duration = 8
  aspect_ratio = 2.35, opacity = 1

OVERLAY 1
  start_time = 0, duration = 8
  layer_type = fade
  color = #000000
  mask_shape = full
  blend_mode = normal
  opacity keyframes: 0s=1, 1s=0, 6s=0, 7s=1
  z_index = 15

OVERLAY 2
  start_time = 2, duration = 3
  layer_type = image
  path = r9-test.png
  x = 0.5, y = 0.5, anchor_x = 0.5, anchor_y = 0.5, scale_x = 1, scale_y = 1
  source.x = 0, source.y = 0, source.w = 1, source.h = 1
  opacity = 1
  z_index = 10

OVERLAY 3
  start_time = 2.5, duration = 2
  layer_type = fade
  gradient = { type: radial, stops: [
    { offset: 0, color: #000000 },
    { offset: 1, color: #FF8800 }
  ] }
  gradient_center_x = 0.5, gradient_center_y = 0.5, gradient_radius = 0.6
  mask_shape = circle
  mask_x = 0.5, mask_y = 0.5, mask_radius = 0.25
  blend_mode = screen
  opacity = 0.35
  z_index = 20

OVERLAY 4
  start_time = 2.5, duration = 2
  layer_type = subtitle
  text = @lang:r9.test
  x = 0.5, y = 0.85, anchor_x = 0.5, anchor_y = 0.5
  font_scale = 1.5, scale_x = 1, scale_y = 1
  opacity = 1
  z_index = 30

OVERLAY 5
  start_time = 5, duration = 3
  layer_type = image
  path = r9-test.mp4
  x = 0.5, y = 0.5, anchor_x = 0.5, anchor_y = 0.5, scale_x = 1, scale_y = 1
  source.x = 0, source.y = 0, source.w = 1, source.h = 1
  opacity = 1
  z_index = 10
```

### 步骤

1. 编辑器打开脚本：五个 `OVERLAY` 片段分别显示 fade / image / fade / subtitle / video 的字段面；`LETTERBOX` 只显示 `aspect_ratio/opacity`。
2. 校验通过；推送并 seek 到 0.5s：黑边在；fade 黑色约半透明；画面整体压暗。
3. seek 到 2.5s：图片在；径向渐变+circle 遮罩的 fade 在图片上方；字幕在最上方；层级预览顺序为 LETTERBOX z0 → image z10 → fade 1 z15（此时 opacity=0，层存在但不绘制）→ gradient fade z20 → subtitle z30。
4. seek 到 3.5s：字幕 `@lang:r9.test` 显示英文回退；图片、径向渐变、circle 遮罩同时可见；渐变边缘与遮罩边界正确。
5. seek 到 5.2s：图片结束；视频开始；视频按源分辨率参与几何；视频音轨随画面播放；字幕已结束；黑边在。
6. seek 到 6.5s：视频继续；fade 正在回黑（半透明）；视频在 fade 下面；黑边在。
7. seek 到 7.5s：fade 全黑；视频仍在下面；字幕/图片不在；黑边在。
8. seek 到 8.5s：脚本实例已结束；FadeLayer/LetterboxLayer 的 0.5 秒渐出完成；Image/Video/Subtitle 不渐出，在片段/实例结束处清理，8.5s 已无残留；画面回到无 HUD 状态。
9. 把 `OVERLAY 2` 的 `path` 改成不存在的 `missing.png`：游戏不绘制图片、不占位；编辑器显示“未在资源列表中找到”。
10. 把 `OVERLAY 5` 的 `path` 改成不存在的 `missing.mp4`：有 ffmpeg 时游戏画黑洋红棋盘格；临时移除 ffmpeg/ffprobe 后再播，视频不显示、不占位；恢复工具链。
11. 在 `OVERLAY 2` 加一个 4.5–6s 的重叠片段：编辑器标出重叠区并提示“后一个不会成层”；游戏 4.5–5s 仍显示第一个片段，5s 后第一个结束、后一个才开始。
12. 保存重开：全部片段字段、关键帧、`gradient`、`mask_*`、`z_index`、`LETTERBOX` 两字段原样保留；JSON 无 UI/宿主字段。
13. 运行 `npm run build`；运行模组 `git status --porcelain`，确认无 09 引入的 `.java` 修改。

通过条件：以上 13 步全通过；任何一步失败按 A–L 对应项定位，不以编辑器示意替代游戏结果。

## 签收

- 10 份文档齐全，README 链接有效；
- A–L 全通过；
- M 真游戏冒烟通过；
- 没有新增消息、没有新增脚本字段、没有改模组 `.java`；
- 编辑器不实现像素级画面处理，所有最终画面由游戏播放。
