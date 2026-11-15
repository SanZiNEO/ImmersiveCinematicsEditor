# 06-01 效果面板外壳

## 目标

`ClipEffectsPanel` 只显示关键帧动画。保留 panelId `clip.effects`、默认槽位 `document.left`、`minWidth=420`、`singleton=true`、`keepAlive=true`。面板不提供“添加属性”入口；属性在 `selection.properties` 属性面板里，出现关键帧后才进入这里。

## 组件树

```text
src/plugins/core.clip-effects/
  manifest.ts
  panels/ClipEffectsPanel.vue
src/components/effects/
  EffectControlsHeader.vue
  EffectControlsToolbar.vue
  EffectControlsRuler.vue
  EffectGroupList.vue
  EffectControlGroup.vue
  AnimatedPropertyRow.vue
  StaticCompanionRow.vue
  EffectKeyframeGroup.vue
src/effects/
  effectContext.ts
  effectState.ts
  panelMembership.ts
  effectRows.ts
  effectRowLayout.ts
  effectViewport.ts
```

`manifest.ts` 的 `component` 指向 `panels/ClipEffectsPanel.vue`。面板只 import `@workbench/api`、`src/effects/*`、`src/components/effects/*`。

## 输入

```ts
interface ClipEffectsPanelProps {
  context: PanelContext
}
```

从 `context` 取：

- `selection`：只读 `Selection`。
- `clipKeys`：只读片段批选。
- `docRevision`：每次文档命令后变化。
- `commands`：所有文档写入。
- `services`：`scriptDoc`、`schema`、`status`、`i18n`、`theme`。
- `requestRevealInEffectControls`：属性面板/诊断定位。

每次 `docRevision` 变化用 `services.scriptDoc.getClip(context.selection.clipKey)` 重取当前片段和轨道定义；不缓存 `ScriptDoc`。

## 四态

| 态 | 条件 | 显示 |
|---|---|---|
| `none` | 无 `clipKey` | 空态：图标 + “在时间轴选择一个片段” |
| `multi` | `clipKeys.length > 1` | 多选摘要：`N 个片段`、主选片段名、批量入口；不取第一个 |
| `clip` | 唯一有效 `clipKey` 且片段存在 | 完整效果面板 |
| `invalid` | `clipKey` 失效/被删/撤销后不存在 | 失效原因 + “撤销恢复” + “回到时间轴” |

`clip` 态如果没有动画属性：

```text
该片段还没有关键帧动画。
在属性面板打开某个属性的时钟后，这里显示它的关键帧组。
```

空态不显示字段占位，不显示“添加属性”按钮。

## 布局

```text
┌ EffectControlsHeader  44px ─────────────────────────────┐
│ 效果 · 片段名 / ID · 轨道名 · 有限 5.0s / 无限 · 校验徽标 │
├ EffectControlsToolbar  32px ────────────────────────────┤
│ [搜索] [只看轴外]                    适配片段 适配全部节点 │
├ EffectControlsRuler  28px ──────────────────────────────┤
│ 0s        1s        2s        3s        4s        5s     │
├ EffectGroupList  flex:1; overflow-y:auto ────────────────┤
│ 位置 (2 动画属性 / 7 帧)                       [折叠]    │
│   position.x  [ 1.2 ]  [时钟] [◆] [←][→]  |  ●  ●   ●   │
│   position.y  [ 0.0 ]  [时钟] [◆] [←][→]  |  ●      ●   │
│ 朝向 (1 动画属性 / 3 帧)                       [折叠]    │
│   yaw         [ 90° ]  [时钟] [◆] [←][→]  |  ●      ●   │
└──────────────────────────────────────────────────────────┘
```

- 左参数列宽 `clamp(220px, 42%, 360px)`；右节点列占剩余宽度。
- 左右列之间 4px 可拖分隔条，比例存 `effectState.splitRatio`，范围 0.32–0.52。
- 面板宽度 `<520px` 时左列降到 200px，右列保持至少 180px；整体横向滚动，不切成单属性页。
- 行高由 `effectRowLayout` 统一计算：组头 30px，动画叶子 52px，详情展开 +52px，事件记录展开 +76px。
- 组列表纵向滚动；标尺和片段头固定。左右列共用同一 `rowTop/height`。

