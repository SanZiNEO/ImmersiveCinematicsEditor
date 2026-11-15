# 06-03 参数与值控件

## 目标

用一套 `PropertyValueForm` 同时服务属性面板的静态值和效果面板的节点值。控件按 02-04 的九种值类型穷举映射，不出现“未知类型落到文本框”的兜底。每个提交必须解析成明确目标：静态 `value`、指定节点、或显式新增节点；面板归属由 `panelMembership` 决定，不由控件猜。

## 组件

```text
src/components/effects/PropertyValueForm.vue
src/components/effects/fields/
  CommitNumberField.vue
  BoolField.vue
  CommitTextField.vue
  EnumField.vue
  RefField.vue
  NullableNumberField.vue
  StructField.vue
src/effects/valueTarget.ts
src/effects/refBindings.ts
src/effects/stepFields.ts
```

```ts
interface PropertyValueFormProps {
  row: PropertyRow
  panel: 'properties' | 'effects'
  target: PropertyEditTarget
  readonly?: boolean
  density: 'normal' | 'compact'
}
```

事件：`commit(draft)`、`cancel()`、`requestAddKeyframe(time)`、`requestEnableAnimation(time)`。

## 类型映射

| `PropertyType` | 控件 | schema 字段 | 提交 |
|---|---|---|---|
| `FLOAT` | `CommitNumberField` | `min/max/unit/step` | 有限 number |
| `INT` | `CommitNumberField` | `min/max`，`step=1` | 整数 |
| `BOOL` | `BoolField` | — | boolean |
| `STRING` | `CommitTextField` | `required` | string |
| `ENUM` | `EnumField` | `enumValues` | 枚举值 |
| `REF` | `RefField` | `refBindings` | 非空形态串 |
| `NULLABLE_FLOAT` | `NullableNumberField` | `min/max/unit` | number 或 `null` |
| `STRUCT` | `StructField` | — | 原样 JSON 对象/数组 |
| `EVENT_RECORD` | 不进入本表单 | — | 由 06-07 编辑 |

- `unit==='degree'` 显示 `°`，输入不归一化。
- `min/max` 越界拒绝，不自动夹取。
- `INT` 非整数拒绝；`FLOAT` 非有限数拒绝。
- `ENUM` 的 `enumValues` 为空时控件禁用并显示“schema 缺少枚举值”。
- `REF` 的补全来自 `refBindings`：`{ pathPrefix, registryKind, freeText }`；未配置的 ref 允许自由文本，但显示“未约束形态”。

## 目标解析

```ts
type PropertyEditTarget =
  | { kind:'value'; clipKey:string; path:string }
  | { kind:'keyframe'; clipKey:string; path:string; time:number }
  | { kind:'addKeyframe'; clipKey:string; path:string; time:number }
```

`resolveTarget({ row, panel, playheadLocal, selection, docRevision })`：

| 面板/row 状态 | 播放头状态 | 目标 |
|---|---|---|
| 属性面板，`present=false` | — | `value`；提交时 `object.add` 创建对象 |
| 属性面板，`mode=value` | — | `value` |
| 属性面板，`mode=animated`、`keyframes=[]` | — | `value`；时钟按钮走 `object.enableAnimation` |
| 属性面板，`mode=animated`、有帧 | — | 该属性已在效果面板；属性面板不显示重复行，显示“在效果面板”定位入口 |
| 效果面板，动画行、播放头有节点 | `abs(time-playhead)<=1e-4` | `keyframe` |
| 效果面板，动画行、播放头无节点 | — | `addKeyframe`；输入草稿保留，点“添加帧”才提交 |
| 效果面板，`mode=event` | — | 不进入值控件；转 06-07 |
| 未知路径 | — | 只读 |

规则：

- 属性面板的未设置行：值控件显示“未设置”占位；提交时 `object.add` + `setValue` 一次完成。
- 属性面板的时钟：`object.enableAnimation` 在播放头建首帧，初值顺序为同属性已有节点 → 当前 `value` → schema `default`；没有合法初值则拒绝。
- 效果面板只显示已有关键帧的属性；目标只能是 `keyframe` 或 `addKeyframe`。
- 已动画属性不允许在属性面板里改一个“不参与采样”的 `value` 冒充动画；要改静态值，先在效果面板关闭动画。
- 同一个值控件在两个面板使用同一 `resolveTarget` 和同一命令，不缓存第二份值。

## 提交语义

| 控件 | 提交时机 | 取消 |
|---|---|---|
| 数字/文本 | 失焦或 `Enter` | `Esc` 恢复原值 |
| 开关/下拉 | 立即 | 无草稿 |
| 可空数字 | 开关立即；数字同数字控件 | `Esc` |
| STRUCT 原文 | `Ctrl+Enter` 或“应用” | “取消” |
| STRUCT 树编辑 | 每次叶子提交 | 叶子级 `Esc` |

提交失败：

