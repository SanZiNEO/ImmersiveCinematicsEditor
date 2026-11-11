# 07-OrientationEditor：朝向编辑

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C09 路径与数值辅助
> 依赖：07-PositionEditor（`position_space=base` 才有方向源）、07-PointSourceForms（连线端点/注视目标）
> 下游：08（相机转场）、07-CurvePathPreview（`orient=tangent` 的切线示意）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

实现朝向组：`yaw`/`pitch`/`roll`、`yaw_lock`/`pitch_lock`、`yaw_base`/`pitch_base` + `yaw_base_selector` + `yaw_base_from/to`（+偏移/冻结）、`look_at` + 载荷、`orient` + `yaw_offset`/`pitch_offset`。

核心是**优先级**与**前置条件**：`look_at` 可解析时覆盖 yaw/pitch；否则 `orient=tangent` 且有切线时用切线 + 偏移；否则手动（基准/锁 + 偏移）。偏移只在切线支读取。

## 二、为什么做

### 2.1 现状与运行时

| 事实 | 证据 |
|---|---|
| 优先级：`look_at` > `tangent` > 手动 | `J:script/object/position/OrientationEvaluator.evaluate（53–78）` |
| `look_at` 命中时：`yaw`/`pitch` 由世界位置到目标点的方向决定；`roll` 仍取 `roll`；`yaw`/`pitch` 偏移与方向锁都不参与 | `OrientationSpec` 类注释（13–14）；`evaluate（62–68）` |
| 切线支：`yaw = atan2(dz,dx) - 90`、`pitch = -atan2(dy,horizontal)`，再叠加 `yaw_offset`/`pitch_offset` | `tangentYawPitch（172–180）`、`evaluate（70–75）` |
| 切线来源：`SampledPathTangent` 中心差分（表达空间导数），`base` 空间过参考系转世界方向 | `SampledPathTangent（10–86）`；`ObjectCameraEvaluator.toWorldDirection（505–514）` |
| 手动支：每轴基准（world/entity/line）→ 锁值替换 → 加 `yaw`/`pitch`；`roll` 直接 | `manual（81–99）` |
| 基准 `line` 端点不可解析或水平退化 → 基准 0（回退 world） | `lineAngles（105–122）`、`ZERO_ANGLES（40）` |
| 实体基准未解析（NaN）→ 0 | `finiteOrZero（183–185）` |
| `yaw`/`pitch`/`roll` 是 `Interp.ANGLE`（`unit=degree`） | `TrackSchemas（159–164）` |
| `yaw_lock`/`pitch_lock` 是 `nullable_float` + `ANGLE`，`null` = 不锁 | `TrackSchemas（165–168）`；`OrientationSpec.yawLock（73–76）` |
| `yaw_base`/`pitch_base` 是 `enum(world/entity/line)` + `STEP` | `TrackSchemas（169–172）` |
| `yaw_base_selector` 默认 `@p` | `TrackSchemas（173–174）`；`OrientationSpec` 默认 `@p`（20、45–46） |
| `look_at` 是 `enum(none/player/coordinate/entity/block)` + `STEP` | `TrackSchemas（211–213）` |
| `orient` 是 `value-only` enum（`manual`/`tangent`） | `TrackSchemas（242–243）` |
| `yaw_offset`/`pitch_offset` 是 `animated` + `ANGLE` + `requires("orient=tangent")` | `TrackSchemas（244–249）` |
| 编辑器旧显隐表把 `yaw_offset` 绑到 `orient=tangent`，但把 `look_at_target` 当对象形态（已移除） | `EDITOR:src/components/DynamicForm.vue（23–44，39–40）`；`types.ts（116）` |

### 2.2 目标

