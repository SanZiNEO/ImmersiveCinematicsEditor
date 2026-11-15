# 07-09 数学模型编辑器

## 目标

给 CAMERA 片段的 6 个 `motion_*` 值字段编辑数学模型：

- `motion_position`（vector）
- `motion_yaw`（angle）
- `motion_pitch`（angle）
- `motion_roll`（angle）
- `motion_fov`（scalar）
- `motion_zoom`（scalar）

这些是 `VALUE` + `STRUCT`，没有关键帧、没有时钟，永远只出现在属性面板；模型编辑用侧编辑面板，不占效果面板。

## 数据模型

```ts
type MathModelDoc =
  | { type: 'linear' }
  | { type: 'smoothstep' }
  | { type: 'ease_in' }
  | { type: 'ease_out' }
  | { type: 'ease_in_out' }
  | { type: 'cubic_bezier'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'exponential_smooth'; tau: number }
  | { type: 'spring' | 'inertia'; stiffness: number; damping: number; initial_velocity: number }
  | { type: 'chain'; models: MathModelDoc[] }
  | { type: 'blend'; a: MathModelDoc; b: MathModelDoc; weight: number }
```

`motion_*` 的挂法：

```json
{
  "motion_position": {
    "value": {
      "type": "chain",
      "models": [
        { "type": "exponential_smooth", "tau": 0.2 },
        { "type": "spring", "stiffness": 6.0, "damping": 0.9, "initial_velocity": 0 }
      ]
    }
  }
}
```

- `value` 是模型对象；没有 `keyframes`。
- 模型对象只写 `type` + 该类型参数；不写 `authoring`、不写 UI 状态。
- `chain.models` 递归；`blend.a/b` 递归。
- 字段缺失 = 该通道无模型；不是 `linear` 的显式值。

## 通道

| 字段 | 值域 | UI 摘要 |
|---|---|---|
| `motion_position` | vector | `chain(spring → linear)` |
| `motion_yaw` | angle | `spring(k=8, d=0.75)` |
| `motion_pitch` | angle | `exponential_smooth(τ=0.15)` |
| `motion_roll` | angle | `blend(spring, exp, w=0.5)` |
| `motion_fov` | scalar | `linear` |
| `motion_zoom` | scalar | `cubic_bezier(0.42,0,0.58,1)` |

- 行内只显示类型 + 关键参数摘要；不展开整棵树。
- 点击行或“编辑模型”打开 `ModelEditorSheet`。
- 每行右侧显示值域徽标、fallback 警告、节点数。
- 6 行都在属性面板 `motion` 组；没有时钟图标、没有“添加首帧”。

## 模型目录

| 类型 | 参数 | 默认 |
|---|---|---|
| `linear` | 无 | — |
| `smoothstep` | 无 | — |
| `ease_in` | 无 | — |
| `ease_out` | 无 | — |
| `ease_in_out` | 无 | — |
| `cubic_bezier` | `x1` / `y1` / `x2` / `y2` | 取 `CubicBezierCurve` 常量 |
| `exponential_smooth` | `tau` | 取 `ExponentialSmoothModel` 常量 |
| `spring` | `stiffness` / `damping` / `initial_velocity` | 取 `SpringModel` 常量 |
| `inertia` | 同 `spring` | 取 `InertiaModel` 常量 |
| `chain` | `models`（子模型数组） | 至少 1 个 |
| `blend` | `a` / `b` / `weight` | `weight` 取 `BlendModel` 常量 |

参数表从 `MathModelRegistry` / 02 字段目录派生；编辑器不手写第二份注册表。

## 侧编辑面板

```text
┌ 编辑模型：motion_position ─────────────────────────┐
│ 值域 vector   节点 3/32   深度 2/8                  │
│ 类型 [ chain ▼ ]                                   │
│ 子模型                                            │
│   1 [ exponential_smooth ▼ ]  tau [0.200]  [×]     │
│   2 [ spring ▼ ]  k [6.0] d [0.9] v [0]    [×]     │
│   [+ 添加子模型]                                   │
│ [预览响应] [重置为 linear] [应用]                  │
└────────────────────────────────────────────────────┘
```

- 从属性面板 `motion` 行打开；右侧滑出，宽度 420~560；不新建 layout panel。
- 关闭不丢草稿；按 `clipKey + objectPath` 保存草稿。
- “应用”一次 `commit`；一次撤销。
- “重置为 linear”确认后把 `value` 写 `{type:'linear'}`；可撤销。
- 标题显示当前通道与值域；不显示关键帧控件。

## 参数控件

| 类型 | 控件 |
|---|---|
| `cubic_bezier` | 四个 0~1 数值 + 小曲线预览 |
| `exponential_smooth` | `tau > 0` |
| `spring` / `inertia` | `stiffness > 0`、`damping >= 0`、`initial_velocity` 有限数 |
| `blend` | `weight` 0~1；`a` / `b` 各一个子模型编辑块 |
| `chain` | 子模型列表；可增删、上移/下移；至少 1 个 |
| 无参类型 | 只显示类型说明 |

