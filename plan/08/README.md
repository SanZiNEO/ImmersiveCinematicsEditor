# 08 镜头、叠化与 lane 合成

## 目标

把 CAMERA 轨道补成完整的镜头作者面。08 只写固定的 CAMERA 脚本字段，不改运行时求值、合成和过渡算法；编辑器写完后用现有 `editor.pushScript` 把完整脚本推给游戏，再用 `editor.seek` / `editor.play` 看真实结果。

08 做七件事：

1. CAMERA 片段的镜头字段全部有编辑归属：`fov/zoom`、合成矩形与遮罩、57 个调色通道 + 10 条调色曲线、手持呼吸、覆盖链 `modifier`、选择器策略。
2. 新增独立**转场面板**：以 A→B 交界为编辑对象，不走片段属性入口，不在主时间轴画转场节点。
3. **叠化 / crossfade** 可编辑：A 片段位置不动，B 片段前移 D 秒，两段真实重叠 D 秒；A 保持不透明，B 在重叠区从 0 淡入到 1。
4. **参数过渡**可编辑：`transition=morph` 时的 `position / yaw / pitch / roll / fov / zoom` 六通道 `mode / duration / curve`，再加 `transition_interrupt`；它不是画面叠化。同一交界允许与叠化共存，面板显示 morph 优先区间和叠化可见区间。
5. 多 lane 合成有可读视图：当前播放头下哪些片段产出 lane、lane 顺序、每 lane 的合成参数、覆盖链和调色归属。
6. 连续性可解释：`play_mode / priority / interruptible / skippable / hold_at_end / macro_loop*`、片段循环、参数过渡打断与循环交界。
7. 玩家移动可预演：EVENT 轨的 `Position` 目标点、相对基准、到达判定和循环复位。

## 设计基线

08 的设计输入只有：

- 02 字段目录：CAMERA 的 `section/group/mode/type/interp/requires/def`。
- 03 文档模型：`clips` / `objects` / `AnimObject` / `Selection` / `commit` / `serializeDoc`。
- 04 插件与布局：`pluginId`、layout tree、`PanelContext`、`document.drawer`、`document.right`。
- 05 面板槽位：`selection.properties`、`clip.effects`、`timeline.main`、`document.drawer`、`document.right`。
- 06 双面板：属性面板列全部适用属性，效果面板只列已有关键帧的属性；`PanelMembershipMode` 默认 `leaf`。
- 07 组合层与路径：位置、朝向、`motion_*`、路径与曲线编辑都沿用 07 的模块和行控件。
- 模组当前代码与合同：`plans/0.3.6/D-transition/scene-transition.md`、`plans/0.3.6/F-playback/camera-composition.md`、`CameraLaneComposite`、`LaneCompositor`、`ScriptLaneDriver`、`CameraTrackPlayer`、`TransitionSpec`。

08 新增的 `TransitionBoundary`、`CrossfadeLayoutDoc`、`CameraTransitionDoc`、`LaneViewModel`、`CameraInspectPanel`、`TransitionPanel`、`PlaybackCheck` 都是编辑器模块；它们消费现有合同和固定脚本格式，不反向定义运行时结构。

## 交付物

| 文档 | 交付内容 |
|---|---|
| [08-01-camera-field-surface](08-01-camera-field-surface.md) | CAMERA 字段分组、属性/效果面板路由、合成/遮罩/呼吸/修饰符/选择器/调色行、特殊字段编辑 |
| [08-02-transition-model](08-02-transition-model.md) | 边界操作、叠化布局与落盘、两条 lane、opacity 规则；参数过渡字段、六通道默认与覆盖、窗口口径、本地校验；共存与遮蔽 |
| [08-03-transition-editor](08-03-transition-editor.md) | 独立转场面板、交界列表、叠化详情、参数过渡表、共存处理、提交与撤销 |
| [08-04-lane-view-model](08-04-lane-view-model.md) | lane 是运行时产物、活跃片段/顺序/合成参数映射、叠化双 lane、morph 单 lane、共存、覆盖链、颜色归属、不写快照 |
| [08-05-camera-inspect-panel](08-05-camera-inspect-panel.md) | `camera.inspect` 面板、lane 表、选中/定位、空态、播放头联动 |
| [08-06-continuity-panel](08-06-continuity-panel.md) | 跨脚本/同脚本播放关系、队列、打断、末尾保持、宏循环、片段循环、叠化重叠区与参数过渡交界 |
| [08-07-player-movement-preview](08-07-player-movement-preview.md) | EVENT `Position` 目标、相对基准、`ARRIVE_EPS`、循环复位、XZ 预演 |
| [08-08-playback-check](08-08-playback-check.md) | 校验、`pushScript`、`seek/play/pause/stop`、状态回执、真实画面检查 |
| [08-09-r8-acceptance](08-09-r8-acceptance.md) | 字段、转场面板、叠化、参数过渡、共存、lane、连续性、玩家移动、回放、模组零改动验收矩阵 |
| `README.md` | 入口、面板归属、固定格式、实施顺序、完成定义 |

