# 08-03 转场面板

## 目标

新增一个独立的 **转场面板**，用 A→B 交界作为编辑对象：

- 作者在面板里选择“哪个轨道的哪两个相邻片段之间的交界”。
- 面板显示这个交界当前有什么效果：叠化 / crossfade、参数过渡、两者共存、硬切、结构不完整。
- 叠化和参数过渡都在这个面板里编辑；片段属性面板不再出现“叠化组”“参数过渡组”，主时间轴也不出现转场节点或转场轨。
- 面板只做编辑器操作和本地校验；落盘仍只写现有字段，推送由 08-08 负责。

## 插件

```text
src/plugins/core.transition-panel/
  manifest.ts
  panels/TransitionPanel.vue
  panels/TransitionBoundaryList.vue
  panels/TransitionBoundaryDetail.vue
  panels/CrossfadeDetail.vue
  panels/CameraMorphDetail.vue
  panels/CoexistDetail.vue
```

manifest：

| 项 | 值 |
|---|---|
| `pluginId` | `core.transition-panel` |
| `panelId` | `transition.panel` |
| `requires` | `['core.workbench']` |
| `apiVersion` | `'1'` |
| `component` | `panels/TransitionPanel.vue`（懒加载） |
| `defaultSlot` | `document.right` |
| `titleKey` | `panel.transition`（中文“转场”） |
| `minWidth` | 340 |
| `maxWidth` | 560 |
| `closable` | true |
| `singleton` | true |
| `keepAlive` | true |
| `available` | `pageId==='document' && hasDoc` |

- `builtin.ts` 在 `core.selection-properties` 之后追加 `coreTransitionPanel`；04 的 `PanelHost`、布局树、宿主服务不改。
- 与 `selection.properties` 同属 `document.right`，按标签/上下停靠共存；不替换属性面板，也不把转场字段塞进属性面板。
- 不注册独立页面，不注册第二个时间轴，不注册 lane 轨。
- 面板默认可见；用户可关闭，命令 `view.transitionPanel` 可重新打开/聚焦。

## 命令

| commandId | 标题 | 启用 | 行为 |
|---|---|---|---|
| `view.transitionPanel` | 打开转场面板 | 有文档 | 打开/聚焦 `transition.panel`；不自动选中交界 |
| `transition.revealBoundary` | 定位到转场交界 | 当前选择为 CAMERA 片段且存在相邻交界 | 打开面板并选中该交界；不改文档、不改选区 |

- `view.transitionPanel` 只控制面板显隐/焦点；不创建时间轴节点、不新增消息。
- `transition.revealBoundary` 是可选导航命令；面板仍可直接从列表选择，不依赖命令。
- 不在片段右键菜单、时间轴交界热区、效果面板菜单里加“添加转场”入口。

## 数据来源

```text
PanelContext.docRevision     文档修订号
PanelContext.commands        03 EditorCommand（应用/移除/显式解决共存）
PanelContext.services        DocumentApi / StatusApi
```

- 面板不读 `state.doc`，不缓存第二份文档；`docRevision` 变化时重建交界列表。
- 面板自己的选中态存 session：

```ts
interface TransitionPanelSession {
  selectedBoundaryKey: string | null   // trackId + fromClipKey + toClipKey
  filter: 'all' | 'crossfade' | 'morph' | 'both' | 'cut' | 'invalid'
}
```

- 不写 `state.selection`；片段选择与转场选择是两个不同的 UI 层。
- 播放头不参与交界选择；面板可以显示当前播放头是否落在该交界的重叠区/窗口内，但不创建第二个播放头。

## 布局

