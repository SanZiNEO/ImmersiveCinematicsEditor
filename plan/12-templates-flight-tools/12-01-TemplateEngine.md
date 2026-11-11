# 12-01 模板引擎（参数 / 注册 / 展开 / 装配）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：01（schema 快照）、02（文档命令与 id 规则）；下游：12-02～12-06、12-10。

## 1. 职责

定义模板的最小内核：参数声明、注册表、展开器、装配器、错误模型、事务边界。它不知道「环绕」或「推近」是什么，只负责把 `(templateId, params, target)` 变成一次合法的文档变更。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/components/PresetsPanel.vue:7–16` | `selectedPreset` 写死 `'orbit_circle'`；`orbitParams` 六个参数写死在组件里 |
| `EDITOR:src/components/PresetsPanel.vue:18–76` | `generateOrbitCircle()`：直接返回整份 `ScriptDoc`，含 `version:3`（60）、`total_duration`（64）、片段级 `curve`（42–48）、片段级 `keyframes`（49–56） |
| `EDITOR:src/components/PresetsPanel.vue:77–86` | `applyPreset()`：`state.doc.meta = {...}` + `timeline = newDoc.timeline`，**整份覆盖**，无事务、无引用检查 |
| `EDITOR:src/store.ts:142–157` | `commit()`：`pushUndo` → fn → `maintainInvariants` → 防抖推送（唯一的写入入口，02 会替换其实现） |
| `EDITOR:src/schema.ts:36–78` | `fillDefaults` / `fillClipDefaults` / `fillKeyframeDefaults`（旧形状：clips/keyframes） |
| `EDITOR:src/schema.ts:88–120` | `stripDefaults` / `stripScriptDefaults`（保存前精简；02 会重写为对象级） |
| `MOD:docs/SCRIPT_FORMAT.md:90–144` | 片段键白名单、`objects` 两形态、插值由字段元数据决定 |
| `MOD:docs/SCRIPT_FORMAT.md:649–715` | 脚本级 `clips/rules/rule_bindings/paths` 形状与 id 规则 |
| `MOD:plans/0.3.6/Z-editor/templates.md` §1/§3 | 参数声明与 `FieldDef` 同形；模板 = 参数声明 + 展开规则 + 可嵌套引用 |

## 3. 拟新建（提案）

| 文件 | 导出 | 职责 |
|---|---|---|
| `EDITOR:src/templates/types.ts` | `TemplateLayer`、`TemplateDef`、`TemplateParam`、`TemplateParams`、`TemplateFragment`、`TemplateError` | 类型与错误码 |
| EDITOR:src/templates/registry.ts | registerTemplate、templatesOf、getTemplate、replaceDataTemplates（提案） | 内置/纯数据统一注册和查询；整包替换原子且不覆盖其他来源 |
| `EDITOR:src/templates/params.ts` | `normalizeParams(def, raw)` | 类型归一、缺省填充、越界拒绝、未声明键报错 |
| `EDITOR:src/templates/assembler.ts` | `assemble(fragment, target, ctx)` | 分配 id、装进轨道/脚本、引用重写 |
| `EDITOR:src/templates/provenance.ts` | `recordSource`、`sourcesOf(docId)` | 编辑器侧来源元数据（不写脚本） |
| `EDITOR:src/templates/ids.ts` | `allocateClipId`、`allocatePathId`、`allocateRuleId` | 按 `^[A-Za-z0-9_]{1,64}$` 生成唯一 id |

## 4. 输入 / 输出 / 字段约束

### 4.1 参数声明（冻结形状）

```ts
type TemplateParamType = 'float' | 'int' | 'bool' | 'enum' | 'string' | 'position' | 'selector' | 'curve_type'

