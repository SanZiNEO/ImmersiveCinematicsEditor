# 06-KeyframeEditOps：关键帧编辑操作

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C08 异步属性身份、C04 编辑命令与历史
> 依赖：02-EditorStore（commit/undo）、06-ClipEffectControlsPanel
> 下游：06-EffectControlsRows（效果控件节点交互）、13（WebUI验收）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

把关键帧的增、删、移、改值、多选、复制粘贴、时间吸附定义成**命令 + 判定**，并明确哪些旧操作必须删除（整帧插值、边界补帧、钳制、跨属性去重）。

本文件是操作层：ClipEffectControlsPanel/EffectControlsRows发出带完整路径的节点命令，快捷属性复用同一目标解析；统一片段级展示不改变单属性命令或原节点批选限制。主时间轴没有节点命令入口。

**参考输入**：[Olive属性关键帧适配](../references/02-olive-property-keyframes.md)的拖动/选择/粘贴命令。借鉴起始快照、临时预览和松手一次提交，不搬同时间覆盖、兄弟分量联选或任意keyframe type。冲突逐属性检查并整次拒绝，零位移/取消不产生历史，旧整帧命令按本文退役。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| 添加：拒绝重复时间（`EPSILON=0.001`），插入后排序 | `EDITOR:src/operations.ts — addKeyframeAt（157–170）`、`EPSILON（11）` |
| 移动：`Math.max(0, Math.min(duration, ...))` 硬钳制 + 排序 | `operations.ts — moveKeyframe（184–188）` |
| 删除：`indexOf` + `splice` | `operations.ts — deleteKeyframe（178–182）` |
| 添加后整帧插值 | `operations.ts — interpolateNewKeyframe（190–215）` |
| 边界补帧 | `operations.ts — ensureBoundaryKeyframes（573–601）`，被 `resizeClipRight（140–156）` 调用 |
| 钳制关键帧 | `operations.ts — clampKeyframes（602–608）` |
| 跨属性去重/排序 | `operations.ts — sortKeyframes（560–572）` |
| 吸附：全局 `snapInterval`，`snap` 取整 | `operations.ts — snap（632–635）`、`DEFAULT_SNAP_INTERVAL（12）` |
| 拆片段：按全局时间切，复制帧 | `operations.ts — splitClip（485–552）` |
| 撤销是整文档快照 | `EDITOR:src/store.ts（102–132）` |

问题：

1. 移动被钳制到 `[0,duration]` → 与"超界保留"冲突，且缩小时会丢作者数据。
2. `ensureBoundaryKeyframes` 在片段缩小时**创建**作者没写的帧（`resizeClipRight` 调用），违反"不补帧"。
3. 添加时整帧插值污染其它属性。
4. 吸附是全局整数化，无法按属性关闭。
5. 拆片段复制整帧，无法按属性处理。

### 2.2 目标

1. 每个操作 = 一个命令，一个命令 = 一个撤销快照。
2. 时间只做**吸附**（可选、可关），不做钳制。
3. 不补边界帧、不跨属性去重、不跨属性插值。
4. 多选只用于"同属性批量"或"多属性批量删除/移动"，且批量操作原子。
5. 复制粘贴保留相对时间，粘贴到不同属性时按类型校验。

### 2.3 非目标

- 不做曲线编辑器。
- 不做片段的拆分/合并语义（归 05）；本文件只定义"拆分时关键帧怎么办"的规则。

## 三、方案

### 3.1 命令与判定

| 命令 | 判定（失败即拒绝，不改文档） |
|---|---|
| `object.addKeyframe {clipKey, path, time, value}` | `mode=animated`；`time` 有限且 `>= 0`；与同属性已有帧 `|Δt| > 1e-4` |
| `object.removeKeyframe {clipKey, path, time}` | 该帧存在；若删后为空且 `mode=event` → 拒绝 |
| `object.moveKeyframe {clipKey, path, from, to}` | 目标帧存在；`to` 有限且 `>= 0`；与同属性其它帧 `|Δt| > 1e-4` |
| `object.setKeyframeValue {clipKey, path, time, value}` | 帧存在；值通过类型校验（02-AnimObject §3.3） |
| `object.moveKeyframes {clipKey, path, deltas: {from,to}[]}` | 批量：全部目标位置合法且互不冲突；否则全回滚 |
| `object.removeKeyframes {clipKey, path, times: number[]}` | 批量：删后不为空（`event`） |
| `object.pasteKeyframes {clipKey, path, at, frames}` | 目标属性 `mode=animated`；所有目标时间合法且不冲突；类型逐个校验 |

