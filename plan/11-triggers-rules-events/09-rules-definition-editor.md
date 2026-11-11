# 09 规则定义编辑（rules[] 与 policy）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`10-rule-bindings-editor.md`、`11-rule-actions-and-release.md`、`12-rules-condition-tree.md`

## 1. 职责

新增「规则」面板的一半：编辑脚本级 `rules[]`——每条规则的 `id`、`condition`（条件树，见 12）、`actions`（见 11）、`policy`（`once`/`cooldown`/`mode`/`dwell`/`timeout`/`on_timeout`）。不编辑绑定（10）、不定义动作参数细节（11）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 数据载体 | `MOD:script/rule/RuleDefinition.java:21-31` | 常量：`DEFAULT_ONCE=true`、`DEFAULT_COOLDOWN=0`、`MODE_ENTER`/`MODE_DWELL`、`DEFAULT_DWELL=0`、`TIMEOUT_NONE=-1` |
| 构造校验 | `RuleDefinition.java:59-99` | id 非空；condition 非空；actions 至少一个；mode 合法；cooldown/dwell ≥ 0；timeout > 0 或 -1 |
| 解析 | `MOD:script/rule/RuleCollectionParser.java:103-152`（`parseDefinition`） | 键白名单 `id/condition/actions/policy`（`:46`）；`policy` 白名单 `once/cooldown/mode/dwell/timeout/on_timeout`（`:47-48`）；未知键报错 |
| policy 解析 | `RuleCollectionParser.java:126-147` | 逐字段带默认；`on_timeout` 走 `requireActions(..., false)`（可为空） |
| 条件树保留原文 | `RuleDefinition.java:47-49`、`RuleCollectionParser.java:150` | `condition.deepCopy()`；本层不解析条件树 |
| 集合索引 | `MOD:script/rule/RuleCollection.java:60-95` | 按 id 查定义/绑定；`bindingsFor(clip)` 用 `IdentityHashMap` |
| 校验 | `MOD:script/ScriptValidator.java:531-576` | 逐条校验定义（与解析器同一套规则） |
| schema 导出 | `MOD:script/schema/SchemaExporter.java:168-186` | `script_structure.rules` + `policy` 子对象 |
| 动作白名单 | `MOD:camera/rule/RuleActions.java:48-51`（`ACTION_TYPES_V1`） | 9 种 |
| 运行期语义 | `MOD:script/rule/runtime/RuleRuntime.java:296-392`（`stepBinding`） | once/cooldown/mode/dwell/timeout 的实际判定 |
| 编辑器现状 | `ED:` 全仓库 grep `rules`/`rule_bindings` | **0 命中** |

**关键事实**：`condition` 在解析期被 `deepCopy()` 后原样保留，因此**编辑器写什么就存什么**；条件树的合法性由 `ScriptValidator` 的 `checkRuleCombination0` 等分支负责（见 12）。`policy.on_timeout` 是动作数组，与 `actions` 同构但可为空。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 面板 | 无 | 新增右侧「规则」tab |
| `rules[]` | 无法编辑 | 列表 + 增删 + 复制 |
| `policy` | 无法编辑 | 6 字段分组表单 |
| 条件树 | 无法编辑 | 见 12 |
| 动作 | 无法编辑 | 见 11 |
| 校验 | 只能靠 `script.validate` | 面板内联 issue + 保存前提示 |

### 3.2 policy 字段的语义（UI 必须解释清楚）

| 字段 | 默认 | 语义 | 陷阱 |
|---|---|---|---|
| `once` | `true` | 成功后不再触发（同一激活内） | 与触发器 `repeatable` **不是**一回事：这是「同一次片段执行内」的判定结果去重 |
| `cooldown` | `0` | 成功后静默秒数（按播放时钟，跨执行保留） | `cooldownUntil` 不随执行重置（`RuleActivation.java:56-58`） |
| `mode` | `enter` | `enter` = 条件由假变真那一帧触发；`dwell` = 累计满足时长达到 `dwell` | `enter` 依赖 `edgeTrue`，跳帧可能错过上升沿 |
| `dwell` | `0` | 驻留阈值（秒），仅 `mode=dwell` 生效 | 中途条件断开 → `resetDwell()`（`RuleRuntime.java:340-347`） |
| `timeout` | `-1` | 时间门到达后等待上限（秒，真实时钟） | `-1` = 无限等待；超时执行 `on_timeout` 一次 |
| `on_timeout` | `[]` | 超时动作 | 可为空；为空时超时只标记终态 |

### 3.3 拟新建（提案）

- `ED:components/rules/RulesPanel.vue`（提案）：规则定义列表 + 选中项编辑。
- `ED:components/rules/RuleDefinitionEditor.vue`（提案）：`id` + 条件树（12）+ 动作（11）+ `policy`。
- `ED:components/rules/RulePolicyFields.vue`（提案）：6 字段 + 语义提示。
- `ED:lib/ruleModel.ts`（提案）：默认值常量（与 `RuleDefinition` 同值）、`newRule(usedIds)`、`validateRule(def, knownClipIds, knownBindingIds)` 的**展示层**校验（不做语义求值）。