interface TemplateParam {
  key: string                 // 唯一，snake_case
  type: TemplateParamType
  default?: unknown           // 缺失 = 必填
  required?: boolean
  min?: number; max?: number  // 仅数值
  enumValues?: string[]
  unit?: 'second' | 'degree' | 'block' | 'ratio' | 'pixel'
  section?: string            // 表单分组；缺省 'basic'
  labelKey: string            // i18n key，必须有 zh_cn 与 en_us
  doc?: string                // 帮助文本（中文一句话）
}
```

约束：

- `type` 与 `default` 必须相容；`enum` 必须有非空 `enumValues` 且 `default ∈ enumValues`。
- `position` 参数值为 `{x,y,z}` 或 `{dx,dy,dz}`，由模板声明 `positionMode: 'absolute' | 'relative'`（缺省 relative）。
- 参数不接受任意嵌套结构；position等明确类型按声明验证，多字段拆为已声明参数。这是格式合同，不是将纯数据能力推到后续。

### 4.2 模板定义

```ts
interface TemplateDef {
  id: string                  // 层内唯一；建议 `clip.fade` / `track.orbit_full` / `script.follow_black`
  layer: 'clip' | 'track' | 'script'
  titleKey: string
  docKey: string
  params: TemplateParam[]
  /** 该模板产出的轨道类型（片段级必填；轨道级为轨道类型） */
  trackType?: TrackType
  /** 展开：纯函数，不得读取全局状态、不得发请求 */
  expand(params: TemplateParams, ctx: ExpandContext): TemplateFragment
  /** 可选：展开前的额外校验（跨参数约束），返回错误列表 */
  validate?(params: TemplateParams): TemplateError[]
}

