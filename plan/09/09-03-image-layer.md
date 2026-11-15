# 09-03 图片层

## 目标

把 `layer_type=image` 的图片层编辑完整：素材路径、素材存在性提示、取材、位置、锚点、缩放、透明度、层级。

视频也走 `layer_type=image`，但视频的识别、解码、音轨和错误状态单独放在 `09-04`。本文件只处理静态图片与 GIF。

## 源码事实

- `OverlayTrackPlayer.createObjectLayer()` 对 `layer_type=image` 先看路径扩展名：`mp4/webm/mkv` 走 `VideoLayer`，其余走 `ImageLayer`。
- `ImageLayer` 从 `TextureLoader.loadTexture(fileName)` 取纹理；文件不存在、加载失败、GIF 超限，都会得到 `null` 纹理，层不绘制，也不占位。
- `TextureLoader` 支持 PNG 静态图与 GIF；GIF 上限 256 帧、单边 1024，超限直接拒绝。
- `TextureLoader.getTextureSize(fileName)` 给出素材原始像素；未加载/失败返回 `null`，`ImageLayer` 直接不绘制。
- `ImageLayer` 的 `opacity` 初值是 0，由播放器在层创建后补 1；脚本字段缺省仍是 1。
- `ImageLayer` 没有颜色、遮罩、渐变字段；这些字段即使存在于同一片段，运行时也不读。
- `ImageLayer` 的局部时间用于 GIF 帧索引；静态图不受时间影响。

## 字段面

| 字段 | 模式 | 默认 | 语义 |
|---|---|---|---|
| `path` | value string | 空 | 资源根目录下的图片路径；相对路径 |
| `x` / `y` | animated float | 0.5 | 未缩放基准矩形的中心，窗口归一化 |
| `anchor_x` / `anchor_y` | animated float | 0.5 | 元素自身归一化；0 = 左/上缘，1 = 右/下缘；缩放绕点；schema 无 min/max，运行时不钳制 |
| `scale_x` / `scale_y` | animated float | 1 | 相对裁切后素材像素的倍数；1 = 素材 1:1 像素 |
| `source.x/y/w/h` | animated float | 0 / 0 / 1 / 1 | 素材归一化取材矩形；缺省整幅 |
| `opacity` | animated float 0–1 | 1 | 层透明度；≤ 0.001 不绘制 |
| `z_index` | value int | 10 | 建层时排序；规则见 09-07 |

`path` 是 value-only，没有时钟；不能在片段内关键帧切换素材。

## 素材路径

### 路径格式

- 资源根目录下的相对路径，例如 `overlays/title.png`；
- 扩展名决定加载方式：`.png` 静态图，`.gif` 动图；
- 静态图与 GIF 之外的后缀不由 `ImageLayer` 处理；
- 路径大小写按文件系统实际；扩展名识别按小写；
- 空路径：层可以存在，但没有纹理，不绘制；编辑器显示“未选择素材”。

### 素材列表

- 使用既有 `resource.list(kind=image)`：只列 `png/gif`；
- 不把视频混进图片列表；视频选择走 09-04 的 `kind=all` 过滤；
- 列表返回的相对路径直接写入 `path`；
- 列表没有返回的文件，编辑器标“未在资源列表中找到”，不伪造“运行时会加载”。

### 缺失与失败

- 文件不存在：`TextureLoader` 返回 null；层不绘制、不占位；
- 加载失败：同上；
- GIF 超限：同上；
- `getTextureSize` 返回 null：同上；
- 编辑器只能根据 `resource.list` 判断“路径是否存在于资源列表”；不能判断 ffmpeg、解码、GIF 帧数等运行状态；不显示假的加载成功状态。

## 几何

### 公式

`ImageGeometry` 与 `VideoLayer` 共用同一套数学：

```text
k = min(播放宽 / W基, 播放高 / H基)
B = (裁切后素材宽 × k, 裁切后素材高 × k)
中心 = (x × 播放宽, y × 播放高)
TL0 = 中心 - B / 2
A = TL0 + (anchor_x × B.x, anchor_y × B.y)
TL = A - (anchor_x × B.x × scale_x, anchor_y × B.y × scale_y)
S = (B.x × scale_x, B.y × scale_y)
```

- `W基/H基` 来自 `meta.base_resolution`，缺省 1920×1080；
- `k` 是单一系数，宽高共用；不是分别拉伸；
- `B` 是裁切后素材像素乘 `k`，不是窗口尺寸；
- 素材恒按元素框铺满，没有独立“适应/填充/拉伸”字段；
- `x/y` 是未缩放基准矩形的中心，不是左上角；
- `anchor` 是缩放不动点；`anchor=0.5` 绕中心缩放；
- 归一化坐标不钳制；越界元素按公式落到窗口外；
- `scale <= 0` 会得到零或负尺寸，运行时不绘制；编辑器给 warning，不自动改值。

### 取材

`source` 是素材归一化矩形：

- `source.x/y` 原点在素材左上角；
- `source.w/h` 是裁出宽高比例；
- 缺省 `{0,0,1,1}` 整幅；
- 运行时先 `clamp01` 起点，再 `clamp01(x+w) - u0` 得到裁切宽；高同理；
- 越界会被钳制到素材内；
- `source.w/h < 0` 或裁切结果 ≤ 0：运行时不绘制；编辑器 block 负值；
- `source.x+w` / `source.y+h` 超出 0–1：允许保存，编辑器给 warning 并显示“运行时钳制后的有效取材”；
- `source` 是 animated，可以打帧做“取材窗口移动”。

