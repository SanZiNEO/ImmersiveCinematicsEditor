# 09-07 层级、轨道与排序

## 目标

把 `z_index` 和多轨规则写清楚，让作者知道：

- 覆盖层内部谁先画、谁后画；
- 同一轨道里多个片段重叠时会发生什么；
- 多条 `OVERLAY` / `LETTERBOX` 轨道如何共存；
- 哪些顺序是可稳定的，哪些必须靠不同的 `z_index` 或不同的轨道来表达。

09 不建立“全局合成 z 表”。`z_index` 只在覆盖层 HUD 内部排序，不和 CAMERA lane 共用顺序。

## 源码事实

### OverlayManager

- `layers` 是 `ArrayList<OverlayLayer>`；
- `addLayer()` 先 `add`，再 `layers.sort(Comparator.comparingInt(OverlayLayer::getZIndex))`；
- Java `List.sort` 是稳定排序：相同 `zIndex` 的层保留插入顺序；
- 渲染时按列表顺序遍历，`isVisible()` 为 true 的层才绘制；
- `zIndex` 越小越先绘制（底层），越大越后绘制（顶层）；
- `removeLayer()` 会调用 `close()`；
- `removeLayersOf(owner)` 清掉同一播放实例的全部层；
- `layers` 只在 `addLayer()` 时重排；层内 `zIndex` 改变不会触发重排。

### OverlayTrackPlayer

- 每条 `OVERLAY` 轨道同一时刻只保留一个 `activeClip`；
- `findActiveClip()` 按 `clips()` 数组顺序返回**第一个**活跃片段；
- 同一轨道里，后一个片段与前一个片段重叠时，后一个不会成为 `activeClip`，也不会建层；
- clip 切换时先移除旧层，再创建新层；
- `z_index` 只在 `createObjectLayer()` 时读取一次；
- 运行中改 `z_index` 不重排；同一片段内动画 `z_index` 不成立（它本来就是 value-only，没有关键帧）；
- 建层时 `base_resolution` 从 `ScriptMeta` 取，默认 1920×1080。

### LetterboxTrackPlayer

- 每条 `LETTERBOX` 轨道构造时创建一层并 `addLayer`；
- 层固定 `z=0`，没有脚本 `z_index`；
- 空档时 `aspect_ratio=0`、`opacity=1`，层仍在管理器里，但不画黑边；
- `onStop()` 时移除本轨道的层；
- 同一轨道同样只取 `clips()` 数组里的第一个活跃片段。

### 与 CAMERA lane 的分界

- CAMERA lane 合成走 `LaneCompositor`；覆盖层走 `OverlayManager`；
- 两者没有共享的全局 z 表；
- 覆盖层是 HUD 管线，在 GUI 阶段绘制；
- `ADJUST` 作用于底图，不作用于覆盖层；
- 运行时画面顺序：世界渲染 → CAMERA lane 合成 → 原版后处理 → ADJUST master 调色 → GUI（`OverlayManager` 层按 `z_index` 升序；z<0 在 `LETTERBOX` z0 下，z>0 在上）。

## `z_index` 字段

| 项 | 值 |
|---|---|
| 字段 | `z_index` |
| 模式 | value int |
| 默认 | 10 |
| 范围 | 整数，无 min/max |
| 适用 | 全部 `OVERLAY` 层类型 |
| 读取时机 | 建层时一次 |
| 运行中修改 | 不重排；下一次建层才生效 |
| 效果面板 | 0 命中 |
| 属性面板 | 数字输入 + 层级预览入口 |

`z_index` 不是帧字段，不能在片段内做“层级动画”。如果作者需要不同时间不同层级，应该拆成不同片段/不同轨道，让层在建层时使用新的 z。

## 排序规则

```text
先按 z_index 升序；
z_index 相同 → 保留 addLayer 的插入顺序；
插入顺序 = 层实际被创建并加入管理器的顺序。
```

### 同 z 的含义

- 同 z 不是错误；
- 同 z 的层按稳定排序保留插入顺序；
- 插入顺序由运行时建层时机决定，不由 `z_index` 字段决定；
- 跨轨道的插入顺序可能随片段激活时间、轨道驱动顺序变化；
- 需要确定的跨轨顺序时，给不同层分配不同的 `z_index`；
- 编辑器对“同时活跃且同 z”的层给 warning，并显示当前预览顺序；不承诺该顺序在另一个播放时刻保持不变。

这不是“UI 不承诺”，而是明确的运行时规则：同 z 合法、稳定，但顺序来自插入，不来自字段。

### 建议 z 值

| z | 用途 |
|---|---|
| 0 | `LETTERBOX` 固定层 |
| 10 | `OVERLAY` 默认层（fade / image / video / subtitle） |
| 20 | 背景图/底图覆盖层（作者自定） |
| 30 | 字幕层（作者自定，避免被图片盖住） |

这些是建议值，不是运行时枚举，也不是全局表。脚本接受任意整数。

- `z < 0`：会画在 `LETTERBOX` 黑边下面；编辑器 warning；
- `z = 0`：与 `LETTERBOX` 同 z；谁后加入谁后画；编辑器 warning；
- `z > 0`：画在黑边上面，通常这是覆盖层想要的效果。

