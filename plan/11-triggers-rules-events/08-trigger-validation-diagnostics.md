# 08 触发器校验与诊断

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`02-trigger-common-fields.md`、`05-trigger-requires-editor.md`、`07-continuity-and-facts.md`、`12-rules-condition-tree.md`

## 1. 职责

让作者在编辑器里就能看到触发器/规则的全部静态问题，并让这些问题**指向具体字段**而不是一坨文本。包含：校验消息的获取与合并、issue 到字段的映射、错误/警告分级、跨脚本引用检查的缺口。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 校验入口 | `MOD:script/ScriptValidator.java:85-97`（`validate(String json)`）、`:99-108`（`validate(String, Collection<String> knownScriptIds)`） | 返回 `List<String>`，每条含路径与说明 |
| 警告前缀 | `ScriptValidator.java:62`（`"[警告] "`）、`:69-77`（`errorsOf`） | 警告不阻断「校验通过」 |
| 编辑器调用 | `MOD:webui/WebEditorApi.java:153-167` | **只调 `validate(json)`，不传 `knownScriptIds`** |
| 游戏内调用 | `MOD:command/CinematicCommand.java:333-337` | 传入全部已加载脚本 id，因此**只有游戏内才能发现跨脚本悬空** |
| 前端合并 | `ED:store.ts:377-398`（`validateScriptDocument`） | 前端 `ops.validateScript` + 服务端 `script.validate`，去重合并 |
| 前端兜底 | `ED:operations.ts`（`validateScript`） | grep 显示**不校验触发器**（无 `trigger`/`requires` 命中） |
| 顶部横幅 | `ED:App.vue:323-328` | 只显示第一条 + 计数 |
| 触发器校验分支 | `ScriptValidator.java:2086-2155`（`validateTriggerConditions`） | 类型/条件/`exit_buffer`/`poll_interval`/`continuity`/`on_enter` |
| 身份校验 | `ScriptValidator.java:1995-2025` | id 格式/重复 |
| requires 校验 | `ScriptValidator.java:2030-2078` | 字符串/对象两路 |
| 跨脚本引用 | `ScriptValidator.java:2494-2528` | `knownScriptIds == null` 时**跳过**存在性检查（`if (knownScriptIds != null && …)`） |
| 规则校验 | `ScriptValidator.java:496-655` | `rules[]` / `rule_bindings[]`；含 `checkHoldReachability`（`:599`） |

**关键事实**：编辑器的 `script.validate` 从不做跨脚本存在性检查。因此「`requires` 指向不存在的脚本」在编辑器里**永远不会被报出来**，只有游戏内 `/icinematics validate` 才会。这是 05 轮需要 UI 侧自行提示的直接原因，也是本文件要补的缺口。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 跨脚本检查 | 编辑器不做 | `script.validate` 增加可选 `knownScriptIds`（或由服务端自行用索引填充）；契约变更 |
| issue 呈现 | 顶部横幅第一条 + 计数 | 诊断抽屉里的可展开列表（**壳归 05-08** 的 `DiagnosticsPanel.vue`），按 `meta.triggers[i].…` 路径分组（**分组与定位归本文件**） |
| 字段定位 | 无 | 点击 issue 跳到对应字段并高亮 |
| 分级 | 只有 `[警告]` 前缀 | 保留前缀语义；UI 分成「错误 / 警告」两栏 |
| 前端兜底 | 不校验触发器 | 明确**不做**前端触发器校验（避免第二套语义）；离线时只做 JSON 结构检查 |
| 规则可达性 | 服务端有 `checkHoldReachability` | UI 把该 issue 映射到绑定行的提示 |

### 3.2 跨脚本检查的缺口（合同）

三个方案：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | `handleScriptValidate` 改为 `ScriptValidator.validate(json, ScriptIndexService.scriptIds())`（提案） | 需要主模组改一行；索引已在 04/01 存在 |
| B | 前端把 `knownScriptIds` 放进请求 `data`，服务端透传 | 需要改消息形状；前端必须保证集合正确 |
| C | 前端自己比对（用图数据的 `scriptId` 集合） | 两套语义；且 `script.validate` 的 `ok` 字段仍不反映悬空 |

本轮按 **A** 写合同（一行改动），并要求在 `shared/contracts.md` 记录「`script.validate` 的 `ok` 从此包含跨脚本引用检查」。在 A 落地前，UI 用 C 做**辅助提示**（文案标注「编辑器提示，非权威」），不得声称等价于 `/icinematics validate`。

### 3.3 issue 到字段的映射（提案）

issue 是字符串，形如：

- `meta.triggers[1].requires[0] 指向不存在的脚本 'ghost'（该触发器将永不触发）`
- `meta.triggers[0].conditions.mode 已移除：多项判定用 any / all_of 组合器表达`
- `meta.triggers[2].poll_interval 对 advancement 无效（事件驱动触发器不参与轮询），将被忽略`
- `rule_bindings[1].gate.at 缺失`

映射规则（前端纯字符串解析，不改服务端）：

1. 用正则提取前缀 `meta\.triggers\[(\d+)\]` 或 `rule_bindings\[(\d+)\]` 或 `rules\[(\d+)\]`。
2. 其余部分作为「字段路径」显示在对应行的提示区。
3. 无法解析的 issue 归入「其他」。

