# 02-SchemaSnapshot：schema 快照与漂移检查

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C01 Schema 能力快照
> 依赖：01（基线快照）
> 下游：02-PropertyPathRegistry、06、07、12（模板）、13（WebUI 验收）
> 证据前缀见 [README](README.md) 开头

## 一、摘要

定义编辑器如何使用 `schema.get` 的结果：六段结构（`meta` / `tracks` / `triggers` / `models` / `curveTypes` / `script_structure`）、离线快照的生成与标记、连接时与快照的漂移检查、以及"缺段 = 能力未知，不用旧默认顶上"的处理规则。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| `schema.get` 返回 `{schema}`，内容 = `SchemaExporter.exportAll()` | `J:webui/WebEditorApi.java — handleSchemaGet（221–226）`；`J:script/schema/SchemaExporter.java — exportAll（43–142）` |
| 六段：`meta`、`tracks`、`triggers`、`models`、`curveTypes`、`script_structure` | `exportAll（43–142）`：`meta` 45、`tracks` 47–55、`triggers` 57–91、`models` 93–98、`curveTypes` 100–136、`script_structure` 138–139 |
| 前端 `Schema` 类型只声明 `meta` / `tracks` / `triggers`，没有 `models` / `curveTypes` / `script_structure` | `EDITOR:src/types.ts — Schema（236–244）` |
| 前端离线 demo 自带一份手写 schema，含 `version` 字段与旧形状 | `EDITOR:src/demo.ts（15，`version: {type:'int', default:3, required:true}`）` |
| 握手带版本号，当前是 `0.3.6` | `J:webui/WebEditorApi.java — handleHello（96–102，100）`；`MOD:plans/0.3.6/Z-editor/implementation.md` §③ 记的 `0.3.5` 已过期 |
| 前端取 schema 后只存 `state.schema` | `EDITOR:src/store.ts — getSchema（350–356）` |

结论：前端拿到的数据比它认识的类型多三段；离线 demo 的 schema 是手写的旧形状，与运行时无关联，必然漂移。

### 2.2 目标

1. 在线：每次连接取一次 `schema.get`，编译成 `PathRegistry`（02-PropertyPathRegistry）+ 模型/曲线类型表（07）+ 结构段（02/11）。
2. 离线：用**生成出来的**快照文件，带生成时间与来源版本，不用手写表。
3. 漂移：连接后比较快照与在线 schema 的键集合；差异给出明确提示（缺字段/多字段/类型变化），不静默。
4. 缺段：某段缺失时相关面板显示"能力未知"，禁用写入，**不**回退到旧默认值。

### 2.3 非目标

- 不在浏览器/Electron 里跑 Java。
- 不做 schema 的语义校验（`ObjectSchemaValidator` 在运行时启动期做，`J:script/schema/ObjectSchemaValidator.java 36–71`）。
- 不做热重载（schema 随模组版本变化，见共享合同 C01）。

## 三、方案

### 3.1 六段的编辑器消费方

| 段 | 结构 | 消费方 | 用途 |
|---|---|---|---|
| `meta` | `FieldDef` 表 | 02（文档）、05（脚本属性面板） | meta 表单字段 |
| `tracks.<type>.playControl` | `FieldDef` 表 | 05（片段面板） | `start_time`/`duration`/`loop*` |
| `tracks.<type>.objects` | `ObjectDef` 表 | 06、07 | 属性列表/表单 |
| `triggers.types` / `triggers.conditions` / `triggers.triggerFields` | 类型列表 + `FieldDef` 表 | 11 | 触发器编辑 |
| `models.<type>` | `FieldDef` 表 | 07-MathModelEditor | 模型参数表单 |
| `curveTypes.<type>.{capabilities,params}` | 能力数组 + 参数表 | 07-PathGeometryForms | 路径几何表单 |
| `script_structure.{clips,rules,rule_bindings,paths,action_types,exit_kinds,schedule_kinds,condition_fact_types}` | 字段表 + 枚举 | 02、07、11、12 | 结构面板字段 |

导出细节（写实现时必须逐条对上）：

