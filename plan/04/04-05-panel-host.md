# 04-05 面板宿主与 PanelContext

## 目标

让布局树里的每个 `{ pluginId, panelId }` 都能被唯一解析成插件组件，并拿到一份只读、可测试的 `PanelContext`。宿主负责加载、错误、空态、焦点作用域、keepAlive 和选区四态；不实现任何业务表单，不持第二份选区，不直接写文档。

## 宿主结构

```text
LayoutRenderer
  GroupRenderer
    TabStrip
    PanelHost(pluginId, panelId)   // 每个可见 panel 一个
      PanelBoundary               // 错误边界
      PanelSlot                   // 加载/空态/内容
```

`PanelHost` 是唯一把 `pluginId + panelId` 解析成组件的地方：

1. 从 `PanelRegistry` 取 `PanelContribution`；
2. 找不到 → 显示“插件未安装/已禁用”占位 + 移除/重置；
3. 找到 → 懒加载 `component()`；
4. 加载中 → `HostSkeleton`（灰条，不显示 0/默认值）；
5. 加载失败/抛错 → `HostError`（错误摘要 + 重试 + 复制诊断）；
6. 成功 → 创建 `PanelContext`，挂载组件。

`PanelHost` 不读文档字段，不直接读文档 store，不直接改布局；面板想改选区/布局只能调 `PanelContext.request*`。

## PanelContext

```ts
interface PanelContext {
  pluginId: string
  panelId: string
  pageId: string

  selection: Selection            // 03-03 的共享主选区，只读快照
  clipKeys: readonly string[]     // 03 会话批选，只读
  docRevision: number             // 文档修订号；变化时面板重取派生数据
  commands: DocumentCommands      // 03 命令面；面板只能通过它写文档

  theme: ThemeApi                 // 当前主题 token/订阅
  i18n: I18nApi                   // t()/locale
  status: StatusApi               // 只读状态/临时提示
  layout: PanelLayoutApi          // 当前 panel 的尺寸/折叠/可见；不直接改树
  services: ServiceRegistry       // 跨插件服务，按 token 取

  requestSelect(ref: Selection): void
  requestRevealInEffectControls(target: EffectTarget): void
  requestOpenDrawer(tabId: string): void
  requestFocus(panelId: string): void
  requestClosePanel(): void
}
```

约束：

- `selection` 是快照，不是可变对象；面板不能改它。
- `docRevision` 每次文档命令后递增；面板用它判断是否重取，不得缓存跨 revision 的值。
- `commands` 只暴露 03 的文档命令；面板不能直接改 `state.doc`。
- `layout` 只读当前 panel 的尺寸/折叠/可见；面板不能改 `sizes/panels/activePanelId`。
- `services` 按 token 取；缺失时面板自己决定空态/禁用，不能伪造默认值。
- `requestSelect` 只发意图给 03；宿主不替它改选区。
- `requestRevealInEffectControls` 的 `EffectTarget = { clipKey, objectPath, time? }`，只用于属性面板→效果面板定位，不携带值/选区副本。
- `requestClosePanel` 只隐藏当前面板；不卸载插件、不删布局节点。

## 选区四态

`clip.effects` 的上下文解析只有四种：

| 状态 | 含义 | 宿主呈现 |
|---|---|---|
| `none` | 没有选中片段 | 空态；不自动选第一个片段 |
| `multi` | 多选/批选 | 多选摘要；不合并对象、不取第一个 |
| `clip` | 唯一有效 clipKey | 把完整 Selection + PanelContext 交给面板 |
| `invalid` | 选中对象被删/撤销后失效 | 失效原因 + 撤销入口；不自动跳邻片段 |

`selection.properties` 是片段属性面板：`clip` 态显示片段全部适用属性、静态值、未设置行和时钟；`group/leaf/node` 只做展开、高亮、定位，不切成单属性摘要页；对 `path/rule/binding` 显示“当前选择不属于片段属性”，只读身份 + 打开对应面板；对 `none/multi/invalid` 与上表一致。

| 主选区 | `clip.effects` | `selection.properties` |
|---|---|---|
| `none` | 空态 | 空态 + 快捷键提示 |
| `clip` | 该片段上下文 + 已有关键帧的组/行 | 片段全部适用属性、静态值、未设置、时钟 |
| `group` / `leaf` | 同一片段上下文，高亮/展开对应动画行；无帧叶子不出现 | 同一片段属性面板，展开/高亮对应静态叶子；叶子在效果面板时显示定位条 |
| `node` | 同一片段上下文，聚焦该节点 | 展开对应叶子；显示“节点 t=…”定位条，不显示节点值/轴 |
| `multi` | 多选摘要 | 多选摘要；不取第一个 |
| `invalid` | 失效 + 撤销 | 失效 + 撤销 |
| `path` / `rule` / `binding` | 不适用，显示“当前选择不属于片段效果控件” | 只读身份 + 打开对应面板 |