```text
┌ 转场 ────────────────────────────────────────────────┐
│ [全部] [叠化] [参数过渡] [共存] [无效果] [异常]       │
│ CAMERA 1 条 · 交界 3 个 · 共存 1 个                   │
├──────────────────────────────────────────────────────┤
│ shot_A → shot_B   CAMERA 0   交界 6.000s              │
│   叠化 3.000s · 参数过渡 0.500s · 共存               │
│ shot_B → shot_C   CAMERA 0   交界 7.000s              │
│   参数过渡 0.500s                                     │
│ shot_C → shot_D   CAMERA 0   交界 9.000s              │
│   硬切                                               │
├──────────────────────────────────────────────────────┤
│ 详情：shot_A → shot_B                                │
│  [叠化] [参数过渡] [共存]                             │
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

- 上列表、下详情；窄宽度时列表在上、详情可折叠。
- 列表行只读；点击行切换 `selectedBoundaryKey`，不改文档。
- 详情按 `effect` 显示：
  - `crossfade`：叠化卡。
  - `morph`：参数过渡卡。
  - `both`：两张卡 + 共存说明。
  - `cut`：硬切卡，显示两段首尾相接。
  - `unmanaged`：结构异常卡，显示原因和定位。
- 详情中的输入只改草稿；点应用才提交。
- 面板底部固定“本地校验 N 条”；错误滚动到对应输入。

## 交界列表

`buildTransitionBoundaries(doc)`：

1. 只遍历 CAMERA 轨道。
2. 每条轨道按 `clips` 数组顺序取相邻对 `(clips[i], clips[i+1])`；不按 `start_time` 重排。
3. 每个相邻对生成一个 `TransitionBoundary`；`atTime = clips[i].start_time + duration`。
4. 最后一个片段没有出场交界；不生成行。
5. 轨道为空或只有一个片段：不生成行，显示空态。

行字段：

| 列 | 内容 |
|---|---|
| 片段 | `A 名称 → B 名称`；无名称用 `id` / `clipKey` 短码 |
| 轨道 | 轨道名称 + 轨道序号 |
| 交界 | A.end 秒，3 位小数 |
| 叠化 | `D` 秒；无则 `—` |
| 参数过渡 | 有效窗口 `maxDuration` 秒；无则 `—` |
| 状态 | `叠化` / `参数过渡` / `共存` / `硬切` / `异常` |
| 提示 | `遮蔽` / `部分遮蔽` / `无下一片段` / `结构不完整` |

- 行点击只切换面板内选中态；不自动选中 A/B 片段，不发 `requestSelect`。
- 行右侧“定位”按钮可选中 A 或 B 片段；这是显式导航，不改变面板选中态。
- 行排序按“轨道顺序 → 交界时间”；不按 `start_time` 重排片段。
- 状态徽标只用文字，不只用颜色。

## 叠化详情

### 布局

```text
A  0.000 ─────────────────────────────── 6.000
B                 3.000 ───────────────── 7.000
                  └──── 重叠 3.000 ────┘