interface ExpandContext {
  schema: SchemaSnapshot        // 01 的 C01
  clipIdHint?: string           // 调用方建议的 id（插入到已有片段之后时可复用命名前缀）
  layerDepth: number            // 嵌套深度，>3 直接报错
}
```

### 4.3 产物片段

```ts
interface TemplateFragment {
  clips?: TimelineClipFragment[]        // 片段级/轨道级
  track?: { type: TrackType; clips: TimelineClipFragment[] }
  script?: { meta?: object; timeline?: { tracks: TrackFragment[] }; clips?: object[]; rules?: object[]; rule_bindings?: object[]; paths?: object[] }
}
```

`TimelineClipFragment` 只允许 `start_time?`、`duration`、`objects`、`loop*`、`exit?`、`id?`；**禁止** `keyframes`、`curve`、`transition` 以外的新键（`transition*` 由 08 的字段契约定义）。

### 4.4 错误模型

| code | 触发 | 表现 |
|---|---|---|
| `E_PARAM_MISSING` | 必填参数缺失 | 字段级错误，聚焦该输入 |
| `E_PARAM_TYPE` | 类型不符 | 字段级错误，保留用户输入 |
| `E_PARAM_RANGE` | 越界 | 字段级错误，显示允许区间 |
| `E_PARAM_UNKNOWN` | 传了未声明键 | 生成期错误（不是静默忽略） |
| `E_TEMPLATE_UNKNOWN` | 未知 id | 面板级错误 |
| `E_EXPAND` | 展开器抛错/返回非法结构 | 面板级错误 + 诊断条目 |
| `E_ASSEMBLE_CONFLICT` | id 冲突/轨道类型不符/引用不可解析 | 事务级错误，整次回滚 |
| `E_NEST_DEPTH` | 嵌套 > 3 层 | 生成期错误 |
| `E_NEST_CYCLE` | 引用成环 | 生成期错误，列出环路径 |

### 4.5 装配规则

1. **id 分配**：`allocateClipId(doc, prefix)` 生成 `^[A-Za-z0-9_]{1,64}$`；已存在的 id 跳过；同一事务内预留后立即登记，避免同批冲突。
2. **轨道归属**：片段级插入到 `target.trackId`；轨道级新建轨道（同类型已存在时**追加**到该轨道，除非参数要求新轨道）；脚本级新建文档。
3. **时间**：`start_time` 由调用方给（播放头或选中片段末尾）；片段内部关键帧时间为**片段局部秒**，从 0 开始。
4. **引用**：模板内生成的 `paths/rules/rule_bindings` 只能引用**本次生成**的 id；引用用户已有片段时必须由用户在面板里显式选择（`12-02`）。
5. **默认值**：只写「非 schema 默认」的字段；`objects` 的每个叶子要么有 `value`，要么有 `keyframes`，不允许空对象。
6. **校验**：装配完成后用 02 的结构检查（不重复实现语义校验）；保存前仍由 `script.validate` 权威判定。

## 5. 修改步骤

1. 新建 `types.ts` / `registry.ts` / `params.ts` / `ids.ts` / `assembler.ts` / `provenance.ts`。
2. 把 `PresetsPanel.vue:18–76` 的生成逻辑**删除**，其数学移入 `12-03` 的 `orbit_arc` 与 `12-04` 的 `orbit_full`（按新格式重写）。
3. `PresetsPanel.vue:77–86` 的整份覆盖删除；改为 `assemble()` 增量插入。
4. 参数表单复用 06 的控件库（`FieldRenderer` 系列），但输入是 `TemplateParam` 而非 `ObjectDef`；写一个 `TemplateParamForm.vue`（12-06）。
5. 注册表在模块加载期自检：id 唯一、labelKey 存在（用 `i18n` 的 `t` 探测）、默认值在枚举内。
6. 装配接入 02 的事务：`withDocumentTransaction(docId, fn)`；失败回滚并返回 `TemplateError[]`。
7. 接入12-12的Loader/Validator/Expander：数据模板绑定同签名展开器，复用参数归一、引用/环检测、ID分配、装配与事务；12-06只展示来源差异，不另维护第二套生成逻辑。

## 6. 禁止修改

- 不改运行时 schema、不新增脚本字段、不写编辑器私有键进脚本。
- 不实现播放期求值（贝塞尔弧长、相机合成、调色）——这些由宿主做。
- 不在展开器里读 `store.state`、发网络请求、读文件。
- 不做「模板自动修改用户已有片段」（除插入位置的 `start_time` 由调用方决定）。
- 不实现「再生成/同步」（来源信息只读）。

## 7. 两分支承载

共享参数/注册/展开/装配语义与行为向量；源码能否直接跨宿主复用按03/14实际脚本能力决定，不预设AUI可跑TS/Vue。主模组editor总开关和双模式见shared/editor-package-modes；创作模板不搬进主模组。WebUI→Forge/Fabric完整，只有游戏内Fabric+AUI适配暂缓。

## 8. 前置

01 的 `SchemaSnapshot`（字段类型/默认/枚举/min/max/unit）；02 的 `clipId` 规则、事务与结构检查；06 的控件库（表单渲染）。

## 9. 验收

**正例**

1. 注册两个同 id 模板 → 加载期抛错并指出文件与 id。
2. 传未声明参数 `radius=8`（模板只声明 `r`）→ `E_PARAM_UNKNOWN`，不生成。
3. 参数 `duration=-1`（min 0.1）→ `E_PARAM_RANGE`，保留输入并显示区间。
4. 展开器返回片段级 `keyframes` → `E_EXPAND`，诊断指出非法键。
5. 一次事务内生成 3 个片段：中途 id 冲突 → 全部回滚，文档修订号不变。
6. 生成后保存：`script.validate` 无新增 issue；JSON 中无 `version`/`total_duration`。
7. 同参数的内置与纯数据模板经统一注册表/装配器生成相同语义产物；坏数据包/循环/未知字段失败不污染注册表或文档；资产不执行代码。

**反例**

1. 模板产物含 `meta.version` → 不通过。
2. 参数默认值缺失但表单显示 0 → 不通过。
3. 展开器直接 `state.doc.timeline.tracks.push(...)` → 不通过。
4. 生成失败后文档留下半份片段 → 不通过。

**真实冒烟**：WebUI 连真机，生成一个 `orbit_arc`（`12-03`）→ 保存 → 重开 → 播放；确认无 parser 错误。

## 10. 完成定义

- 引擎四件套（声明/注册/展开/装配）+ 错误码 + 事务边界全部落地。
- `PresetsPanel.vue` 删除，其能力由模板注册表承接。
- 产物在 `script.validate` 下零新增问题。
- 来源元数据只存编辑器侧，脚本文件无痕。
- 12-12纯数据入口与12-06面板真实接通，内置/数据共用全部参数与装配合同；字幕C14的来源/重导入不受普通模板无再生成限制。
