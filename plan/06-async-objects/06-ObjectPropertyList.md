# 06-ObjectPropertyList：效果控件的对象组与参数列

> 状态：未实现（提案设计）。本轮完整WebUI，13全验后14迁移Forge+AUI。
> 合同：C08独立属性、C03/C04共享状态/命令、C13工作台；界面按[效果控件工作区](../shared/effect-controls-workspace.md)。
> 前置：02-PropertyPathRegistry/Selection/EditorStore；同轮[ClipEffectControlsPanel](06-ClipEffectControlsPanel.md)、[EffectControlsRows](06-EffectControlsRows.md)、PropertyValueForm。

## 一、摘要

本任务是统一片段效果控件的左侧对象/功能组目录与参数列，不再是右侧“点进去才能编辑”的只读导航。它列出当前片段的全部适用组和叶子，行内可委托共用PropertyValueForm修改值；与右侧节点列共享行布局、纵向滚动与局部播放头。点一个属性只选中/高亮，不把其余已展开组隐藏。

快捷属性selection.properties是另一个独立面板，不由本列表替代。两处参数编辑复用同一字段组件/目标解析/命令，不能出现两份值。

## 二、为什么做

### 2.1 已有事实

| 证据 | 实际锚点 | 迁移结论 |
|---|---|---|
| 旧App固定properties/clip/keyframe/triggers标签 | EDITOR:src/App.vue 367–377；src/store.ts 83 | 不再沿旧标签拆出孤立对象/关键帧页 |
| 旧PropertyPanel主要编辑meta | EDITOR:src/components/PropertyPanel.vue 5–17 | 脚本属性与新快捷属性不同，不整篇改名后继续使用 |
| 旧DynamicForm硬编码显隐 | EDITOR:src/components/DynamicForm.vue 23–44 | 改由真实schema与PathRegistry能力决定 |
| section仅编辑器分组、可为null | J:spi/ObjectDef.java 30、54–67；script/schema/SchemaExporter.java exportObject 383 | 功能组只属UI，null归明确扩展/未分组区，不写运行时组 |

来源行号仅作定位，实施前按符号重读。[Olive参考](../references/02-olive-property-keyframes.md)只借行级控件/对齐，不照搬input多分量同步建帧。

### 2.2 目标与非目标

- schema驱动完整目录，字段新增不要求改硬编码路径表；第三方属性保留。
- 参数当前值可直接编辑，不要求选中后跳另一个单属性页面。
- 时钟、当前节点菱形、前后导航三种含义分开；只修改明确目标叶子。
- 搜索/适用性/可用性/折叠/虚拟化与左右行对齐完整落地。
- 不新建运行时对象实例、自由处理链，不重命名标准属性路径，不把脚本级paths/规则树搬进片段目录。

## 三、方案

### 3.1 类级职责

| 提案类/文件 | 职责 | 输入→输出 |
|---|---|---|
| src/model/objectRow.ts | ObjectRow、buildRows/summarize/groupRows | 当前片段+PathRegistry+局部播放头→只读叶子视图 |
| components/objects/ObjectPropertyList.vue | 完整分组/搜索/过滤结果的参数列 | 整片段行集合+共享行布局→可见目录/选择意图 |
| components/objects/ObjectPropertyRow.vue | 名称、值控件、状态/时钟/菱形/导航 | 单行ObjectRow+完整目标→委托值/动画/节点导航命令 |
| components/effects/EffectControlGroup.vue | 组标题、展开/折叠与适用摘要 | 组UI状态→展开/聚焦，不输出组帧 |

本列表只负责参数内容；EffectControlsRows计算左右共同的rowTop/height、可见窗口和节点几何。参数列不另建独立滚动/虚拟化算法，也不访问主时间轴的对象行模型。

### 3.2 行内容与顺序

每叶子显示：完整路径及译名、明确的当前值/未设置或近似状态、mode/interp只读信息、需要的值编辑控件、动画状态、当前时刻节点与前后导航、轴内/轴外计数及可用性原因。不是用“首值→末值”替代当前可编辑目标；节点摘要可以作为辅助，不冒充当前值。

组顺序和组内行顺序按schema能力及声明顺序，不按有帧优先自动重排。section=null归未分组/扩展组，标签可回退原名。position、orientation等默认展开策略是UI偏好，不硬编码排除其他组。多个组同时展开；选yaw只高亮yaw，position仍可见。

### 3.3 适用性、存在性与过滤

| 条件 | 展示/编辑策略 | 数据处理 |
|---|---|---|
| present=false | 列出合法可设置叶子，显示未设置；编辑时按需创建 | 仅查看绝不补默认value |
| requires未满足 | 置灰、可查看已有帧/原因 | 不删数据，不假称可写 |
| appliesTo不适用当前层 | 默认在适用视图过滤，状态/诊断可明确显示原有不适用项 | 层类型切换不静默丢掉旧对象 |
| 未知注册能力 | 保留已有原文/只读项和原因 | 不回退成任意可写字符串 |
| 搜索/全部/有帧/已设置/可编辑 | 只改变显示；空结果与空片段分开文案 | 不重排/删除标准文档，不清空有效Selection |

appliesTo以01/02的统一能力与可用性解析为真源，OVERLAY的layer_type为当前真实来源（TrackSchemas 406–444等）；本组件不复制一套字段名猜测算法。第三方无法解析依赖时明确未知/只读边界，交回能力层，不擅自声称全部适用。