- 参数输入即时校验；类型错 block，不写盘。
- `cubic_bezier` 的小预览只画 [0,1] 曲线，不参与运行时。
- `blend` 的 `a/b` 递归使用同一 `ModelEditorNode`；不复制表单。
- `chain` 的每个子模型可再嵌 `chain/blend`，但受深度/节点限制。

## 递归限制

```text
depth(model, d=1):
  if d > 8 → 超限
  count += 1
  if count > 32 → 超限
  chain.models / blend.a / blend.b → depth(d+1)
```

- 侧面板显示“深度 d/8、节点 n/32”。
- 超限时本地 block，应用按钮禁用；显示具体路径。
- `chain.models` 为空 block；`blend.a/b` 缺失 block。
- 循环引用在 JSON 树里不可能出现；导入的循环对象在解析阶段报错，不进入面板。
- 超限不自动截断，不静默改结构。

## 回落与警告

| 情况 | 处理 |
|---|---|
| 未知模型 `type` | 运行时回落 `linear`；编辑器 `warn`，行显示“未知类型，实际 linear” |
| 未知参数名 | 运行时忽略；编辑器 `warn`，保留原字段不写丢 |
| 已知参数类型错 | block，字段定位 |
| 值域不匹配 | 运行时回落 `linear`；编辑器 `warn`，显示“当前通道值域 vector” |
| 深度/节点超限 | block；运行时不保证 |
| `chain` 空 / `blend` 缺分支 | block |
| `weight` 越界 | block |

未知模型不自动改写成 `linear`；作者可以点“转为 linear”显式替换。未知参数不自动删除；作者可以点“清理未知参数”显式移除。

## 响应预览

- 侧面板“预览响应”按当前模型画一条 0→1 的标量响应曲线；vector 通道画三轴分量或模长。
- 预览只读，不写盘；不替代游戏内实际运动。
- `chain`/`blend` 递归采样；深度/节点超限时不画。
- 预览坐标轴为输入 0→1、输出归一化；不承诺运行时状态初值/历史。
- 状态型模型（spring/inertia）预览用零初值、单位阶跃；显示“示意”。

## 与其他模块

- 属性面板：`motion` 组 6 行；没有效果面板入口。
- 效果面板：`motion_*` 永不进入；`grep motion_position` 在效果面板组件 0 命中。
- 路径/几何：模型编辑器不读写 `paths[]`；`motion_*` 只作用于相机通道。
- 序列化：模型对象按 03-04 原样写；不写默认值、不写 `authoring`。

## 组件

```text
src/components/motion/
  MotionModelGroup.vue        6 行摘要
  MotionModelRow.vue          类型/参数摘要/警告
  ModelEditorSheet.vue        侧编辑面板
  ModelEditorNode.vue         递归模型节点
  ModelParamFields.vue        按类型参数控件
  ModelResponsePreview.vue    0→1 响应示意
src/model/motion/
  mathModelDoc.ts             类型/参数/默认值
  mathModelValidation.ts      类型错/未知/深度/节点/值域
  mathModelSummary.ts         行摘要
  mathModelResponse.ts        预览采样
```

- `mathModelDoc.ts` 从 02 模型目录派生；不硬编码第二份。
- `ModelEditorNode` 递归；`chain/blend` 共用。
- `MotionModelRow` 只显示摘要和入口；不展开参数。
- 按 02 模型目录渲染；不读额外显隐表。

## 验收

1. 6 个 `motion_*` 默认无模型：属性面板显示“未设置”，无时钟；效果面板 0 行。
2. `motion_yaw` 设 `spring(k=8,d=0.75,v=0)`：行摘要 `spring(k=8, d=0.75)`；保存 JSON 正确。
3. `motion_position` 设 `chain([exponential_smooth(tau=.2), spring(...)])`：摘要 `chain(exp → spring)`；保存嵌套数组。
4. `motion_roll` 设 `blend(a=spring,b=exp,weight=.5)`：a/b 递归可编辑；weight 0/1 可用，1.2 block。
5. `motion_fov` 设 `linear`：摘要 `linear`；保存 `{type:'linear'}`。
6. `motion_zoom` 设 `cubic_bezier` 默认：四参数有默认值；x1/y1/x2/y2 越界 block。
7. `chain` 添加 3 个子模型，再嵌 `chain`：深度/节点计数正确；第 9 层 block。
8. `chain` 节点总数 33：应用按钮禁用；显示超限路径。
9. `chain.models=[]`：block；`blend` 缺 `a` 或 `b`：block。
10. 未知类型 `{type:'foo'}`：行显示“未知类型，实际 linear”；不自动改写；点“转为 linear”后保存。
11. 未知参数 `{type:'spring', foo:1}`：warn；保留 `foo`；点“清理未知参数”后移除。
12. `tau=-1`、`stiffness=0`、`damping=-1`：字段级 block。
13. `motion_yaw` 放 `linear` 正常；值域不匹配的模型显示 warn，不 block。
14. 重置为 linear：一次撤销恢复旧树。
15. 关闭/重开侧面板：草稿按通道恢复；文档未提交改动不落盘。
16. 效果面板 0 个 `motion_*` 行；主时间轴 0 个 `motion_*` 控件。
17. 保存重开：6 个模型树、参数、未知字段原样保留；没有默认值补写、没有 `authoring`。