**没有**"clamp"、"ensureBoundary"、"sortAcrossProperties" 命令。

### 3.2 时间吸附

| 项 | 规则 |
|---|---|
| 吸附开关 | `session.snap.enabled`（默认开） |
| 吸附步长 | `session.snap.interval`（默认 0.5，沿用 `DEFAULT_SNAP_INTERVAL`，`operations.ts 12`） |
| 吸附算法 | `round(t / interval) * interval`（沿用 `snap`，`operations.ts 632–635`） |
| 吸附对象 | 只在**拖动结束**时应用；输入框里的精确时间不吸附 |
| 吸附例外 | 按住 Alt（或 UI 开关）临时禁用 |
| 吸附后冲突 | 与已有帧重合 → 拒绝（提示"吸附到 t=… 与已有帧冲突"），不自动微调 |

**不**把吸附应用到 `paths[].from/to`（端点必须精确命中节点时间，07）。

### 3.3 复制 / 粘贴

```text
复制：{path, frames: [{time, value}]}   // 保留绝对时间与相对时间两种视图
粘贴：目标属性 + 目标锚点时间 at
  - 模式 A（默认）：保持相对间隔，首帧对齐到 at
  - 模式 B：保持绝对时间（at 被忽略）
```

判定：

- 目标属性 `mode=animated`。
- 逐个帧做类型校验（复制自 `yaw` 粘贴到 `position_mode` 会被拒）。
- 所有目标时间必须 `>= 0` 且互不冲突；任一冲突 → 全部拒绝（不做部分粘贴）。

跨片段粘贴：`clipKey` 变化；时间按目标片段局部秒解释（不换算全局秒）。

### 3.4 多选

| 场景 | 允许 | 原子性 |
|---|---|---|
| 同属性多帧 | 批量移动（同一 delta）、批量删除 | 一个命令一个快照 |
| 跨属性多帧 | **只允许批量删除**（不允许多属性同时移动，因为时间语义各自独立） | 一个命令 |
| 跨片段 | 不允许（选择域限制在单片段，见 02-SelectionIdentity §3.3） | — |

批选属于02文档会话：片段使用selection.clipKeys，节点使用keyframeSelection的clipKey/path/times；移动/删除/撤销与文档命令一起重映射，组件不持有第二份真值。

### 3.5 片段缩放/拆分时关键帧的处置

| 操作 | 规则 |
|---|---|
| 片段变长 | 不补帧、不动已有帧 |
| 片段变短 | 不删帧、不钳制；越界帧变"轴外"（`SampledProperty.compile` 同口径） |
| 拆分（按全局时间） | 左片段保留 `t <= splitLocal` 的帧；右片段保留 `t > splitLocal` 的帧并**减去** `splitLocal`；`time == splitLocal` 的帧归左（含端点）。若拆出的右片段某属性无帧但有 `value` → 保留 `value`（不造帧） |
| 合并 | 本轮不做（05 决定是否提供） |

拆分时**不**复制 `authoring.easing` 到两侧（避免段被切断后缓动指向不存在的段）：段的 `fromTime` 落在切点另一侧 → 丢弃该段缓动并提示。

### 3.6 撤销粒度

| 操作 | 快照数 |
|---|---|
| 点一次"添加" | 1 |
| 拖动一帧（drag 过程多次移动，松手一次提交） | 1 |
| 批量移动 5 帧 | 1 |
| 粘贴 N 帧 | 1 |
| 拆片段 | 1 |

拖动期间**不**写文档（只在 UI 上预览位置）；松手时一次 `commit`。这样撤销一次回到拖动前。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `applyKeyframeCommand(doc, cmd): {doc, error?}` | 文档 + 命令 | 新文档或错误（纯函数） |
| `snapTime(t, interval)` | 时间 + 步长 | 吸附后时间 |
| `planPaste(src, dst, at, mode)` | 源帧 + 目标属性 | `{frames}` 或错误 |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/keyframeOps.ts`（提案）：命令实现 + 判定。
2. 改 `EDITOR:src/operations.ts`：
   - `addKeyframeAt`（157–170）删除（由命令取代）。
   - `deleteKeyframe`（178–182）删除。
   - `moveKeyframe`（184–188）删除（钳制语义错误）。
   - `interpolateNewKeyframe`（190–215）删除。
   - `ensureBoundaryKeyframes`（573–601）删除；`resizeClipRight`（140–156）与 `resizeClipLeft`（122–139）里对它的调用一并删除。
   - `clampKeyframes`（602–608）删除。
   - `sortKeyframes`（560–572）保留但只用于"同一属性内排序"（文档模型保证已有序，实际只在导入/迁移时用）。
   - `splitClip`（485–552）按 §3.5 改写。
   - `snap`（632–635）保留，但只在拖动结束时调用。
3. 删除EDITOR:src/components/Timeline.vue（342–366）旧节点拖动及节点菜单/快捷入口，不改成主轴属性行。EffectControlsRows承接节点预览+松手提交，局部视口换算由06完成；拖动来源始终是效果控件行或其明确详情。
4. 人工在效果控件中同时展开不同属性，再操作冲突、类型不符、VALUE加帧、EVENT删空、取消/失焦等路径，观察只改指定目标、提示/回滚与另一组仍可见；不新增单元测试。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/KeyframeOps.java`（提案）：同命令与判定。
2. 拖动预览在 AUI 层做，松手调 `commit`。

