# 01 触发器身份

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`README.md`、`02-trigger-common-fields.md`、`../04-project-graph/02-graph-data-contract.md`

## 1. 职责

定义「触发器身份」这一个字符串：它怎么来、怎么展示、改它会怎样、编辑器新增/复制/删除触发器时如何保证身份稳定。身份是事实记录、去重、图数据、文档寻址的共同键，本轮所有其它任务都以它为准。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 身份定义 | `MOD:script/TriggerDefinition.java:87` | `getId() != null ? id : type + "#" + declarationIndex` |
| id 合法形式 | `TriggerDefinition.java:15` | `ID_REGEX = "[A-Za-z0-9_]{1,64}"` |
| id 可选 | `TriggerDefinition.java:84-85`、`:19-21` | `null` = 未指定，由声明下标合成 |
| 解析 | `MOD:script/ScriptParser.java:1052-1066`（`optTriggerId`） | 缺省/`null` → `null`；非字符串/空串 → 解析错误 |
| 声明下标 | `ScriptParser.java:926`、`:934` | `parseTriggerDefinition(obj, p, index)`；`index` 来自数组遍历 |
| 校验 | `MOD:script/ScriptValidator.java:1995-2025`（`validateTriggerIdentities`） | 存在时必须是字符串、非空、匹配正则、同脚本内不重复 |
| 注册 | `MOD:script/ScriptManager.java:136` | `new TriggerRegistration(meta.getId(), td.getIdentity(), …)` |
| 去重键 | `MOD:trigger/server/TriggerEngine.java:251-259`（`shouldSkip`） | `FactQueries.triggerFired(player, scriptId, triggerId)` |
| 事实键 | `MOD:trigger/server/fact/FactQueries.java:27-29` | `exists(TRIGGER_FIRED, script, triggerId)` |
| 边沿状态键 | `TriggerEngine.java:341-345`（`edgeFor`） | `scriptId + ":" + triggerId` |
| 文档语义 | `docs/TRIGGER_TYPES.md`「触发器身份与连续语义」 | 「改 id = 换了一个新触发器，旧事实不再命中」 |

**关键事实**：身份有两个来源，且**合成身份不稳定**——`type#index` 里的 `index` 是数组下标，删除/重排触发器会让原本的第 2 个变成第 1 个，于是 `location#1` 变成 `location#0`，旧事实全部失配。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 面板显示 | 只显示 `trig.id`（`ED:components/TriggerPanel.vue:245-248`） | 显示「身份」= `id` 或 `type#index`，并标注来源（显式/合成） |
| 新增触发器 | `id = 'trigger_' + (length+1)`（`TriggerPanel.vue:60-73`） | 生成全脚本唯一的显式 id；冲突时递增到空位 |
| 删除触发器 | 直接 `splice`（`TriggerPanel.vue:85-93`） | 若后续项是合成身份，提示「删除会改变 n 个触发器的身份」 |
| 重排 | 无 | 有合成身份项时禁止拖拽重排，或先「固化 id」 |
| 复制触发器 | 无 | 复制时生成新 id（不复制身份） |
| 缺 id 的旧脚本 | 直接编辑 | 面板给「固化 id」按钮：按当前身份写回显式 `id` |

### 3.2 为什么必须显式 id

| 场景 | 合成身份后果 |
|---|---|
| 作者删掉第一个 `location` 触发器 | 第二个 `location` 的身份从 `location#1` → `location#0`；非 repeatable 的「已触发」事实失配 → **重新触发一次** |
| 作者在中间插入一个 `biome` | 其后所有同类型触发器身份位移 |
| 图数据/文档寻址用 `identity` | 保存后寻址失效 |

因此编辑器新增触发器必须写显式 `id`；对已有缺 id 的脚本，提供「固化 id」动作（把当前 `type#index` 写成 `id`，此后稳定）。

### 3.3 拟新建（提案）

- `ED:components/trigger/TriggerIdentityField.vue`（提案）：显示身份、来源徽标、编辑框（校验正则）、「固化」按钮。
- `ED:lib/triggerIdentity.ts`（提案）：
  - `identityOf(trigger, index): string` — 与 `TriggerDefinition.getIdentity()` 同构；**唯一实现**，图数据与文档共用。
  - `isSynthetic(trigger): boolean` — `!trigger.id`。
  - `nextFreeId(triggers, base): string` — 生成 `base`、`base_2`…直到不冲突；`base` 默认 `"trigger"`。
  - `syntheticIdentityMoves(triggers, removeIndex): {index, from, to}[]` — 预测删除后哪些身份会变。

