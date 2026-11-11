# 12-12 纯数据模板（DataTemplateLoader / DataTemplateValidator / DataTemplateExpander）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：12-01（引擎内核）、12-02（引用/环）、01（C01 schema 快照）、02（C04 文档事务）、03（C05 受控宿主文本端口）。下游：12-06（面板来源与导入）、13（WebUI 验收）。
> 证据前缀：`EDITOR:` = 编辑器仓库；`MOD:` = 主模组仓库；`J:` = `MOD:common/src/main/java/com/immersivecinematics/immersive_cinematics/`。

## 1. 职责与结论

纯数据模板 = **编辑器资产 JSON + 编辑器解释器**（Z E4）。模板定义从 TS 代码变成资产，解释器留在编辑器侧；产物仍是标准脚本，运行时零模板语义。

本轮**必须完成**，不是后续层：

- Z `templates.md` §6 步骤 5 已把「纯数据模板 / 用户自定义模板（E4）」列为 Z 轮交付项；
- 同文 §三 的「后续层」只表示**相对首版代码内置的实施顺序**（先跑通 4 个内置模板，再数据化），不是下一轮、下一版本；
- 因此本文件与 12-01～12-11 同轮验收；README 旧版「纯数据化留待后续（不在本轮）」的表述已删除。

三个类各守一段：

| 类 | 只做什么 | 不做什么 |
|---|---|---|
| `DataTemplateLoader` | 来源、读取、严格解析、上限、整包原子装载、来源指纹 | 不校验 schema 语义、不展开 |
| `DataTemplateValidator` | 结构 / schema / 引用 / 环 / 表达式 / 编译期干跑 | 不读文档、不写注册表、不执行宿主能力 |
| `DataTemplateExpander` | 封闭算子 + 白名单生成器 → `TemplateFragment` | 不 eval、不访问全局/文件/网络、不装配进文档 |

安全结论：资产只能声明**数据**；没有循环、没有用户函数、没有字符串求值、没有 `eval`/`new Function`/`import()`/`require`/`fetch`/文件 API。表达式是封闭算子表上的数值树；几何由编辑器白名单生成器计算。

## 2. 依据

### 2.1 Z 正式规格（逐条）

| Z 位置 | 原文要点 | 本文件落点 |
|---|---|---|
| `MOD:plans/0.3.6/Z-editor/templates.md` §0.1-④（E4） | 「模板定义 = 编辑器资产 JSON + 编辑器解释器；依赖变化：不再等 B16——编辑器侧运算自足（几何 / 采样在编辑器算完，产物是显式关键帧数据）」 | §3 资产格式、§6 展开器；几何用白名单生成器在编辑器算 |
| 同文 §6 步骤 5 | 「纯数据模板 / 用户自定义模板（E4；不再以 B16 为前置，见 §0.1-④）｜Z 轮｜模板定义 = 编辑器资产 JSON + 解释器」 | 本轮任务，不延期 |
| 同文 §4.3 | 「模板定义是编辑器的创作资产：首版是编辑器侧代码里的生成函数，纯数据化后是资产 JSON 加解释器。参数是「键、显示名、字段元数据」三元组。」 | `params` 复用 12-01 `TemplateParam`，不造第二套参数类型 |
| 同文 §2.3 | 「不做运行时模板语义：运行时只认最终的标准脚本，不新增模板字段、模板轨道或模板转场。」 | 产物只写 parser 白名单字段；`E_DATA_FORBIDDEN_KEY` |
| 同文 §4.2 | 「嵌套引用只向下，不向上、不横向，引用链上出现重复 id 即判环。」 | 复用 12-02 `TemplateRef`、`E_NEST_DIRECTION`、`E_NEST_CYCLE` |
| 同文 §5 缺点 | 「首版模板是代码，新增模板要改代码并发版；纯数据化要等引擎稳定。」 | 这是**代价陈述**，不是排期；本轮用封闭算子/上限/编译干跑把代价压到可控 |

### 2.2 实际 schema（校验权威，不另造）