1. 显示优先级：面板顶部一句话说明当前生效支路（"当前由 look_at 决定" / "当前由切线决定" / "当前手动"）。
2. `look_at != none` 时：`yaw`/`pitch` 置灰（不参与），`yaw_lock`/`pitch_lock` 置灰，`yaw_offset`/`pitch_offset` 置灰；`roll` 仍可编辑。
3. `orient=tangent` 且 `look_at=none` 时：`yaw_offset`/`pitch_offset` 可用；提示"切线来自位置导数；若该片段无位置帧，切线为 0 → 回退手动"（`evaluate 70–71` 的 `lengthSqr >= EPSILON²` 判定）。
4. `yaw_base=line` 时显示 `yaw_base_from/to`（+偏移/冻结）；`entity` 时显示 `yaw_base_selector`；`world` 时隐藏两者。
5. `pitch_base` 与 `yaw_base` 独立（可一轴 entity、另一轴 world，`BaseSource` 类注释 8–9）。
6. 角度输入不自动归一（运行时不归一；`AngleUtil` 只在插值时折最短弧）。

### 2.3 非目标

- 不做世界内朝向拾取（飞控归 12/13）。
- 不做转场/morph 的朝向混合（08）。
- 不实现切线计算（运行时 `SampledPathTangent`）。

## 三、方案

### 3.1 面板结构

```text
┌ 朝向 ────────────────────────────────────────────┐
│ 生效：手动（基准 world + yaw/pitch）              │
│ 模式 orient  (•) manual   ( ) tangent             │
│ ── 角度 ───────────────────────────────────────  │
│ yaw   [ 0   ]°   pitch [ 0   ]°   roll [ 0 ]°    │
│ yaw_lock   [ ] 不锁   [ 45 ]°                     │
│ pitch_lock [ ] 不锁   [    ]°                     │
│ ── 基准 ───────────────────────────────────────  │
│ yaw_base   [ world ▾ ]   pitch_base [ world ▾ ]   │
│ 选择器     [ @p        ]   （仅 entity）          │
│ 起点/终点  [ @p ] [ @e ]  + 偏移 + 冻结（仅 line）│
│ ── 注视 ───────────────────────────────────────  │
│ look_at    [ none ▾ ]                             │
│ （player）无载荷 /（coordinate）坐标或结构         │
│ （entity）选择器 + look_at_part 百分比             │
│ （block）block:id[:radius]                        │
│ 偏移 + 冻结                                       │
│ ── 切线偏移 ───────────────────────────────────  │
│ yaw_offset [ 0 ]°  pitch_offset [ 0 ]°（需 tangent）│
└──────────────────────────────────────────────────┘
```

### 3.2 生效支路判定（UI 用，不求值）

```ts
function activeBranch(doc, clipKey, t): 'look_at' | 'tangent' | 'manual' {
  const lookAt = valueAt('look_at', t)
  if (lookAt !== 'none' && lookAtResolvableInEditor(lookAt)) return 'look_at'
  if (valueAt('orient') === 'tangent' && hasPositionDerivative(clipKey, t)) return 'tangent'
  return 'manual'
}
```

`lookAtResolvableInEditor` 是**近似**（编辑器无法解析实体/方块/结构）：

- `player` → 若游戏已连接且有玩家激活位置 → 可解析；否则"未知"。
- `coordinate` → 结构为空且有坐标 → 可解析；结构非空 → "未知"。
- `entity` → "未知"（取决于实体是否存在）。
- `block` → "未知"。

因此面板显示三种状态：**确定生效** / **确定不生效**（如 `look_at=none`）/ **取决于世界**（未知）。未知时提示"运行时若目标不可解析，会回退到切线或手动"（`evaluate 62–68` 的 `target != null` 判定）。

`hasPositionDerivative`：该片段 `position.x/y/z` 至少有 2 帧（中心差分需要两侧采样；单帧时导数为 0 → 回退手动）。

### 3.3 置灰规则

