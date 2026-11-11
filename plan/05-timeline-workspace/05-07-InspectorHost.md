# 05-07 双宿主：片段效果控件与快捷属性（06 内容本体不在本轮）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 前置：02 唯一身份/Selection/命令、05-03 片段级导航适配、05-01 布局树；06 按本宿主合同实现 `clip.effects` 与 `selection.properties` 的内容。
> 本文件是 05 与 06 的唯一接口面：05 只交付**两个宿主**与契约，**不实现**属性表单、效果控件行/节点、局部时间视口、曲线手柄、规则表单。

## 1. 职责

提供两个独立、可同时停靠的宿主，并冻结「选中什么 → 每个宿主收到什么」的契约：

| 宿主 | 注册标识 | 负责 | 明确不负责 |
|---|---|---|---|
| 片段效果控件宿主 | `clip.effects` | 当前唯一有效片段的上下文解析、面板容器、空态/多选/失效/错误、焦点、停靠与尺寸约束；把完整 Selection 与命令面交给 06 | 属性组/叶子行、参数控件、节点几何/命中/拖动、局部标尺与虚拟化（06） |
| 快捷属性宿主 | `selection.properties` | 当前选中片段/组/叶子/节点的常用参数与「定位到效果控件」入口；复用 06 的字段控件与同一命令 | 第二套关键帧时间轴、单属性独占页、另一份值/选择缓存 |

两者不是同一个 tab 的二选一，也不被 `objectPath` 选区切成「只看单个属性」的页面：效果控件始终展示当前片段**全部适用**的组/叶子（06 内容），快捷属性只是一个补充入口。效果控件不继承旧检查器 280–560px 窄栏；它需要容纳左侧参数列与右侧对齐的节点列。

**参考输入**：[工作台/偏好/宿主适配](../references/03-workspace-preferences-host.md)的活动面板与焦点恢复，配合[属性关键帧适配](../references/02-olive-property-keyframes.md)的绑定解绑。宿主不另建选区所有者；切换片段/失效引用时清理旧订阅和过期结果，不能回显到错误属性。06 负责内容本体，本任务不提前实现或复制其表单/行/视口。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/App.vue:366–379` | 右面板 = `TabbedPanel` + 四个写死 tab（属性/片段/关键帧/触发器） |
| `EDITOR:src/store.ts:78` | `rightTab: 'properties' \| 'clip' \| 'keyframe' \| 'triggers'` |
| `EDITOR:src/store.ts:660–687` | `selectTrack/selectClip/selectKeyframe` **顺手改 `rightTab`**，把选择与面板耦合 |
| `EDITOR:src/components/PropertyPanel.vue:6–19` | 读 `state.schema.meta`（旧 schema 形状），`DynamicForm` 一把渲染 |
| `EDITOR:src/components/ClipPanel.vue:11–36` | 读 `schema.tracks[type].clips`（旧形状），`start_time/duration` 手工塞进 `allFields` |
| `EDITOR:src/components/KeyframePanel.vue:12–123` | 读 `clip.keyframes`（旧形状），一屏铺该帧所有字段 + 缓动下拉 + 飞控按钮；由 06 重写，不进入宿主 |
| `EDITOR:src/components/DynamicForm.vue:20–49` | `VISIBILITY_RULES` 硬编码字段显隐（旧字段名） |
| `EDITOR:src/components/fields/FieldRenderer.vue:23–59` | 按 `field.type` 分发 12 种控件；`REGISTRY_KEYS`/`RESOURCE_KEYS` 硬编码键名 |
| `MOD:docs/SCRIPT_FORMAT.md:106–141` | 每个对象叶子路径独立 `value`/`keyframes`；`time` 为片段局部秒 |
| `EDITOR:plan/shared/effect-controls-workspace.md` §3.1/§3.3/§4.1 | 两面板独立注册、可同时可见；效果控件不受旧右栏限制；单一状态与数据所有者 |
| `EDITOR:plan/shared/contracts.md` C08 | 属性独立关键帧、局部秒、严格递增、VALUE 不允许 keyframes |

## 3. 拟新建（提案）

| 文件 | 导出 | 职责 |
|---|---|---|
| `EDITOR:src/inspector/ClipEffectsHost.vue` | 组件 | `clip.effects` 宿主：片段上下文、内容槽、折叠、错误边界、焦点作用域容器 |
| `EDITOR:src/inspector/SelectionPropertiesHost.vue` | 组件 | `selection.properties` 宿主：当前项摘要槽、定位入口、折叠、错误边界、焦点作用域容器 |
| `EDITOR:src/inspector/useSelection.ts` | `useSelection()` | 订阅 02 选区、失效处理、跨宿主同步；不持有第二份选择 |
| `EDITOR:src/inspector/panelContract.ts` | 类型 + 注册表 | `DockPanelDefinition`、`PanelContext`、两个稳定 panelId |
| `EDITOR:src/inspector/HostEmpty.vue` | 组件 | 空态（无选中/多选/对象不存在） |
| `EDITOR:src/inspector/HostSkeleton.vue` | 组件 | 加载骨架（不得显示 0/默认值冒充数据） |
| `EDITOR:src/inspector/HostError.vue` | 组件 | 加载失败/失效引用 + 重试/撤销入口 |

**不新建** 任何效果控件行、节点标记、局部标尺或属性表单组件；这些属于 06（`06-ClipEffectControlsPanel`、`06-EffectControlsRows`、`06-PropertyValueForm`）。

## 4. 契约（06 必须按此实现）

### 4.1 宿主注册与接口

```ts
// 提案
type HostPanelId = 'clip.effects' | 'selection.properties'

