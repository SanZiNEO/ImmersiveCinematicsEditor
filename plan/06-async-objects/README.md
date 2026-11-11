# 06 异步对象与统一片段效果控件

> 状态：未实现（全部为实施指导；旧源码不是新版成果）。
> 范围：本轮完整实现/人工验收WebUI，正常对接主模组Forge/Fabric；13全验后14迁移Forge+AUI，仅游戏内Fabric+AUI暂缓。
> 前置：01 schema、02标准文档/身份/命令、05主时间轴与双面板宿主；后续07–12复用本轮对象行/控件/命令。
> 界面权威：[片段效果控件工作区](../shared/effect-controls-workspace.md)。源码前缀沿[02基线](../02-model-contracts/README.md)。

## 一、摘要

以一个片段为上下文，在统一效果控件clip.effects中同时组织多个对象/功能组：左侧参数与值控件，右侧在同一片段局部标尺上展示每个叶子自己的关键帧组。右侧selection.properties是独立快捷属性面板，可同时显示，复用同一值控件、Selection和命令，不再有自己的节点时间轴。

主时间轴只编排轨道与片段，不显示属性节点、对象展开或关键帧汇总点。异步的含义是各属性的数据与时间独立，不是必须为每个属性创建一个独占页面。九个类/模块任务仍完整覆盖模式、值类型、事件、缓动、轴外、诊断和命令；只是按新的创作流程重新分工。

## 二、为什么做

### 2.1 已有事实与问题

| 当前源码事实 | 迁移锚点 | 新版必须改变的部分 |
|---|---|---|
| KeyframePanel按clip.keyframes取整帧，旧schema也读keyframes | EDITOR:src/components/KeyframePanel.vue 12、16、129–161 | 删除整帧路径，容器读取整个片段的objects但命令精确到叶子 |
| 添加/插值跨字段填帧 | EDITOR:src/operations.ts interpolateNewKeyframe 190–215、copyKeyframeProperties 713–739、interpolateKeyframe 740–768 | 单属性命令不补其他字段；显式批量保留原允许范围 |
| 主时间轴画整帧菱形并按下标拖动 | EDITOR:src/components/Timeline.vue 342–366、756–763 | 从主时间轴删除节点交互，不改成主轴对象子行 |
| 保存/推送按整片段通道烘焙 | EDITOR:src/operations.ts 370–416、854–897 | 原属性段作者元数据+显式烘焙，保存/推送不隐式烘焙 |
| 编译对每属性过滤范围并独立采样 | J:script/object/SampledProperty.java 42–111、153–213；ObjectKeyframe.java 12 | 统一展示仍保留独立时间、time/value及轴外数据 |

旧组件名只用于定位迁移源，不是目标信息架构。参考[Olive属性交互](../references/02-olive-property-keyframes.md)借秒表/菱形/对齐与事务，不搬同步分量补帧、自由帧插值、静默钳制或本地播放器。

### 2.2 目标与非目标

- 统一片段上下文、多组/多属性同时可见；选中叶子只改变目标与高亮。
- 主时间轴没有节点和对象展开；对象多也不撑高编排轨道。
- VALUE/ANIMATED/EVENT、STEP/null/引用/STRUCT与字段适用性继续按schema。
- 局部视口、行命中、虚拟化、轴外可达、快捷属性联动由本轮实际完成，不留给05/14。
- 不改标准格式，不创建运行时组、任意效果链或新帧类型；不复制游戏采样/渲染。

## 三、方案

### 3.1 用户看到的工作区

| 区域 | 本轮内容 | 交互结果 |
|---|---|---|
| 效果控件顶部 | 当前片段、轨道/身份、时长、局部标尺与播放头 | 一个片段上下文，不按当前属性切换容器 |
| 左侧对象/参数列 | 功能组、叶子路径/标签、当前值、可用性、秒表/菱形/导航 | 多组同时展开，值可委托共用控件行内提交 |
| 右侧节点列 | 与左侧同行的各属性独立节点组/适用详情 | 共享局部标尺，不合并同刻不同属性节点 |
| 快捷属性面板 | 当前片段/对象组/叶子/节点的常用参数与定位入口 | 与效果控件同时可见、同值命令回显，无第二条节点轴 |
| 主时间轴 | 05轨道/片段编排与全局播放头 | 只选/移/裁/分片段，节点编辑不在这里 |

组按schema.section与真实能力组织，CAMERA位置/朝向/光学、OVERLAY适用内容/几何/透明度、AUDIO音源/监听、ADJUST调色等定制落点见共享工作区§3.4。组只是UI：position.x/y/z仍是独立叶子，不输出position组帧。脚本meta、触发、规则、paths仍有原文档/行为/路径入口。