| 锚点 | 事实 | 用途 |
|---|---|---|
| `J:script/schema/SchemaExporter.java:43–141` | `exportAll()` 导出 `meta`、`tracks[type].playControl`、`tracks[type].objects`、`triggers`、`models`、`curveTypes`、`script_structure` 六段 | 校验的唯一能力来源（C01） |
| `J:script/schema/SchemaExporter.java:151–232` | `scriptStructure()` 导出 `clips`/`rules`/`rule_bindings`/`paths` 的字段、类型、必填、枚举 | 脚本级 `writes` 与 body 校验 |
| `J:spi/ObjectDef.java:36–52` | 记录字段：`path/mode/type/defaultValue/interp/requires/required/enumValues/nullable/min/max/section/group/appliesTo/labelKey/unit` | 叶子字段的形态/类型/范围/枚举/条件 |
| `J:spi/ObjectDef.java:19–34` | `mode` 为字段形态；`requires` 是前置条件表达式；`appliesTo` 限定层/轨道子类型 | `E_DATA_MODE`、`E_DATA_REQUIRES` |
| `J:spi/PropertyMode.java:12–15` | `VALUE` / `ANIMATED` / `EVENT` | `VALUE` 只能 `value`；`ANIMATED` 可 `value` 或 `keyframes`；`EVENT` 不可由数据模板写 |
| `J:script/schema/TrackSchemas.java:86–94` | `playControl` = `start_time/duration/loop/loop_count/loop_mode` | 片段级 `start_time` 由调用方给，body 不得覆盖 |
| `J:script/schema/TrackSchemas.java:109–...` | CAMERA 的 `position.x/y/z`、`fov` 等叶子路径 | `writes` 与 body 的字段白名单 |
| `J:script/schema/TrackSchemas.java:398–456` | OVERLAY 的 `layer_type/text/x/y/anchor_*/scale_*/opacity/font_scale` 等 | 字幕/覆盖层数据模板的字段边界 |
| `J:script/schema/PathCurveRegistry.java:63–195` | 注册曲线类型与参数（`control_points` 为 `POINT_LIST`） | `E_DATA_CURVE` |
| `J:script/schema/PathCurveRegistry.java:408–425` | 控制点必须是**恰好** `{x,y,z}` 或恰好 `{dx,dy,dz}` 的对象 | 生成器输出与校验；禁止数组元素 |
| `J:script/schema/PathCurveRegistry.java:427–437` | `readPointList` 只接受对象数组 | 同上 |
| `MOD:docs/SCRIPT_FORMAT.md:90–144` | 片段键白名单与 `objects` 两形态 | 片段级 body 校验 |
| `MOD:docs/SCRIPT_FORMAT.md:649–715` | 脚本级 `clips/rules/rule_bindings/paths` 形状 | 脚本级 body 校验 |
| `MOD:docs/SCRIPT_FORMAT.md:734–755` | 已移除键（`version`、`total_duration`、片段级 `keyframes/curve/rules` 等） | `E_DATA_FORBIDDEN_KEY` |
| `J:script/ScriptParser.java:345–412` | `parseObjectClip` 的片段解析边界 | 产物必须能过 parser |
| `J:script/ScriptParser.java:444–489` | `parseStandaloneClips` 的独立片段边界 | 脚本级 `clips` 校验 |
| `J:script/ScriptValidator.java:85–96` | 公开 `validate(json[, knownScriptIds])` | 保存前权威校验 |

### 2.3 现状

| 位置 | 事实 |
|---|---|
| `EDITOR:src/templates/` | 不存在；12-01/12-02 只有代码内置模板的提案 |
| `EDITOR:src/components/PresetsPanel.vue:18–76` | 唯一「模板」是硬编码整圈生成，产物为旧格式 |
| 主模组 `script/template/` | 当前工作树不存在；`ScriptTemplate.java` 仍被 `script.new` 使用（02/03 处理） |
| 12 README（本轮修改前） | §4.3/§五/缺点三处把纯数据模板写成「留待后续」，与 Z §6 步骤 5 冲突；本文件与 README 修订同时清零 |

## 3. 资产格式 `ic-templates/1`

### 3.1 顶层

```json
{
  "format": "ic-templates/1",
  "pack": { "id": "my_pack", "title": "我的模板", "author": "", "version": 1 },
  "templates": [ /* 1..64 个模板 */ ]
}
```

约束：

- `format` 必须精确等于 `ic-templates/1`；未知版本 → `E_DATA_VERSION`。
- `pack.id` 匹配 `^[a-z][a-z0-9_]{1,31}$`；仅作编辑器侧来源标识，不写脚本。
- `templates` 1–64 个；整包原子加载（任一模板失败 → 整包拒绝，注册表不变）。
- 顶层只允许 `format`/`pack`/`templates`；未知键 → `E_DATA_SHAPE`（不静默丢弃）。
- 文件 ≤ 256 KiB；JSON 嵌套深度 ≤ 32。

### 3.2 模板条目

```json
{
  "id": "data.dolly",
  "layer": "clip",
  "titleKey": "tpl.data.dolly.title",
  "docKey": "tpl.data.dolly.doc",
  "trackType": "CAMERA",
  "params": [
    { "key": "duration", "type": "float", "default": 4, "min": 0.1, "max": 600,
      "unit": "second", "labelKey": "tpl.data.dolly.p.duration", "section": "basic",
      "doc": "片段时长（秒）" },
    { "key": "x0", "type": "float", "default": 0, "min": -3.0e7, "max": 3.0e7,
      "unit": "block", "labelKey": "tpl.data.dolly.p.x0", "doc": "起点 X" },
    { "key": "x1", "type": "float", "default": 8, "min": -3.0e7, "max": 3.0e7,
      "unit": "block", "labelKey": "tpl.data.dolly.p.x1", "doc": "终点 X" },
    { "key": "fov_from", "type": "float", "default": 70, "min": 1, "max": 179,
      "unit": "degree", "labelKey": "tpl.data.dolly.p.fov_from", "doc": "起始视场角" },
    { "key": "fov_to", "type": "float", "default": 70, "min": 1, "max": 179,
      "unit": "degree", "labelKey": "tpl.data.dolly.p.fov_to", "doc": "结束视场角" }
  ],
  "writes": ["position.x", "position.y", "position.z", "fov"],
  "localIds": ["cam"],
  "refs": [],
  "body": {
    "clips": [{
      "localId": "cam",
      "duration": { "$param": "duration" },
      "objects": {
        "position": {
          "x": { "$keyframes": [
            { "t": 0, "value": { "$param": "x0" } },
            { "t": { "$param": "duration" }, "value": { "$param": "x1" } }
          ] },
          "y": { "value": 64 },
          "z": { "value": 0 }
        },
        "fov": { "$keyframes": [
          { "t": 0, "value": { "$param": "fov_from" } },
          { "t": { "$param": "duration" }, "value": { "$param": "fov_to" } }
        ] }
      }
    }]
  }
}
```

