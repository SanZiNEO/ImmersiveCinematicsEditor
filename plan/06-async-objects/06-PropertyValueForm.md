# 06-PropertyValueForm：属性值表单

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C08 异步属性身份
> 依赖：02-AnimObject（值类型表）、02-PropertyPathRegistry（`ObjectDefView`）
> 下游：06-StepNullableAndEnum、07（位置/朝向的复合控件）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

把 `ObjectDefView.type` 映射到控件：9 种值类型各一个控件，读 `unit`/`min`/`max`/`enumValues`/`nullable`，提交语义统一（失焦/回车提交，Esc 取消），校验失败不写文档。

本任务既替换旧FieldRenderer类型分支，也为clip.effects行内参数与selection.properties快捷属性提供唯一值控件/目标解析。快捷属性内容由本任务的SelectionPropertiesPanel组装，05只负责独立宿主/上下文；不得复制控件、选择或节点时间轴。

**参考输入**：[Olive属性关键帧适配](../references/02-olive-property-keyframes.md)的Slider/WidgetBridge/InputDragger。只取编辑草稿、提交/取消、拖动聚合与防止回显覆盖正在输入的值；非法值按本任务拒绝并提示，不静默钳制，不因为Olive支持跨分量建帧而改变单属性合同。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| `FieldRenderer` 按旧类型分支：`string`/`int`/`float`/`bool`/`tristate`/`enum`/`position`/`bezier_curve`/`map`/`object` | `EDITOR:src/components/fields/FieldRenderer.vue（51–66）` |
| 新 schema 的类型是 9 种值类型，没有 `tristate`/`position`/`bezier_curve` | `J:spi/PropertyType.java（9–31）`；导出 `SchemaExporter.exportObject（368）` |
| `ref` 字段靠硬编码键名集合走注册表补全 | `FieldRenderer.vue（25–29 `REGISTRY_KEYS`、40–42）` |
| 字符串字段靠硬编码键名集合走资源选择 | `FieldRenderer.vue（32–34 `RESOURCE_KEYS`、44–46）` |
| 已有"提交式"控件：失焦/回车才提交 | `EDITOR:src/components/fields/CommitNumberField.vue（23–45）`、`CommitTextField.vue` |
| `MapField` 编辑任意对象（STRUCT 的通用入口） | `EDITOR:src/components/fields/MapField.vue` |

问题：

1. 类型分支与 schema 不符：新 schema 里 `position`/`bezier_curve`/`tristate` 不会出现；`struct` 反而没有入口（落到 `default → StringField`，会把对象变成 `"[object Object]"`）。
2. `ref` 的补全靠键名硬编码，新增 `ref` 字段就丢补全。
3. 没有 `nullable_float` 的"启用/不启用"控件（旧 `tristate` 语义不同：三态 vs 可空数值）。

### 2.2 目标

1. 类型 → 控件是**穷举映射**（9 种，无 `default` 兜底到字符串）。
2. `ref` 的补全按"字段名 + 注册表类型"配置化，不散落在组件里。
3. `nullable_float` 有明确的启用开关（关闭 = 写 `null`）。
4. 提交语义统一：编辑中的草稿不写文档；提交失败显示原因并保持草稿。
5. 只读显示（`interp`、`mode`、`type`）与可编辑值分区。

### 2.3 非目标

- 不做复合控件（`position.x/y/z` 三轴联动面板归 07-PositionEditor；本文件只提供单轴数字控件）。
- 不做路径几何表单（07）。
- 不做模型参数表单（07-MathModelEditor）。

## 三、方案

### 3.1 类型 → 控件映射（穷举）

| `PropertyType` | 控件 | 读取的 schema 字段 | 提交值 |
|---|---|---|---|
| `FLOAT` | `CommitNumberField` | `min`/`max`/`unit`/`step?` | number（有限） |
| `INT` | `CommitNumberField`（`step=1`） | `min`/`max` | number（整数） |
| `BOOL` | `BoolField`（开关） | — | boolean |
| `STRING` | `StringField` 或 `ResourceStringField`（按配置） | `required` | string |
| `ENUM` | `EnumField`（下拉） | `enumValues` | string |
| `REF` | `RegistryStringField` 或形态下拉（07-PointSourceForms） | 配置表 | string |
| `NULLABLE_FLOAT` | `NullableNumberField`（提案）：开关 + 数字 | `min`/`max`/`unit` | number 或 `null` |
| `STRUCT` | `StructField`（提案）：JSON 树编辑 / 原文编辑 | — | 嵌套 JSON |
| `EVENT_RECORD` | 不在此表单（06-EventRecordEditor） | — | — |

`EVENT_RECORD` 的属性不出现在"值表单"里：它的值只存在于 `keyframes[].value`。

### 3.2 提交语义

