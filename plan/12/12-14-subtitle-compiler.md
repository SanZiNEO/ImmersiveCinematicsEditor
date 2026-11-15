# 12-14 字幕编译

## 目标

把字幕批次表编译成标准 `OVERLAY` 字幕片段：一条 cue 一个片段，只写 09-05 已有字段。编译器不引入字幕格式、不改运行时、不做样式合成。

## 输入

- 来源 A：12-12 导入向导产出的 cue 草稿。
- 来源 B：12-13 选定的已有字幕轨道 cue 表。
- 来源 C：重导入比对后的 `new` / `changed` cue 集合。

每条 cue 至少有：`start` / `end` / `text` / 目标轨道（或“待分配”）/ 布局值（可缺省）。

## 输出

```text
OVERLAY 轨（一条或多条）
  clip
    id
    start_time
    duration
    objects
      layer_type = subtitle
      text
      font_scale
      x / y
      anchor_x / anchor_y
      scale_x / scale_y
      opacity
      z_index
```

- 不使用 `source.*`、`path`、`color`、`gradient`、`mask_*`、`blend_mode`。
- 不写 `text` 关键帧；`text` 是 value-only。
- 不写 `transition*`；字幕片段之间没有转场。
- 不写 `timeline.total_duration`；字幕时长由 cue 决定。
- 不写“字幕样式”扩展字段。

## 字段写法

| 字段 | 形态 | 值 |
|---|---|---|
| `layer_type` | `{value:"subtitle"}` | 必写 |
| `text` | `{value:"..."}` | cue 文本；保留 `\n`；可空但编译跳过/报错 |
| `font_scale` | `{value:1}` | 默认取 09-08 `subtitle.lower-third`；可被批次布局覆盖 |
| `x` / `y` | `{value:0.5}` / `{value:0.85}` | 默认下方居中；可被批次布局覆盖 |
| `anchor_x` / `anchor_y` | `{value:0.5}` | 缩放绕点 |
| `scale_x` / `scale_y` | `{value:1}` | 相对文字块倍数 |
| `opacity` | `{value:1}` | 0–1；默认 1 |
| `z_index` | `{value:10}` | 同轨/跨轨仍按各层规则；不建全局 z 表 |

说明：

- 默认布局引用 09-08 `subtitle.lower-third`，不在 12 重新登记一份字幕默认值。
- 如果批次表已有布局值（作者在 09 改过），保留已有值；不强制覆盖成默认。
- 不写 `color`：字幕运行时固定白色，`color` 是覆盖层通用字段但不是字幕语义。
- 不写 `path`：字幕没有素材路径。
- 不写 `anchor_x/anchor_y` 之外的锚点/对齐字段；没有对齐枚举。

## 一条 cue 一个片段

- cue 的 `[start,end)` 对应片段 `start_time=start`、`duration=end-start`。
- 一条 cue 不能拆成多个片段；一个片段不能塞多条 cue。
- `OverlayTrackPlayer.findActiveClip` 同轨取第一个活跃片段；同轨 cue 不能重叠。
- 重叠 cue 必须分轨；编译器不把两条 cue 合成一个片段，也不做“同轨多行滚动”。
- 片段结束时间不单独存在；`end = start_time + duration`。
- 片段之间可以相邻（`end==start`）；不自动留 gap，不自动做淡入淡出。

## 轨道分配

### 已有轨道

- 作者选定轨道；按 12-13 的打包规则放入。
- 同轨已有 cue 与新区间重叠 → error；不覆盖、不拆、不自动推。
- 可选“移到新轨”：编译器新建 `OVERLAY` 轨，不改变已有轨。

### 新轨道

- id `overlay_{n}`，从现有最大后缀 +1；不重命名现有轨。
- 轨道类型 `OVERLAY`；`clips` 按开始时间排序。
- 轨道顺序追加到现有字幕轨之后；不插入相机轨之间。
- 新轨不写“字幕专用”标记；只靠片段 `layer_type=subtitle` 判定。

### 不建全局 z 表

- 每个字幕片段自己写 `z_index`；同轨片段仍按时间活跃。
- 跨轨层叠由 `z_index`/运行时规则决定；编译器不生成“全局合成顺序表”。
- 不因为 cue 多就把 `z_index` 按轨道序号递增；保持默认/作者值。

## 编译模式

### 1. 草稿编译（导入/重导入）

输入 cue 草稿/变更集；输出：

- `new` cue → 新片段。
- `changed` cue → 更新已有片段的 `text`/时间/布局，前提是作者确认。
- `unchanged` → 不写。
- `missing` → 保留；不删除。
- 一次事务；失败零残留。

### 2. 变更编译（已有片段）

输入重导入变更集：

- `changed` cue → 更新已有字幕片段的 `start_time`/`duration`/`text`/布局；按片段 id 定位，不重建。
- `new` cue → 新建片段。
- `unchanged` → 不写。
- `missing` → 保留；不删除。
- 不删除/重建已有字幕片段；不重置 `exit`、`opacity` 关键帧或其它已有字段。
- 改时长时，已有 `opacity` 关键帧不自动缩放；若关键帧时间超出新时长，warning，作者到 09 调整。
- 一次事务；失败零残留。

