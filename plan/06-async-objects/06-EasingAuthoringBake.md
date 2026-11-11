# 06-EasingAuthoringBake：缓动作者元数据与按属性段烘焙

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C08 异步属性身份
> 依赖：02-AnimObject（`authoring`）、06-KeyframeEditOps（帧命令）
> 下游：13（WebUI 验收）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

把缓动从"每个关键帧一个标记 + 整片段按通道表烘焙"改成"**属性段**作者元数据 + 显式烘焙命令"：

- 元数据存在 `AnimObject.authoring.easing[]`，**不写盘**。
- 烘焙是**显式命令**（作者点"烘焙本段"），不是保存时的隐式步骤。
- 只烘焙该属性该段；step 属性不烘焙；`paths[]`、`orient`、`yaw_offset`/`pitch_offset` 不烘焙。

**参考输入**：[Olive属性关键帧适配](../references/02-olive-property-keyframes.md)的曲线与把手。把手操作只供作者段元数据/显示交互参照，不得输出Olive的逐帧Linear/Bezier/Hold或把手字段；仍只显式烘焙支持属性，保存/推送不隐式烘焙，STEP不出现连续把手。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| 缓动标记写在关键帧对象上（`easing` 键） | `EDITOR:src/operations.ts（318 `EASING_KEY='easing'`、370–383）` |
| 保存时**自动**烘焙整个文档 | `EDITOR:src/store.ts — saveScript（444–446：`ops.bakeDocEasing(docToSave)`）` |
| 推送时也自动烘焙 | `store.ts — pushScript（533–535）` |
| 烘焙按"轨道连续通道表"决定烘焙哪些字段 | `operations.ts — continuousChannels（854–897）`、`bakeClipEasing（385–416）` |
| 采样数按秒数分档（4/s，8~20 帧） | `operations.ts（321–323、345–354）` |
| 支持判定按轨道 + 片段 | `operations.ts — easingSupport（356–369）` |
| 烘焙出的帧用整帧复制 + 通道插值 | `operations.ts — sampleBakedKeyframe（902–945）` |

问题：

1. 保存自动烘焙 = 作者失去缓动可编辑性，且"打开→保存"会改文档（违反无损）。
2. 通道表硬编码：新增属性必须改编辑器；`ADJUST` 只覆盖 12 个通道（`continuousChannels 890–895`），其余 47 个不烘焙。
3. 缓动标记挂在帧上，语义是"该帧到下一帧"——跨属性共享同一帧对象时无法区分。
4. 烘焙整帧复制会把其它属性的值带进来。

### 2.2 目标

1. 缓动归属 `(clipKey, objectPath, fromTime)`，即"该属性从这一帧到下一帧"。
2. 元数据不写盘；保存/推送不再烘焙。
3. 烘焙只在该属性内插入帧，值按该属性的 `interp` 插值。
4. 作者可随时撤销烘焙。
5. 明确"不烘焙清单"。

### 2.3 非目标

- 不做贝塞尔手柄编辑器（07-CurvePathPreview 做路径几何预览；属性缓动只提供 4 种预设）。
- 不做缓动曲线自定义（不在本轮）。
- 不改运行时（运行时只认显式帧）。

## 三、方案

### 3.1 元数据结构

```ts
// AnimObject.authoring（不写盘）
interface ObjectAuthoring {
  easing?: { fromTime: number; type: 'ease_in' | 'ease_out' | 'ease_in_out' }[]
}
```

- `linear` 不存（= 无条目）。
- 段的定义：`fromTime` 必须精确命中该属性某帧的 `time`；段 = `[fromTime, nextFrameTime)`。
- 帧被删除/移动 → 该段元数据失效：删除该条目并提示（不猜测新段）。

### 3.2 烘焙算法（该属性、该段）

