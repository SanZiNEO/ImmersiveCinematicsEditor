# 12.22 — SubtitleScriptCompiler / SubtitleTrackAllocator（拟新增）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 目标与前置

12.20/21、01能力索引、02文档事务、09真实字幕元能力、11身份/引用合同。把cue/样式批量编译为普通脚本，主模组无需认识任何导入器/模板。建议src/core/subtitles/下实现，调用12公共模板/片段ID分配职责，禁止另建一套ID生成规则。

## 必读真实依据

- J:script/schema/TrackSchemas.java — overlayObjects（398–456）：layer_type/text/z_index是value，x/y/anchor/scale/opacity/font_scale是可动画字段；color.r/g/b的appliesTo是fade，不是字幕通用文字颜色。
- J:overlay/SubtitleLayer.java — render（55–100）：当前白色文字，按换行处理；font_scale是游戏原版字号倍数，不是网页px或font-family。
- J:script/OverlayTrackPlayer.java — findActiveClip（234–239）：同一轨道取第一个活跃片段；createLayer的subtitle分支（180–184）设置文本、z序与基准分辨率。
- J:script/ScriptParser.java — parseObjectClip（355–412）、parseMeta（193–211）。

**参考输入**：[外部字幕与批量流程](../references/04-import-subtitles-batch.md)§3.7/3.10。重叠簇扫描只作输入分析，不等于轨道分配；本任务按真实isClipActive边界分轨，保留所有重叠cue，不合并丢字。text只写value的权威是本模组schema，Olive静态文本仅作对照；不输出ASS/SRT或新subtitle轨道类型。

## 输入输出与具体编译规则

输入：确认的SubtitleBatchSession、当前schema快照、目标标准文档、目标起点/轨道策略、样式参数。输出：可审阅的标准文档patch+生成映射+诊断；提交走C04，保存/校验走C05。

1. 每cue生成OVERLAY片段，start_time=cue.startSeconds，duration=end-start；objects.layer_type={value:subtitle}、objects.text={value:规范文字}，其余字段按合法schema写value或独立keyframes。所有片段ID由共享分配器生成并去重。
2. 一cue一片段是当前text为VALUE的直接结果；不得给text生成keyframes，不输出subtitle_source、cue、batch、template等新运行时字段。
3. SubtitleTrackAllocator按时间区间给重叠cue分轨：同轨任何时刻至多一个字幕片段活跃；相邻边界须结合真实isClipActive窗口规则验证。不能只把片段排序后全塞同轨。允许与非本批内容共轨时先检测冲突，不改既有片段。
4. 样式从schema取实际能力：x/y中心坐标、anchor_x/y、scale_x/y、font_scale、opacity、z_index及base_resolution合同。字体/描边/阴影/ASS定位不被当前消费者支持时必须显示不可兑现项，不拿浏览器CSS冒充游戏结果。
5. 淡入淡出只用opacity对象的合法动画，节点局部秒严格递增且不超过有效字幕时长。短cue导致fade重叠时让作者调整或按明确可见策略缩短，不能产生相同time的非法节点。
6. 先生成差异和轨道数量/冲突提示，确认后一次提交；任何schema能力缺失、ID冲突、引用错误或真实validate失败均不部分提交。预览生成不得改变本地文档。

## 验收与完成定义

两条字幕[1,3]、[2,4]必须能在游戏2.5秒同时出现，产物在不同OVERLAY轨道；[4,5]与前cue衔接不重复残留。中文多行与0.2秒短cue、opacity动画、缩放/锚点均经真实parser/validator和游戏预览检查。保存后移走原SRT和sidecar，脚本仍可播放；WebUI和Forge读取同一脚本等价。编译不改未选字幕/其他轨道；失败撤销无半批内容。完成的是“标准脚本生成+真实游戏表现”，不是仅JSON.stringify成功。

## 实施步骤完成范围

上述1–6项编译规则逐项实现；输入cue/批次与schema，输出标准patch/映射/诊断，真实validate后一次提交。实现分轨、短cue、撤销和失败原子性，不仅创建编译器类壳。