| 控件 | 提交时机 | 取消 |
|---|---|---|
| 数字 | 失焦 / 回车 | Esc 恢复原值 |
| 文本 | 失焦 / 回车 | Esc |
| 下拉/开关 | 立即（值离散，无草稿） | — |
| 可空数字 | 开关立即；数字同数字控件 | Esc |
| STRUCT | 显式"应用"按钮（树编辑）/ 失焦（原文编辑） | 取消按钮 |

提交失败（类型/范围）：显示内联错误，保持草稿，**不写文档**，`dirty` 不变。

编辑目标必须显式区分静态value、已有节点及明确添加节点。schema为VALUE，或ANIMATED当前处于未启用动画的常量形态时，正常值编辑走object.setValue；已启用动画时，选中节点或播放头精确命中节点走object.setKeyframeValue，不存在节点则先让作者明确添加，再调用既有addKeyframe。作者若明确编辑底层value须显示“有帧时不参与采样”，不能冒充动画当前值。事件仍交EventRecordEditor，不由通用表单猜载荷。

### 3.2a 快捷属性与同值命令

SelectionPropertiesPanel.vue按05的selection.properties宿主及02共享Selection展示当前项常用参数：片段基础控制复用05片段命令，组/叶子/节点复用本控件集。组只是UI组织，不造第二份对象或组帧。它与ClipEffectControlsPanel可以同时可见，但不另带节点标尺、帧带或节点历史；完整动画编辑通过reveal定位效果控件。

提案PropertyEditTargetResolver输入clipKey、完整路径、schema mode、可选nodeTime/局部播放头和docRevision，输出明确的value/node/add意图或不可编辑原因；两面板共用。输入草稿按完整目标及修订隔离，切片段/节点、失效引用或外部更新时处理取消/冲突，不把旧草稿提交给新选择；回显不能覆盖正在输入的草稿。提交一次只走一次02命令，两处同步回显并共享撤销，取消/失败不清脏或制造历史。

### 3.3 单位与范围

- `unit === 'degree'` → 显示 `°` 后缀；输入不自动归一（运行时不归一，`J:math/AngleUtil.java（16–25）` 只在插值时折最短弧）。
- `min`/`max`：`CommitNumberField` 的 `min`/`max` 属性（原生 input 约束）+ 提交时校验；越界**拒绝**（不静默钳制）。注意运行时 `ObjectValidator.checkRange（408–422）` 也是报错而非钳制。
- `INT` 的 `step=1`；非整数输入拒绝。

### 3.4 `ref` 的补全配置（提案）

```ts
// EDITOR:src/model/refBindings.ts（提案）
export interface RefBinding {
  path: string                  // 精确路径或前缀（如 'selector_'）
  registryKind: 'target' | 'entity' | 'structure' | 'item' | 'block' | 'sound' | 'biome' | 'dimension' | 'advancement'
  freeText: boolean             // 是否允许手输（选择器/@p/uuid:）
}
```

当前 schema 的 `ref` 路径（`TrackSchemas`）：

| 路径 | 期望形态 | 建议绑定 |
|---|---|---|
| `position_origin` | 五形态串 | 形态下拉 + 载荷（07-PointSourceForms）；`registryKind='target'` 给选择器 |
| `facing_target` | 五形态串 | 同上 |
| `facing_entity` | 实体选择器 | `entity`，`freeText=true` |
| `yaw_base_selector` | 实体选择器 | `entity`，`freeText=true` |
| `yaw_base_from` / `yaw_base_to` | 五形态串 | 同 `position_origin` |
| `look_at_selector` | 实体选择器 | `entity`，`freeText=true` |

未列出的 `ref` 路径：允许自由文本 + 警告"该引用形态未在编辑器中约束"（不阻断）。

### 3.5 `STRUCT` 的两种编辑模式

| 模式 | 适用 | 行为 |
|---|---|---|
| 结构化子表单 | 有专用编辑器的路径（`modifier`、`transition_params`、`motion_*`、10 条曲线、`gradient`） | 由 07/10 的专用组件提供；本文件只提供挂载点 |
| 原文编辑 | 其余（`data`、未知 struct） | JSON 文本域 + 语法校验；提交时 `JSON.parse`，失败不写 |