**不新建**：结构化 issue 协议（`{path, message, severity}`）。理由：`ScriptValidator` 全量返回字符串，改结构是主模组大改；字符串前缀解析在当前文案下足够稳定，且解析失败只影响定位不影响正确性。

### 3.4 拟新建（提案）

- `ED:lib/issuePath.ts`（提案）：`parseIssue(text): {scope:'trigger'|'rule'|'binding'|'other', index, field, severity}`。
- `ED:components/trigger/FieldIssueBadge.vue`（提案）：字段级红/黄点 + `title`。
- `ED:components/validation/IssueGroups.ts`（提案）：把 `parseIssue` 的结果按 触发器/规则/绑定/其他 分组，并给出「跳转到哪个面板的哪一项」。**不新建面板壳**：列表渲染归 `05-08` 的 `DiagnosticsPanel.vue`。

## 4. 输入输出与字段约束

`script.validate` 请求（现状）：`{doc}`。回执：`{ok, issues[]}`。

契约变更（提案）：服务端内部改为 `validate(json, index.scriptIds())`；**消息形状不变**。

| 字段 | 约束 |
|---|---|
| `ok` | `errorsOf(issues).isEmpty()`；变更后包含跨脚本悬空 |
| `issues[]` | 字符串数组；警告以 `[警告] ` 开头 |

UI 约束：

| 项 | 约束 |
|---|---|
| 分组 | 触发器 / 规则 / 绑定 / 其他 四组；空组不显示 |
| 计数 | 错误数与警告数分列 |
| 跳转 | 点击触发器 issue → 选中该触发器并滚动到字段；规则/绑定同理 |
| 离线 | 不显示「校验通过」，只显示「离线：仅结构检查」 |
| 去重 | 与服务端结果合并时按字符串完全相等去重（与 `store.ts:385-391` 一致） |

## 5. 修改步骤

1. 01 轮/主模组合同：`handleScriptValidate` 传 `knownScriptIds`（锚点 `WebEditorApi.java:158`）。
2. 新建 `issuePath.ts`，实现前缀解析与 `severity` 判定（`text.startsWith('[警告] ')`）。
3. 新建 `IssueGroups.ts`，供 `05-08` 的 `DiagnosticsPanel.vue` 调用（分组 + 跳转目标）；**不**在本轮新建面板壳，也不改 `App.vue` 的横幅（`05-08` 会删）。
4. 触发器面板、规则面板接 `FieldIssueBadge`：由诊断抽屉的选中项驱动高亮。
5. `store.validateScriptDocument` 保留合并逻辑；增加「服务端不可用」分支文案。
6. 明确前端 `ops.validateScript` **不**新增触发器校验（只保留现有结构检查）。

## 6. 禁止修改

- 不得在前端重写一套触发器/规则校验语义（必须与服务端一致；两套必然分叉）。
- 不得改 `[警告] ` 前缀（`errorsOf` 依赖它）。
- 不得把 `ok` 的语义改成「无警告」。
- 不得把 issue 文本当作可本地化的 UI 文案（它是诊断信息，原样显示）。
- 不得在离线时假装校验通过。

## 7. 两分支承载

- Forge 1.20.1：`ScriptValidator` 在 common；`/icinematics validate` 走 `CinematicCommand`。
- Fabric：同源，未实机验证。

## 8. 前置

- `../04-project-graph/01-script-index.md`（`scriptIds` 集合）。
- `01-baseline-schema`（`ScriptValidator` 的触发器/规则分支现状确认）。
- `shared/contracts.md` 记录 `script.validate` 的 `ok` 语义变更。

## 9. 验收

**正例**

- 文档中 `meta.triggers[1].requires[0]` 指向不存在的 `ghost`：编辑器校验返回该 issue（A 落地后），分组「触发器 1」，点击跳到第 2 个触发器的 requires。
- `inventory` 条件里残留 `mode`：issue「`.conditions.mode 已移除…」出现在触发器组。
- `advancement` 写了 `poll_interval`：issue 为**警告**（若服务端按警告输出）或错误，UI 归入对应栏且不阻断保存。
- 两条相同 issue（前端与服务端各一条）：合并后只显示一条。
- 离线：显示「离线：仅结构检查」，不显示绿色通过。

**反例**

- 编辑器显示「校验通过」但游戏内 `/icinematics validate` 报悬空 → 失败（A 未落地时必须标注「编辑器不检查跨脚本引用」）。
- issue 无法点击定位 → 失败。
- 前端自行报出与服务端不同的触发器错误 → 失败。
- `ok` 在只有警告时为 false → 失败。

## 10. 真实冒烟

1. 造一个 `requires` 悬空、一个残留 `inventory.mode`、一个 `advancement + poll_interval` 的脚本。
2. 编辑器校验：三条 issue 分组正确、可点击定位。
3. 游戏内 `/icinematics validate`：同样三条（文案一致）。
4. 修掉悬空后：编辑器与服务端都通过。
5. 断网（停游戏）：编辑器显示离线提示，不显示通过。

## 11. 完成定义

- 触发器/规则的静态问题在编辑器内可见、可定位、可分级。
- 跨脚本引用检查的缺口有明确方案与现状标注，不假装已支持。
- 前端不维护第二套校验语义。
- issue 与服务端文案一致（不做本地化替换）。
