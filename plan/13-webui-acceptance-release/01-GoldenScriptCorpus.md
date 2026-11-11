# 13.01 — GoldenScriptCorpus / CoverageLedger

## 目标与前置

01–12的WebUI全部完成；建立消费者行为级黄金脚本与能力覆盖账，不要求AUI实现。来源见shared/source-inventory、[片段效果控件工作区](../shared/effect-controls-workspace.md)与各轮类任务。未来14复用同一场景迁移，不同步跑第二宿主。

黄金场景必须覆盖06-ClipEffectControlsPanel/06-EffectControlsRows承载的统一效果控件与06-PropertyValueForm共用的快捷属性；主时间轴只作为片段编排入口，不作为属性节点或关键帧汇总的编辑处。

## 必读来源

J:script/ScriptParser.java — parse/parseInternal（122–160）、parseMeta（193–297）、timelineKeys（83–89）、parseStandaloneClips（437–489）；ScriptValidator.validate（85–124）；SchemaExporter.exportAll（42–141）、scriptStructure（151–246）、exportObject（364–394）。逐字段/轨道语义继续读对应任务的实际消费者，不只读格式摘要。

## 输入输出与实施步骤

1. 输入真实schema、WebUI已实现路由/控件/编译器、模组生产源码清单；输出每能力的唯一UI入口、负责类、黄金场景与实际结果。内部缓存/Mixin等通过可观察行为覆盖，不复制引擎实现。
2. 合法场景：七轨最小脚本、meta全部组/screen_layers、x/y/z错开时间（x在0/2/5秒、y在1/3秒、z为常量）、VALUE/STEP/ANGLE/GEOMETRIC/EVENT、四个脚本级集合与互相引用、全部注册模型/曲线；在`clip.effects`同时展开位置与朝向时各行可见、左右对齐，主时间轴轨道高度不变且无对象展开。
3. 组合场景：多lane+覆盖层+音频+调色、并播/循环/无限、触发链+事实查询+规则挂起释放+出口、模板/纯数据引用重映射、字幕重叠分轨与重导入。
4. 负例：旧version/total_duration/片段级keyframes、缺author、非法对象路径/模式/枚举、重复时间、悬空/重复引用、路径非相邻、非法规则/gate/动作。人工核对具体错误位置与不半写，不新增自动断言或只检查是否抛错的测试。
5. 逐例加载→编辑→撤销重做→序列化→真实validate/parse→保存→重载；比较标准脚本语义，不钉JSON键序或空白。未知扩展保留且有明确能力状态。编辑必须经过真实入口：主时间轴只移动/裁切片段；属性值、独立关键帧、局部标尺seek、轴外帧定位在`clip.effects`完成，快捷属性与效果控件改同一目标时命令与结果一致；轴外帧不改变片段时长或主时间轴宽度。
6. 记录当前基线及消费合同，为14输出可复用夹具/期望；不在这一步要求Java/AUI镜像实现或GPU纹理接口。

## 验收与完成定义

所有WebUI必做能力均有行为场景且真实通过；默认精简不丢数据、匿名片段/节点选择不漂移、错误不假保存。新界面合同同时通过：主时间轴无属性节点/对象展开/关键帧汇总；同一片段多组多属性在效果控件同时可见且左右行对齐；局部标尺与全局播放头映射正确；两面板同值命令同步且快捷属性无自有节点时间轴；轴外帧可定位/编辑/撤销/保存且不拉宽主时间轴；小窗、停靠、IME与撤销保存场景有记录。WebUI分别连接Forge/Fabric主模组验证标准产物。源码/schema冲突有准确裁决，不能改运行时语义或放宽测试掩盖。AUI相关项标明确14迁移输入，不填通过、不阻塞本轮。