| 条件 | 置灰字段 | 理由 |
|---|---|---|
| `look_at != none` | `yaw`、`pitch`、`yaw_lock`、`pitch_lock`、`yaw_offset`、`pitch_offset`、`yaw_base*` | `look_at` 覆盖 yaw/pitch，锁与偏移不参与（`evaluate 62–68`） |
| `orient != tangent` | `yaw_offset`、`pitch_offset` | `requires("orient=tangent")` |
| `yaw_base != entity` | `yaw_base_selector`（对 yaw 轴） | `manual 86–90` 只在 entity 读选择器 |
| `yaw_base != line` | `yaw_base_from/to` + 偏移 + 冻结 | `lineAngles` 只在 line 调用 |
| `pitch_base != line` | `yaw_base_to` 仍可能被 yaw 用；按"任一轴 line"显示 | `manual 83–84`：任一轴 line 才计算 `line` |
| `position_space != base` | `facing_*`（不在本面板，但同组提示） | 07-PositionEditor |

注意：`yaw_base_selector` 同时服务 yaw 与 pitch 的 entity 基准（`manual 88、93` 都用 `spec.yawBaseSelector()`）——**只有一个选择器字段**，不是两个。面板必须说明"该选择器同时用于 yaw/pitch 的 entity 基准"。

### 3.4 `look_at` 载荷（按枚举分支）

| `look_at` | 载荷 | 互斥 |
|---|---|---|
| `none` | 无 | 其余载荷全部隐藏（写了也不读取，`lookAtSpec 393–411` 的 `default → null`） |
| `player` | 无（`look_at_selector` 被 `LookAtSpec.PLAYER` 构造使用但运行时忽略，见 `ObjectCameraEvaluator 394–397`） | — |
| `coordinate` | `look_at_target_x/y/z` **或** `look_at_target_structure` | 二选一（`resolveLookAt 129–131`：structure 非空则用结构中心） |
| `entity` | `look_at_selector` + `look_at_part.x/y/z` | — |
| `block` | `look_at_target_block`（`block:id[:radius]`） | — |

`look_at_part` 百分比：0~100，默认 50（`TrackSchemas 216–221`）；运行时钳制（`EntityPoint`），编辑器拒绝越界。

### 3.5 角度语义

| 字段 | 单位 | 语义 | 运行时 |
|---|---|---|---|
| `yaw` | 度 | 相对基准的偏移（手动支）；`look_at` 时被覆盖 | `OrientationResult.yaw`（世界角，0=南，90=西） |
| `pitch` | 度 | 相对基准的偏移；`look_at` 时被覆盖 | 0=水平，-90=正上（`OrientationResult` 注释 4–6） |
| `roll` | 度 | 直接使用 | 同上 |
| `yaw_lock` | 度 | 世界角绝对值；`null`=不锁 | `manual 96–97` |
| `pitch_lock` | 度 | 同上 | 同上 |
| `yaw_offset` / `pitch_offset` | 度 | 切线支叠加 | `evaluate 73–74` |

编辑器**不**把 `yaw` 归一化到 `(-180,180]`；作者输入 270 就写 270（运行时插值按最短弧，绝对输出不归一，`AngleUtil` 类注释 4）。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `orientationVisibility(doc, clipKey, t)` | 文档 + 时间 | `{branch, disabled: string[], reasons: Record<string,string>}` |
| `lookAtLoadout(doc, clipKey)` | 文档 | `{fields: string[], conflicts: string[]}` |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/objects/OrientationEditor.vue`（提案）。
2. 新建 `EDITOR:src/model/orientation.ts`（提案）：`orientationVisibility` / `lookAtLoadout` / `hasPositionDerivative`。
3. 改 `EDITOR:src/components/DynamicForm.vue（23–44）`：删除 `yaw_offset`/`pitch_offset`/`look_at_*`/`yaw_base_*` 的手写显隐规则（已由本文件接管）。
4. 改 `EDITOR:src/types.ts`：删除 `look_at_target`（对象形态，116）与 `follow*`（108–109）。
5. 在 06 的属性列表里，`section=orientation` 的组标题旁加"朝向面板"入口。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/OrientationEditorScreen.java`（提案）。
2. 同 `orientationVisibility`；分支判定同 §3.2（含"未知"三态）。