规则：**选中某个属性只改变高亮、展开与编辑目标，不隐藏其他属性，不把两个面板切成单属性独占页。** 属性面板不是第二套节点编辑器：不画独立关键帧轴，不显示节点值/节点几何，不缓存第二份值/节点。

## 双宿主

冻结两个宿主 ID 和默认槽位：

| 宿主 | panelId | 默认槽位 | 宽度 | 负责 | 不负责 |
|---|---|---|---|---|---|
| 片段效果面板 | `clip.effects` | `document.left` | ≥420；折叠=0 | 片段上下文、已有关键帧的组/行、空态/多选/失效/错误、焦点 | 全部适用属性、静态值/未设置行、时钟、参数控件由 `selection.properties` 提供；节点几何/命中/拖动、局部标尺、虚拟化由 `clip.effects` 内容组件提供 |
| 片段属性面板 | `selection.properties` | `document.right` | 280–560；折叠=0 | 片段全部适用属性、静态值/未设置、时钟、定位入口 | 第二套关键帧轴、第二份选择、节点值/节点几何、把效果面板压回窄栏 |

- 两者是独立面板，可同时可见、分别停靠、分别缩放；不是同一个 tab 的二选一。
- 两者都只读同一 `Selection`；任何写入走同一 `commands`。
- 宿主不缓存属性值/节点列表；`docRevision` 变化就让面板重取。
- 宿主不实现任何具体字段控件；demo 面板可以显示假数据用于验收，但必须标记 demo，不冒充业务字段。

## 懒加载、keepAlive、错误

- `component()` 首次可见才 `import()`；同一 panel 已加载则复用。
- `keepAlive=true` 的面板隐藏时保持挂载（`v-show`），保留滚动/筛选/草稿；`false` 的面板隐藏即卸载，重新显示重新加载。
- 错误边界捕获面板渲染/生命周期错误：只该面板显示错误，其他面板/预览/主轴正常；错误进诊断。
- 加载失败/超时：显示“加载失败 + 原因 + 重试”；不回落到写死默认值。
- 快速切选区/切文档：宿主给每次请求 `requestId`，只接受最后一次结果；过期结果丢弃，不闪回原值。
- 文档关闭：宿主清空 selection、卸载面板、取消进行中的加载；不把既有文档引用带到新文档。
- 面板抛错连续两次：保留错误态，提供“重试/禁用该面板”；不禁用整个插件，除非插件 activate 失败。

## 焦点与键盘

- 每个 PanelHost 包一个焦点作用域 `data-focus-scope="panel:<pluginId>:<panelId>"`；04-10 的 FocusService 用它。
- 面板标题/标签可聚焦；内容区第一个可聚焦元素由面板自己声明 `autofocus` 或 `focusFirst`。
- 面板内 `Tab` 不逃出面板，除非用户按 `F6` 切区域；弹窗优先。
- 面板折叠/隐藏时，焦点回到标签或上一个区域，不丢到 `body`。
- 宿主提供 `aria-label`（面板标题），loading/error 用 `role=status`/`alert`，不静默。

## 验收

- `demo.kitchen-sink` 注册两个 demo 面板，分别占 `document.left` / `document.right` 槽位，不占用真实 `clip.effects` / `selection.properties` ID；两面板同时可见、可分别拖动缩放。
- demo 选区切 `none/multi/clip/invalid`：两宿主显示对应空态/多选/片段/失效，不互相隐藏、不自动切内容。
- demo 面板懒加载：首次显示骨架，不显示 0/默认值；加载失败显示错误 + 重试。
- demo 面板故意抛错：只该面板错误，其他面板/外壳正常；诊断有记录。
- 快速连点 5 个选区：两宿主最终都显示最后一个；无过期数据闪现。
- `docRevision` 变化：面板重取；宿主不缓存原值。
- 关闭文档再开新文档：宿主清空原 selection，面板不显示上一份文档数据。
- 隐藏 `keepAlive` 面板再显示：滚动/筛选保留；非 keepAlive 面板重新加载。
- 焦点：Tab 在面板内循环；F6 能离开；折叠/隐藏焦点回到标签；错误态可键盘重试。
- `rg` 检查宿主没有文档 store import、没有具体属性/效果面板 import、没有具体字段名。

## 宿主约束

- 宿主只渲染四态、片段摘要、空态和错误态；具体字段控件由面板组件提供。
- 宿主不改 `state.doc`、不持第二份 Selection、不缓存属性值。
- `selection.properties` 显示片段全部属性；`clip.effects` 只显示已有关键帧属性。
- 属性面板宿主不建独立关键帧轴、不建第二份节点选择、不显示节点值/节点几何。
- `clip.effects` 宽度按 04-02 的尺寸约束。
- demo 面板显式标记 demo。
- 面板只通过 `PanelContext` 取数据，不直接 import 全局 store。
