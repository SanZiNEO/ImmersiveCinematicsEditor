# 08 移动与重命名的引用事务

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：04-project-graph
> 关联：`01-script-index.md`、`04-folder-partitions.md`、`07-dependency-edge-semantics.md`

## 1. 职责

把两件**本质不同**的事分开做对：

1. **移动脚本文件**（改路径）——不涉及任何内容改写。
2. **重命名脚本 id**（改 `meta.id`）——必须全包扫描引用并原子改写。

并明确：本任务**不发明**协议。移动用既有 `script.save` 路径语义 + 新增一条文件移动消息；重命名用「扫描 → 预览 → 提交」三步，消息形状需先在 `shared/contracts.md` 登记。

**参考输入**：[Olive项目浏览与节点画布](../references/05-project-graph-navigation.md) G5。借鉴拖放条目去重、明确目标与同目录无操作，不搬进程内指针或内存撤销。布局拖动与文件移动必须分开，磁盘事务成功后才更新路径与布局绑定；失败保留原文件，不能因视觉上已移入泳道就宣告成功。

## 2. 现有事实（源码锚点）

### 2.1 为什么「移动」不需要引用事务

| 事实 | 锚点 |
|---|---|
| `requires` 引用的是**脚本 id**，不是路径 | `MOD:script/ScriptParser.java:1027-1031`（字符串 → `scriptPlayed(id)`） |
| 服务端按 `meta.id` 建索引 | `MOD:script/ScriptManager.java:52-90`（`scripts.put(meta.getId(), script)`，`scripts.containsKey(reqId)` 于 `:121-131`） |
| 加载按目录递归，与文件名无关 | `ScriptManager.java:62-70`（`Files.walk(dir, MAX_SCRIPT_DEPTH)`） |
| 图节点 id 是路径、脚本身份是 id | `MOD:webui/ScriptGraphService.java:352-355`（`path`）、`:369-371`（`scriptId`） |
| 保存通知只带文件名 | `MOD:trigger/network/C2SScriptSavedPacket.java:9-13`、`:37-39`（`ScriptSyncState.onScriptSaved`） |

结论：移动只需 `Files.move` + 索引失效 + 图重取。**不需要**改写任何脚本内容，也**不得**顺手改 `meta.id`。

### 2.2 为什么「重命名 id」必须改写引用

| 事实 | 锚点 |
|---|---|
| `requires` 元素里脚本 id 的键是 `script` | `ScriptParser.java:1032-1046`（对象型其余键进 `data`）；`MOD:script/TriggerRequirement.java:22-24`（`data`） |
| 只有内置三种类型带脚本 id | `MOD:webui/ScriptGraphService.java:36-38`；`ScriptManager.java:175-190`（`scriptIdOfRequirement`） |
| 组合器子条件也能引用脚本 | `MOD:script/ScriptValidator.java:2116-2119`、`:1400-1435`（递归 `list`，`script` 同样校验） |
| 改 id = 换触发器身份（事实失效） | `MOD:script/TriggerDefinition.java:15`（`ID_REGEX`）、`:87`（`getIdentity`）；`docs/TRIGGER_TYPES.md` §触发器身份 |
| 校验会报悬空 | `ScriptValidator.java:2030-2078`（指向不存在脚本 → issue） |

**注意**：改的是**脚本** id（`meta.id`），不是**触发器** id（`meta.triggers[].id`）。后者属 11 轮触发器面板，不在本事务内。

### 2.3 现有文件操作能力

| 能力 | 锚点 | 缺口 |
|---|---|---|
| 读 | `MOD:webui/ScriptFileService.java:52-56`（`loadScript`） | — |
| 写（父目录按需创建） | `ScriptFileService.java:62-71`（`saveScript`） | 无备份、非原子 |
| 删 | `ScriptFileService.java:75-79`（`deleteScript`） | — |
| 路径越界防护 | `ScriptFileService.java:86-93`（`resolveSafe`） | 可复用 |
| 移动/重命名文件 | **无** | 需新增 |

