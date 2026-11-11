# 02-LegacyConsumerCutover：旧前端调用方干净切换

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现；仅计划。合同C01/C02/C04，前置本轮标准文档、对象模型、序列化、DocumentIO。

## 一、摘要

本任务迁移的是**编辑器旧代码的调用方**，不是给产品增加旧脚本格式转换器。新编辑器直接使用0.3.6标准objects模型；旧version/total_duration/整帧keyframes等格式由实际校验明确拒绝，不在打开流程隐藏一套升级器，也不另写Java LegacyMigrator。

## 二、为什么做

现有EDITOR:src/types.ts（63–208）与schema.ts（58–78、117–141）仍以旧字段为合同；store.ts与operations.ts继续创建、裁切和保存整帧数据。只换types会留下旧消费者；只在保存时转换则无法表达独立异步关键帧。目标是迁移全部调用者后删除废弃代码，不做用户未要求的历史数据自动升级。

## 三、方案

| 现有文件/职责 | 必须切换的行为 | 责任交接 |
|---|---|---|
| types.ts | 删除meta.version、timeline.total_duration、旧Keyframe/PositionData/BezierCurve与旧屏幕开关，改用本轮标准结构 | 本轮唯一模型所有者 |
| schema.ts | 不再读tracks.clips/keyframes，不再按整帧fillDefaults或stripDefaults | 01能力索引+02序列化 |
| store.ts | 加载不改写原数据；新建/保存/推送共用标准文档，停止bootstrap旧字段 | 02-DocumentIO/EditorStore |
| operations.ts | 编辑命令按对象路径/局部时间操作，不由通用整帧补值/裁切改变其他属性 | 02命令合同；05/06实现各操作 |
| demo.ts/PresetsPanel.vue | 用标准夹具与模板展开替代旧脚本生成；不能留隐藏旧演示入口 | 01.06、12 |
| Timeline/ClipPanel/KeyframePanel/PropertyPanel | 消费新合同，不搭临时反向整帧投影 | 05/06与01 |
| i18n/旧字段组件 | 删除失效路由和标签，保留有明确新用途的通用输入控件 | 各责任轮同步完成 |

本轮保证标准模型/命令/IO切换及下游接口冻结，不要求提前实现05/06的全部交互。后轮只实现既定新接口，不得反过来要求02保留旧格式垫片。本轮不得留下已授权切换范围内的旧读写路径。

## 四、技术细节

### 必读源码

- J:script/ScriptParser.java — metaKeys/timelineKeys（76–89）、parseMeta（193–211）、parseObjectClip（355–412）。
- J:script/object/ObjectParser.java — CLIP_KEYS及parse（实施时读当前符号）；J:script/schema/SchemaExporter.java — exportAll（42–141）。
- EDITOR:src/types.ts（63–208、224–243）；schema.ts（58–78、117–141）；operations.ts — keyframes（45–46）、splitClip及validateScript（执行前读当前实现）；store.ts — maintainInvariants/loadScript/newScript/saveScript。

### 输入输出与步骤

输入：现有调用点清单、01 schema能力和本轮标准文档/命令合同。输出：全部受影响调用者迁移、废弃类型/函数/别名移除、合法新格式黄金场景与旧格式拒绝场景。

1. 用引用/目标搜索列出旧字段读写及返回值消费者，给每处指定本轮或后轮明确所有者；不得只grep后删关键词。
2. 共享types/store/operations由单一集成所有者修改；先冻结新接口，再迁移调用方。不能让多个子代理并写同一文件。
3. 删除只为旧模型存在的代码与再导出，不留下旧→新→旧转换、LegacyMigrator、自动降级或隐藏兼容入口。
4. 非0.3.6输入显示可定位错误、保持文件不变；可以提示采用独立且已存在的迁移工具，但本任务不创建新转换器、不猜测等价转换。
5. 02序列化、DocumentIO和本轮README按同一边界更新；将本任务重命名为02-LegacyConsumerCutover.md，修复所有引用。

### 两载体与禁止项

WebUI使用同一新文档（本轮出口）；游戏内Forge消费共享合同是14迁移要求，届时不另实现一份Java旧格式转换器。WebUI对接Forge/Fabric主模组均不受AUI故障影响；仅游戏内Fabric+AUI适配暂缓，见shared/host-scope.md。禁止为了迁移前端而改主模组格式；禁止丢掉新脚本的未知扩展原文；禁止自动把不支持的STRUCT动画取首帧后声称无损。

### 验收与完成定义

合法objects脚本打开/编辑/撤销/保存/重载语义不变；独立属性时间序列不补齐为同步帧；新建不生成旧键；标准payload通过真实parser/validator。旧version、total_duration和片段级keyframes输入明确拒绝或只读诊断，不修改原文件、不创建伪迁移产物。全部授权旧调用方迁移完、无旧模型别名与兼容分支后完成。后轮新交互尚未实施不冒充02已经交付，已切换IO也不得为其保留旧写出路径。

## 五、为什么不选别的

不把历史转换器加入必做：用户要求基于0.3.6完整编辑器，不要求迁移历史工程；旧规则/默认值/路径参考空间的等价性不能靠现有新schema猜。干净切换减少第二套语义，代价是旧脚本不能在本编辑器里自动升级；这一边界必须明确而不是静默丢字段。

## 六、实现结果

未实现。本任务是旧消费者切换的实施指导，不是历史脚本兼容承诺。
