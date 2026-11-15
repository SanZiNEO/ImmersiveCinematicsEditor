# 09-05 字幕层

## 目标

把 `layer_type=subtitle` 的字幕层编辑完整：文本、`@lang:` 引用、字号、位置、锚点、缩放、透明度、层级。

字幕层只有 Minecraft 原版字体，没有颜色、字体家族、描边、背景框、富文本字段。运行时文字固定白色。

## 源码事实

- `SubtitleLayer` 的文本按 `\n` 分行：`text.split("\n", -1)`；末尾换行会产生一个空行，并影响文字块高度。
- 文字块宽 = 最长行 `font.width(line)`；高 = 行数 × `font.lineHeight`。
- 基准尺寸 `B = (maxLineWidth × fontScale × k, totalHeight × fontScale × k)`；`k = min(播放宽/W基, 播放高/H基)`。
- `x/y` 是文字块（未缩放基准矩形）的中心，窗口归一化；`anchor` 是缩放不动点。
- `font_scale` 决定文字块像素尺寸；`scale_x/y` 再乘在文字块上；绘制矩阵缩放 = `fontScale × scale × k`。
- `font_scale=1` 对应原版 9px 字号；字号靠矩阵缩放实现，不换字体。
- 文字颜色固定 `0x00FFFFFF`，alpha 由 `opacity` 决定。
- `opacity <= 0.001` 或 `text` 为空：不绘制。
- `alpha < 4`（opacity 约 < 1.6%）时直接跳过绘制，避免 MC 字体把低 alpha 补成不透明。
- `text` 是 value-only；文本不能在片段内关键帧切换。
- `text` 以 `@lang:` 开头才查语言表；`@@lang:` 转义为字面 `@lang:`；其余字符串原样渲染。
- 语言回退链：当前语言 → `en_us` → 原样引用串；key 语法 `^[a-zA-Z0-9_]{1,32}(\.[a-zA-Z0-9_]{1,32})*$`，总长 ≤ 256。
- 文本解析发生在建层时；改了 `text` 后要重新建层/重新推送脚本才生效。

## 字段面

| 字段 | 模式 | 默认 | 语义 |
|---|---|---|---|
| `text` | value string | 空 | 文本；支持 `\n`；支持 `@lang:` |
| `x` / `y` | animated float | 0.5 | 文字块中心，窗口归一化 |
| `anchor_x` / `anchor_y` | animated float | 0.5 | 缩放绕点，元素自身归一化；schema 无 min/max，运行时不钳制 |
| `scale_x` / `scale_y` | animated float | 1 | 相对文字块像素的倍数 |
| `font_scale` | animated float | 1 | 字号倍数；1 = 原版 9px |
| `opacity` | animated float 0–1 | 1 | 透明度 |
| `z_index` | value int | 10 | 建层时排序；规则见 09-07 |

不显示、不写：`path`、`source.*`、`color`、`color.r/g/b`、`gradient`、`gradient_*`、`mask_shape`、`mask_*`、`blend_mode`。

## 文本

### 多行

- 文本区按 `\n` 分行；
- 不做自动换行；作者写几行就是几行；
- 末尾 `\n` 会产生空行，文字块高度增加；
- 空文本不绘制；
- 文本块宽取最长行，短行不拉伸；
- 每行按 `font.lineHeight` 行高绘制；
- 不支持 `\t` 制表、富文本、颜色标记、字体切换；
- 不支持背景框、描边、阴影字段；运行时没有这些参数。

### `@lang:` 引用

- `@lang:key`：建层时查语言表；
- `@@lang:key`：转义为字面 `@lang:key`；
- 其他字符串：原样渲染；
- key 只能由 `[a-zA-Z0-9_]` 段和 `.` 组成；段长 1–32；总长 ≤ 256；
- 非法 key 原样显示引用串；
- 当前语言未命中 → `en_us` → 原样引用串；
- 语言文件是 `<resource>/lang/<语言>.json` 的扁平对象；值只收字符串；
- 编辑器可以用 `resource.list(kind=lang)` 列出语言文件和 key，做输入提示；
- 编辑器预览可以选择“原文 / 按 en_us 解析”；预览不写盘；
- 不把译文烘焙进 `text`；保存的仍是引用串。

### 文本与关键帧

`text` 是 value-only：

- 属性面板显示文本框；
- 效果面板 0 命中；
- 不能在片段内做逐字/逐行动画；
- 要做逐段字幕，创建多个字幕片段，或用多条字幕轨道；
- 改文本后重新推送脚本，游戏重建字幕层。

## 几何