## 3. 差异与提案

### 3.1 两个操作的差异表

| 维度 | 移动（路径） | 重命名（`meta.id`） |
|---|---|---|
| 影响文件数 | 1 | 1 + N（N = 引用它的脚本数） |
| 影响内容 | 无 | `requires[].script`、组合器 `conditions.list[*].conditions.script` |
| 需要预览 | 否 | 是（列出每条将被改写的引用） |
| 失败回滚 | 不需要（单次 `move` 原子） | 必须（多文件） |
| 布局影响 | `path` 变 → 布局按 `scriptId` 重绑定（05 轮） | `scriptId` 变 → 布局按 `path` 匹配 |
| 服务端影响 | 需 `/icinematics reload` 才反映路径变化（但 id 未变，触发器仍有效） | **必须 reload**：旧 id 的注册仍在，新 id 未注册 |

### 3.2 移动（提案）

- `MOD:webui/ScriptFileService.java` 新增 `public static void moveScript(String from, String to)`（提案）
  - 两端都过 `resolveSafe`；
  - 目标已存在 → `IOException("target exists: …")`；
  - `Files.createDirectories(to.getParent())`；
  - `Files.move(from, to)`（同盘 `ATOMIC_MOVE`，不支持时回落普通 move）。
- 消息（提案）：`script.move {from, to}` → `script.moved {from, to}`。
- 移动**不**校验目标文件夹是否存在（父目录自动建）；但前端必须只允许拖到已知泳道（04 轮）。

### 3.3 重命名（提案）

三步，缺一不可：

**Step 1 — 预览**：`script.refs.preview {scriptId, newScriptId}` → `{affected:[{path, triggerIndex, triggerIdentity, requirement, location}]}`

- `location` ∈ `requires` / `conditions.list[<path>]`，用于 UI 显示「在哪个触发器、哪一条」。
- 扫描范围：全部 `*.json`（含被改名脚本自身——它可能自引用，`ScriptManager.java:129` 会记日志）。

**Step 2 — 提交**：`script.refs.apply {scriptId, newScriptId, expectAffected: <count>}` → `{written:[path], backupDir}`

- `expectAffected` 是乐观并发保护：若实际受影响条数与预览不一致（期间有人改了文件），拒绝并让用户重预览。

**Step 3 — 结果**：`{ok, written, failedPath?, rollback: 'none'|'restored'}`。

原子性实现（无 FS 事务，用备份目录）：

1. 在 `immersive_cinematics/editor/.refactor-<timestamp>/` 下按相对路径备份**所有将被写入的文件**（含被改名脚本）。
2. 逐文件写入（`saveScript`）。
3. 任一步失败 → 从备份逐文件还原 → 返回 `rollback: 'restored'` + `failedPath`。
4. 全部成功 → 删除备份目录；若删除失败只记日志（残留目录不影响正确性）。

**内容改写规则（必须精确，不得扩大）**：

| 位置 | 条件 | 改写 |
|---|---|---|
| `meta.triggers[i].requires[j]` 为字符串 | 值 `=== oldId` | 改为 `newId` |
| `meta.triggers[i].requires[j]` 为对象 | `type ∈ {script_played, script_started, script_completed}` 且 `data.script === oldId` | 改 `script` |
| `meta.triggers[i].conditions.list[k].conditions.script`（递归任意层） | 子条件 `type ∈ {script_played, script_started, script_completed}` 且值 `=== oldId` | 改 `script` |
| 被改名脚本自己的 `meta.id` | 总是 | 改为 `newId` |
| 其它任何字段 | — | **不动** |

**不改写**：
- 自定义前置条件的任意 `data`（`my_mod:quest` 之类可能恰好有 `script` 字段，但那不是脚本 id 引用；`ScriptManager.java:175-190` 也只认内置三种）。
- `meta.triggers[].id`（触发器身份）。
- `rules[]` / `rule_bindings[]` / `paths[]` / `exit.target`（同脚本内引用）。