**不新建**：规则运行态预览（需要客户端播放实例，编辑器不模拟）。

## 4. 输入输出与字段约束

`rules[]` 元素：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | 是 | `^[A-Za-z0-9_]{1,64}$`（`RuleCollectionParser.ID_PATTERN`）；脚本内唯一 |
| `condition` | object | 是 | 非空对象；结构见 12 |
| `actions` | array | 是 | 至少一个；元素见 11 |
| `policy` | object | 否 | 键白名单 6 个；未知键报错 |

`policy`：

| 字段 | 类型 | 默认 | 约束 |
|---|---|---|---|
| `once` | boolean | `true` | — |
| `cooldown` | number | `0` | 有限、`≥ 0` |
| `mode` | string | `enter` | `enter` / `dwell` |
| `dwell` | number | `0` | 有限、`≥ 0` |
| `timeout` | number | `-1` | `> 0` 或 `-1`；`0` 非法 |
| `on_timeout` | array | 缺省 | 元素同 `actions`；可为空数组 |

约束：
- 新建规则时 `id` 从 `rule`、`rule_2`… 取空位；`actions` 至少给一个合法动作（否则解析期拒绝加载整个脚本）。
- `policy` 全默认时**不写该对象**（保持文件干净）。
- 删除规则前必须检查 `rule_bindings[].rule` 引用；有引用时禁止删除或提示「先删除 n 条绑定」。
- 复制规则时 `id` 换新，`condition`/`actions`/`policy` 深拷贝。

## 5. 修改步骤

1. 新建 `ruleModel.ts`（默认值 + id 生成 + 引用检查）。
2. 新建 `RulesPanel.vue`，挂到右侧 `rightTabs`（`ED:App.vue:34-39` 增加 `rules` 项）。
3. `RuleDefinitionEditor.vue`：`id` 输入（正则）、条件树（12）、动作列表（11）、`policy`（本文件）。
4. `RulePolicyFields.vue`：`mode` 切换时 `dwell` 启用/禁用（`enter` 下 `dwell` 无效但保留值）。
5. 删除/复制：接 `ruleModel` 的引用检查。
6. 保存前调 `script.validate`（08），把 `rules[i]` 的 issue 映射到面板。

## 6. 禁止修改

- 不得在 `condition` 里写注释或非 JSON 结构（解析期 `deepCopy` 原样保存，但校验器会报）。
- 不得让 `actions` 为空（`RuleDefinition` 构造直接抛异常 → 整个脚本加载失败）。
- 不得把 `timeout=0` 当作「立即超时」（非法值；`-1` 才是无限）。
- 不得把 `mode=dwell` 与 `dwell=0` 当作「关闭 dwell」（等价于立即触发，但语义上仍走 dwell 分支）。
- 不得删除仍被 `rule_bindings[].rule` 引用的规则。
- 不得改 `RuleCollectionParser.ID_PATTERN` 的字符集。

## 7. 两分支承载

- Forge 1.20.1：解析/运行在 common（客户端主线程）。
- Fabric：同源，未实机验证。

## 8. 前置

- `12-rules-condition-tree.md`（条件树编辑器）。
- `11-rule-actions-and-release.md`（动作编辑器）。
- `01-baseline-schema`（`script_structure.rules` 导出）。

## 9. 验收

**正例**

- 新建规则：`id=rule`，`condition={type:"time",from:0,to:5}`，`actions=[{type:"pause"}]`，`policy` 不写。
- 保存后 `script.validate` 0 issue；游戏内规则在片段 0–5 秒内暂停。
- 设 `once=false`、`cooldown=2`：条件持续为真时每 2 秒触发一次（游戏内验证）。
- 设 `mode=dwell`、`dwell=1.5`：条件需连续满足 1.5 秒。
- 设 `timeout=3`、`on_timeout=[{type:"resume"}]`：门后 3 秒未成功则恢复。
- 删除被绑定引用的规则：被阻止并列出绑定 id。

**反例**

- `actions` 为空保存 → 失败（会拒绝加载整个脚本）。
- `timeout=0` 被接受 → 失败。
- `policy` 写入未知键 → 失败。
- 删除仍被引用的规则 → 失败。

## 10. 真实冒烟

1. 建 `r_gate`（`time` 条件 0–5 秒，动作 `pause`），绑定到某片段 `gate.at=1`（见 10）。
2. 播放：到 1 秒暂停；条件成立后 `resume` 或不成立则保持。
3. 加 `cooldown=1` 与 `once=false`：观察重复触发间隔。
4. 加 `timeout=2` 与 `on_timeout=[resume]`：条件永不成立时 2 秒后恢复。
5. 保存后用 `/icinematics validate` 复核：0 issue。

## 11. 完成定义

- `rules[]` 四字段全部可编辑，默认值与 `RuleDefinition` 常量一致。
- `policy` 六个字段的语义在 UI 上可读，非法值被拦截。
- 删除/复制有引用保护。
- 条件树与动作分别由 12/11 承载，本文件不重复实现。