## 单轨多片段

### 规则

同一 `OVERLAY` 轨道：

- 同一时刻只取 `clips()` 数组里的第一个活跃片段；
- 后一个片段即使与前一个重叠，也不会成为 active，也不会建层；
- 片段切换时旧层移除、新层创建；
- 一个片段结束到下一个片段开始之间的空档：没有层，画面不残留。

同一 `LETTERBOX` 轨道同样只取第一个活跃片段；空档时黑边消失。

### 编辑器提示

当同一轨道出现重叠片段：

- 在时间轴上标出重叠区；
- 说明“后一个片段在该重叠区不会成层”；
- 提供“拆到另一条轨道”或“调整 start_time”的入口；
- 不自动移动片段，不自动改时长；
- 不把重叠片段合并成一个“合成片段”。

### 为什么要多轨

要同时显示多张图片、多个字幕、多个 fade，必须使用多条同类型轨道。每个 `OVERLAY` 轨道只持有一个层；多轨才有多个层。

## 多轨共存

| 组合 | 运行时 | 编辑器 |
|---|---|---|
| 多条 OVERLAY，不同 z | 按 z 升序；各自一个层 | 层级预览列出全部活跃层 |
| 多条 OVERLAY，同 z | 稳定排序；按插入顺序 | warning；显示“同 z，顺序来自建层插入” |
| OVERLAY + LETTERBOX（z>0） | LETTERBOX z=0；OVERLAY z 升序 | 显示“黑边在覆盖层下面” |
| OVERLAY + LETTERBOX（z=0） | 同 z；按插入顺序 | warning；不承诺黑边在底 |
| OVERLAY + LETTERBOX（z<0） | OVERLAY 在 z0 前绘制 | warning；黑边盖住该层 |
| 多条 LETTERBOX | 每轨一层，全部 z=0；后加入者后画 | warning；黑边可能叠加/覆盖 |

## 层级预览

`OverlayOrderPopover` 从 `z_index` 行打开，不新建独立面板。

### 内容

- 当前播放头下的全部活跃 `OVERLAY` 片段；
- 当前播放头下的全部活跃 `LETTERBOX` 片段；
- 每行的轨道索引、片段名、`layer_type`、`z_index`、生效顺序；
- 同 z 分组；
- 警告：同 z、同轨重叠、多 LETTERBOX、z<0、z=0。

### 行为

- 跟随主时间轴播放头，只读；
- 不创建第二个时钟；
- 不写盘；
- 不创建 lane 选区；
- 点击行只选中对应片段，不修改 `z_index`；
- 不显示“最终像素合成结果”；只显示层顺序。

## 本地校验

| 检查 | 处理 |
|---|---|
| `z_index` 非整数 | block |
| `z_index < 0` | warning“画在黑边下面” |
| `z_index = 0` | warning“与 LETTERBOX 同 z，顺序取决于插入” |
| 同轨片段重叠 | warning“后一个片段不会成层” |
| 多条同类型轨道同时活跃 | 允许；层级预览列出，不阻止保存 |
| 同 z 多层 | 允许；warning + 显示插入顺序 |
| `layer_type` 非 fade/image/subtitle | block；见 09-01 |

## 验收

| # | 场景 | 通过条件 |
|---|---|---|
| G1 | 单条 OVERLAY，z=10 | 一个层；按 z 排序；无冲突 |
| G2 | 两条 OVERLAY，z=10/30 | 10 在下、30 在上；顺序稳定 |
| G3 | 两条 OVERLAY，同 z=10 | 稳定排序；同 z 警告；显示插入顺序 |
| G4 | OVERLAY z=10 + LETTERBOX | 黑边 z0 在下；覆盖层在上 |
| G5 | OVERLAY z=-1 | 画在黑边下面；编辑器 warning |
| G6 | OVERLAY z=0 | 与黑边同 z；按插入顺序；warning |
| G7 | 同轨两个重叠片段 | 后一个不成层；编辑器标出重叠区并提示拆轨 |
| G8 | 同轨片段切换 | 旧层移除、新层创建；z 只在建层时读取 |
| G9 | 多轨图片/字幕 | 每条轨道一个层；层级预览列出全部 |
| G10 | 多条 LETTERBOX | 每轨一层 z0；warning 叠加 |
| G11 | 层级预览 | 跟随播放头、只读、不写盘、不建第二时钟 |
| G12 | 与 CAMERA 关系 | 不显示 CAMERA lane；不共享 z 表；不把 lane 顺序混进覆盖层 |
| G13 | 保存重开 | `z_index` 值保留；无层级视图字段写盘 |

## 完成定义

- `z_index` 的读取时机、排序规则、同 z 行为与 `OverlayManager` 一致；
- 同轨单活跃片段规则与 `OverlayTrackPlayer` / `LetterboxTrackPlayer` 一致；
- 多轨共存与 `LETTERBOX z=0` 的边界清楚；
- 编辑器只做层级预览，不伪造全局合成表；
- 冲突提示明确，不把“同 z 顺序”写成 UI 不承诺。