```text
输入：clipKey, path, fromTime
1. 找 from = 该属性 time == fromTime 的帧；找 to = 下一个帧。任一缺失 → 失败。
2. 若 def.interp == 'step' → 只删除该段元数据，不插帧，返回 {inserted:0, reason:'step'}。
3. 若 def.interp == 'geometric' 且值 <= 0 → 不插帧（几何插值要求正值，`SampledProperty.geometric 549+`），返回 reason。
4. 采样数 n = clamp(round(span * 4) + 1, 8, 20)     // 沿用现有 4/s、8~20（operations.ts 321–323、345–354）
5. 对 k = 1..n-2：
     u = k / (n - 1)
     e = easingProgress(type, u)                    // 见 §3.3
     t = from.time + span * u
     v = interpolate(def.interp, from.value, to.value, e)
     插入帧 {time: t, value: v}
6. 删除该段元数据。
7. 校验：插入后时间严格递增（span/n 必须 > 1e-4；否则减少 n）。
```

`interpolate` 的三种（与运行时同公式，`SampledProperty.interpolateFloat 515–525`）：

| interp | 公式 |
|---|---|
| `linear` | `a + (b - a) * e` |
| `angle` | `a + shortestDelta(a,b) * e`（`AngleUtil.delta 34–36`；`SampledProperty.angle 527–547`） |
| `geometric` | `exp(log a + (log b - log a) * e)`（`SampledProperty.geometric 549+`） |
| `step` | 不烘焙 |

### 3.3 缓动曲线

沿用现有四条（`EDITOR:src/operations.ts — easingProgress（330–344）`）：

| 类型 | 公式（`u ∈ [0,1]`） |
|---|---|
| `ease_in` | `u²` |
| `ease_out` | `1 - (1-u)²` |
| `ease_in_out` | `u<0.5 ? 2u² : 0.5 + 0.5*(1-(1-(2u-1))²)` |
| `linear` | `u` |

这四条与运行时数学模型 `Curves` 的同名实现一致（`J:math/Curves.java — easeIn（25–28）、easeOut（31–34）、easeInOut（37–44）`），但**不要把 `Curves` 当编辑器依赖**：烘焙是编辑器侧一次性计算，产出显式帧。

### 3.4 不烘焙清单（硬约束）

| 对象 | 理由 | 依据 |
|---|---|---|
| `paths[]` 条目 | 运行时保留几何+timing，烘焙成帧会丢可逆性与 3D 弧长保真 | `MOD:plans/0.3.6/Z-editor/object-model.md §3.6`；`MOD:plans/0.3.6/I-script-core/path-collection.md §3.4` |
| `orient` | value-only，运行时按切线/手动分派 | `TrackSchemas（242–243）`；`OrientationEvaluator（53–78）` |
| `yaw_offset` / `pitch_offset` | 运行时在切线支叠加，烘焙成 `yaw`/`pitch` 会与 `look_at` 优先级冲突 | `OrientationEvaluator（62–75）` |
| step 属性 | 烘焙无意义（台阶） | `Interp.STEP` |
| `mode=value` / `mode=event` | 无关键帧/离散记录 | `SampledProperty（60–84）` |
| STRUCT 值 | 不可关键帧 | `SampledProperty（63–72）` |

### 3.5 与保存/推送的关系

- 保存：**不**烘焙。`authoring` 被 `serializeDoc` 剥离（02-SerializationLossless §3.3）。因此"未烘焙的缓动"只存在于编辑器会话；保存后重开，缓动标记丢失（已烘焙的帧保留）。
- 为避免作者困惑：保存前若存在未烘焙的缓动段，弹一次提示"这些缓动段未烘焙，保存后将丢失缓动设置（显式帧不受影响）"，提供"先烘焙"或"直接保存"。
- 推送：同样不烘焙；预览看到的是显式帧的效果（与保存一致）。