```

- 横轴用主时间轴秒；A 条在上、B 条在下；重叠区实色块。
- A 条全程不移动；B 条左端 = `A.end - D`，右端 = `B.start_time + B.duration`。
- 布局条只读；拖动条不改 `start_time`；改时长走数字输入。
- B 的 `duration` 不变，所以 B 条总宽不随 D 改变；只有左端/右端整体平移。
- 当前已有重叠时，D 初值 = `A.end - B.start_time`；无重叠时初值 0，输入占位。

### 叠化时长

| 状态 | 显示 | 行为 |
|---|---|---|
| 当前已有重叠 | `A.end - B.start_time` | 作为初值；不自动改写 |
| 当前无重叠 | `0.000` / 输入占位 | 作者输入 D |
| 输入合法 | 3 位小数 | 实时更新布局条/预览 |
| `D<=0` | error | 应用禁用 |
| `D>min(A.duration,B.duration)` | error | 应用禁用；提示上限 |
| 非数字/非有限 | error | 应用禁用 |

- `D` 是叠化时长、B 前移量、B 淡入时长；三者永远相等。
- `D` 不是新字段；应用后由 `B.start_time` 与 B 的 opacity 关键帧时间共同表达。
- 修改 `D` 只改草稿；点“应用叠化”才写文档。
- 输入框旁显示上限 `min(A.duration, B.duration)`；不自动夹值。

### 画面预览

```text
下层 A  opacity 1.000  [████████████]
上层 B  opacity 0.000→1.000  [░░░░▒▒▓▓██]
```

- 只显示两个片段的 `composite.opacity` 摘要，不采样游戏画面。
- A 的 opacity 必须恒为 1；没有帧时按 1；静态值非 1 或有非 1 帧时显示 error，不允许应用。
- B 的 opacity 显示本地 0 和本地 D 两端值；两端之间默认线性；曲线由关键帧插值/曲线决定，不另存转场曲线字段。
- 预览用“下层不透明、上层淡入”表达交叉淡化；不画“两层同时变半透明”的错误模型。

### 应用叠化

点“应用叠化”一次写两项，一个 `EditorCommand`：

| # | 写入 | 规则 |
|---|---|---|
| 1 | `B.start_time` | `A.start_time + A.duration - D` |
| 2 | `B.objects['composite.opacity']` | 本地 0 = 0，本地 D = 1；替换 `(0,D)` 内既有帧；保留区间外帧 |

- 不写 A 的 `start_time`、A/B 的 `duration`、A 的 opacity、A 的 `transition*`。
- 不移动 C 及后续片段；B 的 `end` 随 `start_time` 前移，B 后可能留下 gap。移除叠化时 B 回 `A.end`，C 仍不动。
- 不新增字段；不写 `crossfade`、`overlap`、`lane`、`authoring`。
- 如果 A 原本是 `morph`，应用叠化**不**自动把它改成 `cut`；面板转到“共存”态，显示 morph 优先区间。
- 如果 B 的 opacity 在 `(0,D)` 内有既有帧，应用时显示 info“已替换重叠区内 N 个帧，区间外保留”。
- 应用后 B 在重叠区从 0 到 1；A 在重叠区保持 1；A 到 `A.end` 结束；B 继续到自己的 `end`。
- 应用成功后按钮变“重新应用”；布局条显示“已应用叠化”。

### 移除叠化

- 只在当前布局确实有重叠且 B 的两端帧能被识别为叠化帧时启用。
- 一次 commit：
  - `B.start_time = A.end`（把 B 移回不重叠的位置）
  - 删除 B 在本地 0 = 0、本地 D = 1 的两个精确帧
  - 保留 B 的 `(0,D)` 外帧
  - A 的 `transition*` 保持原样
- 如果 B 的两端帧已被作者改成别的值，按钮禁用，显示“两端帧已改动，手动调整或重新应用叠化”。
- 移除不恢复/不修改 A 的参数过渡；参数过渡由独立按钮显式处理。

## 参数过渡详情

### 片段缺省

| 控件 | 行为 |
|---|---|
| `transition` 开关 | 立即一次 `commit`；`cut` 折叠通道表，`morph` 展开 |
| `transition_duration` | 数字 + 单位秒；空 = 未声明（运行时 `0.5`）；`0` 允许，表示无窗口 |
| `transition_curve` | 行摘要 + “编辑模型”；空 = 线性；打开 07-09 `ModelEditorSheet`，值域 `transition` |
| `transition_interrupt` | 二选一；`cut` 时隐藏，值保留 |

- `transition_duration` 与 `transition_curve` 是片段级缺省；通道表里空着的单元格继承它们。
- `transition_duration` 只接受有限非负数；负数、非数字 block。
- `transition_curve` 编辑一次提交一次；清除后回到“线性”，不写 `{type:'linear'}`。
- `transition_interrupt` 只影响 `morph`；`cut` 时隐藏但保留原值。
- `transition` 开关不因叠化存在而禁用；作者可以选择保留两者，面板显示共存。

### 通道表

| 列 | 内容 | 空值 | 编辑 |
|---|---|---|---|
| 通道 | `position / yaw / pitch / roll / fov / zoom` | — | 不可改名 |
| 模式 | `继承 / blend / hold / cut` | `继承` = 不写 `mode` | 下拉 |
| 时长 | 秒；占位显示片段缺省 | 空 = 继承 | 数字 |
| 曲线 | `继承 / 线性 / <模型摘要>` | `继承` = 用片段曲线 | 行内摘要 + 编辑 |
| 清除 | `×` | 行无覆盖时禁用 | 删除该通道对象 |

行状态：

```text
继承：模式/时长/曲线三格都空，行首显示“继承”
覆盖：至少一个显式键，行首显示“覆盖”；右侧 × 可清空整行
覆盖且 cut：时长/曲线格 disabled；仍显示保留值
无窗口：所有非 cut 行时长为 0 或全部 cut，表底显示“当前无参数过渡窗口”
```

- `mode=继承` 时运行时按 `blend`；行内提示“继承（blend）”。
- 显式 `blend` 写 `{mode:'blend'}`；显式 `hold` 写 `{mode:'hold'}`；显式 `cut` 写 `{mode:'cut'}`。
- `mode=cut` 时该行的 `duration/curve` 不写；如果已有值，先保留为禁用值，清除该行才删除。
- `duration` 空 = 不写 `duration`；非空必须是有限正数（`0` 不允许在通道覆盖里）。
- `curve` 空 = 不写 `curve`；要显式覆盖为线性，选“线性覆盖”写 `{type:'linear'}`。
- 曲线编辑复用 07-09；行内只显示类型 + 关键参数摘要，不展开整棵树。
- 修改单元格进入表草稿；不立刻写文档。表底“应用参数过渡”一次写：
  - `transition_duration`
  - `transition_curve`
  - `transition_params`（六行合成的完整对象）
  - `transition_interrupt`
- 一次“应用”= 一个 `EditorCommand` = 一次撤销。`Esc`/“放弃更改”恢复应用前快照。
- `transition` 开关不走表草稿；它立即提交，避免 cut/morph 折叠状态与未提交表冲突。

### 窗口示意

```text
                交界
                  │