### 3.4 时钟、菱形与导航

| 控件/动作 | 行为 | 不允许 |
|---|---|---|
| 关闭的时钟→启用 | 按原object.enableAnimation仅为目标叶子在明确局部时间建首帧 | 给组内或所有属性补帧 |
| 开启的时钟→关闭 | 确认后按原disableAnimation删目标帧并保留确定value，可撤销 | 因播放头恰有节点就禁用时钟；取消后按钮仍变状态 |
| 当前时刻菱形 | 表示本叶子此时是否有节点，添加/删除走原命令 | 与时钟混成一种状态，或删除其他叶子的同刻节点 |
| 前/后节点 | 跳到本属性前后节点，保留其他展开行 | 改文档、按数组相邻跨属性导航 |
| VALUE | 无时钟/节点，直接使用合法静态值控件 | 强制动画化 |
| EVENT | 按原记录结构显示专用入口/内容 | 自动套连续参数动画 |

首帧初值仍遵循原确定来源顺序：同属性已有精确节点→明确value/默认，允许的编辑器近似须标明；不复制运行时采样器，不用近似当游戏真值。没有合法局部时间或值时显示原因，不能静默clamp/填0。

## 四、技术细节

### 4.1 组合合同

输入当前有效clipKey、只读ScriptDoc/修订、PathRegistry/ObjectRow集合、共享Selection与局部播放头、统一EffectControlsRowLayout/可见窗口。输出选择/展开/过滤、明确值提交目标、动画开关、节点导航或原文档命令；不在列表写原始JSON、保存文件或修改运行时状态。

ObjectRow保持本轮README字段：path/def/present/mode/value/keyframes/计数/availability/atPlayhead。buildRows给完整适用集合；groupRows与过滤只派生视图，Selection主目标与节点批选归02/06命令。UI展开/过滤/列宽按文档会话+clipKey保存，不进入标准脚本。

值控件由PropertyValueForm委托；已动画属性要明确编辑哪个节点或显式添加节点，不能只改不参与采样的value冒充动画已调整。行内未提交草稿保留编辑目标与docRevision，切片段/外部变更时按共享冲突/取消策略处理，不把草稿提交到新对象。

### 4.2 实施步骤

1. 读实际旧App/字段/KeyframePanel以及01/02能力层；确认新宿主clip.effects已冻结，不再给rightTab增加旧object/keyframe切页。
2. 从schema/标准片段派生ObjectRow和组，处理null section、扩展字段、缺省/显式值/轴外计数和依赖原因。
3. 实现ObjectPropertyList/Row与组组件，接统一行布局；多个组可同时展开，选一叶不裁掉其他行。
4. 行内嵌入PropertyValueForm，复用时钟/菱形/前后节点命令；把当前值、明确目标与只读摘要区分。
5. 接搜索/过滤/展开和reveal定位，复用EffectControlsRows可见窗口，不每列独立虚拟化。100+属性保持可达且不扩大主轴高度。
6. 迁移旧DynamicForm显隐/右侧单属性路由及全部调用方，参数目录不再只是只读入口；原脚本meta表单留在其职责位置。
7. 完成双面板同步、取消/失败、不同密度、小窗停靠、保存重开与真实游戏人工检查。

### 4.3 人工验收

| 准备与操作 | 预期 | 异常路径 |
|---|---|---|
| CAMERA展开位置/朝向，选yaw并改当前合法值 | 多组仍可见，只有yaw目标变化，右列同行同步 | 不能切成yaw独占页 |
| y常量、x/yaw有不同节点 | 各有独立状态；只给y启用动画 | x/yaw不补帧，VALUE项无时钟 |
| 关闭x动画并取消/确认/撤销 | 取消无变化；确认只改x且可撤销 | 当前有节点时仍可正确使用时钟 |
| requires不满足、换OVERLAY层类型 | 适用/禁用原因正确，旧对象不静默删 | 第三方/null section仍可发现 |
| 搜索/只看有帧/清过滤 | 显示与计数正确，选择不按下标漂移 | 空结果不冒充空片段 |
| 100+属性、展开曲线/详情并滚动 | 左右同一行，点击不串目标，主轴不展开对象 | 不是一次渲染全部行或独立列错位 |
| 快捷属性改同一值并撤销/重开 | 效果控件一致回显，标准文档无UI字段 | 不出现第二份节点/历史 |

完成定义：目录/参数列及全部模式/错误/适用性真实可用；不是只列路径或只有单属性入口。人工验证标准保存/parse/validate及游戏；未执行不得填通过。13后14完整迁移同语义，不预设AUI列表回收已实证，也不省略必要性能与拖动能力。

## 五、为什么不选别的

不把每个叶子做成大卡片，不把列表放回主轴，不使用选择即单属性切页，不将列表严格只读后强迫去右侧找控件，也不从组容器生成同步帧。按组组织、叶子成行，才能同时保留整体处理结构和独立关键帧。代价是参数列须与节点列统一布局和命令回显，但不能用两套模型绕开。

## 六、实现结果

未实现。本次替换的是旧只读导航/独占面板思路，schema能力、独立时间、原子命令和真实预览原则不变。只交实施文档，未改代码或运行构建/游戏/参考软件，未新增自动化测试。来源实施前按符号重读。