- `paths` 段的 `geometry.type` 枚举 = `line` + `PathCurveRegistry.types()`（`SchemaExporter.geometryTypeNames 314–321`），**不含** `PathCurveRegistry.DEFAULT_TYPE` 的隐式缺省（`J:script/schema/PathCurveRegistry.java 48`）。
- `models` 段按 `MathModelRegistry.types()` 顺序（`exportAll 94–98`）。
- `curveTypes` 段含 `capabilities`（`PathCapability.name()`）与 `params`（`kind`/`default`/`required`/`enumValues`/`doc`）（`exportAll 102–135`）。

### 3.2 快照文件（提案）

```text
EDITOR:src/generated/schema.snapshot.json      // 生成产物，随仓库提交
EDITOR:src/generated/schema.snapshot.meta.json // { generatedAt, modVersion, source: 'SchemaExporter.exportAll' }
```

生成方式（提案，二选一，实施时定）：

- A：开发机上连一次真游戏，前端把 `schema.get` 的原始 JSON 原样落盘（不加工）。
- B：用一次性脚本调用模组导出（需要主模组提供 CLI 或测试钩子；当前没有，属新增前置，须显式提出）。

**不做**：手写 schema、把 schema 裁剪成"编辑器认识的子集"、给快照加编辑器自定义字段。

### 3.3 漂移检查

连接成功、`schema.get` 返回后执行：

1. 比较 `tracks` 的键集合：新增轨道类型 → 提示"运行时支持 X，编辑器未覆盖"，该轨只读。
2. 对每个 `tracks.<type>.objects`：比较路径集合与每个路径的 `mode`/`type`/`interp`/`requires`/`appliesTo`。
   - 快照有、在线无 → 该路径为"已移除"，只读显示并在保存前阻止写入。
   - 在线有、快照无 → "新增字段"，用在线声明临时渲染（只读 + 提示"未验证控件"）。
   - 类型/形态变化 → 提示"控件可能不匹配"。
3. 比较 `curveTypes` 与 `models` 的类型集合：新增类型在对应下拉里出现（因为表单由参数表驱动），缺失类型从下拉移除。
4. 比较 `script_structure` 的键：新增键提示"结构面板未覆盖"。

漂移结果只用于提示与只读降级，**不阻断打开/保存**（保存由服务端校验兜底）。唯一例外：`meta`/`timeline`/`clip` 的键白名单不一致时，保存前必须本地拦截（否则必被 parser 拒绝）。

### 3.4 缺段处理

| 缺失 | 处理 |
|---|---|
| `schema` 整体缺失 / 请求失败 | 断开状态；不允许编辑文档（只读缓存），显示"未连接" |
| `tracks` 缺失 | 不显示轨道面板；不写任何脚本 |
| `models` 缺失 | `motion_*` 与 `transition_curve` 的模型编辑禁用，显示"模型能力未知" |
| `curveTypes` 缺失 | `paths[].geometry` 只允许 `line`，其余类型禁用（不是"允许任意 type 字符串"） |
| `script_structure` 缺失 | `paths[]`/`rules[]`/`rule_bindings[]` 面板禁用（结构字段未知） |

### 3.5 版本号

- 握手 `hello_ack.version` 是**模组版本**（`WebEditorApi 100` 当前 `0.3.6`），不是 schema 版本，也不是脚本格式版本。
- 脚本格式**没有**版本号（`MetaSchemas` 无 `version`；`MOD:docs/SCRIPT_FORMAT.md §7`）。
- 快照 meta 里记录 `modVersion` + `generatedAt` 仅用于人读与漂移提示，不写进脚本。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `loadSnapshot(): {schema, meta}` | 生成的 JSON | 快照 + 元信息 |
| `applyLiveSchema(schema)` | `schema.get` 结果 | 更新注册表 + 漂移报告 |
| `diffSchema(snapshot, live): DriftReport` | 两份 schema | `{addedTracks, removedPaths, addedPaths, changedDefs, addedCurveTypes, ...}` |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/SchemaSnapshot.ts`（提案）：六段类型 + `loadSnapshot` + `diffSchema`。
2. 新建 `EDITOR:src/generated/schema.snapshot.json` + `.meta.json`（提案）：由真游戏 `schema.get` 落盘。
3. 改 `EDITOR:src/types.ts — Schema（236–244）`：补齐 `models` / `curveTypes` / `script_structure` 三段类型。
4. 改 `EDITOR:src/store.ts — getSchema（350–356）`：取到后编译 `PathRegistry`、跑 `diffSchema`、把 `DriftReport` 存 `state.schemaDrift`。
5. 改 `EDITOR:src/demo.ts`：删除手写 schema（第 15 行的 `version` 字段与整段 `clips`/`keyframes` 表），改用快照；demo 文档数据同步改成 `objects` 形状（与 02-ScriptDocument §4.2 第 7 步同一改动）。
6. 新增漂移提示 UI（归 05 的顶栏/诊断面板；本轮只提供数据）。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/SchemaSnapshot.java`（提案）：同进程直接调 `SchemaExporter.exportAll()`，不走 WebSocket；快照即"在线 schema"。
2. 保留同一 `diffSchema`（对上一次会话缓存的 schema 做比较），用于提示"模组已更新"。
3. 不把 `SchemaExporter` 的 `JsonObject` 直接当编辑模型用；必须过一次 `PathRegistry` 编译（保证两载体同构）。