### 基准分辨率

`base_resolution` 不是 `OVERLAY` 片段字段，是脚本 `meta` 字段：

- 缺省 1920×1080；
- 必须宽高同时为正整数；缺一即脚本解析错误；
- 编辑器在脚本元数据里编辑，不在图片层属性面板里重复造一个 `base_resolution`；
- 图片层属性面板只显示当前 `W基/H基` 的只读摘要，方便理解 `scale` 的实际像素。

## GIF

- `TextureLoader` 加载 GIF 后按局部时间轮播；
- 上限 256 帧、单边 1024；超限直接拒绝，层不绘制；
- 帧延迟按 GIF 数据，最小 1ms；
- GIF 仍按 `source` 裁切、按 `scale` 缩放；
- 编辑器不实现 GIF 播放预览；只显示“GIF”标记与路径；
- 不新增 GIF 速度、循环、帧范围字段；运行时没有这些脚本字段。

## 编辑面

### 属性面板

图片层显示：

1. `layer_type`；
2. 素材路径（`OverlayMediaField`）；
3. 位置 / 锚点 / 缩放；
4. 取材；
5. 透明度；
6. 层级。

不显示：`font_scale`、`text`、`color`、`color.r/g/b`、`gradient`、`gradient_*`、`mask_shape`、`mask_*`、`blend_mode`。

### `OverlayMediaField`

- 路径输入 + 文件选择；
- 文件选择只列 `png/gif`；
- 选择后写 `path`；
- 显示扩展名标记：`PNG` / `GIF`；
- 显示“资源列表中存在 / 未找到”；
- 不显示 ffmpeg、解码、帧数等运行状态；
- 清除路径：删除 `path`，层保留但运行时不绘制；不自动删除片段。

### `OverlayGeometrySketch`

- 16:9 画布；
- 画出未缩放基准矩形、缩放后的元素框、中心点、锚点；
- 画出 `source` 裁切框；
- 只做几何示意，不加载素材像素、不合成画面；
- 数值变化即时更新示意，不建立第二个时钟。

### 效果面板

只有 `x/y/anchor/scale/source/opacity` 这些 animated 叶子有 `keyframes.length > 0` 时才出现；`path`、`z_index` 不进效果面板。

## 本地校验

| 检查 | 处理 |
|---|---|
| `path` 非空且扩展名不是 `png/gif/mp4/webm/mkv` | block；视频扩展名转 09-04 识别 |
| `path` 指向 `mp4/webm/mkv` | 允许保存；属性面板显示“视频层”，编辑面转 09-04 |
| `x/y/anchor/scale/source` 非有限数 | block |
| `source.w/h < 0` | block |
| `source.x+w` / `source.y+h` 超出 0–1 | warning；显示有效取材 |
| `scale <= 0` | warning“运行时不绘制” |
| `opacity` 超出 0–1 | block |
| `z_index` 非整数 | block |
| `layer_type` 不是 image 却存在 image 字段 | block；由 09-01 清理 |
| 图片路径（png/gif）不在 `resource.list(kind=image)` | warning“未在资源列表中找到”；不阻止保存 |
| 视频路径（mp4/webm/mkv） | 不在 `kind=image` 列表里判断；走 09-04 的资源与 ffmpeg 状态 |

## 验收

| # | 场景 | 通过条件 |
|---|---|---|
| C1 | 选择 PNG | `path` 写入；属性面板显示 PNG；游戏按素材原始像素 × k × scale 绘制 |
| C2 | 选择 GIF | 标记 GIF；游戏按局部时间轮播；无 GIF 速度/循环字段 |
| C3 | 空路径 | 层保留；游戏不绘制；不占位；编辑器显示未选择素材 |
| C4 | 文件不存在 | 编辑器 warning；游戏不绘制；无错误占位 |
| C5 | `x/y` | 0.5/0.5 居中；0/0 左上；1/1 右下；不自动夹 |
| C6 | `anchor` | 0.5 绕中心缩放；0/0 绕左上；1/1 绕右下；几何示意一致 |
| C7 | `scale` | 1 = 素材 1:1 像素；2 = 双倍；0/负数 warning 且游戏不绘制 |
| C8 | `source` 整幅 | 缺省 0/0/1/1；不写多余字段 |
| C9 | `source` 裁切 | 0.2/0.2/0.6/0.6 只画中间裁切；越界钳制；负宽高 block |
| C10 | 基准分辨率 | 缺省 1920×1080；`meta.base_resolution` 改变时 k 改变；片段属性面板不新增字段 |
| C11 | 打帧 | `x/y/scale/source/opacity` 有帧进效果面板；`path/z_index` 不进 |
| C12 | 层类型切换 | image→fade 移除 `path/source/x/y/anchor/scale`；image→subtitle 移除 `path/source` |
| C13 | 保存重开 | 路径、几何关键帧、source、opacity、z 原样保留 |

## 完成定义

- 图片/GIF 的全部既有字段都有明确落点；
- 素材缺失、GIF 超限、空路径的运行时行为与代码一致；
- 几何公式与 `ImageGeometry` 一致；
- 没有新增素材适配字段、GIF 控制字段或 `base_resolution` 片段字段；
- 编辑器不加载素材做最终合成，只做路径/几何/示意。
