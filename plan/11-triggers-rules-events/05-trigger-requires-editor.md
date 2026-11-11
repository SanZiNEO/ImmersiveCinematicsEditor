# 05 前置条件（requires）编辑器

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`01-trigger-identity.md`、`07-continuity-and-facts.md`、`../04-project-graph/07-dependency-edge-semantics.md`、`../04-project-graph/08-move-rename-transaction.md`

## 1. 职责

把meta.triggers[].requires编辑正确：目标是脚本ID而非文件名，三内置类型和自定义数据区分，简写/对象保留语义，悬空与自引用可见。本页是文档内完整入口；04.11在项目图提供受限关系维护，二者复用同一标准命令、字段规则、指纹/校验/回滚合同，不各写一套，也不把图降为只读。

## 2. 现有事实（源码锚点）

### 2.1 数据形态

| 事实 | 锚点 |
|---|---|
| 字符串元素 = `script_played` | `MOD:script/ScriptParser.java:1027-1031`（`TriggerRequirement.scriptPlayed(id)`） |
| 对象元素 = `type` + 其余键进 `data` | `ScriptParser.java:1032-1046` |
| 内置三型需要 `script` | `MOD:script/TriggerRequirement.java:38-45`（`scriptPlayed`/`scriptStarted` 便捷构造；`script_completed` 由注册器定义） |
| 求值：AND | `MOD:trigger/server/TriggerEngine.java:234-247` |
| 内置语义 | `MOD:trigger/server/prereq/BuiltinPrerequisites.java:17-38` |
| 自定义类型注册 | `MOD:trigger/server/prereq/PrerequisiteRegistry.java:26-44` |
| 校验：字符串/对象两路 | `MOD:script/ScriptValidator.java:2030-2078` |
| 校验：脚本 id 存在/自引用 | `ScriptValidator.java:2494-2528`（`validatePrerequisiteRef`） |
| 组合器内同样校验 | `ScriptValidator.java:2466`（`validatePrerequisiteRef(sub, data, sp+".conditions", …)`） |

### 2.2 编辑器现状（三处硬伤）

| 问题 | 锚点 | 后果 |
|---|---|---|
| **下拉值 = 文件名去 `.json`** | `ED:components/TriggerPanel.vue:472-475`：`<option v-for="s in availableScripts" :value="s.replace('.json','')">` | `requires[].script` 必须是 `meta.id`（`MOD:script/ScriptManager.java:121-131` 用 `scripts.containsKey(reqId)`）。默认模板 `meta.id = "untitled"`（`MOD:script/schema/MetaSchemas.java:19`）与文件名 `untitled.json` 恰好一致，所以**只在重命名过的脚本上暴露**：写出 `boss` 而实际 id 是 `chapter_boss` → 悬空 → 该触发器永不触发 |
| **类型下拉只有 3 项** | `TriggerPanel.vue:459-464` | 自定义前置条件（其它模组注册）无法编辑；选了也无法保存 `data` 里的额外字段 |
| **字符串项被强转对象** | `TriggerPanel.vue:150-164`：`if (typeof item === 'string') trig.requires![index] = {type:'script_completed', script:item}` | 一旦编辑就写入 `script_completed`，但字符串简写语义是 `script_played`（`ScriptParser.java:1027-1031`）——**静默改变语义**。另外 `:119-125` 把字符串展示成 `type: 'script_completed'`，展示与语义不符 |
| 新增默认 `script_completed` | `TriggerPanel.vue:133-140` | 与字符串简写语义不同，作者难以预期 |