### 4.4 禁止修改

- 不把 `look_at` 当五形态 `ref`。
- 不在 `look_at != none` 时让 `yaw`/`pitch` 看似生效（必须置灰 + 说明）。
- 不把 `yaw_base_selector` 拆成两个字段。
- 不自动归一化角度。
- 不自动补 `yaw_offset` 关键帧（作者显式加）。

## 五、正反例验收

### 5.1 正例

1. `orient=manual`、`look_at=none`、`yaw_base=world` → `yaw`/`pitch`/`roll` 可编辑；`yaw_offset`/`pitch_offset` 置灰；分支显示"手动"。
2. `orient=tangent` 且片段有 ≥2 个位置帧 → 分支显示"切线"；`yaw_offset`/`pitch_offset` 可用。
3. `orient=tangent` 但片段只有 1 个位置帧 → 分支显示"手动（无切线）"，提示"单帧导数为 0"。
4. `look_at=entity` → `yaw`/`pitch`/锁/偏移/基准全部置灰；`roll` 可编辑；分支显示"取决于世界（look_at）"。
5. `yaw_base=entity`、`pitch_base=world` → `yaw_base_selector` 可用（同时服务两轴），`pitch` 仍按 world 基准。
6. `yaw_base=line` → `yaw_base_from/to` 出现；填 `@p` 与 `@e[type=pig,limit=1]`；运行时连线角度（若两者可解析）。
7. `look_at=coordinate` + 结构 `village_plains` → 坐标字段禁用；只写结构。
8. `look_at=none` 但文档里有 `look_at_target_x` → 提示"不读取"（不删除）。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| `look_at=entity` 时 `yaw` 输入框仍可编辑且无说明 | 禁止（必须置灰 + 说明） |
| `orient=manual` 时显示 `yaw_offset` 为可用 | 禁止 |
| `yaw_base=line` 但未填端点 | 提示"端点为空 → 基准回退 world"（`lineAngles 110–112`） |
| 把 `yaw` 输入 270 自动改成 -90 | 禁止（不归一） |
| `look_at=coordinate` 同时写结构与非零坐标 | 拒绝（互斥） |
| `look_at_part` 输入 150 | 拒绝 |

### 5.3 异步关键帧专项

**正例**：`look_at`（step）在 `t=2` 从 `none` 变 `entity`；`yaw` 有 `[0,3]` 两帧。切到 `entity` 后 `yaw` 仍保留两帧（不删），只是不参与；切回 `none` 后 `yaw` 立即生效。

**反例**：切到 `entity` 时自动删除 `yaw` 关键帧。

- 期望：禁止（运行时不读取但保留数据，与 `ObjectValidator.checkRequiresAndRequired 424–443` 的"只警告不删"一致）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；CAMERA 片段，位置两帧（0→3 秒）。
2. `orient=manual`、`yaw=0→90`；播放确认转向。
3. `orient=tangent`（路径沿 +x 方向）；播放确认相机朝行进方向；`yaw_offset=15` 后偏 15°。
4. `look_at=entity` 指向一个实体；播放确认视线跟随；`roll=10` 生效。
5. `yaw_base=entity` 站在实体旁；播放确认相机基准随实体身体朝向。

通过判定：第 2/3/4/5 步画面朝向符合预期；日志无解析错误；`script.validate` 通过。

## 七、完成定义

1. `OrientationEditor.vue` + `orientation.ts` 存在。
2. `DynamicForm.vue` 不再有朝向相关手写显隐。
3. `types.ts` 的 `look_at_target`/`follow*` 已删除。
4. §5 的 8 条正例、6 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同 `orientationVisibility`（同置灰集合）。