## 头部

`EffectControlsHeader` 显示：

- 标题“效果”。
- 片段名：`clip.label` / `clip.name` / `clip.id` / “未命名片段”。
- 轨道名：`track.label` / `track.type`。
- 身份：`clip.id`（有则显示，无则“无 id”）。
- 时长：有限 `duration` 一位小数；无限显示 `∞`；循环显示 `×N`。
- 动画统计：`N 个动画属性 · M 帧`。
- 校验徽标：`block` 红、`error` 橙、`warn` 黄、`info` 灰；点击滚到 06-10 诊断条。
- 脏标记：`docRevision` 与保存回执不一致时显示“未保存”。

## 工具栏

| 控件 | 行为 |
|---|---|
| 搜索 | 按叶子路径/标签/组名过滤当前动画行；空结果与空片段分开 |
| `只看轴外` | 只显示有 `time>duration` 节点的动画行；组头保留 |
| 适配片段 | 局部视口设为 `0..duration`；无限片段用 `0..当前窗口末端` |
| 适配全部节点 | 局部视口包住所有动画节点，含轴外 |
| 折叠全部 | 折叠所有组；当前选中叶子所在组保持展开 |
| 刷新 | 重取 schema/片段；保留选择和视口 |

工具栏没有“+ 添加属性”、没有“新建效果”、没有“添加组”。属性在属性面板中开启时钟后自动进入效果面板。

工具栏按钮提供键盘等价：`Tab` 可达，`Enter/Space` 触发；搜索框内不响应全局快捷键。

## 效果行集合

```ts
const rows = buildPropertyRows(clip, trackDef, playheadLocal)
const groups = buildEffectGroups(rows)
const { effectGroups } = partition(groups, panelMembership)
```

- 只保留 `panelMembership.isRowInEffect(row)===true` 的行；默认策略为 `leaf`，要求 `row.keyframes.length > 0`。
- 只保留 `effectGroups` 中至少有一个动画行的组。
- 每个动画行 `keyframes[]` 非空；空数组属于属性面板，不在效果面板。
- 行集合随 `docRevision` 重算；折叠/过滤/视口不动文档。

## 会话状态

```ts
interface ClipEffectsState {
  clipKey: string
  collapsedGroups: Record<string, boolean>
  filter: { text: string; outOfRangeOnly: boolean }
  splitRatio: number
  viewport: {
    originLocalSeconds: number
    pxPerSecond: number
    scrollLeft: number
    scrollTop: number
  }
  expandedRows: Record<string, boolean>
  selectedNode?: { path: string; time: number }
}
```

- 以 `clipKey` 为键存 `session.effectPanels`；切片段恢复折叠/过滤/视口。
- 文档关闭清空对应 `clipKey` 状态；撤销恢复的 `clipKey` 重新绑定。
- 不写 `doc`，不进 `serializeDoc`。

## 接线

`src/plugins/builtin.ts` 的 `core.clip-effects` 仍是一行；只改 manifest 的 `component`：

```ts
component: () => import('./panels/ClipEffectsPanel.vue')
```

`selection.properties` 由 06-09 的 `ClipPropertiesPanel` 替换；两个面板独立停靠、独立缩放、可同时可见。属性面板开时钟后效果面板收到 `docRevision` 更新并出现对应组/行。

## 验收

1. 文档页选择有动画的片段：`clip.effects` 显示头部、工具栏、标尺和动画组；无“添加属性”按钮。
2. 选择没有动画的片段：显示空态；不显示静态属性占位；属性面板仍可在同一片段上开时钟。
3. 属性面板给 `position.x` 开时钟后：效果面板出现“位置”组和 `position.x` 行；`position.y/z` 仍在属性面板。
4. 效果面板关 `position.x` 动画：确认后行消失，属性面板出现 `position.x` 静态值；一次撤销恢复。
5. 拖动分隔条后重启：比例恢复；面板宽 420px 时左右列仍可操作。
6. 切换片段：折叠、过滤、视口按 clipKey 恢复；不串用上一个片段状态。
7. 点头部校验徽标：滚到诊断条并展开对应组/叶子。
