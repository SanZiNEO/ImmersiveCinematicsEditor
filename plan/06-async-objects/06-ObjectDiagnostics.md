# 06-ObjectDiagnostics：异步对象诊断

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C08 异步属性身份
> 依赖：02-ValidationBridge（issue 模型与本地检查清单）、06 各文件
> 下游：05（诊断面板）、13（WebUI 验收）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

把"异步对象"特有的问题集中成一组可定位的 issue：时间冲突、形态不符、`requires` 不满足、step 切换缺三轴帧、轴外帧提示、`event` 空列表、`struct` 不可关键帧、跨属性误操作痕迹（同一时间被批量写入但值完全相同 → 可疑补帧）。

本文件不重复 02-ValidationBridge 的通用结构检查，只补"属性/关键帧层面"的诊断，并把它们映射到 UI 定位。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| 前端只有一个 `validationIssues: string[]`，无结构、无定位 | `EDITOR:src/store.ts（56）`、`validateScriptDocument（394–409）` |
| 校验结果直接显示文本（无跳转） | 现有 UI 无诊断面板（`App.vue` 无对应组件） |
| 服务端 issue 有路径前缀但格式不统一 | 02-ValidationBridge §3.4 |
| 旧模型下"整帧"不会出现"某属性时间冲突"，新模型才会 | `J:script/object/SampledProperty.java（97–110）` |

### 2.2 目标

1. 每条 issue 有 `code`、`severity`、`where`（`clipKey` + `objectPath` + `keyframeTime`）。
2. 点issue定位统一效果控件中的片段、对象组、叶子及节点；主时间轴最多定位/选择对应片段，不展开对象行或节点。
3. 区分"必须修"（block）与"提示"（warn/info）；轴外帧是 **info**，不是错误。
4. 不重复实现服务端语义：本地只查形状与异步一致性。

### 2.3 非目标

- 不做运行时可用性检查（选择器/结构是否存在 → 运行期 `isClipUsable`，`J:camera/source/ObjectCameraEvaluator.java 266–288`）。
- 不做性能诊断。

## 三、方案

### 3.1 诊断项（本文件负责的部分）

| code | 级别 | 条件 | 定位 |
|---|---|---|---|
| `obj.pathInvalid` | block | 路径不匹配 `[a-z][a-z0-9_]*`（`PropertyPath.isSegment 86–101`） | 片段 |
| `obj.pathUnknown` | block | 路径不在该轨 schema | 片段 + 路径 |
| `obj.memberUnknown` | block | 属性里有 `value`/`keyframes` 之外的成员 | 片段 + 路径 |
| `obj.empty` | block | 既无 `value` 也无 `keyframes`（`ObjectParser.parseProperty 101–103`） | 片段 + 路径 |
| `obj.modeValueHasKeyframes` | block | `mode=value` 且有 `keyframes` | 片段 + 路径 |
| `obj.modeEventNoKeyframes` | block | `mode=event` 且 `keyframes` 空/缺失 | 片段 + 路径 |
| `obj.requiredMissing` | block | `required` 且无值/有效帧/默认 | 片段 + 路径 |
| `obj.requiresUnmet` | warn | 写了但 `requires` 不满足 | 片段 + 路径 |
| `obj.typeMismatch` | block | 值类型不符（9 种） | 片段 + 路径（+ 帧） |
| `obj.rangeViolation` | block | 超出 `min`/`max` | 片段 + 路径（+ 帧） |
| `kf.timeNegative` | block | `time < 0` | 片段 + 路径 + 时间 |
| `kf.timeNotAscending` | block | 同属性时间不严格递增 | 片段 + 路径 + 时间 |
| `kf.timeDuplicate` | block | 同属性两帧 `|Δt| <= 1e-4`（同上，但文案区分） | 片段 + 路径 + 时间 |
| `kf.outOfRange` | info | `time > duration`（有限片段） | 片段 + 路径 + 时间 |
| `kf.stepBaked` | warn | step 属性上存在"烘焙痕迹"（相邻帧间隔均匀且数量 > 5，且该属性 `interp=step`） | 片段 + 路径 |
| `kf.suspiciousUniform` | info | 同一片段内多个属性在**完全相同**的时间集合上都有帧，且帧数 > 5（疑似整帧补帧遗留） | 片段 |
| `switch.missingPositionFrames` | block | `SPACE_SWITCH_FIELDS` 变化点缺 `position.x/y/z` 任一 | 片段 + 时间 + 缺失路径 |
| `event.recordShape` | block | 事件记录键/形态不符（`ObjectCodec.readEvent 115–145`、`readModEvent 146–164`） | 片段 + 路径 + 时间 |
| `struct.animated` | block | `struct` 属性出现 `keyframes` | 片段 + 路径 |
| `clip.unknownKey` / `meta.*` / `timeline.*` | block | 见 02-ValidationBridge | 对应位置 |

