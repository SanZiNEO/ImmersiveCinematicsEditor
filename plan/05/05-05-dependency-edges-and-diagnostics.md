# 05-05 依赖边与诊断

## 目标

把图上的线做成可解释的依赖：每条边能追到真实触发器、具体 `requires` 条目、目标脚本；缺失、自引用、重复 id、未知触发器都有明确提示；可维护的内置前置与只读的自定义前置分级清楚。图不靠“拖一条线”隐式改依赖。

## 边模型

前端从 05-01 的 `GraphEdge` 派生 `EdgeDescriptor`：

```ts
interface EdgeDescriptor {
  key: string
  fromNodeId: string
  toNodeId: string
  fromScript: string
  toScript: string
  triggerIdentity: string
  triggerIndex: number
  requirementIndex: number
  triggerType: string
  requirementType: string
  state: 'normal' | 'crossFolder' | 'back' | 'cycle'
  path: string                 // SVG d
}
```

- `key` 必须包含 `from/to/triggerIdentity/requirementIndex`，不能用数组下标或只按 `from>to` 去重，否则同一对脚本多条前置会被吞。
- `back=true`：目标拓扑层 ≤ 源层；可能是环内边或逆流边，不单独判错。
- `cycle`：两端在同一 SCC 或自环；由布局的 `inCycle` 决定。
- `crossFolder`：两端 folder 不同；只影响样式，不影响语义。
- 边绘制方向：被依赖脚本（前置）→ 依赖方脚本；箭头指向依赖方；不反向。

## 边浮层

悬停边或点击边（细线命中 8px 宽透明热区）：

```text
依赖：<fromScript> → <toScript>
触发：<triggerType>（identity 小字，诊断模式）
前置：<requirementType> → <targetScript 或 “自定义/缺失”>
位置：<to.path> · 触发器 #<triggerIndex> · requires[<requirementIndex>]
状态：正常 / 跨文件夹 / 回流 / 环内 / 缺失 / 自引用 / 重复 id
[定位到依赖方] [定位到前置] [复制诊断]
```

- `定位到依赖方`：选中 `to` 节点并居中；不打开文档。
- `定位到前置`：选中 `from` 节点；若目标缺失，无节点可定位，只显示原因。
- `复制诊断`：复制一行 `from -> to | triggerIdentity | requirementIndex | message`，供作者贴日志。
- 浮层不提供“删除这条依赖”按钮；删除走 05-07 的维护对话框，且必须选到具体 `requires` 条目。

## 悬空桩

`dangling` / `self_reference` 不画成完整边，画成节点侧边的“悬空桩”：

- 在依赖方节点右侧（或靠近触发器的方向）画 24px 虚线短桩 + 警告徽标；不指向空白节点。
- 悬停短桩显示：目标 id、触发器类型、`requires` 下标、原因（缺失/自引用）。
- 点击短桩选中依赖方节点，并在 warnings 面板定位该条；不创建假节点。
- 同一节点多条悬空桩沿右侧纵向排队，最多显示 5 条，超出显示 `+N`；点击 `+N` 打开 warnings 列表。
- 短桩不参与布局包围盒计算；不把画布撑大。

## 诊断分级

| 类型 | severity | 图上呈现 | 可维护 |
|---|---|---|---|
| `dangling` | warn | 悬空桩 + warnings | 目标可重建则 05-07 可改；否则只读 |
| `self_reference` | warn | 自环短桩 + 节点 `环` | 只读，提示删除/改目标 |
| `duplicate_id` | warn | 两个节点都标 `!`/重复徽标；边可能只解析到先扫到的节点 | 只读；改 id 走 05-06 |
| `unknown_trigger` | warn | 节点触发器 chip 打 `?`；不画边 | 只读 |
| `invalid` | error | 节点 `!` + 错误条 | 只读；修复文件/刷新 |
| `custom requirement` | info | 不画边；节点浮层显示“自定义前置” | 只读 |

- warnings 面板按 `kind` 分组：`invalid`、`duplicate_id`、`dangling`、`self_reference`、`unknown_trigger`；每组显示数量、路径、消息。
- 单条可“定位”：选中节点/边、居中、打开浮层；不能定位的只显示原文 + 复制。
- `stats.warningCount` 是截断前真实总数；列表最多 200 条；超出显示“还有 N 条未显示，复制全部”。
- 诊断不自动修复、不自动删除坏条目；只呈现。

## 可维护性

- `GraphRequirement.editable=true` 仅限：
  - 类型是 `script_played` / `script_started` / `script_completed`；
  - `script` 非空；
  - 目标脚本存在且 `meta.id` 唯一；
  - 触发器 identity 可定位。
- `editable=false` 的原因：
  - `custom`：自定义前置，没有脚本 id；
  - `missing_target`：目标不存在；
  - `self`：自引用；
  - `duplicate_target`：目标 id 重复，无法确定改哪一个；
  - `unknown_trigger`：触发器类型未注册。
- 只读条目仍显示在浮层/维护面板；不提供“编辑”按钮，不把值清空。
- 可写条目的编辑入口只在 05-07 的 `DependencyMaintenanceDialog`；图上不出现输入框/下拉。

## 拖线禁令

- 图不支持从节点拖一条线到另一个节点来新增依赖；拖动节点只移动布局。
- 不支持拖线删除依赖；删除必须选具体 `requires` 条目。
- 不支持“拖到空白创建脚本”；空白双击/菜单只打开新建脚本命令。
- 任何依赖写入都必须经过 05-07 的 `script.requires.mutate`，带 `triggerIdentity + requiresFingerprint`，不能只传 `from/to`。

## 验收标准

- 同一触发器有两条不同目标 `requires`：两条边，key 不同；悬停能分别定位到 index 0/1。
- 同一对脚本重复两条相同 `requires`：图只画一条边，但 `GraphRequirement` 两条都保留；浮层显示两条 index。
- 目标缺失：不画完整边；节点右侧悬空桩；悬停显示目标 id + 原因；不创建假节点。
- 自引用：节点 `环` 标记 + 自环短桩；不画指向自己的完整边。
- 重复 `meta.id`：两个节点都标重复；边只解析到先扫到的节点；浮层提示“目标 id 重复，无法确定”。
- 自定义前置：无边、无悬空桩；节点浮层显示“自定义前置，只读”；不显示“缺失”。
- 未知触发器：触发器 chip 打 `?`；不画边；warnings 有 `unknown_trigger`。
- 边命中：8px 热区可点；浮层定位依赖方/前置；复制诊断内容完整。
- 折叠泳道：边端点吸附折叠标题条；悬空桩不画到空白。
- `grep drag`：没有“拖线创建依赖”的 pointer 处理；拖动只改节点坐标。
- `grep editable`：只读条目没有编辑入口；可写条目入口只在 05-07 对话框。

## 边与诊断范围

- 依赖边只从内置 `requires` 生成；自定义前置、命令文本、`play_mode`、事件类型不建边。
- 悬空目标画空心桩；缺失脚本不被自动创建。
- 依赖编辑走 05-07 对话框；图内不提供输入框/下拉。
- 重复 id、自引用只提示；修复由作者操作。
- 边的曲线由布局算正交/贝塞尔路径；不提供手工路由编辑。
- warnings 放在图内入口 + 可展开列表；不占常驻横幅。