## 面板归属

| 内容 | 面板/位置 | 规则 |
|---|---|---|
| `fov` / `zoom`、`opacity`、`dest.*` / `source.*`、`mask_*`、`dimension`、`cam_breath_*`、`modifier`、`selector_*`、57 个调色通道 | `selection.properties` | 属性面板按 `section` 分组；静态/未设置行在这里；没有关键帧时没有节点轴 |
| 已有关键帧的上述叶子 | `clip.effects` | 效果面板按 06 `leaf` 策略只列 `keyframes.length > 0` 的叶子；不出现整组全字段 |
| 叠化 / crossfade、参数过渡、共存 | `transition.panel` | **唯一编辑入口**；以 A→B 交界为对象；不写片段属性组；不进入 `clip.effects` |
| `transition*` 字段 | `transition.panel` | 这些是 `VALUE` 字段，没有时钟；六通道表在面板内展开；片段属性面板不列该组 |
| B 的 `composite.opacity` | `clip.effects`（有帧时） | 叠化写入的是普通 opacity 关键帧；有帧后按 06 进入效果面板，没有“叠化”节点 |
| 10 条调色曲线 | `selection.properties` 的“调色曲线”行 | `VALUE` + `STRUCT`；行打开 `ColorCurveSheet`，写控制点数组 |
| 位置、朝向、`motion_*` | `selection.properties` / `clip.effects` | 沿用 07；08 不复制这些行 |
| lane 列表、覆盖链、连续性、玩家移动、回放检查 | `camera.inspect` | 文档级抽屉面板，默认 `document.drawer`；内部 tab 切换，不占主时间轴 |
| 主时间轴 | `timeline.main` | 只编排轨道/片段/标记；不新增 lane 轨、不画叠化节点、不画参数过渡节点、不画对象行、不画交界手柄 |

`camera.inspect` 的插件：

```text
pluginId      core.camera-inspect
panelId       camera.inspect
defaultSlot   document.drawer
keepAlive     true
singleton     true
available     pageId==='document' && hasDoc
tabs          lanes / continuity / player / playback
```

转场面板是独立插件：

```text
pluginId      core.transition-panel
panelId       transition.panel
defaultSlot   document.right
closable      true
singleton     true
keepAlive     true
available     pageId==='document' && hasDoc
```

## 五条主线

### 字段面

CAMERA 字段不另开检查器页。06 的属性面板/效果面板已经按 02 目录派生行；08 只补四类特殊编辑：

- 合成矩形 `dest/source` 的归一化输入与遮罩形状门禁。
- `modifier` 的通道掩码/优先级/逐通道值。
- `selector` 的通用行与调用点覆盖行。
- 调色曲线的控制点表。

普通 float/enum/bool/ref/string 行继续用 06 的九种值控件；不出现第二份字段表。`transition*` 不进入片段属性面板，统一由 `transition.panel` 承载。

### 叠化 / crossfade

叠化是画面效果，不是 `transition` 字段。落盘只改片段落点和上层不透明度：

```text
A.start_time 不动
A.duration   不动
B.start_time = A.end - D
B.duration   不动
重叠区       [B.start_time, A.end)
D            = 叠化时长 = B 前移量
```

- 同一 CAMERA 轨道内 A、B 相邻；B 在数组后面，是上层；A 是下层。
- A 的 `composite.opacity` 在重叠区保持 1；B 的 `composite.opacity` 从本地 0 的 0 到本地 D 的 1。
- 合成结果是“下层不透明、上层淡入”，视觉上就是两张画面交叉淡化；不靠 `transition` 生成。
- 应用叠化**不自动**改 A 的 `transition`；如果 A 原本是 `morph`，两者共存，面板显示 morph 优先区间。
- 叠化与参数过渡允许共存，不强制二选一；共存不表示两种画面效果同时叠加。
- 不新增 `crossfade` 字段、不新增消息、不新增本地运行时。

### 参数过渡

参数过渡属于**出场片段**，不属于下一片段。只有 `transition=morph` 且片段有限时，运行时才会在片段末端打开窗口；`transition_params` 是一个 `VALUE` 对象，内部按六通道名存放 `mode/duration/curve`，不生成六条独立 `AnimObject`。

六通道名与位序固定：

```text
position / yaw / pitch / roll / fov / zoom
```

默认：全通道 `blend`、时长取片段 `transition_duration`、曲线取 `transition_curve`、打断规则 `blend`。每通道可声明覆盖；`cut` 不占窗口，`hold` 在窗口内保持 A 侧，`blend` 按曲线混合。窗口以片段交界为中心，前后各取 `maxDuration/2`；这是六参数混合，不是画面叠化。

### lane

lane 不是脚本字段，也不是持久轨道。它是运行时按当前播放头从活跃 CAMERA 片段算出的画面快照：