**不新建**：Java 侧身份规则的第二个实现。前端 `identityOf` 必须与 `TriggerDefinition.getIdentity()` 逐字一致（`id ?? type + "#" + index`）。

## 4. 输入输出与字段约束

`identityOf(trigger, index)`：

| 输入 | 输出 |
|---|---|
| `{id:"trg_a", type:"location"}`，`index=3` | `"trg_a"` |
| `{type:"location"}`，`index=3` | `"location#3"` |
| `{id:"", type:"location"}`，`index=0` | `"location#0"`（空串视为未指定；与 `optTriggerId` 的「空串 → 解析错误」不同，这里是**已加载文档**的容错展示） |

字段约束：

| 字段 | 约束 |
|---|---|
| `id` | 匹配 `^[A-Za-z0-9_]{1,64}$`；同脚本内唯一；写入前 trim，不做其它归一 |
| 展示身份 | 只读；不因显示而改写数据 |
| 「固化」写入 | `trigger.id = identityOf(trigger, index)`；若该值已被占用 → 追加 `_2`… |

约束：
- 身份**不含**脚本 id；跨脚本唯一性由 `(scriptId, identity)` 组合保证（与 `FactQueries` 一致）。
- 编辑器不得为了「好看」把 `location#0` 改写成 `location_0`（会改变身份）。

## 5. 修改步骤

1. 新建 `ED:lib/triggerIdentity.ts`（三个纯函数）。
2. `TriggerPanel.vue` 列表项改为显示 `identityOf(trig, i)` + 来源徽标（替换 `:245-248`）。
3. `addTrigger` 改用 `nextFreeId(triggers, 'trigger')`（替换 `:60-73`）。
4. `removeTrigger` 前调 `syntheticIdentityMoves`；非空时弹确认，列出将变化的身份（替换 `:85-93`）。
5. 新增 `TriggerIdentityField.vue` 替换「触发器 ID」输入（`:228-235`），含正则校验与「固化」按钮。
6. 04 轮图数据的 `identity` 字段改为复用同一规则（Java 侧已有 `getIdentity()`，前端只做展示）。

## 6. 禁止修改

- 不得改 `TriggerDefinition.getIdentity()` 的合成规则（`type#index`）。
- 不得把身份做成可空或「自动生成且不可见」。
- 不得在删除/重排时静默改变合成身份（必须提示）。
- 不得用文件名、路径、序号以外的任何东西参与身份。
- 不得把「固化」做成自动（会批量改写作者文件）。

## 7. 两分支承载

- Forge 1.20.1：身份规则在 common（`TriggerDefinition`），前端只读。
- Fabric：同源，未实机验证。

## 8. 前置

- `01-baseline-schema` 确认 `meta.triggers[].id` 的必填性口径（实现上可选，文档上写「是」——见 `docs/TRIGGER_TYPES.md` 通用字段表）。
- `../04-project-graph/02-graph-data-contract.md` 的 `identity` 字段。

## 9. 验收

**正例**

- 文档有两个 `location` 触发器，都无 `id`：面板显示 `location#0`、`location#1`，徽标「合成」。
- 删除第一个：弹确认「`location#1` 将变为 `location#0`」；取消则不删。
- 点「固化」：写入 `id = "location#0"`，徽标变「显式」，身份不变。
- 新增触发器：`id = "trigger"`；再新增：`"trigger_2"`；删掉 `trigger` 再加：复用 `"trigger"`。
- 复制一个显式 id 触发器：新 id 为 `"<原id>_2"`，身份不同。

**反例**

- 新增触发器不写 id → 失败。
- 删除后身份静默位移且无提示 → 失败。
- 面板显示的 id 与 Java `getIdentity()` 不一致（如大小写、下划线替换）→ 失败。
- 「固化」把已占用的 id 覆盖掉 → 失败。

## 10. 真实冒烟

1. 打开一个只有合成身份的脚本，面板显示 `type#index`。
2. 删除第一个同类型触发器：出现位移提示；确认后保存。
3. 游戏内 `/icinematics reload`，再让该触发器触发一次：日志中的 trigger id 为新身份（旧「已触发」事实不再命中）。
4. 固化全部身份后保存，重开编辑器：徽标全为「显式」，身份字符串与保存前一致。
5. 在图视图悬停该脚本：触发器行的 `identity` 与面板一致（04/06）。

## 11. 完成定义

- 面板显示的身份与 `TriggerDefinition.getIdentity()` 逐字一致，并有「合成/显式」区分。
- 新增/复制/删除/固化四条路径都不会产生重复 id，也不会静默改变已有身份。
- 删除引发的身份位移在操作前可见。
- 全仓库只有一处前端身份计算实现（`triggerIdentity.ts`）。