字段约束：

| 字段 | 必填 | 约束 |
|---|---|---|
| `id` | 是 | 必须 `data.` 开头，匹配 `^data\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$`；与内置或其他数据模板冲突 → `E_DATA_ID_CONFLICT` |
| `layer` | 是 | `clip` / `track` / `script` |
| `titleKey` / `docKey` | 是 | i18n key；缺 zh_cn/en_us 在面板显示 key 本身并记诊断，不阻塞生成 |
| `trackType` | clip/track 必填 | 必须是 `schema.tracks` 的键（内置为 `CAMERA`/`OVERLAY`/…，区分大小写） |
| `params` | 是 | ≤32；形状与 12-01 `TemplateParam` 完全一致；key 唯一；`default` 类型相容；`enum` 的 default ∈ enumValues |
| `writes` | clip/track 必填 | 叶子路径数组；每项必须命中 `schema.tracks[trackType].objects[].path`；script 层命中 `meta`/`script_structure` 的字段 |
| `localIds` | 否 | ≤16；供 `$localId` 引用；名字匹配 `^[a-z][a-z0-9_]{0,31}$` |
| `refs` | 否 | 直接使用 12-02 的 `TemplateRef[]`（`template`/`params`/`repeat`），不另造绑定语法 |
| `body` | 是 | 见 §3.3；只允许片段/轨道/脚本三种产物键 |

### 3.3 `body` 语法（封闭）

`body` 是 JSON 片段，叶子位置只允许以下节点：

| 节点 | 形态 | 约束 |
|---|---|---|
| 字面量 | 数字 / 布尔 / 字符串 / 数组 / 对象 | 数字必须有限；对象键不得是 `__proto__`/`constructor`/`prototype` |
| `$param` | `{"$param":"name"}` | 只能出现在**值**位置；name 必须已声明；不得用于对象键 |
| `$op` | `{"$op":"lerp","args":[a,b,t]}` | 封闭算子表（§3.3.1）；参数个数/类型固定；结果有限 |
| `$keyframes` | `{"$keyframes":[{"t":expr,"value":expr}, …]}` | 仅 `ANIMATED` 叶子；求值后 `t ≥ 0` 且严格递增；至少 2 个节点；不得用于 `VALUE`/`EVENT` |
| `$generator` | `{"$generator":"arc_control_points","args":{…}}` | 白名单生成器（§3.3.2）；只允许出现在 `paths[].geometry.control_points` |
| `$localId` | `{"$localId":"cam"}` | 只允许出现在 id 位置（`id`/`clip`/`rule`/引用字段）；必须在 `localIds` 中声明 |

片段/轨道/脚本键：

- 片段：`localId?`、`duration`、`objects`、`loop?`、`loop_count?`、`loop_mode?`、`exit?`、`id?`。`start_time` 由调用方（播放头/选中片段末端）给，body 出现 → `E_DATA_SHAPE`。
- 轨道：`track` = `{ "type": "CAMERA", "clips": [...] }`。
- 脚本：`meta?`、`timeline?`、`clips?`、`rules?`、`rule_bindings?`、`paths?`。
- 路径是脚本级集合：片段级模板需要路径时写在 `script.paths`，由装配器并入目标文档（与 12-03 `orbit_arc` 的处理一致）。

#### 3.3.1 算子表（只有这些）

`add` / `sub` / `mul` / `div` / `min` / `max` / `clamp` / `lerp` / `abs` / `sqrt` / `pow` / `sin` / `cos` / `tan` / `atan2` / `deg2rad` / `rad2deg` / `round` / `floor` / `ceil`

- 全部是数值算子；不接受字符串、数组、对象参数。
- `div` 除零、`sqrt` 负数、`pow` 结果非有限 → `E_DATA_EXPR`。
- 表达式树深度 ≤16，单模板节点数 ≤2048。
- **没有**条件、循环、变量赋值、字符串拼接、函数定义、属性访问。

#### 3.3.2 生成器表（v1）

| 生成器 | 参数 | 输出 | 数学归属 |
|---|---|---|---|
| `line_control_points` | `{from:{x,y,z}, to:{x,y,z}, at:0..1}` | `[{x,y,z}]` 或 `[{dx,dy,dz}]` | 编辑器 `src/curves/shapes.ts`（12-09） |
| `arc_control_points` | `{radius, start_angle, sweep}` | 2 个 `{dx,dy,dz}` | 12-03 的 `CTRL=(4/3)·tan(sweep/4)`；`sweep ≤ 120` |
| `ellipse_control_points` | `{rx, rz, start_angle, sweep}` | 2 个 `{dx,dy,dz}` | 12-09 |
| `parabola_control_points` | `{from, apex, to}` | 2 个 `{dx,dy,dz}` | 12-09 |

生成器是编辑器代码里的纯函数白名单；资产只给数值参数。未知生成器 → `E_DATA_GENERATOR`；输出必须是恰好 `{x,y,z}` 或 `{dx,dy,dz}` 的对象（`J:script/schema/PathCurveRegistry.java:408–425`）。

### 3.4 引用与局部 id 片段