### 3.2 属性行模型

ObjectRow沿用src/model/objectRow.ts提案：path、def、present、mode、value、keyframes、inRangeCount、outOfRangeCount、available/unavailableReason、atPlayhead。派生规则不变：

- present根据标准objects中是否显式出现，不按“是否等于默认”判断；仅查看不创建value。
- mode/type/interp/default/requires/appliesTo来自01/02注册能力；缺省与null/空集合语义不自动归一。
- atPlayhead按本属性局部节点时间定位；节点身份仍是clipKey+完整路径+可变time，由命令old→new映射修复。
- 有限片段0≤t≤duration轴内，合法t>duration轴外；无限片段合法t≥0轴内。
- 完整行集合由当前片段派生；过滤/折叠只改UI。选中yaw不把其他已展开行从集合移走。

EffectControlGroup与EffectControlRowLayout只提供UI分组和左右行几何，不写脚本。多个叶子共用一个EffectControlsViewport，但不是共用节点时间数组。主轴全局viewport与效果局部viewport分开；可以复用纯换算函数，不共用可变滚动/缩放状态。

### 3.3 命令与模式（语义保持）

| 原命令 | 保留语义 | 失败/边界 |
|---|---|---|
| object.enableAnimation | 仅目标叶子在明确局部时间建立首帧，取确定初值 | 非ANIMATED、非法时间或目标冲突不写入 |
| object.disableAnimation | 确认后删目标叶子帧并保留确定value，可撤销 | 取消不改；秒表不因当前有帧就失效 |
| object.setValue | 写明确value目标 | 有动画时不假称只改value能改变采样结果 |
| object.addKeyframe | 在目标属性添加time/value | 同属性重复时间按原±1e-4规则拒绝；不补其他叶子 |
| object.removeKeyframe | 删明确路径/time节点 | 事件非空与路径端点影响仍按原任务/真实消费者 |
| object.moveKeyframe | 改明确节点时间并返回映射 | 同属性重合、路径/引用冲突整次拒绝 |
| object.setKeyframeValue | 改明确节点值 | 类型/范围错误拒绝，未提交草稿不写 |
| object.setEasing | 该属性相邻节点段的作者元数据 | mode/interp只读，不新造运行时easing |
| object.bakeEasing | 显式将支持属性的所选段烘焙为普通节点 | STEP/VALUE/EVENT及paths/orient/offset等原禁止项不烘焙 |

静态值和动画当前时刻节点的写目标由PropertyValueForm明确解析；没有节点时添加必须是显式命令，不静默补帧。原允许的节点批选操作仍逐属性检查、一次命令全成或全败；统一可见不新增跨属性批量改值或兄弟分量自动联选。

### 3.4 轴外、事件与缓动

轴外节点保留/可编辑/可拖回/保存，运行时按原窗口过滤；显示仅扩展效果控件局部范围，不拉宽主时间轴片段。缩短片段不删帧、不钳制、不补边界。

EVENT/MOD_EVENT复用06记录组件并由11补专用内容/执行语义；常量text等不能因为截图里有动画按钮就变成可动画字段。缓动仍在AnimObject.authoring.easing中、只作作者段信息，不写标准节点；显式烘焙支持段后可撤销，保存/推送不暗改。路径/几何示意不是游戏画面或新采样真值。

## 四、技术细节

### 4.1 九个类/模块任务

| 任务 | 唯一责任 | 核心输入→输出 |
|---|---|---|
| [06-ObjectPropertyList](06-ObjectPropertyList.md) | 适用组与左参数列、搜索/过滤/可用性/时钟 | 当前片段+schema→完整组/行与选择/值/动画意图 |
| [06-ClipEffectControlsPanel](06-ClipEffectControlsPanel.md) | 统一片段容器、上下文与各业务组件组合 | 文档/Selection→完整效果控件与seek/命令 |
| [06-KeyframeEditOps](06-KeyframeEditOps.md) | 原节点/批选/复制粘贴/吸附原子命令 | 路径/time目标→标准文档事务/映射/错误 |
| [06-PropertyValueForm](06-PropertyValueForm.md) | 九类控件、明确写目标、快捷属性内容 | schema+目标→同一值控件/提交/错误 |
| [06-StepNullableAndEnum](06-StepNullableAndEnum.md) | STEP、nullable、枚举/引用/STRUCT边界 | schema与值→适用显示/合法提交 |
| [06-EasingAuthoringBake](06-EasingAuthoringBake.md) | 原属性段作者缓动与显式烘焙 | 单属性段→元数据/支持节点事务 |
| [06-EventRecordEditor](06-EventRecordEditor.md) | 事件记录基础内容 | EVENT_RECORD→记录/诊断/命令 |
| [06-EffectControlsRows](06-EffectControlsRows.md) | 局部视口、左右行对齐、节点渲染命中/虚拟化/轴外 | 完整行/局部窗口→可见几何/节点意图 |
| [06-ObjectDiagnostics](06-ObjectDiagnostics.md) | 原异步诊断与效果控件定位 | issues/标准位置→片段组/叶子/节点reveal |

