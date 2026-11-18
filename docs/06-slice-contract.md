# 06 轮并行切片契约（子代理必读）

本文件是主代理冻结的共享接口。所有子代理**只允许依赖**这里列出的契约，
不得改动本文件、`src/features/effects/types.ts`、`src/core/doc/commands.ts` 的命令联合，
也不得改动别人负责的文件。

## 一、已落地的基础设施（可直接使用）

| 模块 | 导出 | 说明 |
|---|---|---|
| `src/features/effects/types.ts` | `PropertyRow` `EffectGroup` `PanelMembership` `EffectViewport` `KeyframeNode` `SegmentGeometry` `KeyframeSelection` `SegmentSelection` `CommitTarget` `RejectCode` `CommitAttempt` `KeyframeClipboard` `AuthoringEasing` `SegmentView` `EffectDiagnostic` `DiagnosticIndex` `ValueControlKind` `EffectPanelSession` `PropertiesPanelSession` `ClipSpan` `RowMode` `RowValueKind` `NodeKind` `EasingMode` `EasingHandle` `FitCommand` | 冻结形状，不要改 |
| `src/features/effects/rows.ts` | `buildPropertyRows` `readClipTiming` `isRequiredMissing` `outOfRangeCount` `effectiveStaticValue` `groupKeyOf` `groupLabelOf` `labelOf` | 行派生纯函数 |
| `src/features/effects/membership.ts` | `hasKeyframeContent` `buildGroups` `panelMembership` `partitionGroups` `summarizeRows` | 归属策略 |
| `src/features/effects/viewport.ts` | `DEFAULT_VIEWPORT` `VIEWPORT_LIMITS` `timeToX` `xToTime` `clampPxPerSecond` `zoomAt` `panBy` `scrollVertically` `finiteDuration` `nodeTimeRange` `fitViewport` `visibleTimeWindow` | 局部视口 |
| `src/features/effects/geometry.ts` | `ROW_LAYOUT` `PLAYHEAD_EPSILON` `isOutOfRange` `nodesOfRow` `segmentsOfRow` `layoutRows` `hitTestNodes` `nodesInRect` | 节点/段几何 |
| `src/features/effects/easing.ts` | `normalizeHandle` `segmentIndexAt` `sampleValue` `bakeSampleCount` `bakeSegment` `BAKE_MAX_POINTS` `BAKE_MIN_POINTS` | 缓动采样 |
| `src/features/effects/valueControls.ts` | `controlKindOf` `REJECT_MESSAGES` `validateValue` `parseTextInput` `resolveTarget` `seedForNewNode` `missingPositionAxes` `animatable` `rangeHint` `unitSuffix` `isNumberInput` | 值控件与目标解析 |

## 二、已扩展的命令层（`src/core/doc/commands.ts`）

新增成员（**已实现并通过自检**，不要重写）：

```
object.enableAnimation   { clipKey, path, time, value? }
object.disableAnimation  { clipKey, path }
object.setKeyframeValue  { clipKey, path, time, value }
object.moveKeyframes     { clipKey, moves: {path, from, to}[] }
object.removeKeyframes   { clipKey, targets: {path, time}[] }
object.pasteKeyframes    { clipKey, path, mode:'merge'|'replace', type?, anchor, points:{offset,value}[] }
object.bakeEasing        { clipKey, path, fromTime, toTime, points:{time,value}[] }
```

已有成员（03 轮）：

```
object.setValue      { clipKey, path, value }
object.setKeyframes  { clipKey, path, keyframes }
object.addKeyframe   { clipKey, path, time, value }
object.removeKeyframe{ clipKey, path, time }
object.moveKeyframe  { clipKey, path, from, to }
object.remove        { clipKey, path }
```

## 三、store 新增入口（`src/core/doc/store.ts`）

```ts
commitClipAuthoring(clipKey: string, mutate: (state: AuthoringState) => void): CommitResult
clipAuthoringOf(clipKey: string): AuthoringState
```

- 作者态缓动存 `doc.clipAuthoring[clipKey]`，**进撤销栈、不写盘、不进预览推送**；
- 事件是 `'authoring'`（不触发推送与服务端校验）；
- 缓动键约定：`doc.clipAuthoring[clipKey].easing[`${path}@${fromTime}-${toTime}`]`，值为
  `{ mode, out:{x,y}, in:{x,y}, revision }`。读取时用 `src/features/effects/easingStore.ts`
  （由切片 C 提供）。