```json
{
  "layer": "track",
  "trackType": "CAMERA",
  "localIds": ["cam_a", "cam_b"],
  "refs": [
    { "template": "data.dolly",
      "params": { "duration": { "from": "segment" }, "x0": { "const": 0 }, "x1": { "const": 8 },
                  "fov_from": { "const": 70 }, "fov_to": { "const": 70 } } },
    { "template": "data.dolly",
      "params": { "duration": { "from": "segment" }, "x0": { "const": 8 }, "x1": { "const": 16 },
                  "fov_from": { "const": 70 }, "fov_to": { "const": 70 } } }
  ]
}
```

- `refs` 的 `params` 用 12-02 `ParamBinding`（`const`/`from`/受控 `expr`），不是第二套表达式语言。
- 引用只向下（script→track→clip）；深度 ≤3；总实例 ≤512；`repeat.count` ≤64；环 → `E_NEST_CYCLE`。
- 数据模板与内置模板可以互相引用；解析统一走 12-01 注册表的 `getTemplate(id)`。

## 4. `DataTemplateLoader`

### 4.1 文件与签名

`EDITOR:src/templates/data/DataTemplateLoader.ts`

```ts
export interface DataTemplateSource {
  kind: 'asset' | 'file'
  id: string                 // 来源标识（asset 包名 / 文件名）
  displayName: string
  readText(): Promise<string> // 必须来自 03 的受控文本端口
}

export interface DataTemplateLoadResult {
  packs: LoadedDataPack[]            // 已通过校验、可注册的包
  rejected: DataTemplateRejection[]  // 整包拒绝
  diagnostics: DataDiagnostic[]      // 逐模板诊断
}

export class DataTemplateLoader {
  constructor(
    private readonly port: HostTextFilePort,       // 03：Electron 主进程 / Forge 宿主服务
    private readonly validator: DataTemplateValidator,
    private readonly limits: DataLimits,
  ) {}
  async load(source: DataTemplateSource): Promise<DataTemplateLoadResult>
  async loadAll(sources: DataTemplateSource[]): Promise<DataTemplateLoadResult>
}
```

### 4.2 输入

- `DataTemplateSource[]`：只接受两种来源——
  1. 编辑器资产包（随编辑器分发、只读，路径由构建期确定）；
  2. 用户显式选择的 `.json` 文件（WebUI 走 Electron 受控打开对话框；Forge 走宿主受控文件服务）。
- **不接受** renderer 传入的任意绝对路径；不从游戏 `resource/`、脚本目录或网络自动扫描。
- `DataLimits`：`maxBytes=262144`、`maxTemplates=64`、`maxParams=32`、`maxLocalIds=16`、`maxJsonDepth=32`、`maxExprNodes=2048`、`maxExprDepth=16`。

### 4.3 输出

- 成功：`LoadedDataPack { packId, sourceId, sourceHash, templates: DataTemplateDef[] }`；`templates` 已冻结，可直接交注册表。
- 失败：`DataTemplateRejection { sourceId, code, message }` + 逐模板 `diagnostics`；**注册表零变更**。

### 4.4 步骤

1. 通过 `HostTextFilePort.readText(source, { maxBytes, encoding: 'utf-8' })` 读取；端口不存在或拒绝 → `E_DATA_SOURCE`，不降级为 renderer `fetch`/`fs`。
2. 去 UTF-8 BOM；解码失败 → `E_DATA_JSON`（给出字节偏移）。
3. `JSON.parse`；失败 → `E_DATA_JSON`，消息含行列（由 V8 错误位置换算）。
4. **先**做原型键扫描（`__proto__`/`constructor`/`prototype`，含嵌套）→ `E_DATA_PROTO`；在进入任何对象合并前完成。
5. 检查 `format`/`pack`/`templates` 与上限 → `E_DATA_VERSION`/`E_DATA_LIMIT`/`E_DATA_SHAPE`。
6. 逐模板结构预检（id 前缀、layer、params 数量、localIds 数量）→ `E_DATA_ID`/`E_DATA_SHAPE`。
7. 调 `DataTemplateValidator.validatePack(raw)`；任何 error → 整包拒绝（不部分注册）。
8. 通过后 `replaceDataTemplates(packId, templates)`：先移除同 `packId` 旧版本，再一次性加入；失败回滚到旧集合。
9. 记录来源指纹 `sourceHash = SHA-256(bytes)` 与 `sourceId` 到编辑器侧 provenance；**不写脚本**、不写游戏目录。
10. 返回 `LoadResult`；调用方（12-06）刷新列表。

### 4.5 边界（禁止）

- 禁止 `eval`/`new Function`/`Function`/`setTimeout(string)`/`import()`/`require`/`fetch`/`XMLHttpRequest`/`fs`。
- 禁止把模板包内容拼进 HTML、i18n 模板字符串或 CSS。
- 禁止「先注册再校验」；禁止坏模板留在注册表里。
- 禁止从脚本文件、`resource/`、剪贴板自动加载；剪贴板粘贴必须先落到受控文本输入并走同一校验。
- 禁止把 `sourceId`/`sourceHash` 写进运行时脚本。

### 4.6 验收

**正例**

1. 合法包（§3.2）→ 加载成功；`packId`、`sourceHash` 稳定；模板出现在 12-06 列表，来源徽标为「数据模板」。
2. 同一包重复加载 → 旧版本被替换，不产生重复项；已生成文档不受影响。
3. 两个包各含 1 个模板 → 都可见；id 不冲突。