- 内联错误显示在控件下方；草稿保留，焦点不跳走。
- `dirty` 不变；撤销栈不增加。
- 错误码：`type_mismatch`、`out_of_range`、`not_finite`、`int_required`、`enum_invalid`、`ref_empty`、`struct_invalid_json`、`default_missing`、`requires_unmet`、`readonly_unknown`、`row_in_other_panel`。

## 属性面板的静态值

- 属性面板列出全部未在效果面板的适用叶子；未设置也显示；已有关键帧的叶子只在效果面板。
- `VALUE`：直接编辑静态值；没有时钟。
- `ANIMATED` 且 `keyframes=[]`：编辑静态值；时钟可用；显示“动画轨道无帧”。
- `ANIMATED` 且 `keyframes.length>0`：该行已移入效果面板；属性面板显示“在效果面板”入口，不重复值控件。
- `EVENT`：显示“记录”入口；完整记录编辑在效果面板。
- `STRUCT`：只允许 `value` 形态；没有时钟。

## 效果面板的节点值

- 动画行：播放头精确命中节点时编辑节点值；无节点时只保留草稿，点“添加帧”才提交。
- 事件行：不进入通用值控件；打开 06-07 记录编辑器。
- 组内静态伴随行（`group` 策略）：显示静态值；没有节点组；编辑走 `object.setValue`。

## 未设置与初始化

- 属性面板未设置叶子：输入 → `object.add` + `setValue`；初始值来自输入，不用默认值冒充作者输入。
- 点时钟 → `object.enableAnimation`：
  - 若 `default`/`value` 存在，首帧取该值；
  - 若同属性播放头已有节点，取该节点值；
  - 都没有 → `default_missing`，要求先输入静态值。
- `ANIMATED` 初始 `keyframes=[]` 是合法静态形态；不自动补帧。
- 属性面板不提供“添加属性”弹层；未在效果面板的适用叶子已经在列表里。

## step 与切换字段

`stepFields.ts`：

```ts
const SPACE_SWITCH_FIELDS = [
  'position_mode', 'position_space', 'position_origin',
  'position_origin_freeze', 'facing_source'
]
const BASE_SWITCH_FIELDS = [
  'facing_target', 'facing_target_freeze', 'facing_entity',
  'look_at_freeze', 'yaw_base_from_freeze', 'yaw_base_to_freeze'
]
```

- `interp==='step'` 行显示台阶图标 `⌐`；节点用枚举/开关/离散值控件；不显示连续缓动入口。
- 改 `SPACE_SWITCH_FIELDS`（`t>0`）时，调用 `switchImpact(doc, clipKey, path, time)`：
  - 若 `position.x/y/z` 缺任一帧，弹出“参考系切换需要三轴位置帧”，提供“补齐三轴（值取切换前采样近似，标记近似）”和“取消”。
  - 选择补齐时一次命令写入三帧；取消不改文档。
- `BASE_SWITCH_FIELDS` 只在 `position_space==='base'` 时检查同样三轴。
- `t=0` 的初始值不算切换。

## STRUCT

- 有专用编辑器的路径（`modifier`、`transition_params`、`motion_*`、调色曲线、`gradient`）挂载专用组件；本表单只给挂载点。
- 其余路径用 `StructField`：
  - 树编辑：键值树，支持嵌套对象/数组/布尔/数字/null。
  - 原文编辑：JSON 文本域；提交时 `JSON.parse`，失败不写。
- 原样透传：不重排键、不补默认、不删空数组、不把数字转字符串。
- `STRUCT` 不允许关键帧；默认 `leaf` 模式下属性面板不显示时钟、效果面板不出现该行；`group` 模式下只作为静态伴随行，无时钟、无节点组。

## 验收

1. `yaw` 输入 `90`：显示 `90°`；提交后文档 `yaw.value=90`；其他叶子不变。
2. `yaw` 输入 `abc`：拒绝，草稿保留，错误 `type_mismatch`；文档和撤销栈不变。
3. `opacity` 输入 `1.5`（max=1）：拒绝 `out_of_range`，不夹到 1。
4. `yaw_lock` 关闭开关：写 `value:null`；再打开输入 45：写 `value:45`；显示 `—（不锁）`，不显示 0。
5. `position_mode` 下拉只出现 `relative/absolute`；直接输入非法值被拒。
6. `modifier` 用专用编辑器；`data` 用原文 JSON；语法错误不写文档。
7. 属性面板未设置 `position.y` 输入 2：创建对象并写值；行变已设置；一次撤销恢复“未设置”。
8. 属性面板点 `position.x` 时钟：首帧在播放头创建；效果面板出现 x 行；属性面板 x 行变“在效果面板”。
9. 效果面板 `yaw` 播放头无节点：输入值只保留草稿；点“添加帧”才建帧；取消不写。
10. 效果面板关闭 `yaw` 动画：删帧保留值；属性面板出现 yaw 静态值；一次撤销恢复。
11. `position_space` 在 `t=2` 切换且缺 `position.y/z`：弹出补齐对话框；取消不改文档；补齐后三轴帧同刻存在。