### 4.4 禁止修改

- 不修改 `SchemaExporter` / `TrackSchemas` / `MetaSchemas` / `PathCurveRegistry` / `MathModelRegistry`。
- 不在快照里加编辑器私有字段（除 `schema.snapshot.meta.json` 这个独立文件）。
- 不把 `hello_ack.version` 当格式版本。
- 不用手写表替代快照。

## 五、正反例验收

### 5.1 正例

1. 快照与在线 schema 完全一致时，`diffSchema` 返回空报告。
2. 在线 schema 新增一个第三方轨道 `modid:foo`（`J:script/track/TrackRegistry.register 98–124`），编辑器提示"新增轨道，只读"。
3. `curveTypes` 新增一种曲线（`PathCurveRegistry.register 231–257`），路径几何下拉自动出现该类型（参数表单由 `params` 驱动）。
4. `models` 段缺失时，`motion_*` 编辑禁用且**不**显示旧硬编码参数。

### 5.2 反例

| 输入 | 期望 |
|---|---|
| 快照里 `yaw` 的 `interp` 是 `linear`，在线是 `angle` | 漂移报告 `changedDefs` 含 `CAMERA.yaw.interp`；编辑器显示"插值方式已变化，只读显示" |
| 在线 schema 删除了 `objects.mask_shape` | 报告 `removedPaths`；该属性只读；保存前若文档里有该路径 → 阻止并提示"运行时已移除" |
| 离线 demo 用旧 `{clips, keyframes}` schema | 拒绝加载，提示"schema 形状不匹配"（不尝试转换） |
| `schema.get` 超时 | 编辑器进入"未连接"，不写盘 |

### 5.3 异步关键帧专项

**正例**：快照刷新（重新连接）不改变文档中任何 `keyframes`。

- 期望：`applyLiveSchema` 只更新注册表与漂移报告，不 touch `state.doc`。

**反例**：schema 变化后"顺手"把不再登记的路径的关键帧删掉。

- 期望：禁止。只读显示 + 保存前拦截；删除必须是显式用户命令（且撤销可回退）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组启动，F9，编辑器连接；记录 `hello_ack.version`。
2. 确认编辑器加载的是 `src/generated/schema.snapshot.json`，且 `diffSchema` 为空。
3. 断开连接（关闭预览屏），确认编辑器进入只读，不能保存。
4. 重连，确认文档未被清空、`keyframes` 未变。
5. 打开一个含 `paths[].geometry.type='bezier'` 的脚本，确认几何表单显示 `control_points`（来自 `curveTypes.bezier.params`，`PathCurveRegistry 64–67`）。

通过判定：第 2 步无漂移；第 3 步确实阻断保存；第 5 步参数名与运行时一致（`control_points`）。

## 七、完成定义

1. `EDITOR:src/model/SchemaSnapshot.ts` 存在；`EDITOR:src/generated/schema.snapshot.json` 来自真游戏。
2. `EDITOR:src/types.ts` 的 `Schema` 覆盖六段。
3. `EDITOR:src/demo.ts` 不再有手写 schema 与 `version` 字段。
4. §5 的 4 条正例、4 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体用同一 `diffSchema` 得到相同报告（对同一对 schema）。