**反例**

1. 300 KiB 文件 → `E_DATA_LIMIT`，不解析。
2. 65 个模板 → `E_DATA_LIMIT`。
3. 坏 JSON → `E_DATA_JSON`，行列可定位。
4. 含 `__proto__` → `E_DATA_PROTO`，整包拒绝。
5. 一个包内 1 个合法 + 1 个非法模板 → 整包拒绝，注册表零变更。
6. 文件端口不可用 → `E_DATA_SOURCE`，不偷偷读本地路径。

## 5. `DataTemplateValidator`

### 5.1 文件与签名

`EDITOR:src/templates/data/DataTemplateValidator.ts`

```ts
export class DataTemplateValidator {
  constructor(private readonly schema: SchemaSnapshot, private readonly limits: DataLimits) {}
  validatePack(raw: unknown): DataTemplateValidation
  validateTemplate(raw: unknown, ctx: { knownIds: Set<string> }): DataTemplateValidation
  validateGraph(templates: DataTemplateDef[]): DataTemplateValidation
  validateCompiled(compiled: CompiledDataTemplate, samples: TemplateParams[]): DataTemplateValidation
}
```

### 5.2 输入 / 输出

- 输入：`unknown`（JSON.parse 结果）+ `SchemaSnapshot`（01 的 C01）+ 已知模板 id 集合。
- 输出：`{ ok: boolean; errors: DataDiagnostic[]; warnings: DataDiagnostic[] }`；`DataDiagnostic = { code, path, message, templateId? }`，`path` 用 JSON Pointer 风格（`/templates/0/body/clips/0/objects/fov`）。
- 纯函数：不读文档、不写注册表、不发请求、不读文件。

### 5.3 校验分层

| 层 | 内容 | 失败码 |
|---|---|---|
| L1 结构 | 顶层/模板/参数/body 的键与类型、数量、深度 | `E_DATA_SHAPE`、`E_DATA_LIMIT`、`E_DATA_PROTO` |
| L2 schema | `trackType`、`writes`、叶子路径、mode/type/interp/enum/min/max/requires/appliesTo、片段键白名单、禁止键 | `E_DATA_TRACK`、`E_DATA_FIELD`、`E_DATA_MODE`、`E_DATA_ENUM`、`E_DATA_REQUIRES`、`E_DATA_FORBIDDEN_KEY` |
| L3 引用 | 目标存在、方向向下、参数绑定匹配、环、深度、实例数 | `E_DATA_REF`、`E_DATA_REF_DIRECTION`、`E_DATA_CYCLE`、`E_DATA_DEPTH` |
| L4 表达式 | 算子/生成器白名单、arity、类型、有限性、节点/深度 | `E_DATA_EXPR`、`E_DATA_GENERATOR` |
| L5 编译干跑 | 用默认值 + 全最小 + 全最大（每模板 ≤3 组）展开，校验产物形状与 schema | `E_DATA_BOUND`、`E_DATA_SHAPE` |

### 5.4 具体规则

1. **`writes` 必须是叶子**：`position.x` 合法，`position` 不合法（除非 schema 本身有该路径）。每个 `writes` 项必须等于某个 `ObjectDef.path()`。
2. **body 字段必须 ⊆ `writes`**：body 出现未声明路径 → `E_DATA_FIELD`；`writes` 声明了但 body 未用 → warning（不阻塞）。
3. **mode 匹配**：`VALUE` 叶子只能是 `{value: …}`；`ANIMATED` 叶子可以是 `{value: …}` 或 `{keyframes: […]}`；`EVENT` 叶子禁止 → `E_DATA_MODE`。
4. **type 匹配**：数字叶子不接受字符串；`bool` 只接受布尔；`enum` 值必须 ∈ `ObjectDef.enumValues`（`E_DATA_ENUM`）；`REF`/`NULLABLE_FLOAT` 按 schema 处理。
5. **范围**：字面量/常量参数在 `min`/`max` 外 → `E_DATA_BOUND`；表达式无法静态证明时，交给 L5 干跑。
6. **requires**：`requires` 是前置条件（如 `orient=tangent`）；同一模板同时写互斥组合 → `E_DATA_REQUIRES`。
7. **片段键白名单**：只允许 `duration/objects/loop/loop_count/loop_mode/exit/id`；`start_time`、片段级 `keyframes/curve/rules` → `E_DATA_FORBIDDEN_KEY`。
8. **脚本级**：`meta.version`、`timeline.total_duration`、未知顶层键 → `E_DATA_FORBIDDEN_KEY`；`paths` 的 `id/clip/from/to/axes/geometry/timing` 按 `script_structure` 校验。
9. **路径控制点**：`geometry.control_points` 必须是对象数组，每项恰好 `{x,y,z}` 或 `{dx,dy,dz}`；数组元素/混合键 → `E_DATA_CURVE`（依据 `PathCurveRegistry.readPoint`，文档 `SCRIPT_FORMAT.md:710–714` 的数组示例是笔误，不照抄）。
10. **引用**：`refs[].template` 必须在 `knownIds`（内置 + 数据）；目标层必须严格低于当前层；`params` 的键必须命中目标模板的参数声明；`from` 只能引用当前模板已声明参数；`repeat.count` 1–64；总实例 ≤512。
11. **环**：DFS 展开栈出现重复 id → `E_DATA_CYCLE`，消息给出 `a → b → a`；深度 >3 → `E_DATA_DEPTH`。
12. **表达式**：算子/生成器白名单；`$param` 必须已声明；`$localId` 必须在 `localIds`；`$` 开头的未知键 → `E_DATA_EXPR`；对象键位置的 `$param` → `E_DATA_EXPR`。
13. **编译干跑**：对每个模板用默认值、全最小、全最大各展开一次；展开在内存沙箱里（只传 params/schema/generators，不传文档/全局）；产物必须通过 `assertFragmentShape` 与 schema 校验。干跑失败 → `E_DATA_BOUND`，不注册。