**不在此列**（由 02-ValidationBridge 或服务端负责）：路径集合端点、规则绑定引用、跨脚本引用、模型合法性。

### 3.2 与 02-ValidationBridge 的关系

- 02 的 `validateStructure` 负责 L01–L34（文档形状与引用）。
- 本文件的诊断项**并入同一 `validateStructure`**（同一遍遍历，不重复读文档），只是把 `code` 命名空间分开（`obj.*`/`kf.*`/`switch.*`/`event.*`）。
- 因此实现上是"一个函数、一张 issue 表"，不是两套校验。

### 3.3 轴外帧的提示策略

| 情况 | 级别 | 文案 |
|---|---|---|
| `time > duration`（有限片段） | info | `轴外关键帧（t=7.0 > duration=5.0），运行时忽略` |
| 无限片段 | 无 | 不提示 |
| 片段缩短导致大量帧变轴外（> 30% 的帧） | warn | `片段缩短后有 N 帧落到轴外，运行时不生效` |

轴外帧**不是错误**：不阻断保存，不进入服务端 issue 列表（服务端也不报，`SampledProperty.compile 153–162`）。

### 3.4 可疑补帧检测（`kf.suspiciousUniform`）

目的：迁移或旧编辑器可能留下"每个属性都在同一批时间点有帧"的痕迹。这不是错误（运行时合法），但会让作者以为"属性真的在动"。

判定：

```text
对同一片段的所有 animated 属性：
  若 ≥ 3 个属性，且它们的时间集合完全相同，且帧数 >= 5
  → 报 info："N 个属性共用同一组 M 个时间点，可能是整帧补帧遗留"
```

只提示，不自动删。作者可"仅保留值发生变化的帧"（提案命令 `object.pruneRedundantFrames`，需显式执行）。

### 3.5 定位与跳转

```ts
export interface DocLocation { clipKey?, objectPath?, keyframeTime?, jsonPath? }
```

跳转行为：

1. 用02共享Selection定位实际clipKey/objectPath/keyframeTime，先确认仍存在；失效则显示原因，不猜邻居。
2. 显示clip.effects，由ClipEffectControlsPanel打开片段上下文，EffectControlsRows显式reveal被折叠/过滤的目标组与叶子，其他已展开组保持。
3. 将效果控件局部游标与可见窗口定位到目标time；需要游戏seek时经03按global=start_time+local换算，独立片段按原宿主时间合同处理。
4. 轴外节点通过本地范围扩展可达，不拉宽主时间轴片段；主时间轴只滚到片段位置，06自己负责节点行可见性。

### 3.6 诊断面板形态（与 05 的接口）

```text
┌ 诊断（3 错误 / 2 警告 / 4 提示）──────────────┐
│ [全部 ▾] [错误] [警告] [提示]                 │
│ ● kf.timeNotAscending  c1 · yaw · t=2.000     │ → 跳转
│ ● switch.missingPositionFrames  c1 · t=3.000  │ → 跳转
│   ⚠ obj.requiresUnmet  c1 · yaw_offset         │ → 跳转
│   ⓘ kf.outOfRange  c1 · position.x · t=7.000   │ → 跳转
└───────────────────────────────────────────────┘
```