**关键语义**：`script_played` = 有开始事实 **且** 有结束事实（任何退出原因）；`script_started` = 只有开始；`script_completed` = 只有结束（不校验是否开始过）。三者不等价（`BuiltinPrerequisites.java:18-36`）。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 脚本候选 | `state.scripts`（路径）→ 去 `.json` | 项目索引的 `scriptId`（04/01），显示 `name (id)`，值 = `id` |
| 显示 | 路径字符串 | `meta.id` + 脚本名 + 所在文件夹 |
| 悬空 | 无提示 | 即时红条「指向不存在的脚本」+ 候选中标红 |
| 自引用 | 无提示 | 即时黄条「引用自身，可能永不解锁」 |
| 自定义类型 | 不可编辑 | 类型下拉含「自定义…」，可填 `type` + 任意 `data` 键值 |
| 字符串 ↔ 对象 | 强转 `script_completed` | 字符串项以只读形式显示为 `script_played（简写）`；「转为对象」时写 `{type:"script_played", script:id}`；「转为简写」仅在 `type==="script_played"` 且无额外键时可用 |
| 新增默认 | `script_completed` | `script_played`（与简写同义，减少歧义） |
| 排序 | 无 | 保持声明顺序（AND 求值顺序无影响，但 UI 稳定） |

### 3.2 自定义类型的编辑边界

自定义类型由其它模组注册（`PrerequisiteRegistry.register(type, prereq)`），编辑器**不知道**它的 `data` 结构。因此：

- 类型下拉列出「内置三型」+ 从当前文档已出现的自定义 type 收集的项 + 「自定义…」。
- 选「自定义…」后给两个输入：`type`（字符串）+ `data`（键值表，值支持字符串/数字/布尔）。
- **不**尝试推断必填字段；只做「`type` 非空」校验。
- 保存后由 `script.validate` 兜底（未知类型在运行期恒不满足，`PrerequisiteRegistry.evaluate` 会 warn）。

### 3.3 拟新建（提案）

- `ED:components/trigger/RequiresEditor.vue`（提案）：列表 + 增删 + 每项形态切换。
- `ED:components/trigger/RequirementRow.vue`（提案）：单条编辑（内置三型 / 自定义）。
- `ED:components/trigger/ScriptIdSelect.vue`（提案）：脚本 id 下拉，数据源 = 图数据或 `script.graph` 的 `nodes[].scriptId`（**不是** `state.scripts` 路径）。
- `ED:lib/requiresModel.ts`（提案）：
  - `toEditorModel(item): {kind:'short'|'object', type, script, data}` — 字符串 → `{kind:'short', type:'script_played', script}`。
  - `toJson(model): string | object` — `kind==='short'` 且 `type==='script_played'` 且无额外 `data` → 字符串；否则对象。
  - `validate(model, knownIds, selfId): Issue[]` — 与 `validatePrerequisiteRef` 同规则（不重复实现语义，只做前置提示）。

**不新建**：`requires` 的服务端新消息。它随 `script.save` 落盘。

## 4. 输入输出与字段约束

编辑器模型：

| 字段 | 类型 | 约束 |
|---|---|---|
| `kind` | `'short' \| 'object'` | 仅 UI 形态，不落盘 |
| `type` | `string` | 内置三型或自定义；非空 |
| `script` | `string` | 仅内置三型必填；必须是 `meta.id` |
| `data` | `Record<string, JsonPrimitive>` | 自定义类型的额外键；内置三型只允许 `script` |

落盘规则：

| 条件 | 写入形态 |
|---|---|
| `kind === 'short'` 且 `type === 'script_played'` 且 `data` 只有 `script` | 字符串 `"<id>"` |
| 其它 | 对象 `{type, ...data}` |

字段约束（与校验器一致）：

| 场景 | 期望 |
|---|---|
| `script` 指向不存在 id | 保存允许（`script.save` 不阻断），但 UI 红条 + `script.validate` 报「指向不存在的脚本」 |
| `script === meta.id` | 黄条「自引用，可能永不解锁」；`script.validate` 同文案 |
| `type` 为空 | 禁止保存该项（UI 拦截） |
| 内置三型缺 `script` | 禁止保存该项（UI 拦截；校验器也会报） |
| 自定义类型含 `script` 键 | 允许（可能是它自己的字段），但 UI 提示「非内置类型，`script` 不作为脚本引用」 |

## 5. 修改步骤