## 四、面板上下文可用能力

```ts
ctx.commands.commit(cmd)     // 唯一写入口
ctx.commands.commit(cmd, coalesceWith?)  // 连续编辑合并（见下）
ctx.commands.endCoalescing()             // 显式结束连续编辑串
ctx.commands.undo() / redo()
ctx.commands.canUndo / canRedo
ctx.commands.commitClipAuthoring(clipKey, mutate)  // 作者态缓动（进撤销栈、不写盘）
ctx.commands.clipAuthoringOf(clipKey)              // 读作者态副本
ctx.docRevision              // getter，变化即重取
ctx.selection / ctx.clipKeys // 只读快照
ctx.services.get(DOCUMENT_SERVICE)   // view() / clipObjects(clipKey) / sessionView() / setPlayhead()
ctx.services.get(SELECTION_SERVICE)  // state() / subscribe() / requestReveal()
ctx.services.require(CATALOG_SERVICE)// objectDef(trackType, path) / paths(trackType)
ctx.requestSelect(sel)
ctx.requestRevealInEffectControls({ clipKey, objectPath, time? })
ctx.requestFocus(panelId)
ctx.requestOpenDrawer(tabId)
ctx.preferences              // 面板会话持久化（可选）
```

`usePanelRevision(ctx)`（各插件目录已有同名文件）把 selection + document 变化折成 ref 版本号。

### 撤销合并（06-05）

- `coalesceWith` 是**串身份字符串**；同串在窗口（默认 400ms）内连续提交只产生一个撤销项。
- 串身份变化 / 窗口超时 / 撤销 / 重做 / 打开 / 关闭 / 外部同步都会自动打断。
- `endCoalescing()` 供失焦、回车、切换记录时显式结束。
- 一次拖拽松手、一次批删、一次粘贴：**不要**传串身份（它们本身就是单个撤销项）。
- 建议串身份格式：`setValue:<clipKey>:<path>:<time>`、`easing:<clipKey>:<path>:<from>-<to>`、
  `eventField:<clipKey>:<path>:<time>:<field>`。

### 组件额外 props / 事件（外壳与行组件之间，超出冻结的八个 props）

- `EffectRow` 额外可选 props：`diagnostics` / `selectedSegment` / `readOnly` / `snapCandidates` / `rowTop`。
- `EffectControlGroup` 额外 props：`rowCenters`（`layoutRows` 产出的行中心表，跨行框选必需；
  不传时退化为只在本行内框选）。
- `EffectControlGroup` 额外事件：`toggle-collapse`（会话态由外壳持有，组件不改 `session`）。
- `EffectKeyframeGroup` 点组内空白时直接调 `DOCUMENT_SERVICE.setPlayhead()`（会话态、
  不写文档、不进撤销栈）；这是允许的会话写入，与"面板不写文档"不冲突。
- 吸附源里的"标尺刻度"由外壳按 `pxPerSecond` 下发；外壳不下发时行组件按 48px 步长自选刻度。

### 分层约束（06-12）

- `features/` 只放纯函数与类型，**不放 Vue 组件**。
- `plugins/` 之间零引用。跨面板共享的**输入控件**（`PropertyValueForm` / `StructTreeEditor` /
  `DiagnosticsBar`）放 `src/workbench/shared/controls/`，属于中立共享区，不算插件互引。
- `workbench/shared/` 的组件不得 import `features/` 的具体实现；跨面板数据以中立结构（props）传入。

## 五、硬约束（验收会检查）

1. 效果面板**没有**任何"添加属性 / 新建效果 / 添加组"入口。
2. 属性面板**没有**关键帧轴、节点几何、局部标尺。
3. 所有写入走 `ctx.commands.commit`；面板不直接改文档对象。
4. 选择身份用 `clipKey + path + time`，不用数组下标。
5. 会话状态（折叠、过滤、视口、选中节点）不进文档、不进序列化。
6. 未知路径只读，但必须可见、可关闭动画。
7. 组件不得 import `core/doc/store.ts`；只能经 `PanelContext`。
8. 每个面板必须覆盖四态：`none` / `multi` / `clip` / `invalid`（+ `foreign`）。