interface DockPanelDefinition {
  id: string                        // 宿主与内容面板的稳定 id，不按 tab 下标
  titleKey: string                  // i18n key，中文长标签由 art-direction 约束
  order: number
  appliesTo(ref: Selection, ctx: PanelContext): boolean
  component: () => Promise<Component>   // 懒加载
}

interface PanelContext {
  selection: Selection              // 02共享主选区，只读
  clipKeys: readonly string[]       // 02会话批选，只读；节点批选也归02/06共享合同
  docRevision: number               // 文档修订号；变化时面板需重取派生数据
  schema: SchemaSnapshot            // 01 的 C01 快照（只读）
  commands: DocumentCommands        // 02 的命令面（面板只能通过它写入）
  requestSelect(ref: Selection): void              // 只发意图给02，不在宿主改状态
  requestRevealInEffectControls(target: EffectTarget): void  // 快捷属性→效果控件定位
  requestOpenDrawer(tab: string): void
}
```

`clip.effects` 的上下文解析结果只有四种：`none` / `multi` / `clip`（唯一有效 clipKey）/ `invalid`。宿主把结果和 `PanelContext` 一起交给 06；效果控件的组折叠、过滤、列宽、局部视口由 06 按文档会话 + clipKey 保存，宿主不复制这些状态。

`EffectTarget` 是快捷属性发往效果控件的只读定位载荷：`{ clipKey: string; objectPath: string; time?: number }`；`time` 仅用于聚焦某个节点，缺省表示聚焦该叶子行。它不携带值、不携带选择副本，效果控件按当前 `docRevision` 重新解析；目标失效时显示明确错误，不写旧对象。

### 4.2 选择 → 两个宿主的关系

| 主选区 | `clip.effects` | `selection.properties` |
|---|---|---|
| `none` | 空态（不自动选第一个片段） | 空态 + 快捷键提示 |
| `clip` | 上下文 = 该片段；06 展示全部适用组/叶子/节点 | 片段播放参数摘要 + 属性组入口 + 定位 |
| `group` / `leaf` | **同一片段上下文**；高亮该行，其他已展开行保留 | 该叶子当前值/模式/节点目标 + 定位 |
| `node` | 同一片段上下文；聚焦该节点，其他行保留 | 节点时间/值/适用缓动入口 + 定位 |
| `multi` | 多选摘要；不合并 `objects`、不取第一个 | 多选摘要；不取第一个、不合并值 |
| `invalid` | 失效原因 + 撤销入口；不自动跳邻片段 | 同上 |
| `path` / `rule` / `binding` | 不适用（显式非片段选择），显示「当前选择不属于片段效果控件」 | 只读身份 + 「打开对应面板」，不伪装成可编辑参数 |

规则：**选中某个属性只改变高亮与编辑目标，不隐藏其他已展开属性，也不把效果控件切成单属性独占页。** 快捷属性不是第二套节点编辑器：不显示独立关键帧时间轴，不缓存另一份参数；写入必须走同一 `commands`。

表中的group是06在当前clipKey下的对象组UI聚焦，不给02 Selection新增运行时组域或对象实例身份。快捷属性显示组内常用字段时，每个控件仍携带真实叶子objectPath与明确value/node目标；定位具体参数使用EffectTarget，不存在组级合并写值或组帧命令。

两个宿主是常驻的独立面板，不以 `appliesTo` 互相隐藏；`appliesTo` 只用于同一 group 内其他可选面板的 tab 过滤。选中 `none`/`multi`/`invalid` 时宿主仍保留自己的位置并显示对应状态，不自动切换成别的内容面板。

### 4.3 选区契约（冻结）

1. 两个宿主都只读选区，**不改选区**；面板想改选区必须调 `requestSelect`。
2. 选区失效（对象被删/撤销）：宿主保留 `lastKnownLabel`，显示「对象已不存在」+「撤销」按钮（调 02），3 秒后自动回到空态；不自动跳到相邻对象。
3. 多选：宿主把 `multi` 传给面板；面板自行决定批量编辑；宿主不合并、不去重、不排序（由 05-03 保证稳定顺序）。
4. `docRevision` 变化时，两个宿主都必须让面板重新从文档取数据；宿主不缓存属性值或节点列表。
5. 面板不得持有跨文档的选区引用；文档关闭时宿主清空并卸载面板。
6. 节点选择/批选只有一份会话状态；`clip.effects` 与 `selection.properties` 不得各自维护节点选择、局部播放头或“当前属性”第二份真值。

### 4.4 异步与错误

- 面板懒加载：首次 `appliesTo` 命中才 `import()`；加载中显示 `HostSkeleton`（3 行灰条，不显示数值）。
- 面板抛错：宿主错误边界显示「面板加载失败」+ 错误摘要 + 重试；主轴与预览不受影响。
- 数据依赖异步（schema/资源/注册表）：加载失败显示「未能加载 X」并可重试；**不得**回落到写死默认值。
- 快速切换选区：宿主用 `requestId` 丢弃过期结果（最后一次选中获胜）；两个宿主互不阻塞。
- 06业务内容未注册时不创建假表单/假行/假节点或“等待实现”的产品占位入口；05只验其真实宿主、Selection摘要/空态/错误与现有可用内容的组合。完整效果/快捷属性内容在06联调验收，不由05假报通过，也不将其实现反派给05。

### 4.5 布局、尺寸与焦点

| 项 | `clip.effects` | `selection.properties` |
|---|---|---|
| 默认位置 | 预览左上方（与预览同一横向区） | 右侧，独立 dock group |
| 宽度 | 由布局树给，最小约 420px（容纳参数列 + 节点列）；折叠 = 0；**不套旧 280–560** | 280–560px，默认约 20% 视口；折叠 = 0 |
| 标题区 | 片段身份 + 轨道 + 有限/无限 + 多选/失效状态 | 当前项名称 + 路径面包屑（`clip / position / x`）+ 折叠 |
| tab 条 | 只在该 group 内 `appliesTo` 为真的面板间显示；效果控件内容本体不是多个叶子 tab | 只显示快捷属性内容；不得变成“属性/关键帧”双 tab |
| 可停靠 | 一个 dock group；可被 22 移到其他区域或与其他面板成组 | 同上，可与效果控件同时停靠、换位、缩放 |
| 焦点 | 宿主暴露 `effectControls` 键盘作用域；展开组/行/节点可键盘到达 | 宿主暴露 `properties` 作用域；值控件与“定位到效果控件”可键盘到达 |
| 滚动 | 内容区独立滚动；左右列由 06 同步，宿主不拆成两个独立滚动区 | 独立滚动；不横向滚动 |

面板位置/分组/标签顺序属于布局（21/22），宿主只负责当前组的内容渲染与选区契约；不得在宿主内私存「上次显示哪个面板」的第二份布局状态（当前标签由布局树的 group 记录）。

### 4.6 pin（可选保留）

pin 只是同一文档内的显式 UI 上下文：标题明确固定对象，所有写入必须针对实际展示的有效 `clipKey`。删除、关闭文档、失效引用后不继续写旧对象；不以 pin 制造第二份 Selection，也不让 pin 阻止 06 在同一片段内切换属性。

## 5. 输入 / 输出

输入 02 共享 Selection、docRevision、schema 快照、面板注册表与 05-21 的布局组；不定义 SelectionRef 或宿主自持 multi 选区。效果控件的局部视口/行布局是 06 的输入输出，不在本宿主。

**输出**：`requestSelect`、`requestRevealInEffectControls`、`requestOpenDrawer`、命令调用（委托 02）；不直接改文档。

## 6. 修改步骤

1. 新建 `panelContract.ts`：冻结 `clip.effects` / `selection.properties` 两个稳定 id 与 `PanelContext`；再建两个宿主与空态/骨架/错误组件。
2. 删除 `store.ts:78` 的 `rightTab` 与三处「选择即改 tab」（`store.ts:660–687`）；改为选区驱动的 `appliesTo`。
3. `App.vue:366–379` 的右面板替换为 `SelectionPropertiesHost`；在预览左侧挂 `ClipEffectsHost`；删除 `rightTabs`（`App.vue:34–38`）。两个宿主都从 05-21 读取宽度/折叠，不共用 `inspectorW`。
4. 旧 `PropertyPanel.vue`（脚本属性）改为「文档属性」面板，挂到顶栏的文档菜单或抽屉的「文档」tab；**不占任何一个宿主主位**。
5. 清除旧ClipPanel/KeyframePanel渲染和所有旧整帧/下标调用；迁移完的无用组件直接删除，不作为未挂载兼容垫片等待06。片段基础控制复用05真实命令，06按新任务实现效果控件/快捷属性内容；旧源码仅是基线证据，不要求把旧类原样改名。
6. DynamicForm的旧VISIBILITY_RULES不进入新宿主；通用schema/依赖能力由01/02已冻结索引提供，06仅消费它来组成参数行，不在05或06再造一套字段显隐规则。迁移后清理废弃调用，05不以“待06替换”旧模型作为可用内容。
7. 资源/注册表控件（`fields/RegistryStringField.vue`、`ResourceStringField.vue`）保留，作为 06 的控件库，不在宿主里重建。

## 7. 禁止修改

- 不在宿主里渲染任何具体字段控件（宿主不知道 `position.x` 是什么）或效果控件行/节点。
- 不在宿主里写文档（只转发命令）。
- 不恢复「一个 tab 显示整帧所有字段」的旧交互（`KeyframePanel.vue` 的平铺形态）。
- 不恢复「选中单属性 → 只显示该属性的独占面板」；不把效果控件压回 `object`/`keyframe` 旧 tab。
- 不给快捷属性添加独立关键帧时间轴或第二份节点/值缓存。
- 不把效果控件限制在旧检查器 280–560px；不在宿主里实现局部视口/行对齐/虚拟化（06 的 `06-EffectControlsRows`）。
- 不让面板直接 import `store.ts` 的全局 `state`（必须经 `PanelContext`），否则无法做离线/多文档测试。

## 8. 两分支承载

| 宿主 | 差异 |
|---|---|
| WebUI | tab 条可 hover；面包屑可点击跳转；宽度拖拽（提交布局命令）；两宿主可并排 |
| 游戏内 Forge/AUI | 默认折叠快捷属性（1280×720 下预览优先）；效果控件以小窗标签/折叠保证可达，但不降级为单属性切页；宽度连续拖拽若 AUI 指针事件不支持，则用键盘步进/预设三档，但**面板移动、成组、恢复默认仍必须可用**（由 22 的输入桥兜底）；面包屑只显示末两级 |

## 9. 验收

**宿主合同（05 单独可复现）**

0. 无选择/多选/片段失效/未知 schema/断连：两个宿主分别显示空态、多选摘要、失效+撤销、错误+重试，且不互相隐藏、不自动切到别的内容面板。

**联合验收（06 内容接入后；不在 05 单独声称通过）**

以下 1–7 同时验证宿主契约是否够用；05 交付方不能把 06 未实现的内容算作本任务成果。

1. 选中一个 CAMERA 片段：`clip.effects` 显示该片段全部适用组；`selection.properties` 同时显示片段播放参数摘要。两个面板可同时可见、分别拖动缩放。
2. 在效果控件选中 `position.x` 行：`position` 组其他行（`y`/`z`）仍可见；快捷属性显示 x 的当前值与定位入口；效果控件没有被切成只显示 x。
3. 再选中 `yaw`：效果控件里位置组仍保留，yaw 高亮；快捷属性切到 yaw；两个宿主不重建整个文档上下文。
4. 选中片段 → 快捷属性改一个值：效果控件与标准文档同步；取消/失败时两边都保持原值，不出现两份值。
5. 删除选中对象后按 Ctrl+Z：两个宿主都提示「对象已不存在」，撤销后恢复同一对象选择。
6. 快速连点 5 个片段：两个宿主最终都显示最后一个；无过期数据闪现。
7. 折叠效果控件后预览变宽，主轴宽度不变；快捷属性仍可用；重启后两面板宽度与折叠状态恢复。

**反例**

1. 宿主直接改 `state.doc` → 不通过。
2. 选择变化时宿主自动选第一个片段 → 不通过。
3. 加载中显示 `fov: 70`（schema 默认）冒充真实值 → 不通过。
4. 选中属性后效果控件只剩该属性、其他已展开组消失 → 不通过（退化为单属性独占页）。
5. 快捷属性里出现独立关键帧时间轴或第二份节点选择 → 不通过。
6. 效果控件宽度被夹在 280–560px → 不通过。
7. 一个面板里同时编辑整帧所有属性且没有片段上下文 → 不通过。

**真实冒烟**：WebUI 打开真实脚本：(a) 05 单独复测宿主 0 的空态/多选/失效/错误/停靠/折叠；(b) 06 内容接入后联合按 1–7 操作。游戏内 Forge 用三档宽度与折叠复测属 14 迁移参考，不构成本轮出口。

## 10. 完成定义

- 两个稳定宿主 `clip.effects` / `selection.properties` 与契约文件落地；06 可在不改宿主的前提下接入内容。
- `rightTab` 与「选择即改 tab」从代码中消失；两个宿主可同时停靠。
- 宿主不 import 任何具体控件、效果控件行或局部标尺；一切经 `PanelContext`。
- 效果控件宽度不继承 280–560 旧限制；快捷属性没有第二套关键帧时间轴。
- 空态/加载/错误/失效/多选五种状态都有可复现路径与截图记录。