1. 新建 `requiresModel.ts`，实现三种转换 + 校验。
2. 新建 `ScriptIdSelect.vue`，数据源改为图数据里的 `scriptId` 集合（04/01 索引）；每项显示 `name`、`id`、`folder`；`scriptId` 为 `null` 的脚本不可选（提示「该脚本缺 meta.id」）。
3. 新建 `RequirementRow.vue` / `RequiresEditor.vue`，替换 `TriggerPanel.vue:116-175`（模型）与 `:455-478`（模板）。
4. `addRequirement` 默认 `{kind:'short', type:'script_played', script:''}`（替换 `:133-140`）。
5. `updateRequirement` 删除强转逻辑（`:150-164`），改为模型更新 + 重新序列化。
6. 列表项展示：`script_played（简写）→ b`、`script_started → c`、`my_mod:quest → {quest:q1}`。
7. 悬空/自引用即时提示：用 `requiresModel.validate` + 图数据里的 `scriptId` 集合。

## 6. 禁止修改

- 不得用 `state.scripts`（文件路径）作为 `script` 的取值来源。
- 不得把字符串简写解释成 `script_completed`。
- 不得在编辑字符串项时静默改语义（必须显式「转为对象」并保留 `type`）。
- 不得为自定义类型推断/强制 `script` 字段。
- 不得在 UI 里自动删除悬空项（作者可能需要先写引用、后建脚本）。
- 不得改 `requires` 的 AND 语义（例如提供「任一满足」开关——那是 `any` 组合器的职责）。

## 7. 两分支承载

- Forge 1.20.1：语义在 common（`TriggerRequirement` / `BuiltinPrerequisites` / `PrerequisiteRegistry`）；前端共用。
- Fabric：同源，未实机验证。

## 8. 前置

- `../04-project-graph/01-script-index.md`（`scriptId` 集合）。
- `../04-project-graph/08-move-rename-transaction.md`（重命名 id 时本编辑器的改写规则必须与其 §3.3 表格一致）。
- `01-baseline-schema` 确认 `requires` 元素形态。

## 9. 验收

**正例**

- 脚本 `boss.json`（`meta.id = "chapter_boss"`）与 `intro.json`（`meta.id = "intro"`）。在 `boss` 的触发器里加前置：下拉显示 `chapter_boss` 与 `intro`，选 `intro` → 落盘 `"intro"`。
- 加一条对象型：`{"type":"script_started","script":"intro"}` → 显示「开始播放 → intro」。
- 加一条自定义：`type = "my_mod:quest"`，`data = {quest:"q1"}` → 落盘 `{"type":"my_mod:quest","quest":"q1"}`。
- 把字符串项「转为对象」：落盘 `{"type":"script_played","script":"intro"}`（语义不变）。
- 引用不存在的 `ghost`：红条「指向不存在的脚本」；`script.validate` 同报。
- 引用自身：黄条；`script.validate` 报「自引用」。

**反例**

- 下拉值写成文件名（`boss`）→ 失败（必须 `chapter_boss`）。
- 编辑字符串项后落盘变成 `script_completed` → 失败。
- 自定义类型被强行加上 `script` 字段 → 失败。
- 提供「任一满足」开关 → 失败（语义应交给 `any`）。
- 悬空项被自动删除 → 失败。

## 10. 真实冒烟

1. 造 `intro`（`meta.id=intro`）、`boss`（`meta.id=chapter_boss`，文件名 `boss.json`）。
2. 在 `boss` 的 `location` 触发器加 `requires: ["intro"]`，保存。
3. 图视图：出现 `intro → boss` 的边，`requirement=script_played`（04/07）。
4. 游戏内：先播 `intro` 到结束，再走进 `boss` 区域 → 触发；未播 `intro` 直接进区域 → 不触发。
5. 把 `requires` 改成 `{"type":"script_started","script":"intro"}`：只要 `intro` 开始播放（不等结束）即可触发。
6. 改成 `{"type":"script_completed","script":"intro"}`：`intro` 结束后即可（不要求开始过——用跳过中断验证差异）。

## 11. 完成定义

- `script` 的候选值与落盘值都是 `meta.id`，不存在路径/文件名参与。
- 三种内置类型的语义在 UI 上可区分，字符串简写不再被误读。
- 自定义类型可编辑且不被强行套 `script`。
- 悬空/自引用在保存前可见，且与 `script.validate` 文案一致。
