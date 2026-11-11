# 07-PathTimingEditor：路径时间映射

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C09 路径与数值辅助
> 依赖：07-PathCollectionEditor（条目）、07-PathGeometryForms（几何总弧长）
> 下游：07-CurvePathPreview
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

`paths[].timing`：把片段局部时间归一化成"沿路径的归一化进度"。

- 缺省/`{"type":"linear"}`：`s = u`。
- `{"type":"keyframes","points":[{t,s},…]}`：单调不减的折线，端点固定 0 与 1。

本文件定义编辑器形态、校验、以及"改 timing 不改形状"的硬约束。

## 二、为什么做

### 2.1 现状与运行时

| 事实 | 证据 |
|---|---|
| `timing` 缺省 = 线性；`null` 也按线性 | `J:script/path/PathCollectionParser.parseTiming（274–277）` |
| `linear` 只接受 `type` 键 | `TIMING_LINEAR_KEYS（60）`、`parseTiming（290–293）` |
| `keyframes` 需要 `points` 数组、至少 2 点 | `parseTiming（294–308）` |
| 每个点只允许 `t`/`s`，且都是有限数字 | `POINT_KEYS（62）`、`parseTiming（311–321）` |
| `times`/`values` 长度 ≥2 且一致；端点必须 0/1；两者单调不减 | `J:script/path/PathTiming.java — KeyframeTiming.of（72–103）` |
| `times` 允许相等（相等时刻按后值跳变） | `KeyframeTiming.of（92–96）`；`locate（119–133）` |
| 运行期 `u = (t - startTime) / (endTime - startTime)`，两次 clamp，再 `timing.progress(u)` | `PathBindingResolver.progress（107–120）` |
| 求值顺序：`s = timing(t)`（归一化）→ `s * L` → `geometry(s)` | `PathEvaluator.position（27–34）`；`ArcLengthTable.uAt` |
| 线性 timing 下速度大小恒为 `L / T`；非线性时瞬时速度是 `ds/dt` | `MOD:plans/0.3.6/I-script-core/path-collection.md §3.4` |
| 编辑器无 timing 概念 | `EDITOR:src/types.ts（151 `curve`）` |

### 2.2 目标

1. 两种形态二选一；`linear` 不写多余键。
2. `keyframes` 用折线编辑器：点的 `t`（0~1 归一化时间）与 `s`（0~1 进度），端点锁定 0/1。
3. 校验与运行时同口径：至少 2 点、端点 0/1、单调不减（`t` 可相等）。
4. 显示"该 timing 对速度的影响"：预览里可看到非匀速。
5. 明确：**timing 不改变形状**，只改变沿路径的推进。

### 2.3 非目标

- 不做缓动曲线选择（`timing` 只接受 `linear`/`keyframes`，引用缓动定义不在当前实现内：`MOD:plans/0.3.6/I-script-core/path-collection.md §3.4`）。
- 不做"按弧长匀速"以外的速度曲线（那是 `keyframes` 的用途）。
- 不做几何求值。

## 三、方案

### 3.1 数据形态

```json
"timing": { "type": "linear" }
```

```json
"timing": { "type": "keyframes", "points": [
  { "t": 0.0, "s": 0.0 },
  { "t": 0.3, "s": 0.7 },
  { "t": 1.0, "s": 1.0 }
] }
```

语义：前 30% 时间走完 70% 路程（起步快），后 70% 时间走 30%（收尾慢）。

### 3.2 编辑器形态

```text
┌ 时间映射 ─────────────────────────────────────┐
│ (•) linear（匀速：s = u）                      │
│ ( ) keyframes                                  │
│     t [0.00]  s [0.00]  （端点锁定）            │
│     t [0.30]  s [0.70]  [删除]                 │
│     t [1.00]  s [1.00]  （端点锁定）            │
│     [+ 添加点]                                  │
│ 提示：改这里只改推进速度，不改路径形状。          │
└────────────────────────────────────────────────┘
```

- `t`/`s` 都是 0~1 的归一化值（不是秒、不是方块）。
- 端点（第一个与最后一个）的 `t`/`s` 锁定为 0/1，不可编辑（运行时强制，`KeyframeTiming.of 83–91`）。
- 中间点可增删；`t` 允许相等（同刻跳变），但 UI 要提示"同一 t 的两点会形成瞬时跳变"。
- 排序：按 `t` 升序；插入时自动定位（但**不**自动改 `s`）。

### 3.3 校验（本地，与运行时同口径）

| 检查 | 级别 | 依据 |
|---|---|---|
| `type` ∈ `{linear, keyframes}` | block | `parseTiming（328–330）` |
| `linear` 只有 `type` 键 | block | `TIMING_LINEAR_KEYS（60）` |
| `keyframes` 只有 `type`/`points` 键 | block | `TIMING_KEYFRAME_KEYS（61）` |
| `points` 是数组且 ≥2 | block | `parseTiming（305–308）` |
| 每个点只有 `t`/`s` | block | `POINT_KEYS（62）` |
| `t`/`s` 有限 | block | `requireFiniteFloat（447–461）` |
| 首 `t=0`、末 `t=1`；首 `s=0`、末 `s=1` | block | `KeyframeTiming.of（84–91）` |
| `t` 单调非减；`s` 单调非减 | block | `KeyframeTiming.of（92–101）` |
| 点数量上限（建议 64） | warn | 编辑器自定（运行时不限；防止手滑生成巨大折线） |