### 3. 校验模式

只校验不写：

- 一条 cue 一个片段；
- 同轨不重叠；
- 时间合法；
- 文本/`@lang:` 合法；
- 字段面合法；
- 最终 `script.validate` 通过。
- 用于编译前预览和诊断。

## 文本规则

- `text` 只写 cue 文本；保留 `\n`；不自动换行、不按字数切、不自动加省略号。
- 末尾换行会生成一个空行并影响文字块高度；导入/编辑时保留，编译器不改。
- 文本为空/仅空白 → 编译跳过并 warning；不生成运行时不绘制的空片段。
- 外部导入的 `@lang:` 必须已在 12-12 转义成 `@@lang:`；编译器不改写文本。
- 如果 cue 标记为“外部导入、未转义”且 `text` 以单 `@lang:` 开头 → error，提示回导入向导转义。
- 手写字幕作者主动写 `@lang:` 时允许；那是作者有意查语言表。
- `@@lang:` 原样保留；运行时显示字面 `@lang:`。
- 语言 key 非法不自动改；运行时原样显示引用串。

## 布局规则

- 布局字段来自：
  1. 已有片段的值（变更编译/更新）；
  2. 批次表作者改过的值；
  3. 都没有时用 09-08 `subtitle.lower-third`；
  4. 仍没有时用 schema 默认值。
- `x/y` 是文字块中心；`anchor` 是缩放不动点。
- `font_scale/scale/opacity` 非有限数 → error；`scale<=0` 或 `font_scale<=0` → warning“运行时不绘制”。
- `opacity < 0.016` → warning“实际不可见”；不自动抬高。
- `x/y` 可以在窗口外；编译器不钳制。
- 不改 `meta.base_resolution`；字幕缩放系数仍按文档基准分辨率计算。
- 不做自动底部对齐、自动安全区、自动换行。

## 时间规则

- `start/end` 秒；`end>start`；否则 error。
- `start>=0`；负时间 error。
- 不按 fps 换算；不做帧对齐。
- 同轨 `[start,end)` 相交 → error；`end==start` 可相邻。
- 跨轨重叠允许；运行时按各自轨道/`z_index` 显示。
- 不自动裁剪到脚本“总时长”；脚本没有 `total_duration`。

## 编译前检查

- 空文本：跳过/报错。
- 同轨重叠：拒绝，提示移到新轨。
- 未转义 `@lang:`：外部导入 error；手写允许。
- `scale/font_scale<=0`：warning。
- `opacity<0.016`：warning。
- 布局非有限：error。
- 轨道类型不是 OVERLAY：error。
- 目标轨道有非字幕片段：只更新/新增 subtitle 片段，warning；不删除 image/fade。
- 最终 `script.validate` error：整次回滚。

## 编译后

- 一次事务；选中第一条新字幕片段；状态显示“已编译 N 条字幕 · 撤销”。
- cue 表从片段重建；与编译前表一致（空文本跳过除外）。
- 不显示“字幕模板/样式/批次 id”。
- 不把源文件路径、编码、导入选项写进脚本。
- 不自动保存/推送；保存/推送走现有通道。

## 禁止项

- 不做“一个片段多 cue”或“字幕滚动/逐字动画”。
- 不写颜色/字体族/描边/背景框/对齐字段。
- 不写 `text` 关键帧、不把文本烘焙成图片。
- 不建全局 z 表、不按轨道序号强排 z。
- 不自动覆盖手改文本、不自动删 missing cue、不自动合并重叠。
- 不按 fps 改时间、不自动换行、不自动翻译。
- 不建 sidecar、不建第二套字幕数据。

## 验收出口

1. 一条 cue 3.0–5.2s：生成片段 `start_time=3`、`duration=2.2`；游戏内 3.0 出现、5.2 消失。
2. 两条 cue 同轨 3–5、4–6：编译拒绝，提示移到新轨；不生成重叠同轨片段。
3. cue 文本两行：`text` 保留 `\n`；游戏内两行；末尾换行多一空行。
4. 外部字幕 `@lang:x` 未转义：编译 error；转义后写 `@@lang:x`，游戏内字面显示。
5. 手写字幕 `@lang:subtitle.one`：允许；游戏内查语言表。
6. `scale_x=0`：warning 运行时不绘制；不自动改。
7. `opacity=0.01`：warning 实际不可见；不自动抬高。
8. 变更编译：changed 更新文本/时间/布局，保留 `exit`/opacity 关键帧；unchanged 不写；撤销恢复。
9. 编译产物只有 `layer_type/text/x/y/anchor/scale/font_scale/opacity/z_index`；没有颜色/字体/描边/路径/转场。
10. 最终 `script.validate` 通过；失败零残留。
