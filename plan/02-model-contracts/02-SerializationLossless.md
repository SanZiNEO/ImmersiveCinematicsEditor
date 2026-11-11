# 02-SerializationLossless：无损序列化与人工往返检查

> 状态：未实现。合同C02/C04，前置标准文档、AnimObject、PropertyPathRegistry。当前轮只实现WebUI；13完整人工使用验收后，14再迁移AUI。不新增自动化测试、比较器、CI或测试脚本。

## 一、摘要

保存与预览推送使用同一标准文档写出规则，保留作者未改动的字段、独立属性时间、显式值和引用；编辑器状态不进入运行脚本。正确性通过人工打开、修改、撤销、保存、重载和游戏播放检查，不建设往返断言工具。

## 二、为什么做

现有EDITOR:src/schema.ts — stripDefaults（95–115）、stripScriptDefaults（118–142）只处理旧clip/keyframes；store.ts的保存/推送又调用自动烘焙和精简。新objects模型区分声明/未声明、value与关键帧、null与数值，随手删默认或补帧会改变含义。

目标：未编辑数据不丢，修改只影响指定对象，保存可被实际模组解析播放；非目标：字节完全一致、历史格式升级、自动化测试工具或通用JSON规范化。

## 三、方案

### 3.1 必须保留

- meta合法字段，包括parser实际要求的空author字符串；screen_layers的显式true/false及动态键。
- timeline.loop_start/loop_end、轨道/片段顺序、clip播放控制/运行时id/exit，以及顶层独立clips/rules/rule_bindings/paths和引用。
- objects的value、keyframes、显式默认、nullable值、STRUCT嵌套结构；不因等于默认值自动删除。
- 属性各自的节点时间/值，超窗口节点保留并标不生效；不补齐到其他属性时间，不裁掉作者数据。
- 原始数字按作者输入保留，不为比较而对所有数字统一float32化；运行时类型转换只用于解释实际播放，不反向改写JSON。
- 合法扩展原文与未知根键按文档/能力合同保留并说明；不能因为当前无专用表单就静默丢弃。

### 3.2 不写入运行脚本

clipKey、Selection、节点批选、主题/布局/窗口、图坐标、marker、纯工作区A–B范围、模板来源、字幕批次/源文件等编辑器元数据。它们进入会话或sidecar，不能增加parser不认识的键。脚本级loop字段与工作区范围分开。

### 3.3 形态按实际解析器

J:script/object/ObjectParser.parseProperty（92–129）允许ANIMATED属性保留value与keyframes，空数组也可能合法；VALUE禁止出现keyframes，EVENT要求非空记录。不要按格式说明的简化表格额外收紧。J:script/object/SampledProperty（55–110）提供实际模式约束。

## 四、技术细节

### 4.1 来源与类级任务

- J:script/ScriptParser — parseMeta（193–211）、parseStandaloneClips（437–489）；ObjectParser.readTime（167–177）；ObjectCodec负责实际值转换。
- J:script/object/ClipValueView.declared与SampledClip.present：显式声明不能自动视为缺省。
- J:script/path/PathCollectionParser.parseEntry（114–189）、parseAxes（193–224）：端点/相邻性/选轴。
- EDITOR:src/store.ts — saveScript/pushScript，src/schema.ts精简路径、src/operations.ts旧烘焙：实施前按当前符号重读。

拟新增或复用serializeDoc（产品序列化职责，不是测试比较器）：输入标准文档和明确预览副本策略，输出模组可读取的JSON或可定位错误。只剥离编辑器元数据；不创建assertLossless、LosslessAssert、normalizeForCompare等仅为自动验收存在的代码。

### 4.2 实施步骤

1. 保存和push共享同一标准序列化规则，预览专用静音等只处理副本，不能污染当前文档或最终保存。
2. 迁移旧schema精简/补默认调用方，删除失效stripScriptDefaults等旧模型逻辑；读取不自动修改文档。
3. 缓动烘焙只用06明确的属性段编辑命令，不在每次保存时暗改全部轨道。
4. 保存前人工触发或按产品正常流程取得模组校验结果；阻断错误不继续写盘，警告明确展示。成功回执后才清脏，失败保留草稿。
5. 路径节点变化按02身份/引用事务更新，不用排序/近似时间猜引用；失败全回滚。

### 4.3 人工验收场景

| 场景 | 人工操作 | 观察 |
|---|---|---|
| 最小合法脚本 | 打开、无修改保存、重载、播放 | 空author与对象值保留，未自动添加version/total_duration |
| 异步属性 | x有2节点、yaw有3节点、fov是常量，只改yaw一项后保存 | x和fov不被补帧，撤销和重载正确 |
| 超界/空动画 | 使用实际parser允许的ANIMATED空数组和超窗口节点 | 数据保留、无假生效；EVENT空记录仍明确拒绝 |
| null/STRUCT | 修改锁定数值后恢复null，编辑合法结构值 | null不被写成省略，嵌套数组/对象不随意转换 |
| 引用集合 | 独立片段+路径+规则/绑定，移动时间或改id | 引用变化有确认/原子处理，保存后游戏正确 |
| 预览静音 | 静音AUDIO预览，再保存重开 | 保存仍含原音频内容，未被推送副本裁剪污染 |
| 失败 | 非法值、断连、保存拒绝、取消 | 无部分写入、不清脏、不产生假成功 |

可以从既有cinematics例子复制人工场景数据，不要求vectors/expected文件或执行器。人工查看实际数据/反馈与播放，发现差异记录具体路径，再修复复验。

## 五、为什么不选别的

不保留旧模型后在保存时投影、不删除所有默认值、不为验收新增比较器/CI。代价是保存文件可能较大，人工需要覆盖典型场景；符合用户以实际使用发现问题的方式。AUI只在14复用相同标准和人工场景，不同步开发。

## 六、实现结果与完成定义

未实现。本任务完成时：统一序列化已接通，旧模型精简/隐式烘焙已清除，以上人工场景实际操作并符合预期，模组正常校验/解析/播放可用；没操作过的如实记未执行。本次仅写文档，没有产品运行结果。
