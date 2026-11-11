# 06-EventRecordEditor：事件记录编辑

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C08 异步属性身份
> 依赖：[06-ClipEffectControlsPanel](06-ClipEffectControlsPanel.md)、02-AnimObject（event_record形态）
> 下游：11（事件轨语义）、13（WebUI 验收）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

`EVENT` 轨的 `objects.event` 与 `MOD_EVENT` 轨的 `objects.mod_event` 是**离散事件记录**（`mode=event`，`type=event_record`）：每一帧是一个记录对象，不插值。

本文件定义两种记录的字段、编辑器形态、校验，以及"事件时间就是关键帧时间"的规则。

本记录组件在当前片段的统一效果控件适用组内展示，11负责原专用内容/执行语义。主时间轴只排列EVENT/MOD_EVENT片段，不渲染事件节点或记录子轨；快捷属性只复用适用字段与记录摘要，完整列表仍在此组件，不能把它改成另一个独占属性页。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| EVENT 轨对象只有 `event`（event_record）与 `event_type`（value） | `J:script/schema/TrackSchemas.java — eventObjects（381–387）` |
| MOD_EVENT 轨对象：`mod_event`（event_record）、`event_type`、`data`（struct） | `modEventObjects（389–396）` |
| `event` 记录允许键：`command`/`event_type`/`id`/`position` | `J:script/object/ObjectCodec.java — readEvent（115–127）` |
| `position` 必须恰好 `{x,z}` 或 `{dx,dz}`，数字有限 | `readPosition（129–145）` |
| `mod_event` 记录允许键：`event_type`/`data`（对象） | `readModEvent（146–164）` |
| 未知成员直接抛错 | 同上（`default -> throw`） |
| `mode=event` 必须有非空 keyframes | `J:script/object/SampledProperty.java（73–84）`；`ObjectParser.parseProperty（111–113）` |
| 事件记录形状由**路径末段**决定 | `ObjectCodec.readEventRecord（101–113）`、`lastSegment（196–200）` |
| 前端旧模型把 `command` 放在关键帧上，事件类型在片段上 | `EDITOR:src/types.ts（132–135）`；`Timeline.vue（190：`clip.keyframes?.find(k => k.command)`）` |

问题：

1. 旧模型把 `command`/`event_type` 混在整帧上，新模型是"记录对象"。
2. 没有专用编辑器：作者要手写 JSON。
3. 事件时间是关键帧时间（不是记录里的字段），旧 UI 不显示。

### 2.2 目标

1. 每个事件 = 一条记录 = 一个关键帧；时间可编辑，记录字段按类型编辑。
2. `event` 与 `mod_event` 的字段集**严格**按运行时白名单；未知键不可加。
3. `position` 二选一：绝对 `{x,z}` 或相对 `{dx,dz}`，切换时清空另一组（不混写）。
4. `mod_event.data` 是任意嵌套对象：树编辑 + 原文编辑。
5. 空列表被拒绝（`mode=event` 至少要一帧）。

### 2.3 非目标

- 不定义事件在运行时的触发语义（归 11 / 运行时 `EventTrackPlayer`）。
- 不做命令自动补全（`command` 是自由字符串；可给提示但不强制）。

## 三、方案

### 3.1 `event` 记录编辑器

```text
┌ 事件记录（t = 1.000）────────────────────┐
│ command      [ say hello            ]    │
│ event_type   [ command             ]    │  ← 记录内字段；轨级 event_type 另有默认
│ id           [                     ]    │
│ position     ( ) 不使用                   │
│              (•) 绝对   x [ 1 ] z [ 2 ]  │
│              ( ) 相对   dx[ 0 ] dz[ 3 ]  │
└──────────────────────────────────────────┘
```

规则：

| 字段 | 控件 | 约束 |
|---|---|---|
| `command` | 文本（长文本可多行） | 字符串 |
| `event_type` | 文本或下拉（来自 `TrackSchemas` 的轨级 `event_type` 默认 `command`） | 字符串 |
| `id` | 文本 | 字符串 |
| `position` | 三态：不使用 / 绝对 / 相对 | 恰好 2 个键；数字有限 |

- "不使用"= 记录里**没有** `position` 键（不是 `null`）。
- 切换绝对/相对 → 清空另一组键（不保留，避免 `{x,z,dx,dz}` 四键被 `readPosition` 拒绝）。
- 空字符串字段：写 `""` 或不写？运行时 `readString` 接受 `""`。编辑器规则：作者留空 = **不写该键**（减少噪声），但若作者显式输入过再清空 → 删除键。

### 3.2 `mod_event` 记录编辑器

| 字段 | 控件 | 约束 |
|---|---|---|
| `event_type` | 文本 | 字符串 |
| `data` | 树编辑 / 原文 JSON | 必须是对象（`readModEvent 152–158`） |

`data` 内可任意嵌套（`readData 165–193` 递归转 `Map/List/String/Boolean/Float/null`）。编辑器不限制键名，但**拒绝**非有限数字与非法 JSON。

### 3.3 事件列表

```text
事件（EVENT 轨 · event）
 t=1.000   command  say hello        [编辑] [删除]
 t=4.500   command  give @p apple    [编辑] [删除]
 [+ 在播放头添加事件]
```