A ────────────────┼──────────────── B
        [窗口总宽 = maxDuration]

叠化重叠区（若存在）
A     [==============================]
B                [==============================]
                 └──── D ────┘
```

- 窗口以 `A.end` 为中心；`windowStart = boundary - maxDuration/2`、`windowEnd = boundary + maxDuration/2`。
- `maxDuration` 取所有非 `cut` 通道的最大有效时长；全 cut 或无有效时长 = 无窗口。
- 面板显示“参数过渡窗口”和“叠化重叠区”两条独立区间；不把二者画成一个转场区间。
- 共存时叠化重叠区上加 `morph 优先` 阴影；只覆盖部分时显示“部分遮蔽”，全覆盖时显示“叠化不可见”。

## 共存详情

同一交界同时有叠化与参数过渡时，面板显示：

```text
shot_A → shot_B
  叠化     A.end - D ～ A.end        D = 3.000s
  参数过渡  boundary - 0.250 ～ boundary + 0.250
  结果     窗口内 morph 单 lane；窗口外可能出 A/B 两条 lane
```

- 显示 `morph 优先区间`、`叠化仍可见区间`、`完全遮蔽`/`部分遮蔽` 状态。
- 不自动删除任何一方；不自动把 A 的 `transition` 改成 `cut`。
- 提供三个显式动作：
  - **仅保留叠化**：把 A 的 `transition` 写成 `cut`，保留 `transition_params` 等值。
  - **仅保留参数过渡**：仅在 A 的 `transition=morph` 时可用；移除叠化布局（B 移回 A.end，删除两端 opacity 帧），不改 A 的 `transition`。
  - **两者保留**：不改字段；显示共存 warning。
- 三个动作都是一次 `commit`，可撤销；按钮文案明确“会改哪个字段”。
- `maxDuration=0` 时不显示“遮蔽”，按无 morph 窗口处理；叠化仍正常。

## 提交与撤销

| 操作 | 提交内容 | 撤销 |
|---|---|---|
| 应用叠化 | `B.start_time` + B opacity 两端键 | 一次回退两项 |
| 移除叠化 | B.start_time 回 A.end + 删除两端键 | 一次回退 |
| 应用参数过渡 | `transition_duration/curve/params/interrupt` | 一次回退整张表 |
| `transition` 开关 | 只写 `transition` | 一次回退 |
| 仅保留叠化 | A `transition=cut` | 一次回退 |
| 仅保留参数过渡 | B.start_time + 删除两端 opacity 键 | 一次回退 |
| 两者保留 | 无写入 | 无 |

- 有 error 时对应“应用”按钮禁用；warning 不阻止应用。
- 提交前跑 08-02 的 `validateCrossfade` / `validateTransitionDoc`；错误路径定位到 `clips[B].start_time`、`objects['composite.opacity']`、`objects['transition*']`。
- 应用后统一走 03 校验桥；错误阻止保存和 `pushScript`。
- 面板关闭不丢草稿；草稿按 `trackId + fromClipKey + toClipKey` 保存；`docRevision` 变化时清空并重建。
- 切换交界：有未应用草稿时提示放弃/应用；不静默丢。
- 不做“批量叠化/批量参数过渡”；一次只处理当前交界。

## 组件边界

```text
src/plugins/core.transition-panel/
  manifest.ts
  panels/TransitionPanel.vue          外壳/列表/详情切换
  panels/TransitionBoundaryList.vue   交界列表
  panels/TransitionBoundaryDetail.vue 详情分发
  panels/CrossfadeDetail.vue          叠化
  panels/CameraMorphDetail.vue        参数过渡
  panels/CoexistDetail.vue            共存/显式解决