- 单片段 = 一条 lane。
- 重叠片段 = 多条 lane，顺序按轨道内片段顺序，后面的在上。
- 叠化 = A、B 各一条全屏 lane；A 在下、`opacity=1`，B 在上、`opacity 0→1`；编辑器标 `role=crossfade`，运行时没有该字段。
- `morph` 窗口 = 前后两个片段合成一条 lane，合成参数取进入的片段；morph 窗口内优先于同区叠化；窗口外仍可能按普通多 lane 合成。
- 覆盖链在 lane 之上做 Base 选择与 Modifier 合成，Modifier 不进入 lane 快照。

`camera.inspect` 的 lane 表是对这些规则的编辑期解释；真实画面和最终合成仍以游戏回放为准。

### 连续性、玩家移动与回放

- `camera.inspect` 的连续性 tab 只读解释播放关系、循环和交界；不写脚本。
- 玩家移动 tab 只读 EVENT `Position` 目标；编辑仍归 06 / 11 的事件面板。
- 回放检查只发已有消息：`script.validate`、`editor.pushScript`、`editor.seek`、`editor.play/pause/stop`、`playback.state`；不新增 type。
- 真实结果以游戏预览为准；编辑器不采样像素、不做本地渲染。

## 固定格式

08 只写这些已有字段：

```text
script
  timeline
    tracks[]
      clips[]
        start_time?        number（内联片段必填）
        duration           number
        objects[path]      AnimObject { value?, keyframes?, authoring? }
          transition?            "cut" | "morph"
          transition_duration?   number
          transition_curve?      MathModel
          transition_params?     { <channel>: { mode?, duration?, curve? } }
          transition_interrupt?  "blend" | "snap"
          composite.opacity?      number / keyframes
          composite.dest.*       number / keyframes
          composite.source.*     number / keyframes
          composite.mask_*       number / keyframes
```

- `transition_params` 是单个 `objects` 路径，内部是普通 JSON 对象；不把六个通道写成六个对象。
- 叠化只写 `clips[B].start_time` 与 `clips[B].objects['composite.opacity']`；不写 A 的 `objects['transition']`。
- `transition*` 只由参数过渡使用；叠化不使用这些字段。
- `authoring`、`clipKey`、lane 视图、选中态、窗口示意、播放状态、面板选中都不写盘。
- 不写版本号、总时长、片段级关键帧、片段级曲线、lane 数组、交界数组。
- 所有引用字段仍是字符串；不写运行时 `CameraLane` / `LaneFrame` 快照。

## 实施顺序

1. 先落 `08-01` 的字段路由和特殊编辑器：合成、遮罩、呼吸、修饰符、选择器、调色曲线；把 `transition*` 从片段属性面板移出。
2. 落 `08-03` 的 `transition.panel` 外壳、交界列表和空态；`transition*` 的编辑只在面板里出现。
3. 落 `08-02` 的叠化模型与校验，再接 `08-03` 的叠化详情和布局条。
4. 落 `08-02` 的参数过渡模型与校验，再接 `08-03` 的六通道表；叠化与参数过渡共用面板外壳，不共用提交路径。
5. 用 `08-04` 冻结 lane 视图模型，再落 `08-05` 的 `camera.inspect` 外壳和 lane 表。
6. 接 `08-06` 的连续性诊断和 `08-07` 的玩家移动预演。
7. 接 `08-08` 的校验、推送、跳转、播放、暂停、停止。
8. 跑 `08-09` 全矩阵和真游戏冒烟；模组 `.java` 保持零改动。

## 完成定义

- CAMERA 的每个 `section` 都有面板归属；已有关键帧的叶子按 06 进入效果面板；`transition*` 只在 `transition.panel`，不在片段属性面板。
- 打开转场面板，能按轨道列出所有相邻交界；选中 `A→B` 能完成叠化：A 不动、B 前移 D、重叠 D、B 的 opacity 0→1；应用一次提交，撤销一次回退。
- 同一交界能编辑六通道参数过渡；`transition=morph` 时窗口、模式、时长、曲线、打断规则都能在提交前解释。
- 同一交界叠化 + 参数过渡可以共存；面板显示 morph 优先区间和叠化可见区间，不自动改 A 的 `transition`，不自动删除任一方。
- 重叠 CAMERA 片段在 `camera.inspect` 中按真实规则列出 lane 顺序、合成参数、覆盖链和调色归属；面板不写运行时快照。
- 连续性面板能指出同脚本替换/排队、跨脚本并行/排队/打断、末尾保持、宏循环、片段循环、叠化重叠区与参数过渡交界的当前结果。
- EVENT `Position` 能画出目标点、相对基准、到达阈值和循环复位；只读，不写事件记录。
- “推送并回放”走现有 `editor.pushScript` / `editor.seek` / `editor.play`，真实画面来自游戏；不新增消息。
- `script.validate` 通过；保存重开无损；无 UI 字段写盘；模组仓库零改动。