- 列表按 `time` 升序（文档保证）。
- 添加：在播放头建一条空记录（`{}` 是合法的：`readEvent` 对空对象不报错，所有键可选）。**但** `mode=event` 要求 keyframes 非空，所以"删到空"才被拒。
- 删除：删后为空 → 拒绝（提示"事件属性至少需要一帧"）。
- 时间编辑：同 06-KeyframeEditOps（严格递增、不钳制）。

### 3.4 与轨级 `event_type` 的关系

- `EVENT` 轨：轨级 `objects.event_type`（`mode=value`，默认 `"command"`）是**默认值/类型提示**；记录内的 `event_type` 是记录自己的字段。
- 编辑器：新建记录时，若轨级 `event_type` 存在，预填记录内 `event_type`（可改）。
- 不把轨级 `event_type` 复制成记录字段（除非作者确认），避免保存时多出字段。

### 3.5 校验

| 检查 | 级别 |
|---|---|
| 记录是对象 | block |
| `event` 记录键 ∈ `{command, event_type, id, position}` | block |
| `mod_event` 记录键 ∈ `{event_type, data}` | block |
| `position` 恰好 `{x,z}` 或 `{dx,dz}` | block |
| `position` 的数字有限 | block |
| `data` 是对象 | block |
| `keyframes` 为空 | block（运行时拒绝） |
| 时间严格递增 | block（同 02-ValidationBridge L14） |

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `emptyEventRecord(): {}` | — | 空记录 |
| `validateEventRecord(kind, record): string[]` | `'event' \| 'mod_event'` + 记录 | 错误 |
| `setPositionMode(record, mode)` | 记录 + 目标形态 | 新记录（清另一组） |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/objects/EventRecordEditor.vue`、`EventList.vue`（提案）。
2. 新建 `EDITOR:src/model/eventRecord.ts`（提案）：`emptyEventRecord` / `validateEventRecord` / `setPositionMode`。
3. 在ClipEffectControlsPanel的EVENT/MOD_EVENT适用组挂接EventList/EventRecordEditor，保留记录选择/局部时间及载荷诊断；不使用普通值曲线，不隐藏同片段其他适用组。
4. 改 `EDITOR:src/components/Timeline.vue（190）`：片段摘要不再读 `clip.keyframes.find(k => k.command)`；改为读 `objects.event.keyframes` 的第一条记录（若存在）。
5. 删除 `EDITOR:src/types.ts（132–135）` 的 `command`/`event_type` 关键帧字段（已不属于帧）。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/EventRecordScreen.java`（提案）。
2. 校验对齐 `ObjectCodec` 文案（`未知成员 X` / `需要对象 {x,z} 或 {dx,dz}`）。

### 4.4 禁止修改

- 不加运行时白名单外的键（如 `delay`、`once`）。
- 不把 `position` 写成四键混写。
- 不把"不使用"写成 `"position": null`（`readPosition` 会拒绝）。
- 不允许空 `keyframes`。
- 不在记录里存 `time`（时间是关键帧的 `time`）。

## 五、正反例验收

### 5.1 正例

1. 在 `t=1` 添加事件，填 `command="say hi"`、`position` 绝对 `{x:1,z:2}` → 记录 `{"command":"say hi","position":{"x":1,"z":2}}`；`script.validate` 通过。
2. 把同一记录改成相对 → `{"command":"say hi","position":{"dx":1,"dz":2}}`（`x`/`z` 已清）。
3. `mod_event` 记录 `{"event_type":"foo","data":{"a":[1,2],"b":{"c":true}}}` → 通过。
4. 删除唯一一条事件 → 拒绝。
5. 事件时间拖到 `duration+1` → 保留（轴外），无错。

### 5.2 反例

| 输入 | 期望 |
|---|---|
| `{"command":"x","delay":1}` | 拒绝：`未知成员 delay` |
| `{"position":{"x":1,"z":2,"dx":0,"dz":0}}` | 拒绝：`需要对象 {x,z} 或 {dx,dz}` |
| `{"position":null}` | 拒绝 |
| `{"data":[]}`（mod_event） | 拒绝：`data 需要对象` |
| 空 `keyframes: []` | 拒绝：`mode=event 必须有 keyframes` |
| 记录里写 `time` | 拒绝：`未知成员 time` |
| `{"position":{"x":"1","z":2}}` | 拒绝：`需要有限数字` |

### 5.3 异步关键帧专项

**正例**：`event` 有 2 条（t=1、t=4）；在 `t=2` 加第 3 条 → 3 条；其它属性（若有）不变。

**反例**：加事件时把 `event_type` 的 value 也改掉。

- 期望：不发生（记录编辑只改 `keyframes[].value`）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；EVENT 轨片段，`t=1` 事件 `command="say smoke"`。
2. 编辑器打开 → 事件列表显示该条；编辑 command 为 `say smoke2`；保存。
3. `script.validate` → `ok:true`。
4. 游戏内播放到 `t=1`，聊天栏出现 `smoke2`。
5. 添加第二条带 `position` 的事件；播放确认命令在该坐标执行（若命令使用 `~ ~ ~` 语义）。

通过判定：第 4 步聊天可见；第 5 步无解析错误。

## 七、完成定义

1. `EventRecordEditor.vue` / `EventList.vue` / `eventRecord.ts` 存在。
2. `mode=event` 属性进入事件编辑器，不进入值表单。
3. `Timeline.vue` 不再读 `clip.keyframes.find(k => k.command)`。
4. §5 的 5 条正例、7 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同白名单与同文案。