面板归 05；本文件提供数据与跳转函数。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `diagnoseObjects(doc, registry): Issue[]` | 文档 + 注册表 | 本文件的 issue 集 |
| `jumpTo(issue, store)` | issue + store | 设置选择/播放头/展开状态 |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/diagnoseObjects.ts`（提案），并入 `validateStructure`（02-ValidationBridge §4.2 第 1 步）。
2. 改 `EDITOR:src/store.ts（56）`：`validationIssues: string[]` → `derived.issues: Issue[]`（02-ValidationBridge §3.1）。
3. 新增诊断面板组件（归 05；本文件提供 `jumpTo`）。
4. 新增命令 `object.pruneRedundantFrames`（提案，可选）：删除"值与前帧相同且非首末帧"的帧；必须撤销可回退。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/DiagnoseObjects.java`（提案）：同 issue 表。
2. AUI 诊断列表：同 `jumpTo` 语义。

### 4.4 禁止修改

- 不把轴外帧报成错误。
- 不自动删除"可疑补帧"。
- 不重复实现服务端语义（选择器解析、模型合法性）。
- 不用字符串匹配代替结构化 issue（`code` 必须稳定）。

## 五、正反例验收

### 5.1 正例

1. `yaw` 帧 `[1,1]` → `kf.timeDuplicate`（block），定位 `t=1`。
2. `yaw` 帧 `[2,1]` → `kf.timeNotAscending`（block）。
3. `position.x` 帧 `[0,7]`，`duration=5` → `kf.outOfRange`（info），不阻断保存。
4. `orient=manual` 且写了 `yaw_offset` → `obj.requiresUnmet`（warn）。
5. `event` 记录 `{"command":"x","delay":1}` → `event.recordShape`（block）。
6. 3 个属性共用 `{0,1,2,3,4}` 五个时间点 → `kf.suspiciousUniform`（info），不删帧。
7. `position_space` 在 `t=3` 变 `base` 但缺 `position.y` → `switch.missingPositionFrames`（block），文案列出缺 `position.y`。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| 轴外帧被报成 block 并阻断保存 | 禁止 |
| 可疑补帧被自动删除 | 禁止 |
| issue 只有文本、无 `code`/`where` | 禁止 |
| 同一问题同时报 `obj.typeMismatch` 与 `event.recordShape`（重复） | 禁止（按路径末段选一个） |
| 诊断里报"选择器无法解析" | 禁止（运行期问题） |

### 5.3 异步关键帧专项

**正例**：`yaw` 在 `t=1` 与 `t=1.00001` → `|Δt| = 1e-5 <= 1e-4` → `kf.timeDuplicate`（block）。作者改成 `t=1.001` → `|Δt| = 1e-3 > 1e-4` → 无 issue。

**反例**：容差用 1e-9，导致 `1.00001` 被当成合法（运行时会拒绝）。

- 期望：用 1e-4（与 `PathCollectionParser.TIME_EPSILON 54` 同量级；运行时严格 `<` 比较，编辑器容差只用于 UI 判定"同一帧"）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；构造 `diag_smoke.json` 含：时间重复、轴外帧、`requires` 不满足、step 切换缺帧、事件记录多键。
2. 编辑器打开 → 诊断面板显示 5 类 issue，级别正确。
3. 逐条跳转 → 选择与播放头落到正确位置。
4. 修复 block 项 → 只剩 info/warn。
5. 保存 → `script.validate` → `ok:true`。

通过判定：第 2 步级别正确（轴外为 info）；第 3 步跳转准确；第 5 步通过。

## 七、完成定义

1. `diagnoseObjects.ts` 存在并并入 `validateStructure`。
2. `store.ts` 的 issue 已是结构化 `Issue[]`。
3. 轴外帧为 info，不阻断保存。
4. §5 的 7 条正例、5 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同 issue 表（同一文档同一 `code` 集合）。