### 3.4 拟新建（提案）

- `MOD:webui/ScriptRefactorService.java`（提案）
  - `public static JsonObject previewRename(String oldId, String newId)` — 返回受影响清单；`newId` 必须匹配 `^[A-Za-z0-9_]{1,64}$`（与 `TriggerDefinition.ID_REGEX` 同源）且在全包内不重复。
  - `public static JsonObject applyRename(String oldId, String newId, int expectAffected)` — 备份 + 写入 + 回滚。
  - `private static int rewrite(JsonObject root, String oldId, String newId, List<JsonObject> hits, String path)` — 就地改写并收集命中。
- 消息（提案，需登记）：`script.refs.preview` / `script.refs.apply`。

**不新建**：通用「引用查找替换」服务。范围只有脚本 id，扩大到任意字符串会误改说明文字/命令文本。

## 4. 输入输出与字段约束

`script.refs.preview` 请求：

| 字段 | 类型 | 约束 |
|---|---|---|
| `scriptId` | `string` | 必须命中某个 `meta.id`；未命中 → 错误 |
| `newScriptId` | `string` | `^[A-Za-z0-9_]{1,64}$`；不得等于旧值；不得与其它 `meta.id` 重复 |

`script.refs.preview` 回执：

```json
{
  "oldScriptId": "old",
  "newScriptId": "new",
  "selfPath": "chapter/old.json",
  "affected": [
    {"path":"chapter/a.json","triggerIndex":0,"triggerIdentity":"t1","requirement":"script_played","location":"requires[1]"},
    {"path":"chapter/a.json","triggerIndex":2,"triggerIdentity":"any#2","requirement":"script_started","location":"conditions.list[0].conditions"}
  ],
  "affectedCount": 2,
  "selfReference": true
}
```

| 字段 | 约束 |
|---|---|
| `affectedCount` | 必须等于 `affected.length`（防前端截断后误判） |
| `selfReference` | 被改名脚本自身是否引用旧 id（`ScriptManager.java:129` 的告警口径） |
| `location` | `requires[<j>]` 或 `conditions.list[<path>].conditions`；仅用于显示，不参与改写 |

`script.refs.apply` 回执：

| 字段 | 类型 | 约束 |
|---|---|---|
| `ok` | `boolean` | `true` 时 `failedPath` 缺省 |
| `written` | `string[]` | 实际写入的相对路径（含 `selfPath`） |
| `failedPath` | `string?` | 首个失败文件 |
| `rollback` | `'none' \| 'restored'` | 失败且还原成功 → `restored`；还原也失败 → 返回错误并保留备份目录路径 |

约束：
- 事务期间编辑器**必须**拒绝并发的 `script.save`（前端置 `refactorInProgress` 标志，保存按钮禁用）。理由：`script.save` 是整文档覆盖，会与事务写入互相覆盖。
- 若当前打开的文档在 `affected` 或 `selfPath` 内且 `state.dirty === true`（`ED:store.ts:49`），必须先保存或放弃修改，否则拒绝执行。
- 事务完成后，前端必须：清空 `state.doc`（若打开的是被改名脚本则重新 `loadScript(newPath)`）、刷新图、提示「需在游戏内执行 /icinematics reload 生效」。

## 5. 修改步骤

1. `ScriptFileService.moveScript`（提案）。
2. `WebEditorApi` 增加 `script.move` 分支（锚点 `WebEditorApi.java:41-88`），成功后 `ScriptIndexService.invalidate()`。
3. 新建 `ScriptRefactorService`：`previewRename` 先扫索引，再逐文件解析 JSON，按 3.3 的规则匹配并收集命中（只读）。
4. `applyRename`：备份 → 逐文件 `rewrite` → `saveScript` → 失败还原。
5. `WebEditorApi` 增加 `script.refs.preview` / `script.refs.apply` 分支。
6. 前端：图卡片菜单加「移动…」「重命名脚本 id…」；重命名弹窗展示 `affected` 列表与 `selfReference` 提示；确认后调用 apply。
7. 前端保存锁：`refactorInProgress` 期间 `saveScript` 直接 reject（`store.ts:436`）。
8. 事务后刷新：`refreshScripts()` + 图 `load()`。