### 5.5 错误码表

| code | 触发 | 表现 |
|---|---|---|
| `E_DATA_JSON` | JSON 解析/解码失败 | 整包拒绝，行列/字节偏移 |
| `E_DATA_FORMAT` | 缺/错 `format` | 整包拒绝 |
| `E_DATA_VERSION` | 不支持的 `ic-templates/*` | 整包拒绝，列出支持版本 |
| `E_DATA_LIMIT` | 文件/模板/参数/深度/节点/实例超限 | 整包拒绝，指出哪一项 |
| `E_DATA_SHAPE` | 结构不符/未知键/缺必填 | 整包拒绝，JSON Pointer |
| `E_DATA_PROTO` | 原型污染键 | 整包拒绝 |
| `E_DATA_PARAM` | 参数声明非法（默认值/枚举/范围/重复 key） | 整包拒绝 |
| `E_DATA_ID` | id 不以 `data.` 开头/不合规 | 整包拒绝 |
| `E_DATA_ID_CONFLICT` | 与内置或其他数据模板冲突 | 整包拒绝 |
| `E_DATA_TRACK` | `trackType` 不在 schema | 整包拒绝 |
| `E_DATA_FIELD` | `writes`/body 字段不在 schema | 整包拒绝 |
| `E_DATA_MODE` | VALUE 用 keyframes / ANIMATED 用错 / EVENT 被写 | 整包拒绝 |
| `E_DATA_ENUM` | 枚举值不在 `enumValues` | 整包拒绝 |
| `E_DATA_REQUIRES` | 违反 schema `requires` | 整包拒绝 |
| `E_DATA_CURVE` | 曲线类型/控制点形态非法 | 整包拒绝 |
| `E_DATA_EXPR` | 未知算子/arity/类型/除零/非有限 | 整包拒绝 |
| `E_DATA_GENERATOR` | 未知生成器/参数错 | 整包拒绝 |
| `E_DATA_REF` | 引用未知模板/参数不匹配 | 整包拒绝 |
| `E_DATA_REF_DIRECTION` | 非向下引用 | 整包拒绝 |
| `E_DATA_CYCLE` | 引用成环 | 整包拒绝，列出环路径 |
| `E_DATA_DEPTH` | 嵌套 >3 | 整包拒绝 |
| `E_DATA_FORBIDDEN_KEY` | `meta.version`/`total_duration`/片段级 `keyframes` 等 | 整包拒绝 |
| `E_DATA_LOCAL_ID` | 未声明的 `$localId` | 整包拒绝 |
| `E_DATA_BOUND` | 干跑越界/产物形状不符 | 整包拒绝 |
| `E_DATA_SOURCE` | 宿主文件端口不可用/拒绝 | 整包拒绝，不降级 |

### 5.6 验收

**正例**

1. §3.2 的合法模板 → `ok=true`，0 error；干跑 3 组参数都通过。
2. 一个模板声明 `writes:["position.x","fov"]`，body 只写这两条 → 通过。
3. 人工以相同参数生成数据模板和内置dolly，检查摘要/保存重载/游戏表现一致，不建设自动比较工具。
4. 引用内置 `clip.orbit_arc` → 通过（内置在 `knownIds`）。
5. 模板只声明 `duration`，body 用 `{"$op":"lerp","args":[…]}` → 通过。

**反例**

1. `writes:["position"]`（非叶子）→ `E_DATA_FIELD`。
2. body 写 `position_origin` 但 `writes` 未声明 → `E_DATA_FIELD`。
3. `VALUE` 叶子写 `$keyframes` → `E_DATA_MODE`。
4. `fov` 写 200（max 179）→ `E_DATA_BOUND`。
5. `geometry.type:"nope"` → `E_DATA_CURVE`。
6. `control_points:[[0,0],[4,8]]` → `E_DATA_CURVE`。
7. `{"$op":"eval","args":[]}` → `E_DATA_EXPR`。
8. `{"$param":"__proto__"}` → `E_DATA_PROTO` 或 `E_DATA_EXPR`。
9. `refs` 指向脚本级模板（从片段级）→ `E_DATA_REF_DIRECTION`。
10. `a→b→a` → `E_DATA_CYCLE`。
11. 模板只在 `duration=0.1` 时产生非法关键帧 → 干跑 `E_DATA_BOUND`，不注册。

## 6. `DataTemplateExpander`

### 6.1 文件与签名

`EDITOR:src/templates/data/DataTemplateExpander.ts`

```ts
export class DataTemplateExpander {
  constructor(
    private readonly generators: GeneratorRegistry,
    private readonly expr: ExprEvaluator,
    private readonly limits: ExpandLimits,
  ) {}
  compile(def: DataTemplateDef): CompiledDataTemplate
  bind(def: CompiledDataTemplate): TemplateExpander   // 与内置模板同签名
  expand(def: CompiledDataTemplate, params: TemplateParams, ctx: ExpandContext): TemplateFragment
}
```