src/components/camera/
  TransitionBoundaryRow.vue           列表行
  CrossfadeLayoutStrip.vue            布局条
  CrossfadeOpacityPreview.vue         0→1 预览
  CoexistWindowStrip.vue              共存区间/遮蔽
  TransitionTable.vue                 六通道表
  TransitionRow.vue
  TransitionWindowStrip.vue
  TransitionInterruptField.vue
```

- 面板组件只 import `@workbench/api`、08 的 `src/camera/transition/*` 和共享 UI；不 import 文档 store、不 import `camera.inspect` 组件。
- `TransitionPanel` 不渲染像素、不采样属性曲线；只显示结构/摘要。
- 片段属性面板、效果面板、`camera.inspect` 都不引用本面板的组件；三处职责不重叠。

## 验收

1. `builtin.ts` 加载后注册表出现 `core.transition-panel` / `transition.panel`；重复 ID、缺依赖、坏 manifest 启动报错。
2. 文档页打开 `view.transitionPanel`：出现“转场”面板；默认 `document.right`，与属性面板共存，不替换属性面板。
3. 面板列出所有 CAMERA 轨道的相邻交界；N 个片段有 N-1 行；最后一个片段没有出场交界。
4. 选择 `shot_A → shot_B`：详情显示 A/B、交界时间、当前效果；不自动选中 A/B 片段。
5. 叠化 3 秒：输入 `D=3`；布局条 A 0–6、B 3–7、重叠 3–6、重叠 3 秒；应用后 `B.start_time=3`，B opacity 本地 0=0、本地 3=1。
6. 叠化落盘：只写 B 的 start_time 与 B 的 opacity 两端帧；不写 A 的 transition；JSON 无 crossfade 字段。
7. A 的 opacity 非恒 1：error；应用禁用；不自动改写 A。
8. A/B 非相邻、跨轨、B 不在上层、A/B loop/infinite、非全屏：error；应用禁用。
9. B 的 `(0,D)` 内已有 opacity 帧：应用替换两端；区间外保留；一次 commit。
10. 移除叠化：B.start_time 回 A.end；删除两端帧；区间外保留；A 的 transition 保持原样；一次撤销。
11. 参数过渡：`transition=morph`、六通道、`duration/curve/interrupt` 可编辑；`transition=cut` 折叠但保留覆盖。
12. 参数过渡窗口以交界为中心；`maxDuration` 取非 cut 最大时长；全 cut 显示“无窗口”。
13. 未知通道/未知键/分通道 duration 非正：error；保存/推送阻止。
14. 同一交界叠化 + morph：列表状态“共存”；详情显示 morph 优先区间和叠化可见区间；不自动改 A 的 transition。
15. morph 窗口覆盖整个重叠区：显示“叠化不可见”；可保存；不自动删除叠化。
16. 点“仅保留叠化”：A 的 transition 写 cut；分通道值保留；一次撤销回退。
17. 点“仅保留参数过渡”：B 回 A.end、删除两端 opacity 帧；A 的 transition 不变；一次撤销回退。
18. 片段属性面板没有叠化组/参数过渡组；`transition*` 在属性面板 0 命中；效果面板没有转场行。
19. 主时间轴没有转场节点/转场轨；`camera.inspect` 没有转场编辑 tab；转场面板是唯一编辑入口。
20. 面板关闭/重开保留选中交界和 filter；`docRevision` 变化重建列表；播放头变化不重建文档。
21. 面板只读字段/不写 UI：关闭面板、切换 tab、输入草稿都不写 JSON；`authoring`、`lane`、`selectedBoundary` 在保存输出 0 命中。
22. 模组 `.java` 零改动；不新增消息；不新增脚本字段。