**关键**：STRUCT 值原样透传（02-AnimObject §3.5），编辑器不得"规范化"（不重排键、不补默认、不删空数组）。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `controlFor(def): Component` | 声明 | 控件组件（穷举，无 default） |
| `validateValue(def, value): string \| null` | 声明 + 值 | 错误文案或 null |
| commitValue(target, draft) | 明确value/node/add目标+schema+草稿 | 经PropertyEditTargetResolver调用既有object.setValue/setKeyframeValue或明确addKeyframe，不清帧、不隐式补别的叶子 |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/objects/PropertyValueForm.vue`（提案）。
2. 新建 `EDITOR:src/components/fields/NullableNumberField.vue`、`StructField.vue`（提案）。
3. 新建 `EDITOR:src/model/refBindings.ts`（提案）：§3.4 配置表。
4. 改 `EDITOR:src/components/fields/FieldRenderer.vue`：删掉 `tristate`/`position`/`bezier_curve`/`map`/`object` 分支与 `REGISTRY_KEYS`/`RESOURCE_KEYS` 硬编码；改为读 `refBindings` 与 `PropertyType` 穷举。
5. 删除 `EDITOR:src/components/fields/TristateField.vue`（若仅被旧 schema 使用；`meta.hide_*` 已移除，见 `MOD:docs/SCRIPT_FORMAT.md §7`）。
6. 删除 `EDITOR:src/components/fields/PositionField.vue`、`BezierCurveField.vue`（旧复合控件；位置三轴归 07-PositionEditor，贝塞尔归 07-PathGeometryForms）。
7. `MapField` 保留但只作为 `StructField` 的"树编辑"实现之一。
8. 新建SelectionPropertiesPanel.vue与PropertyEditTargetResolver（提案）作为本模块紧耦合职责，挂接05独立快捷属性宿主；效果控件参数行使用同一PropertyValueForm，不把两者做成只可二选一的旧tab。
9. 人工同时打开两面板，编辑同一属性的常量/已有节点/明确新增节点，检查同步回显、一次撤销、取消/错误、快速换目标和未提交中文输入；主时间轴始终没有节点操作。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/fields/`（提案）：9 种控件；AUI 原生控件优先。
2. 同 `validateValue` 判定；错误文案对齐 `ObjectCodec`（如 `需要有限数字`）。

### 4.4 禁止修改

- 不新增"未知类型 → 字符串"的兜底。
- 不自动钳制到 `min`/`max`。
- 不把 STRUCT 值规范化。
- 不在输入过程中写文档（只提交时）。
- 不给 `EVENT_RECORD` 做值表单。

## 五、正反例验收

### 5.1 正例

1. `yaw`（`float`，`unit=degree`）输入 `90` → 显示 `90°`，提交写 `{"value":90}`。
2. `yaw` 输入 `abc` → 拒绝，草稿保留，内联错误"需要有限数字"。
3. `zoom`（`float`，`min` 无）输入 `-1` → 允许（schema 无 min；运行时不限制）。
4. `opacity`（OVERLAY，`min=0,max=1`）输入 `1.5` → 拒绝。
5. `position_mode`（`enum`）→ 下拉只有 `relative`/`absolute`（来自 `enumValues`）。
6. `yaw_lock`（`nullable_float`）默认 `null` → 开关关；打开后输入 `45` → 写 `{"value":45}`；关闭 → 写 `{"value":null}`。
7. `modifier`（`struct`）→ 挂载专用编辑器；`data`（`struct`，MOD_EVENT）→ 原文编辑，JSON 语法错误时拒绝提交。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| 未知 `type` 落到 `StringField` | 禁止（穷举，缺控件即开发期错误） |
| `opacity` 输入 1.5 被静默改成 1 | 禁止（拒绝） |
| `modifier` 提交时把键排序、删空数组 | 禁止（原样） |
| `yaw_lock` 关闭时写 `{"value":0}` 而不是 `null` | 禁止（0 = 锁在 0°，语义不同） |
| 输入过程中每敲一个字符写一次文档 | 禁止（撤销会爆） |
| `ref` 路径新增后补全失效 | 禁止（配置表覆盖） |

### 5.3 异步关键帧专项

**正例**：作者在明确标为“底层value（有帧时不参与采样）”的详情中修改yaw.value，文档只改value不改节点；正常动画当前值控件则解析为指定节点或明确添加意图，不能默认落到这个不参与采样的value。

- 期望：改 `value` 不改变任何 `keyframes`；`script.validate` 通过。

**反例**：改 `value` 时把 `keyframes` 清空"让它生效"。

- 期望：禁止（需显式"关闭动画"命令）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；打开 CAMERA 片段。
2. 改 `yaw` 为 90、`opacity` 为 1.5（应被拒）、`yaw_lock` 打开并设 30。
3. 保存；`script.validate` → `ok:true`。
4. 游戏内播放：相机 yaw 90°、pitch 按锁值 30° 生效（`OrientationEvaluator.manual 81–99`）。
5. 关闭 `yaw_lock` 再保存；播放确认不再锁。

通过判定：第 2 步 `opacity` 被拒；第 3 步通过；第 4/5 步行为可见差异。

## 七、完成定义

1. PropertyValueForm.vue、NullableNumberField.vue、StructField.vue、refBindings.ts以及SelectionPropertiesPanel/PropertyEditTargetResolver职责齐备；效果控件和快捷属性使用同一控件与命令目标，无第二条节点轴。
2. `FieldRenderer.vue` 无旧类型分支、无硬编码键名集合。
3. `TristateField.vue` / `PositionField.vue` / `BezierCurveField.vue` 已删除或停用。
4. §5 的 7 条正例、6 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体控件集与判定一致（同一值集结果相同）。
7. 两面板同值同步、无节点时明确添加、草稿不串写、取消/失败不改文档及主时间轴无节点入口均经人工检查；不以字段控件能显示替代整合完成。