### 6.2 统一接口（与内置模板同形）

```ts
type TemplateExpander = (params: TemplateParams, ctx: ExpandContext) => TemplateFragment

interface TemplateEntry {
  id: string
  layer: 'clip' | 'track' | 'script'
  source: 'builtin' | 'data'
  def: TemplateDef | DataTemplateDef
  expand: TemplateExpander   // 内置 = def.expand；数据 = expander.bind(def)
}
```

- 12-01 注册表同时持有 `builtin` 与 `data` 条目；`getTemplate(id)` 不区分来源。
- 12-02 的 `TemplateRef` 解析、环检测、深度/实例限制对两者一视同仁。
- 12-06 的参数表单只认 `TemplateParam[]`，数据模板不产生第二套表单。
- 12-01 的装配器只认 `TemplateFragment`，不关心来源。

### 6.3 展开步骤

1. `normalizeParams(def.params, raw)`（12-01）：缺省填充、类型归一、越界/未知键报错。
2. 用 `ExprEvaluator` 递归求值 `body`：字面量原样；`$param` 查归一后的参数；`$op` 按算子表；`$keyframes` 求值 `t/value`；`$generator` 调白名单生成器；`$localId` 先占位。
3. 为每个 `localId` 通过 12-01 `ids.ts` 分配最终 id（`allocateClipId`/`allocatePathId`/`allocateRuleId`），替换 `$localId`。
4. 按声明顺序追加 `refs`（12-02 `expandTree`），逐层传参；深度/环/实例限制在 `expandTree` 内判定。
5. `assertFragmentShape(fragment, def.writes, schema)`：再次检查字段、mode、类型、关键帧单调、控制点对象形态；失败 → `E_EXPAND`（带 JSON Pointer）。
6. 返回**全新**、冻结的 `TemplateFragment`；不缓存、不复用；装配/事务由 12-01 负责。

### 6.4 表达式求值器（`expr.ts`）

- 只接受 §3.3 的节点；未知 `$` 键 → `E_DATA_EXPR`。
- 数值必须是有限 `number`；`NaN`/`Infinity` → `E_DATA_EXPR`。
- `$keyframes` 的 `t` 求值后必须 `≥0` 且严格递增；`t` 不得是字符串/布尔。
- 不提供属性访问、索引、函数调用、字符串操作、条件、循环。
- 递归深度 ≤16；节点数 ≤2048；结果缓存只在单次展开内（不跨调用）。

### 6.5 生成器（`generators.ts`）

- 注册表是**代码白名单**：`line_control_points`、`arc_control_points`、`ellipse_control_points`、`parabola_control_points`。
- 每个生成器是纯函数：`(args, limits) => Point[]`；不读 schema/文档/全局。
- 输出必须是对象数组，每项恰好 `{x,y,z}` 或 `{dx,dy,dz}`；否则 `E_DATA_GENERATOR`。
- `arc_control_points` 与 12-03 共用同一数学（`CTRL=(4/3)·tan(sweep/4)`，`sweep ≤120`）；不得在数据模板里重写曲线求值。
- 生成器只用于 `paths[].geometry.control_points`；其他位置 → `E_DATA_GENERATOR`。

### 6.6 确定性

- 不使用 `Date.now`/`Math.random`/locale 相关格式化。
- 浮点结果统一四舍五入到 1e-6（与 12-03 的常量精度一致）；同一输入 → 同一输出。
- 对象键顺序按 body 声明顺序；不因遍历顺序产生差异。

### 6.7 验收

**正例**

1. 数据模板 `data.dolly` 与内置 `clip.dolly` 同参数展开 → `TemplateFragment` 结构等价（id 除外）。
2. `data.orbit_arc` 用 `arc_control_points` 生成的控制点与 12-03 的 `orbit_arc` 逐点误差 <1e-6。
3. 轨道级数据模板 `refs` 引用片段级数据模板 3 次 → 3 个片段，id 稳定，参数逐层传入。
4. 同一参数连续展开两次 → 深度相等且 JSON 字符串一致。
5. 展开结果保存 → `script.validate` 零新增问题 → 重开 → 播放。

**反例**

1. 展开器获得任意宿主/全局/网络能力→不通过；人工导入非法算子/恶意属性样本，观察明确拒绝、无副作用，不新增单测或模拟上下文测试。
2. `$op:"eval"` → `E_DATA_EXPR`。
3. 生成器返回数组元素 `[0,0]` → `E_DATA_GENERATOR`。
4. `$keyframes` 的 `t` 重复/倒序 → `E_DATA_BOUND`/`E_EXPAND`。
5. 数据模板写 `meta.version` → `E_DATA_FORBIDDEN_KEY`。
6. 展开一半抛错留下半份片段 → 不通过（12-01 事务回滚）。

## 7. 注册表与面板接入

- 12-01 `registry.ts` 增加 `source` 字段与 `replaceDataTemplates(packId, defs)`；内置注册与数据注册分开提交，互不覆盖。
- 12-06 `TemplatePanel.vue` 增加「导入模板包…」「移除数据模板」；列表项显示来源徽标（`builtin`/`data` + 包名）；移除数据模板只影响后续插入，已生成文档不受影响（生成即脱离）。
- 12-06 的 `SourceBadge.vue` 显示 `{templateId, params, sourceId, sourceHash}`；只读，不提供「重新生成」。
- 12-02 的展开预览树把数据模板与内置模板画成同一种节点，标注来源。