### 3.4 与几何的关系（硬约束）

| 规则 | 说明 |
|---|---|
| timing 不改变形状 | `geometry` 不被修改；`L` 是几何总弧长（`ArcLengthTable`） |
| 改 timing 不重算控制点 | 禁止"为了匀速而移动控制点" |
| 改 geometry 不重算 timing | 禁止"为了保持速度而改 points" |
| 2 轴路径的"匀速"只在该平面内 | 未选轴仍按自身属性插值，3D 速度不可控（`MOD:plans/0.3.6/I-script-core/path-collection.md §3.3`） |
| `timing` 端点斜率 ≠ 段间速度连续 | 段边界的速度衔接由相邻条目的 `timing` 端点斜率表达，无"过渡窗口"机制（同上 §3.4） |

编辑器提示："段间速度不连续是正常的；要平滑接缝，请让前一段末斜率与后一段首斜率匹配（可手动调 points，或让两段都用 linear）。"

### 3.5 `linear` 的写法

- 缺省不写 `timing`（`parseTiming 275` 对 null 返回线性）。
- 作者显式选 `linear` 时，写 `{"type":"linear"}`（不写 `points`）。
- **不**写 `{"type":"linear","points":[...]}`（会被 `TIMING_LINEAR_KEYS` 拒绝）。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `defaultTiming(): PathTimingDoc` | — | `{type:'linear'}` |
| `validateTiming(timing): Issue[]` | timing | 本地 issue |
| `progressAt(timing, u): number` | timing + 归一化时间 | 归一化进度（仅供预览折线绘制） |

`progressAt` 只是预览用（折线求值，几十行），**不是**运行时替代品；预览标注"示意"。

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/paths/PathTimingEditor.vue`（提案）。
2. 新建 `EDITOR:src/model/pathTiming.ts`（提案）：`defaultTiming` / `validateTiming` / `progressAt`。
3. 在 07-PathCollectionEditor 的条目编辑器里嵌入。
4. 在 07-CurvePathPreview 里画 `s(u)` 折线（横轴 `u`、纵轴 `s`），与路径示意并列。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/PathTimingEditor.java`（提案）。
2. 校验可直接调 `PathCollectionParser.parseTiming`（public static）做"试构造"，捕获 `ScriptParseException`。

### 4.4 禁止修改

- 不引入 `easing` 引用类型（运行时只接受 `linear`/`keyframes`）。
- 不允许端点非 0/1。
- 不允许 `s` 递减。
- 不因改 timing 而动 geometry。
- 不把 `t` 当秒（它是归一化时间）。

## 五、正反例验收

### 5.1 正例

1. `timing` 缺省 → 线性；列表显示"linear"。
2. 选 `linear` → 写 `{"type":"linear"}`；`script.validate` 通过。
3. 选 `keyframes`，点 `[{0,0},{0.3,0.7},{1,1}]` → 通过；预览显示前快后慢。
4. 加一个中间点 `{0.5,0.5}`（在 `{0.3,0.7}` 之后）→ `s` 从 0.7 到 0.5 递减 → 本地拒绝（`s` 必须非减）。
5. 两个点 `t` 相同（`{0.5,0.4}`、`{0.5,0.6}`）→ 允许（同刻跳变）；UI 提示。
6. `t` 与 `s` 端点都锁定，无法编辑。

### 5.2 反例

| 输入 | 期望 |
|---|---|
| `{"type":"linear","points":[]}` | 拒绝（linear 只接受 type） |
| `{"type":"easing","name":"ease_in"}` | 拒绝（未知类型） |
| 只有 1 个点 | 拒绝（至少 2 点） |
| 首点 `t=0.1` | 拒绝（端点必须 0） |
| 末点 `s=0.9` | 拒绝（端点必须 1） |
| `s` 递减 | 拒绝 |
| `t` 递减 | 拒绝 |
| 把 `t` 输入成 `2.5`（当成秒） | 拒绝（`t ∈ [0,1]` 由端点约束与单调性间接保证；UI 限制输入范围） |

### 5.3 异步关键帧专项

**正例**：`p1` 的 `timing` 从 linear 改成 keyframes（前快后慢）；`position.x` 的关键帧一个都不动；预览里路径形状不变、速度变化。

**反例**：改 timing 时"顺手"把 `position.x` 的中间帧删掉（以为重复）。

- 期望：不发生（timing 与关键帧无关）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；`c1` 位置节点 `[0,4]`，`p1` 为 `line`、`axes[x,y,z]`。
2. `timing=linear` → 播放：匀速通过 4 秒。
3. 改成 `keyframes [{0,0},{0.25,0.75},{1,1}]` → 播放：前 1 秒走 75%，后 3 秒走 25%（明显前快后慢）。
4. 改回 `linear` → 恢复匀速。
5. 改 `geometry` 为 `bezier`（不动 timing）→ 路径弯曲但时间分布不变。

通过判定：第 3 步速度变化可观察；第 5 步形状变、节奏不变。

## 七、完成定义

1. `PathTimingEditor.vue` + `pathTiming.ts` 存在。
2. 端点锁定；单调性与 0/1 校验在本地生效。
3. 不引入 easing 引用。
4. §5 的 6 条正例、8 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体用 `PathCollectionParser.parseTiming` 试构造，accept/reject 与 WebUI 一致。
