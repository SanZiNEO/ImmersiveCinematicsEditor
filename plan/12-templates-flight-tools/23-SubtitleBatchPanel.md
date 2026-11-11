# 12.23 — SubtitleBatchPanel / SubtitleImportWizard（拟新增）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 目标、前置、出处

12.20–22服务已冻结、05可移动工作区、06提供 `clip.effects` 行/值控件与 `selection.properties`、09定义字幕单片段字段面。建议新增components/subtitles/SubtitleImportWizard.vue、SubtitleBatchPanel.vue，复用统一命令/弹层/主题。原有components/LibraryPanel.vue、PropertyPanel.vue、Timeline.vue要先读取以复用，不假设已存在字幕表格。实际产物能力依据J:script/schema/TrackSchemas.java — overlayObjects（398–456）、overlay/SubtitleLayer.java — render（55–100）。

**参考输入**：[外部字幕与批量流程](../references/04-import-subtitles-batch.md)§3.5/3.6/3.9及人工检查。把参考分散入口收成明确导入向导、cue表格和生成差异；取消/错误不改文档，筛选/排序不改来源顺序。LLC的浏览器track与媒体I帧不是本项目预览或异步属性模型，真实字幕表现只看游戏。

## 输入输出与界面步骤

1. SubtitleImportWizard：选择文件/编码 → 显示cue和解析诊断 → 明确纯文本转换及不支持样式 → 选择目标时间偏移/样式/重叠分轨策略 → 生成差异 → 确认提交。取消任一步都不改脚本。进度是真实状态，不用固定计时器假装正在转换。
2. SubtitleBatchPanel：表格显示序号、起点、终点、时长、文本、来源批次、冲突/手工修改状态；支持搜索/筛选/多选、批量时间/文本/样式操作和重导入对照。当前选择、排序和过滤不改变原cue数据。
3. 双击 cue 经共享 Selection 在主时间轴定位/选择片段并 seek 游戏播放头；主时间轴只显示片段，不展开属性行或关键帧。选中标准字幕片段时，其 `text/font_scale/opacity/布局/z_index` 等参数在 `clip.effects` 的覆盖层字幕组中显示与编辑（06-EffectControlsRows + 06-PropertyValueForm），快捷属性显示同一选择的摘要；同一文档命令回写 21 来源映射，不生成第二套字幕 JSON。
4. 提供模板样式参数表，依据schema显示实际支持项；未支持的字体/描边/CSS样式不能在列表中标为已应用。字幕排版示意只作文本校对，真实画面始终看游戏预览。
5. 批量删除/重导入/替换显示影响范围，冲突明确选择保留手工/应用来源/跳过，不默认覆盖。撤销恢复片段、cue与映射；本批未选内容不动。
6. 面板可移动/缩放/保存为字幕工作区，长中文多行与大量cue用可控滚动/虚拟化或等价方式保持可操作；键盘导航不抢走游戏飞控和文本输入。
7. 承载：`SubtitleImportWizard`/`SubtitleBatchPanel` 是**文档级面板**（05 布局树中可停靠），不是 `clip.effects` 的片段组；片段内的字幕参数只在效果控件字幕组编辑，两边复用同一 Selection 与同一文档命令。

## 两宿主与非目标

本轮只实现/验收 WebUI 侧；游戏内 Forge+AUI 侧同语义是 14 迁移要求，不阻塞本轮。

两宿主复用导入/批次/编译语义。WebUI有桌面文件选择；Forge由宿主能力提供同义入口，不把外部导入省略。ASS复杂样式、语音识别、视频烧录、成片导出不做。不会为了实现导入去改主模组让它理解字幕工程。两宿主都要保持"主时间轴只定位/选择片段、字幕参数在效果控件字幕组"的分工。

## 验收与完成定义

真实完成“选外部SRT/VTT→看诊断→批量偏移/替换/样式→重叠分轨→真实validate→一次提交→游戏播放→保存重开→重导入冲突”的端到端流程。取消无修改、坏文件定位、部分错误需明确确认策略、断连不假成功；关闭恢复保留未保存cue草稿。两宿主同脚本表现相同。12轮所有字幕任务必须全完，不接受只有导入按钮、只导出JSON或先做导入以后再做批量管理。

cue ↔ 片段双向定位稳定：双击 cue 后主时间轴只选中片段，效果控件滚动到并高亮该片段的字幕组行；选择字幕片段（或其属性行）能回到对应 cue。不要求主时间轴展开关键帧，也不为字幕另建属性面板。