### 4.2 运行时类与依赖边界

| 运行时来源 | 编辑器使用方式 |
|---|---|
| script/object/ObjectKeyframe、SampledProperty | time/value、独立时间、窗口与插值语义的依据 |
| SampledProperty.Compiled、ClipSampler、SampledClip、ClipRuntimeCache、ClipValueView、ObjectSlotLayout | 引擎内部只依赖，不复制其缓存/槽位/采样真值 |
| spi/Interp、PropertyMode、PropertyType | 只读能力，决定控件与显示，不提供任意改插值 |
| script/schema/TrackSchemas与SchemaExporter | 从schema.get消费，注册扩展不被硬编码截断 |
| script/path/PathCollectionParser与02引用命令 | 位置节点并集/端点相邻/重绑依据；本轮不随意改规则 |

### 4.3 实施顺序与轮次边界

1. 接05的clip.effects与selection.properties两个独立宿主；05只负责容器、焦点和错误合同，不提前实现06内容。
2. 先冻结ObjectRow/组/Selection/EffectControlsViewport的UI合同，再并行实现列表、容器、行几何与值控件；共享类型/命令由一个集成所有者修改。
3. 接原节点/事件/缓动/诊断，迁移所有旧KeyframePanel/Timeline下标与整帧调用，删除旧模型路径，不保留兼容页。
4. 06独立完成局部缩放/滚动/虚拟化/节点拖动/取消和轴外定位，不再把这些工作指给05主轴。
5. 人工完成全部九任务、两面板同步、真实validate/parse/游戏、保存重载/错误与恢复后结束本轮；14仅在13通过后迁移完整同义能力，不缩水为点选。

### 4.4 人工轮次出口

- x/y/z、yaw等不同节点时刻在同一面板清楚对照；修改单属性不影响其他属性。
- 主时间轴100+属性片段仍只显示片段，任何菜单/快捷键均不在主轴编辑节点。
- 两面板可同时停靠、独立尺寸、同值回显；快速切选择/文档、删除/撤销不串写；IME/焦点作用域明确。
- 轴外与无限节点、STEP、null/枚举/引用/STRUCT、事件、缓动允许/禁止项均按原消费者；冲突全回滚。
- 诊断/路径/取景/字幕从同一Selection定位效果控件；局部/global映射正确，独立片段不混进主轴。
- 旧整帧数组/插值/通道表/边界补帧退役；标准保存无新UI字段，真实游戏画面是唯一动态预览。

按shared/manual-acceptance逐项人工实际使用与复验，不新增自动化测试/单测/CI/测试脚本；尚未操作的检查不得填通过。

## 五、为什么不选别的

| 未采用方向 | 原因 |
|---|---|
| 主时间轴展开对象/属性行 | 把整体编排挤成参数表，与用户截图明确的分工相反 |
| 选属性后只显示一个面板 | 无法同时比较同片段其他处理，不是统一效果控件 |
| 每叶子一张大卡片/一个独立时钟 | 空间和时间对照失控；组可折叠、叶子成行、共享局部标尺 |
| 同刻节点合并/整帧填充 | 破坏异步时间与引用身份 |
| 默认值补齐或轴外钳制 | 改动作者数据，破坏无损和运行语义 |
| PR效果链/本地播放器照搬 | 模组不认识这些格式，预览也不是媒体播放器 |

代价是局部视口、左右同步与双面板命令回显需要完整实现；但复杂度留在片段参数工作区，不污染主时间轴和标准脚本。缓动/时钟操作仍需清楚确认与撤销。

## 六、实现结果

未实现。已将计划从主轴对象行/单属性独占页改为统一片段效果控件及独立快捷属性；不表示旧源码已迁移。全部原0.3.6能力、原命令/字段语义和九任务出口保留，只有界面承载与类职责改变。本次只写文档，不运行编辑器/游戏/构建，不预填验收。