### 4.4 禁止修改

- 不钳制时间。
- 不补边界帧。
- 不跨属性去重/排序/插值。
- 不部分粘贴。
- 不在拖动过程中写文档。
- 不在主时间轴显示/编辑节点，不以节点单属性命令为理由把效果控件切成单属性独占页；多个已展开组保持可见，选择/文档只有一个所有者。

## 五、正反例验收

### 5.1 正例

1. `yaw` 在 1.0、2.0；添加 `t=2.5, value=45` → 成功；`position.x` 不变。
2. `yaw` 在 1.0、2.0；添加 `t=2.0` → 拒绝（`|Δt| <= 1e-4`）。
3. `yaw` 第 2 帧从 2.0 拖到 7.0（`duration=5`）→ 成功，标记轴外；`script.validate` 无错。
4. 吸附 0.5：拖到 2.26 → 2.5；若 2.5 已有帧 → 拒绝。
5. 复制 `yaw` 两帧（1.0、2.0）粘贴到 `pitch`（同为 `angle`）在 `at=5` → 得 5.0、6.0（相对间隔 1.0）。
6. 复制 `yaw` 两帧粘贴到 `orient`（`mode=value`）→ 拒绝。
7. 拆片段在 `t=3`：左片段保留 `t<=3`，右片段保留 `t>3` 且时间减 3；`t=3` 的帧归左。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| 拖动到 -1 → 夹回 0 | 禁止（拒绝，`time >= 0` 是运行时要求） |
| 片段缩短后自动删除越界帧 | 禁止（保留为轴外） |
| 片段变长时在末尾补帧 | 禁止 |
| 添加帧时复制其它属性 | 禁止 |
| 粘贴时部分帧冲突仍写入其余 | 禁止（全拒） |
| 拖动过程中每像素一个撤销快照 | 禁止（松手一个） |
| 拆片段时把 `time==split` 的帧同时放进两侧 | 禁止（归左） |

### 5.3 异步关键帧专项

**正例**：`position.x` 在 0、3；`yaw` 在 1、2。批量删除 `position.x` 两帧 → `position.x` 变 0 帧（`value` 生效）；`yaw` 不变。

**反例**：批量删除时按"整帧"删除 → 把 `yaw@1` 也删了。

- 期望：不发生（选择与命令都按 `(path, time)` 定位）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；打开含 `position.x`（0、3）与 `yaw`（1、2）的片段。
2. 把 `position.x` 的 `t=3` 拖到 `t=8`（`duration=5`）；保存；游戏内播放，确认位置在 `t=5` 后停在末帧值（轴外帧不采样）。
3. 吸附开启拖到 2.26 → 落在 2.5；保存后重载确认时间就是 2.5。
4. 复制 `yaw` 两帧粘贴到 `pitch`；播放确认俯仰按 1 秒间隔变化。
5. 拆分片段，确认两侧帧不重复、不丢失。

通过判定：第 2 步无解析错误且行为为 hold；第 3 步时间精确；第 4 步运动可见；第 5 步帧总数守恒（除去落在切点重复的部分）。

## 七、完成定义

1. `EDITOR:src/model/keyframeOps.ts` 存在；7 条命令可用。
2. `operations.ts` 的 `addKeyframeAt`/`deleteKeyframe`/`moveKeyframe`/`interpolateNewKeyframe`/`ensureBoundaryKeyframes`/`clampKeyframes` 已删除。
3. 拖动只在松手时提交（一个快照）。
4. §5 的 7 条正例、7 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同命令语义（同一向量集结果一致）。