- `x/y` 是文字块中心，不是左上角；
- `anchor` 是缩放不动点；`0.5` 绕文字块中心；
- `font_scale` 先决定文字块像素，再乘 `k`；
- `scale_x/y` 再乘在文字块上；与 `font_scale` 相乘；
- `scale_x/y` 与 `font_scale` 都 ≤ 0 时，元素框尺寸为 0 或负，运行时不绘制；编辑器 warning；
- `x/y` 可在窗口外；运行时不钳制，按公式落到窗口外；
- 文字块不自动适配窗口；超宽会按公式溢出；
- 没有 `source` 取材；字幕没有素材裁切概念。

`OverlayGeometrySketch` 对字幕只画：

- 文字块矩形；
- 中心点；
- 锚点；
- 窗口边框。

不渲染真实文字像素，不测量游戏字体，只用编辑器侧的近似字宽/行高做示意。

## 透明度

- `opacity` 0–1；
- `opacity <= 0.001` 不绘制；
- `alpha = opacity × 255`；`alpha < 4` 不绘制；
- 因此 `opacity < 约 0.016` 实际不可见；
- 编辑器在 0.001–0.016 区间给 warning“运行时不绘制”，不自动改值；
- 淡入淡出用 opacity 关键帧；不要用 alpha 1–3 的“几乎透明”值。

## 编辑面

### 属性面板

字幕层显示：

1. `layer_type`；
2. 文本（`OverlaySubtitleField`）；
3. 位置 / 锚点；
4. 字号 / 缩放；
5. 透明度；
6. 层级。

不显示颜色、字体家族、描边、背景、素材路径、遮罩、渐变、混合。

### `OverlaySubtitleField`

- 多行文本区；
- 显示行数；
- `@lang:` 语法高亮或提示；
- “插入语言 key”选择器：从 `resource.list(kind=lang)` 的 key 列表选择，写入 `@lang:key`；
- “预览”切换：原文 / en_us；
- 不把预览结果写进 `text`；
- 不自动换行；
- 清除文本：删除 `text` 或写空串；层保留，运行时不绘制。

### 效果面板

只有 `x/y/anchor/scale/font_scale/opacity` 有 `keyframes.length > 0` 时才出现；`text`、`z_index` 不进效果面板。

## 本地校验

| 检查 | 处理 |
|---|---|
| `text` 为空 | 允许保存；运行时不绘制 |
| `text` 以 `@lang:` 开头但 key 非法 | block 或强 warning；运行时原样显示引用串 |
| `text` 超长 | warning；schema 没有长度上限，不新增字段限制 |
| `x/y/anchor/scale/font_scale` 非有限数 | block |
| `scale_x/y <= 0` 或 `font_scale <= 0` | warning“运行时不绘制” |
| `opacity` 超出 0–1 | block |
| `opacity` 在 0.001–0.016 | warning“alpha < 4，运行时不绘制” |
| `z_index` 非整数 | block |
| `layer_type` 不是 subtitle 却存在 `text/font_scale` | block；由 09-01 清理 |

## 验收

| # | 场景 | 通过条件 |
|---|---|---|
| E1 | 单行文本 | `text` 写入；游戏按白色 9px 基准绘制；无颜色字段 |
| E2 | 多行文本 | `\n` 分行；行高正确；末尾空行增加高度；不自动换行 |
| E3 | 中文/英文混排 | 按原版字体宽度；最长行决定文字块宽 |
| E4 | `font_scale=2` | 文字块与绘制字号同时放大；锚点/位置不偏 |
| E5 | `scale_x/y` | 在 `font_scale` 基础上再乘；与 `font_scale` 叠加 |
| E6 | `@lang:` 命中 | 预览显示译文；保存仍是 `@lang:key` |
| E7 | `@lang:` 未命中 | 回落 `en_us`；再未命中显示原引用串 |
| E8 | `@@lang:` | 显示字面 `@lang:key`，不查表 |
| E9 | 非法 key | 原样显示；编辑器提示 |
| E10 | 空文本 | 游戏不绘制；不占位；无错误 |
| E11 | 低透明度 | `opacity < 0.016` 游戏不绘制；编辑器 warning |
| E12 | 文本打帧 | 效果面板 0 命中 `text`；只能改值后重新推送 |
| E13 | 保存重开 | 文本、`\n`、引用串、几何关键帧、opacity、z 原样保留 |

## 完成定义

- 字幕只使用 `text/font_scale/x/y/anchor/scale/opacity/z_index`；
- `@lang:` 解析与回退链与 `LangResources` 一致；
- 字幕无颜色/字体/描边/背景字段；
- 低 alpha 跳过规则在编辑器有提示；
- 文本改动通过重新推送脚本生效，不做本地逐字动画。