**这是与现状最大的行为差异**：现状保存自动烘焙（作者无感），新方案要求显式。理由是 02 轮的无损要求（打开→保存不改文档）。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `setEasing(doc, clipKey, path, fromTime, type)` | — | 新文档（写 `authoring`） |
| `bakeSegment(doc, clipKey, path, fromTime)` | — | `{doc, inserted, reason?}` |
| `pendingEasings(doc)` | 文档 | 未烘焙段列表（保存前提示用） |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/easing.ts`（提案）：`setEasing` / `bakeSegment` / `pendingEasings` / `easingProgress`。
2. 改 `EDITOR:src/operations.ts`：删除 `EASING_KEY`（318）、`getEasing`（370–374）、`setEasing`（376–383）、`bakeClipEasing`（385–416）、`bakeDocEasing`（418–430）、`continuousChannels`（854–897）、`sampleBakedKeyframe`（902–945）、`easingSupport`（356–369）、`bakeSampleCount`（345–354）、`BAKE_*` 常量（321–323）。
3. 改 `EDITOR:src/store.ts — saveScript（439–465）`：删除烘焙调用；加 `pendingEasings` 提示。
4. 改 `EDITOR:src/store.ts — pushScript（530–551）`：删除烘焙调用。
5. 将段缓动控件与显式烘焙按钮挂到ClipEffectControlsPanel中相应属性的段详情/展开行，左右行布局同步；不创建单属性独占页面或主时间轴曲线。STEP/VALUE/EVENT及原禁止项不显示该入口。
6. 撤销：烘焙走 `commit`，一个段一个快照。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/Easing.java`（提案）：同公式与采样数。
2. 14将同一入口迁入AUI片段效果控件的对应属性段，不放到独立快捷属性轴，也不缩减为点选列表。

### 4.4 禁止修改

- 不在保存/推送路径烘焙。
- 不烘焙 §3.4 清单里的对象。
- 不把缓动写进 JSON（`parseKeyframes` 只允许 `time`/`value`，写了会被拒绝）。
- 不用整帧复制生成烘焙帧（只写本属性的 `value`）。
- 不跨段合并缓动。

## 五、正反例验收

### 5.1 正例

1. `yaw` 在 `t=0`（0°）、`t=4`（180°），`interp=angle`，段 `0→4` 设 `ease_in`，点"烘焙本段" → 插入 15 帧（`n = clamp(4*4+1, 8, 20) = 17`，中间 15 帧）；`t=2` 处值 ≈ 45°（ease_in(0.5)=0.25 → 45°）。
2. 同上但 `interp=step`（例如 `position_mode`）→ 不插帧，只清元数据，返回 `reason:'step'`。
3. 烘焙后撤销一次 → 回到 2 帧，元数据恢复。
4. `paths[0]` 存在时，对 `position.x` 烘焙 → 只影响 `position.x` 的帧；`paths[0]` 条目不变（几何/端点不动）。
5. 保存前有未烘焙段 → 出现提示；选"先烘焙"则先烘焙再保存；选"直接保存"则 `authoring` 被剥离。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| 保存时自动烘焙 | 禁止 |
| 对 `orient` 烘焙 | 禁止（value-only） |
| 对 `yaw_offset` 烘焙成 `yaw` 帧 | 禁止（运行时叠加语义会变） |
| 烘焙时把 `position.x` 的帧也复制进来 | 禁止（只写本属性） |
| 段跨零长（两帧同时间） | 不可能（时间严格递增）；若出现 → 拒绝 |
| 采样数 100 导致文件巨大 | 禁止（上限 20） |
| `geometric` 且端点 <= 0 时插值 | 禁止（返回 reason，不插帧） |

### 5.3 异步关键帧专项

**正例**：`position.x` 有 2 帧，`yaw` 有 2 帧；只对 `yaw` 的段烘焙 → `yaw` 帧数增加，`position.x` 帧数不变。

**反例**：烘焙 `yaw` 后 `position.x` 也多出插值帧（旧的 `sampleBakedKeyframe` 整帧复制行为）。

- 期望：不发生。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；打开 `yaw` 两帧（0°/180°，4 秒）的片段。
2. 设 `ease_in` 并烘焙；保存；`script.validate` → `ok:true`。
3. 游戏内播放，观察 `t=2` 附近相机 yaw 约 45°（明显慢起）。
4. 撤销烘焙并保存 → 重载后只有 2 帧（缓动标记已丢，符合预期）。
5. 对 `position_mode` 设缓动 → 面板无缓动入口（step）。

通过判定：第 3 步角度在 45°±3°；第 4 步 2 帧；第 5 步无入口。

## 七、完成定义

1. `EDITOR:src/model/easing.ts` 存在。
2. `operations.ts` 的烘焙与通道表代码已删除；保存/推送不再烘焙。
3. step 属性无缓动入口；§3.4 清单不可烘焙。
4. §5 的 5 条正例、7 条反例通过。
5. §6 冒烟 5 步通过（含角度记录）。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同公式（同一段烘焙产出相同帧集合，float32 容差内）。