## 6. 禁止修改

- 不得让移动改写 `meta.id`。
- 不得让重命名改写 `meta.triggers[].id`。
- 不得改写自定义前置条件里的任何 `data` 字段。
- 不得改写 `rules[]` / `rule_bindings[]` / `paths[]` / `exit`（同脚本内引用，与脚本 id 无关）。
- 不得在没有预览的情况下直接 apply。
- 不得在事务期间允许 `script.save`。
- 不得把备份目录放进 `scripts/`（会被 `listScripts` 当成脚本扫进来）。

## 7. 两分支承载

- Forge 1.20.1：`Files.move` / `createDirectories` / 备份复制均无平台差异；`ATOMIC_MOVE` 在 Windows 同盘可用，跨盘需回落。
- Fabric：同源，未实机验证。

## 8. 前置

- `01-script-index.md`（扫描）。
- `shared/contracts.md` 登记 `script.move` / `script.refs.preview` / `script.refs.apply` 与错误码（`target exists` / `id exists` / `id invalid` / `affected mismatch` / `rollback failed`）。
- `11-triggers-rules-events/05-trigger-requires-editor.md`：requires 的字段口径必须与本文件的改写规则完全一致（同一份规则，不得两处各写一套）。

## 9. 验收

**正例**

- 移动：`a.json` 从根移到 `chapter/`；文件路径变，`meta.id` 与全部脚本内容字节不变（`git diff` 只有 rename）。
- 重命名：`old` → `new`，包内 3 处 `requires`（字符串 1、对象 1、组合器 1）全部改写；`affectedCount = 3`；预览与提交结果一致。
- 重命名时被改名脚本自引用：`selfReference = true`，预览中列出该条，提交后指向 `new`（不再是自引用）。
- 预览后手工改了一个引用文件，再提交：`affected mismatch` 拒绝，文件未被改写。
- 提交中途某文件不可写（模拟只读）：返回 `rollback: 'restored'`，所有文件恢复原内容。
- 目标 id 已存在：预览阶段就拒绝（`id exists`）。

**反例**

- 重命名把 `{"type":"my_mod:quest","script":"old"}` 改掉 → 失败（不得扩大范围）。
- 重命名把 `meta.triggers[0].id = "old"` 改掉 → 失败。
- 移动后 `requires` 被改写 → 失败。
- 事务进行中允许保存并覆盖 → 失败。
- 备份目录出现在 `script.list` 里 → 失败。

## 10. 真实冒烟

1. 造 `a`（`requires:["old"]`）、`b`（`requires:[{"type":"script_started","script":"old"}]`）、`old`（`meta.id="old"`，自身触发器用 `any` 引用 `old`）。
2. 预览 `old → new`：`affectedCount = 3`，`selfReference = true`。
3. 提交：三个文件内容按规则改写；`old.json` 的 `meta.id` 变 `new`。
4. 游戏内 `/icinematics reload`：`/icinematics validate` 无 dangling；触发器注册日志显示 `new`。
5. 反向再改回 `new → old`：同样 3 条，往返后文件与原内容一致（除键顺序）。
6. 移动 `old.json` 到 `chapter/`：内容不变，reload 后触发器仍注册（id 未变）。

## 11. 完成定义

- 移动与重命名在代码路径上完全分离，互不触发对方逻辑。
- 重命名的改写范围与 3.3 表格逐行一致，可用「改回原名」做往返验证。
- 失败路径有备份与还原，且备份不污染脚本目录。
- 事务期间保存被拒。
- 未新增未登记消息。