## 8. 安全边界（汇总）

1. **无代码执行**：`src/templates/data/**` 内不得出现 `eval(`、`new Function`、`Function(`、`import(`、`require(`、`fetch(`、`XMLHttpRequest`、`fs.`、`process.`、`window.`、`document.`。
2. **JSON-only**：资产只经 `JSON.parse`；不执行 JS、不解析 `<script>`、不拼接 HTML。
3. **原型安全**：`__proto__`/`constructor`/`prototype` 在解析后第一道扫描拒绝；参数表用 `Map` 或 `Object.create(null)`。
4. **写入白名单**：`writes` 是硬边界；body 不能写未声明字段，参数不能变成字段名。
5. **命名空间**：数据模板 id 必须 `data.` 开头；不能覆盖内置 id。
6. **资源上限**：文件/模板/参数/深度/节点/关键帧/实例全部有上限；超限整包拒绝。
7. **无宿主能力**：解释器只拿到 `{params, schema, generators}`；不拿文档、端口、存储、网络。
8. **不写游戏目录**：加载/展开/来源指纹都不触碰游戏文件系统；用户文件只经 03 的受控端口读取。
9. **CSP**：本功能不需要 `unsafe-eval`；若构建配置为它放开 CSP，视为不通过。

## 9. 前置 / 两宿主 / 禁止

### 9.1 前置

- 12-01：`TemplateParam`、`TemplateDef`、`TemplateFragment`、`normalizeParams`、`ids.ts`、注册表、装配器、事务。
- 12-02：`TemplateRef`、`ParamBinding`、`expandTree`、命名空间、环/深度/实例限制。
- 01：`SchemaSnapshot`（六段 + `ObjectDef` 全字段）。
- 02：文档事务与保存前校验。
- 03：`HostTextFilePort`（WebUI Electron 主进程 / Forge 宿主服务）；没有该端口时阻塞，不用 `fetch`/`fs` 冒充。
- 12-09：生成器数学（`src/curves/shapes.ts`）与控制点对象形态。

### 9.2 两宿主

本轮只实现/验收 WebUI 侧；游戏内 Forge+AUI 侧同语义是 14 迁移要求，不阻塞本轮。

- Loader/Validator/Expander共享同一资产/算子/展开语义和行为向量；源码能否跨宿主直接复用按03/14实证，不预设AUI能执行TS/Vue，也不另建第二套模板含义。
- WebUI 用 Electron 受控打开对话框；Forge 用宿主受控文件服务；两者都只返回文本，不把绝对路径交给解释器。
- 游戏内 Fabric AUI 宿主暂缓只影响该宿主的 UI 适配，不影响本文件的生成语义；WebUI→Fabric 主模组通路不受影响。
- 面板在窄屏下折叠为单栏，但导入/校验/展开/错误定位能力不缩水。

### 9.3 禁止

- 不做运行时模板字段、模板轨道、模板转场。
- 不做「生成物与模板保持关联并可再生成」；来源只读。
- 不做通用 DSL：无循环、无用户函数、无字符串求值、无文件/网络/全局访问。
- 不自动修改用户已有片段/路径/规则；只新增，冲突报告。
- 不把模板包来源路径、包名、hash 写进脚本。
- 不把字幕批次元数据（`sourceCueId`/`batchId`/样式名）写进数据模板产物；字幕归 20–23。

## 10. 验收与完成定义

### 10.1 本轮验收（正/反例）

1. 合法包加载 → 面板可见 → 填参 → 展开 → 装配 → `script.validate` 零新增问题 → 保存 → 重开 → 游戏播放。
2. 人工分别用相同参数展开数据/内置模板，检查生成摘要、保存重载与游戏表现一致，不建立自动对拍。
3. 环、方向、深度、实例、未知算子、未知生成器、未知字段、未知曲线、枚举越界、范围越界、原型键、超限、坏 JSON 各有夹具与错误码。
4. 整包原子：一个坏模板 → 整包拒绝，注册表零变更，已打开文档不受影响。
5. 人工导入非法算子/原型键/越界与坏JSON，观察拒绝/错误定位/注册表与文档不变；功能不需要为资产代码开放CSP。
6. （14 迁移要求，本轮不作为出口）两宿主：同一包在 WebUI 与 Forge 宿主加载、展开、保存结果一致；Forge 无文件端口时明确阻塞，不 mock。
7. 移除数据模板包：后续插入不可用；已生成文档仍可解析/播放；来源徽标只读可查。

### 10.2 完成定义

- `DataTemplateLoader`/`DataTemplateValidator`/`DataTemplateExpander` 三个类与 `expr.ts`/`generators.ts`/`assertShape.ts` 全部落地。
- 数据模板与内置模板共用 `TemplateParam`/`TemplateExpander`/注册表/引用/环检测/装配/事务；没有第二套参数、id、引用或校验。
- 资产格式 `ic-templates/1` 有唯一权威定义（本文件 §3），校验错误可定位到 JSON Pointer。
- 安全边界通过实际导入/生成/取消/异常使用观察及实现核对，记录真实结果；不要求扫描测试、单测或CI。
- README 的纯数据模板条目、任务索引、出口与本文件一致；不再出现「留待后续」。
