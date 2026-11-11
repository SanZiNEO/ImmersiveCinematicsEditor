# 04 — 外部字幕导入与批量字幕工作流（LosslessCut 3.69.0 / Olive 参考）

> **参考快照**：`lossless-cut` 3.69.0（`package.json:6` 版本、`:46` `"license": "GPL-2.0-only"`）；`olive`（`LICENSE` 为 GPLv3 文本，源码头为 GPL-3.0-or-later）。
> 本文只记录**设计思路与独立实现边界**，不复制/改写参考代码、文案或图标资产，也不做法律兼容结论；后续复用须另行评估。
> 范围：只服务 `12.20–12.23`（字幕导入/批次/编译/面板）与相邻的 `02` 事务身份、`03` 宿主文件、`09` 片段效果控件/快捷属性中的真实字段、`10` 资源、`13` 验收。不重写 Olive 的字幕渲染器，不改主模组，不新增模组 SRT 播放器、媒体转码或自动测试。
> 参考软件本次**未运行**，以下均为源码静态阅读（本地快照，不代表上游最新版本）。

## 一、摘要

一句话结论：**所读LosslessCut的SRT链路把字幕转成EDL段，不是本项目所需的独立cue/来源模型；所读Olive字幕块/解码/导出入口也不能直接提供12.20–23的完整导入、批量、重导入和标准脚本编译。主体必须独立实现，只借分层与交互思想。** 不凭这些局部入口断言参考软件全仓没有其他字幕能力。

三条关键判断：

1. LLC 的 SRT 导入把整条 cue 的文字 `lines.join('\r\n')` 放进 `segment.name`（`edlFormats.ts:468–475`），把 cue 序号塞进 `tags.index`；后续"命名/标签/批量偏移"操作的是剪辑段，不是字幕。**不能把它当富字幕模型或来源映射。**
2. `hooks/useSubtitles.ts` 只是**视频内嵌字幕流的预览链路**（`extractSubtitleTrackVtt` → object URL → `<track>`），与外部 SRT 文件导入、与"内嵌流转段"是三条不同路径（见 §3.9）。它不产生可编辑 cue，也不落盘。
3. **I 帧（keyframe）在参考里是 ffprobe 读到的媒体包标志，按需异步查询**（`ffmpeg.ts:76–93`、`:131–143`），既不是文档属性，也不是"异步属性"节点；我们 `06` 的属性关键帧是文档内数据。两者都不能变成 `SubtitleCue` 字段。

### 分层对照（本文件的主线）

| 层 | 参考实现（真实符号） | 我们的归属（提案/任务） |
|---|---|---|
| 文件选择 | `App.tsx:1829–1947` 打开动作、`edlStore.ts:159–181` `askForEdlImport`（`:171` 只给 `srt` 过滤器） | 12.20 受控宿主文件选择（03-06 端口） |
| 解码 | `edlStore.ts:57–59` `loadSrt`；`:23–26` `trimBom` 只用于其它格式 | 12.20 编码确认/失败重试；禁止替换字符静默吞字 |
| 格式解析 | `edlFormats.ts:422–466` `parseSrt`（状态机）、`:468–475` `parseSrtToSegments` | 12.20 `SrtSubtitleReader` / `WebVttSubtitleReader`（提案） |
| 中间 cue | `edlFormats.ts:468–475` + `types.ts:55–76`（`SegmentBase`/`StateSegment`，无字幕字段） | 12.20 `SubtitleCue`（提案） |
| 人工确认 | **无**：`App.tsx:2335–2342` 导入后直接 `loadCutSegments`（append） | 12.23 向导 + 12.20 预览草稿 |
| 批量操作 | `useSegments.tsx:488–497` 时间变换、`:883–897` 统一标签、`:685–711` 拆分；`segments.ts:90–114` 合并 | 12.21 批量会话（偏移/比例/文本/样式/拆并） |
| 输出序列化 | `edlFormats.ts:477–479` `formatSrt`、`edlStore.ts:81–83` `saveSrt` | 12.22 编译为 OVERLAY/subtitle 脚本；**不写回 SRT/VTT** |

## 二、证据索引

| # | 参考文件（本地快照） | 符号 / 行 | 读到的行为 |
|---|---|---|---|
| E1 | [App.tsx](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/App.tsx) | `userOpenFiles` 1829–1947；`.srt` 判定 1898；`loadEdlFile` 1390–1394；`importEdlFile` 2335–2342 | 打开动作按扩展名/已开文件给选项；SRT 两种入口行为不同（见 §3.5） |
| E2 | [edlStore.ts](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/edlStore.ts) | `trimBom` 23–26；`loadSrt` 57–59；`saveSrt` 81–83；`readEdlFile` 133–157（srt 分支 150）；`askForEdlImport` 159–181；`exportEdlFile` 184–227 | 读文件与解析收敛在一层；SRT 只按 utf8 读、无 BOM 变量、无编码参数 |
| E3 | [edlFormats.ts](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/edlFormats.ts) | `parseSrt` 422–466；`parseSrtToSegments` 468–475；`formatSrt` 477–479 | 空行分块的 SRT 状态机；序号必需、坏时间行整条丢弃；文本进 `name` |
| E4 | [types.ts](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/types.ts) | `llcProjectV2Schema` 41–51；`SegmentBase` 55–59；`StateSegment` 70–76 | 段只有 start/end/name/segId/tags/selected；无 text/cue/来源 |
| E5 | [useSegments.tsx](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/hooks/useSegments.tsx) | 历史 90–93；`safeSetCutSegments` 116–150；`loadCutSegments` 164–188；`createSegmentsFromKeyframes` 353–360；`modifySelectedSegmentTimes` 488–497；`selectSegments` 652–658；`splitCurrentSegment` 685–711；`selectSegmentsByLabel` 754–758；`labelSelectedSegments` 883–897 | 选中的段才能被批量变换；载入即整表替换或追加；空结果抛错；零时长降级为 marker |
| E6 | [segments.ts](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/segments.ts) | `mapSaveableSegments` 39–45；`partitionIntoOverlappingRanges` 54–87；`combineSelectedSegments` 90–114；`combineOverlappingSegments` 116–148；`hasAnySegmentOverlap` 151–157 | 重叠扫描/合并；合并选中段会丢掉中间文本；保存字段白名单 |
| E7 | [SegmentList.tsx](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/SegmentList.tsx) | 行渲染 38–300（名称 266、tags 267–269）；右键菜单 120–166；标签编辑 616–635；选中标记 289–292 | 表格行的"文本"就是 name；批量动作来自选中集合；无搜索/筛选/冲突列 |
| E8 | [useSubtitles.ts](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/hooks/useSubtitles.ts) + [ffmpeg.ts](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/ffmpeg.ts) | `useSubtitles` 6–27；`extractSubtitleTrack` 383–394；`extractSubtitleTrackToSegments` 396–399；`extractSubtitleTrackVtt` 406–419；`readFrames` 76–93；`findKeyframeNearTime` 131–143 | 内嵌流有三条不同消费者：预览 VTT / 转段 SRT / GPS SRT；I 帧来自 ffprobe，异步按需 |
| E9 | [useSegmentsAutoSave.ts](../../../ImmersiveCinematics/example/editor/lossless-cut/src/renderer/src/hooks/useSegmentsAutoSave.ts) | 33–65 | 防抖自动写 `*.proj.llc`；只比较可保存字段；无来源指纹 |
| E10 | [subtitleparams.cpp](../../../ImmersiveCinematics/example/editor/olive/app/render/subtitleparams.cpp) / [subtitleparams.h](../../../ImmersiveCinematics/example/editor/olive/app/render/subtitleparams.h) | `GenerateASSHeader` 29–109；`Load` 111–144；`Save` 147–160 | cue 列表 = (TimeRange, text)；XML 记 in/out + 文本；ASS 头用硬编码样式只为 ffmpeg 导出 |
| E11 | [subtitle.cpp](../../../ImmersiveCinematics/example/editor/olive/app/node/block/subtitle/subtitle.cpp) | `kTextIn` 31；`Name` 44–51；`id/Description` 53–61 | text 是 `kInputFlagNotConnectable \| kInputFlagNotKeyframable` 的静态输入 |
| E12 | [ffmpegdecoder.cpp](../../../ImmersiveCinematics/example/editor/olive/app/codec/ffmpeg/ffmpegdecoder.cpp) / [exportsubtitlestab.cpp](../../../ImmersiveCinematics/example/editor/olive/app/dialog/export/exportsubtitlestab.cpp) | 字幕分支486–512（SubRip限定488）；AddSubtitleStream 510；sidecar复选框17–18、SetFormat 43–58 | 所读媒体探测分支处理内嵌SubRip，导出页有sidecar选项；不足以据此断言全仓没有外部SRT导入 |

## 三、逐点适配

### 3.1 选择 → 解码 → 解析的三层分发

- **来源写法**：`App.tsx:1829–1947` 先按扩展名给出"打开/加载工程/转为段/加轨/并入批次"等选项，`.srt` 仅命中 1898 的 `Convert subtitiles into segments`；`edlStore.ts:159–181` 的 `askForEdlImport` 只负责弹文件框和类型过滤（`:171` 只允许 `srt`）；`readEdlFile:133–157` 按 `type` 分派到 `loadSrt`（`:150`）。调用方拿到的是 `SegmentBase[]`，不接触解析细节。
- **解决什么**：把"用户选择/格式识别/字节解码/格式解析"拆成可替换层，新增格式只加一个 loader。
- **可借鉴**：入口只产出统一的中间结果；类型→loader 的显式分派；取消返回空数组而不是抛错（`askForEdlImport` 末尾）。
- **不能照搬**：`edlStore.ts:14–18` 在渲染进程直接 `window.require('node:fs/promises')`、`@electron/remote` 对话框；标题统一叫 `Import project`（`:176`），无法承载字幕专属的编码/诊断/预览步骤；`getImportProjectType`（`util.ts:396–402`）不含 `srt`，所以拖放 SRT 永远不走"导入工程"路径，只能走打开动作里的转换项。
- **映射**：`12.20 SubtitleImportService`（提案）+ `03-06` 宿主文件端口；`12.23 SubtitleImportWizard`（提案）负责选择步骤。
- **适配步骤**：① 宿主端口只返回受控来源标识、文件名、字节/文本与确认编码，renderer不拿任意绝对路径；② 提案SubtitleImportService的输入是这个受控输入对象，顺序为探测格式→解码→Reader→诊断，不照搬load(path)任意读取；③ 失败/取消由向导显示，解析结果先留草稿，不直接改文档。
- **人工检查**：打开 SRT 时能看到编码/格式/诊断步骤；在诊断页取消后脚本 `doc` 不变；选中 VTT 也有入口（参考没有，必须我们自建）。

### 3.2 解码与 BOM：参考只做 utf8

- **来源写法**：`edlStore.ts:57–59` `loadSrt` 直接 `readFile(path,'utf8')` 后进 `parseSrtToSegments`；对比同文件 `:23–26` `trimBom` 只被 csv/cutlist/dv-analyzer/edl 使用，SRT 路径没有调用它。`parseSrt` 内部 `text.trim()`（`:442`）顺带吃掉开头 BOM，属于巧合而不是设计。`extractSubtitleTrack`（`ffmpeg.ts:383–394`）用 ffmpeg 转 SRT 后 `new TextDecoder()`（默认 utf-8）解码。
- **解决什么**：先用最小代码把文件读成字符串；BOM 在多数格式里确实只是前导空白。
- **可借鉴**：解码集中在 loader，解析器只接收纯文本；BOM 作为解码层问题处理，不散落到解析器。
- **不能照搬**：没有编码探测/确认/重试，非 UTF-8 文本会被静默替换；前导 BOM 处理依赖 `trim()`，而 `trim()` 同时会裁掉首尾空白，可能改变文本。与 `12.20` "解码异常给出可选编码重试，不用替换字符悄悄吞字"直接冲突。
- **映射**：`12.20` 输入合同（默认 UTF-8/BOM、显式编码确认）；`12.23` 向导第 1 步显示编码。
- **适配步骤**：① 解码器返回 `{text, encoding, hadBom, warnings}`；② 非法字节序列触发"换编码重试"选择，不替换；③ 空文件/全坏文件直接失败，不产生空批次。
- **人工检查**：同一份中文 SRT 分别存为 UTF-8 BOM / GBK，导入时能识别或让用户选择；错误编码不得出现 `�` 后仍显示"导入成功"。

### 3.3 SRT 状态机与"静默丢弃"

- **来源写法**：`parseSrt`（`edlFormats.ts:422–466`）以空行分块：读到正整数行设为 `subtitleIndexAt`（`:455–459`）；仅在 `subtitleIndexAt > 0` 时才尝试时间行正则 `^(\d+:\d+:\d+[,.]\d+\s+)-->(\s+\d+:\d+:\d+[,.]\d+)$`（`:446–451`）；时间行之后的非空行才是文本（`:452–454`）；`flush` 要求 `start/end` 非空且 `lines.length > 0`（`:431–438`）。
- **解决什么**：无依赖地分块，兼容逗号/点小数，容忍 CRLF/LF。
- **可借鉴**：空行分块 + "索引 → 时间 → 文本"状态迁移；`[,.]` 兼容；先分块再映射成中间对象。
- **不能照搬**：① 没有序号（或序号为 0）的 cue 会被整条丢弃；② 时间行不匹配时，后续文本行也因 `start/end` 为空而不入 `lines`，整条消失；③ 空文本 cue 被丢弃；④ 全程无源行号、无错误表，违反 `12.20` "坏记录定位到源行，不默默丢整条"；⑤ 不支持 VTT 的 `mm:ss.mmm`、cue 标识、NOTE/STYLE。
- **映射**：`12.20 SrtSubtitleReader`（提案）复用分块思路；`WebVttSubtitleReader`（提案）独立实现；诊断字段进 `SubtitleImportResult`。
- **适配步骤**：① 记录每条 cue 的 `sourceLineStart/sourceLineEnd`；② 序号可选，存在时只作 `sourceCueId` 参考、不作身份；③ 时间行坏、时长为零/负、文本为空分别产生诊断并保留占位，由用户决定跳过或修正；④ 顺序按源文件保留，另给按时间排序视图。
- **人工检查**：准备无序号、空文本、坏时间、乱序、重叠、CRLF 六类样本，逐条显示行号与原因；全部失败时文档零改动。

### 3.4 中间 cue：`name` 不是字幕模型

- **来源写法**：`parseSrtToSegments`（`edlFormats.ts:468–475`）返回 `{start,end,name:lines.join('\r\n'),tags:{index:String(index)}}`；`SegmentBase` 只有 `start/end/name`（`types.ts:55–59`），`StateSegment` 增加 `segId/tags/selected`（`:70–76`）；`SegmentList` 直接把 `seg.name` 当一行文本渲染（`SegmentList.tsx:266`），`tags` 显示成键值徽标（`:267–269`）。
- **解决什么**：用既有 EDL 段结构承载字幕，零新模型即可导入/导出。
- **可借鉴**：cue 的"时间 + 多行文本 + 来源序号"三件套一起传递；来源序号可保留为附加信息。
- **不能照搬**：文本与"段标签"共用 `name`，后续任何重命名都会改字幕内容；`tags.index` 是字符串且可重复/可被用户改，不能当身份；没有 `editorCueId`、语言、说话者、样式、源行范围、导入状态。**这是"LLC 把文本放 segment.name 而非富字幕模型"的直接证据。**
- **映射**：`12.20 SubtitleCue`（提案：`editorCueId/sourceCueId/startSeconds/endSeconds/text/源行范围/语言/状态`）；`12.21 SubtitleProvenanceStore`（提案）保存映射；`02-SelectionIdentity` 的 `clipKey` 只用于生成后的片段，不用于 cue。
- **适配步骤**：① 导入器产出 cue 数组，`text` 与 `name` 解耦；② `editorCueId` 由导入批次生成且稳定，`sourceCueId` 仅作对照；③ 生成脚本时文本写 `objects.text.value`，不写任何 cue 字段；④ 列表显示"来源序号"列但不允许作为 ID 编辑。
- **人工检查**：导入后把某条 cue 改名，文本不变；同一序号重复的 SRT 不会导致两条 cue 合并。

### 3.5 载入、人工确认与边界夹取

- **来源写法**：`importEdlFile`（`App.tsx:2335–2342`）在导入后直接 `loadCutSegments({segments, append:true})`；另一条入口 `App.tsx:1921–1923` 的 "Convert subtitles" 调 `loadEdlFile`（`:1390–1394`，`append` 默认 `false`）→ **整表替换**。`loadCutSegments`（`useSegments.tsx:164–188`）空数组抛 `No valid segments found`、超过 2000 抛错；`safeSetCutSegments`（`:116–150`）把 `start` 夹到 ≥0、按 `fileDuration` 夹上界，并把 `end <= start` 静默转成 marker，同时去掉 `initial`。
- **解决什么**：所有导入最终只经过一个入口，天然获得颜色索引、上限和当前选中段定位。
- **可借鉴**：单一载入入口、明确上限、失败抛可见错误；把"夹取"集中在一个函数，避免每个调用方各写一遍。
- **不能照搬**：没有预览/确认/影响条数；同一种 SRT 从两个入口进来行为不同（追加 vs 替换），用户无法预期；零时长被降级成 marker，对字幕等于**丢字**；`No valid segments found` 只有一句，不能定位坏行。与 `12.20` "导入结果先处于预览草稿，不立即写 doc 或 pushScript"冲突。
- **映射**：`12.20` 草稿与诊断；`12.23` 向导"生成差异 → 确认提交"；`02-DocumentIO` 的 `script.save`/`pushScript` 只在确认后调用。
- **适配步骤**：① 导入只进SubtitleBatchSession草稿，显示生成/冲突条数；② 追加/替换必须显式，默认不覆盖同批；③ 坏时间/反向/零时长保留逐cue诊断并默认阻止生成，作者修正或明确排除后才提交合法确认集，不静默夹取或转marker；批量时间变换产生非法值时整条批量命令回滚；④ 取消向导不产生文档历史。
- **人工检查**：同一SRT两种追加/替换策略与提示一致；含零时长cue时默认阻止生成并定位该条，修正或明确排除后才可继续，不能无提示少一条却显示成功。

### 3.6 批量：只作用于选中集合的时间/标签/拆并

- **来源写法**：`modifySelectedSegmentTimes`（`useSegments.tsx:488–497`）用 `pMap`（并发 5）只变换 `selected` 段；`shiftAllSegmentTimes`（`App.tsx:1294–1309`）分别对 `start`/`end` 加 `startShift`/`endShift`；`labelSelectedSegments`（`:883–897`）以第一个选中段的 `name` 为弹窗初值，把所有选中段统一改成同一 `name`；`selectSegmentsByLabel`（`:754–758`）按 `name` **精确相等**过滤；`selectSegments`（`:652–658`）只加选不清除；`splitCurrentSegment`（`:685–711`）在光标处切两段并给 `name` 加 `1/2` 后缀；`combineSelectedSegments`（`segments.ts:90–114`）把选中集合合并成 `[最早 start, 最晚 end]` 一段，保留第一段的字段。
- **解决什么**：批量操作的"作用域 = selected"这一条被贯彻到底，所有入口共享同一把尺子。
- **可借鉴**：选择域驱动批量、一次 map 提交、拆分不产生重叠、合并保留边界；`selected` 状态与数据同帧更新，UI 立即一致。
- **不能照搬**：`name` 同时承担标签与字幕文本；偏移没有负时间/冲突校验（夹取交给 `safeSetCutSegments`）；**没有比例伸缩、查找替换、按文本/来源筛选**；合并直接丢弃中间文本；选择状态存在段对象里（`:70–76` 的 `selected` 是必填字段），与 `02-SelectionIdentity` "选择不写文档"相反；按标签选择是精确匹配，无法做包含/正则（表达式入口 `selectSegmentsByExpr:764–` 用 `safeishEval`，我们不引入 eval）。
  - 另：`createSegmentsFromKeyframes`（`:353–360`）与 `alignSegmentTimesToKeyframes`（`:498–531`）里的 I 帧来自 `readFrames`/`findKeyframeNearTime`（`ffmpeg.ts:76–93,131–143`）的 ffprobe 异步查询，是**媒体包元数据**；它不是文档属性，也不是我们 `06` 的异步属性节点，**不得成为 cue 字段**，也不作为字幕功能引入（会牵出媒体转码/依赖）。
- **映射**：`12.21` 的批量时间/文本/样式/拆并；`06` 的属性关键帧模型保持独立；`02-EditorStore` 的命令与撤销。
- **适配步骤**：① 所有批量命令输入"选区 + 变换函数 + 选项"，输出"新 cue 草稿 + 影响条数 + 冲突列表"；② 时间变换 `t'=anchor+(t-anchor)*scale+offset`，`scale>0` 有限，变换后 `start>=0 && end>start`，否则整批失败；③ 拆分输入分割时间与两段文本，合并输入顺序与合并文本，不猜词语时刻；④ 标签只作为样式预设名，不写入字幕文本。
- **人工检查**：选 3 条含重叠/多行的 cue，做 +0.5s 偏移、1.2 倍伸缩、查找替换、拆分再合并，撤销一次全部恢复；负时间用例整批回滚且提示具体 cue。

### 3.7 重叠扫描 → 分轨（最可直接借用的算法）

- **来源写法**：`partitionIntoOverlappingRanges`（`segments.ts:54–87`）先按 `start` 递增扫描：若当前项 `start < 当前组最大 end` 则入组，否则开新组；`getMaxEnd`（`:64–72`）会对组内数组**原地排序**并取最大 `end`（marker 用 `start` 代替，`:62`）；最后只返回长度 > 1 的组并按 `start` 排序（`:87`）。`hasAnySegmentOverlap`（`:151–157`）只是"存在重叠组"；`combineOverlappingSegments`（`:116–148`）把重叠区间合并成一段；`invertSegments`（`:159–`）在存在重叠时直接返回空（`:169`）。
- **解决什么**：O(n log n) 找出所有重叠簇，供 UI 警告或"合并重叠段"。
- **可借鉴**：按 `start` 排序 + 维护组内最大 `end` 的扫描框架；重叠簇是"候选冲突集"，可直接作为字幕分轨的输入分组。
- **不能照搬**：① 参考把重叠视为错误/待合并，字幕重叠是**必须并存**的合法情况；② 它返回的是"重叠组"，不是轨道号；组内仍需二次装箱（first-fit：维护每条轨的 `lastEnd`，放进第一个 `lastEnd <= start` 的轨，否则开新轨）；③ `getMaxEnd` 会原地排序（源码注释明说 mutates），不能在我们的不可变模型里直接复用；④ marker 的 `end=null` 语义与 cue 必须有 `end` 不同，不能把 `end ?? start` 的兜底带进字幕。
- **映射**：`12.22` 第 3 条 `SubtitleTrackAllocator`（提案）；同轨活跃判定对齐 `J:script/OverlayTrackPlayer.java — findActiveClip（234–239）` 与 `J:script/ScriptPlayer.java — isClipActive（950）`。
- **适配步骤**：① cue 按 `start` 稳定排序（同 start 用源顺序）；② 扫描得到重叠簇只是提示，不据此合并；③ 逐 cue 装箱到 OVERLAY 轨道，边界按 `isClipActive` 的实际开闭区间验证（相邻 cue `[1,3]`、`[3,5]` 是否同轨允许由真实消费者决定）；④ 与非本批片段共轨前先检测冲突，不改既有片段；⑤ 输出"轨道数 + 每条轨的占用区间"供用户确认。
- **人工检查**：`[1,3]` 与 `[2,4]` 必须落在不同 OVERLAY 轨道并在 2.5s 同时可见；`[4,5]` 接在 `[2,4]` 后不残留；三条互相重叠的 cue 得到 3 条轨而不是被合并。

### 3.8 历史、自动保存与"源数据保留"

- **来源写法**：`useStateWithHistory(cutSegments, 100)`（`useSegments.tsx:90–93`）对每次 `setCutSegments` 存整表快照，无命令对象；`llcProjectV2Schema`（`types.ts:41–51`）把 `start/end/name/tags/selected` 写进工程文件；`mapSaveableSegments`（`segments.ts:39–45`）是保存字段白名单；`useSegmentsAutoSave`（`:33–65`）防抖 500ms（dev 2000ms）写 `*.proj.llc`，用 `isEqual(mapSaveableSegments(...))` 跳过未变化，无段或只有初始段时不写。
- **解决什么**：崩溃/关闭前自动保留工作；快照撤销实现极简；保存格式有明确白名单。
- **可借鉴**：自动保存前做"可保存字段"比较去重；无内容不落盘；白名单序列化避免把 UI 状态写进文件。
- **不能照搬**：① 撤销单位是"任意状态变化"而非命令，无法表达"一次批量操作 = 一个撤销单元"；② `selected` 被写进工程文件，恢复后选择状态是旧文档的一部分，与 `02-EditorStore` "撤销栈只存 doc、不存 session"和 `02-SelectionIdentity` 相反；③ `.llc` 是唯一工程格式，**没有来源指纹、批次 ID、生成映射**，因此无法做"重导入对照/冲突/不重复插入"；④ 自动保存只按文件路径命名，没有 sidecar 与脚本的失效关系。
- **映射**：`02-EditorStore`（`commit`/快照撤销 200，`EDITOR:src/store.ts:102–109,142–144`）、`02-DocumentIO`（保存/推送，`:170` 防抖 160ms）、`12.21 SubtitleProvenanceStore`（提案，sidecar）。
- **适配步骤**：① 批量会话的每次确认走一个 `commit`，撤销一次恢复全部 cue 与映射；② 选择只存 session，撤销后按 `02-SelectionIdentity` 修复；③ sidecar 记录 `sourceFingerprint/batchId/editorCueId → 生成片段 clipKey + 原生成快照`，不写进运行时脚本；④ sidecar 缺失/损坏时，标准 OVERLAY/subtitle 仍按普通字幕播放，来源标"未知"，不删片段。
- **人工检查**：导入 → 批量偏移 → 撤销/重做 → 关闭重开，cue 与映射一致；手改一个字幕后重导入，列出新增/移除/变更/手工冲突，默认不覆盖、不重复；删除 sidecar 后脚本仍能在游戏播放。

### 3.9 `useSubtitles` 是预览链路，不是导入

- **来源写法**：`useSubtitles`（`hooks/useSubtitles.ts:6–27`）维护 `subtitlesByStreamId: Record<string,{url,lang}>`；`loadSubtitle` 调 `extractSubtitleTrackVtt(filePath,index)`（`ffmpeg.ts:406–419`：ffmpeg `-map 0:index -f webvtt -` → Blob object URL）；effect 里对不再使用的 URL `URL.revokeObjectURL`。消费端是 `App.tsx:2505` 的 `<track kind="subtitles" src={activeSubtitle.url}>`，切换入口 `:495–517`。另外两条独立路径：外部 SRT 文件 → `edlStore.loadSrt`（`:57–59`）；内嵌流转段 → `extractSubtitleTrackToSegments`（`ffmpeg.ts:396–399`，先转 SRT 再 `parseSrtToSegments`），由 `App.tsx:1397–1406` 调用并 `append:true`。`extractSubtitleTrack`（`:383–394`）同样用 ffmpeg 转 SRT、`TextDecoder` 解码。
- **解决什么**：浏览器预览需要 WebVTT，参考用一次性转码 + object URL 满足 `<track>`。
- **可借鉴**：把"预览用数据"和"可编辑数据"分成两个消费者；资源释放（revoke）与语言标签随流保存。
- **不能照搬**：我们的预览必须是**游戏原始画面经 RGBA/H264 传输**，不能用浏览器 `<track>` 或本地播放器冒充；也不新增转码。参考的 VTT 转换不产生 cue，不能作为 `12.20` 的 VTT 解析器；它只覆盖内嵌流，不覆盖外部 `.vtt` 文件。
- **映射**：`12.23` 第 4 条"示意只作文本校对，真实画面看游戏预览"；`03` 预览流；`12.20 WebVttSubtitleReader`（提案，独立实现）。
- **适配步骤**：① 导入/批次面板里任何"字幕预览"标注为文本校对，不渲染成片；② 真实效果用游戏内 OVERLAY/subtitle 验证；③ 不实现 SRT/VTT→视频烧录或本地播放器。
- **人工检查**：导入后界面没有"本地成片预览"；字幕位置/字号以游戏画面为准；关闭面板后无遗留 object URL/资源泄漏（人工观察内存与日志即可，不写自动测试）。

### 3.10 输出序列化：参考写回字幕文件，我们只编译脚本

- **来源写法**：`formatSrt`（`edlFormats.ts:477–479`）用 `reduce` 重新编号（`index+1`），时间用 `formatDuration`（`util/duration.ts:3–44`，默认毫秒、`HH:MM:SS.mmm`）再把 `.` 换成 `,`，文本取 `segment.name || '-'`，固定 CRLF；`saveSrt`（`edlStore.ts:81–83`）直接写文件，导出分支在 `exportEdlFile:227`。Olive 侧：`SubtitleParams::Save`（`subtitleparams.cpp:147–160`）把每条 cue 写成 `<subtitle in="..." out="...">text</subtitle>`，`Load`（`:111–144`）反向读取；`GenerateASSHeader`（`:29–109`）为 ffmpeg 导出硬编码 Arial 16、384×288、Alignment 2 等样式；`SubtitleBlock` 的 text 输入不可连接/不可关键帧（`subtitle.cpp:31`）。
- **解决什么**：参考需要"导出一份能给别人用的 SRT/ASS"；Olive 需要把 cue 交给 ffmpeg 编码。
- **可借鉴**：cue列表与轨道/块分离、白名单序列化以及静态文本的交互对照。本项目text为VALUE的权威是J:script/schema/TrackSchemas.java及SubtitleLayer消费者，Olive的不可关键帧标记不能决定我们的格式；产物仍按12.22一cue一OVERLAY片段。
- **不能照搬**：① 我们不写回 SRT/VTT，也没有"字幕文件导出"任务；`formatSrt` 的重新编号、`'-'` 占位、CRLF 固定都会伪造内容；② Olive 的 ASS 头是导出近似，不是我们的渲染合同；③ Olive 把 subtitle 做成独立 Track 类型并走 XML/rational 时间，我们的产物是标准 OVERLAY 轨道上的 `layer_type=subtitle` 片段（`J:script/schema/TrackSchemas.java:443–444`），时间用十进制秒；④ 句子里的 font/outline/ASS 样式在当前消费者不存在，不能写进脚本。
- **映射**：`12.22 SubtitleScriptCompiler`（提案）+ `02-DocumentIO` 的 `script.save`/`pushScript`；schema 参数只用真实字段：`x/y`（`TrackSchemas.java:400–401`）、`anchor_x/y`（`:402–403`）、`scale_x/y`（`:404–405`）、`opacity`（`:414–415`）、`font_scale`（`:416–417`，`appliesTo("subtitle")`）、`text`（`:454`）、`z_index`（`:455`）；渲染语义对齐 `J:overlay/SubtitleLayer.java — render（55–103）`。
- **适配步骤**：① 编译输出 `patch + 生成映射 + 诊断`，不产生字幕文件；② 每条 cue 一个 OVERLAY 片段，`start_time/duration` 来自十进制秒，`objects.text.value` 为规范文本；③ 字体/描边/阴影/ASS 定位显示为"不可兑现项"，不写未知键；④ 生成后走真实 validate 再一次提交；⑤ 若未来要做 SRT 导出，另立任务，不能复用本文的导入合同冒充；⑥ 从某条 cue 定位其生成片段时，主时间轴只选中/高亮该片段，参数与节点在 [`clip.effects`](../06-async-objects/06-ClipEffectControlsPanel.md) 中展开、快捷属性显示摘要，不展开主时间轴对象行。
- **人工检查**：编译后导出目录没有新增 `.srt/.ass`；脚本里 `text` 无 keyframes、无 `font/outline/style` 未知键；中文多行与 `font_scale` 在游戏中生效；移走原 SRT 与 sidecar 后脚本仍可播放。

## 四、不采用清单

| 不采用 | 原因 |
|---|---|
| 用 `segment.name` 承载字幕文本、`tags.index` 当身份 | 文本/标签语义重载；序号可重复可变；无 `editorCueId` 与来源映射（§3.4） |
| 渲染进程直接 `readFile`/`dialog`（`edlStore.ts:14–18`） | 违反最小权限与两宿主输入合同；路径会泄露到脚本/工程 |
| 静默丢弃坏时间/空文本 cue（`parseSrt`） | 违反 `12.20` 逐条诊断与"不默默丢整条" |
| 把零时长/反向时间夹取成 marker（`safeSetCutSegments`） | 对字幕等于丢字；`12.21` 要求负时间/反向/零时长整批失败 |
| 选择状态写进文档/工程（`StateSegment.selected`、`llcProjectV2Schema`） | 与 `02-EditorStore`、`02-SelectionIdentity` 冲突 |
| JS 表达式选择/改写（`safeishEval`、`mutateSegmentsByExpr`） | 我们在 WebUI 不引入任意代码执行；筛选用明确字段与查找替换 |
| 把 I 帧对齐/关键帧列表引入字幕 | I 帧是 ffprobe 媒体元数据（异步按需），不是文档属性；字幕对齐会牵出转码/依赖 |
| 浏览器 `<track>` 或本地播放器做字幕预览 | 预览必须是游戏原始画面；参考的 VTT 转码只服务它自己的 `<track>` |
| 复制 `GenerateASSHeader`/`formatSrt`/`SubtitleBlock` 代码或文案 | GPL 源码只作思想参考，不逐句改写；样式常量也不是我们的合同 |
| 把 subtitle 做成独立 Track 类型 | 我们统一为 OVERLAY 轨道 + `layer_type=subtitle` |

## 五、到现有任务映射

| 任务/合同 | 参考提供的 | 必须由我们独立补的 |
|---|---|---|
| [`12.20 SubtitleImportService`](../12-templates-flight-tools/20-SubtitleImportService.md)（提案） | 三层分发、空行分块状态机、逗号/点兼容、BOM 归解码层 | 编码确认/重试、序号可选、源行诊断、VTT Reader、上限与不截断、草稿不写 doc |
| [`12.21 SubtitleBatchSession`](../12-templates-flight-tools/21-SubtitleBatchSession.md)（提案） | 选择域批量、偏移只改选中、拆分边界、合并取首尾 | `t'=anchor+(t-anchor)*scale+offset`、硬失败回滚、查找替换、样式预设、ProvenanceStore/sidecar、重导入冲突 |
| [`12.22 SubtitleScriptCompiler`](../12-templates-flight-tools/22-SubtitleScriptCompiler.md)（提案） | 重叠簇扫描思路、text 静态值 | 真实分轨装箱、边界按 `isClipActive`、schema 白名单、差异预览、真实 validate、一次提交 |
| [`12.23 SubtitleBatchPanel`](../12-templates-flight-tools/23-SubtitleBatchPanel.md)（提案） | 表格行 + 右键批量动作、选中标记 | cue 表格列（来源/冲突/手工）、筛选/多选、诊断页、向导步骤、重导入对照、面板布局 |
| [`02-DocumentIO`](../02-model-contracts/02-DocumentIO.md) / [`02-EditorStore`](../02-model-contracts/02-EditorStore.md) | 无（参考是整表快照 + 自动保存） | `commit` 原子提交、快照撤销 200、`pushScript` 防抖（`EDITOR:src/store.ts:102–109,142–144,170`） |
| [`02-SelectionIdentity`](../02-model-contracts/02-SelectionIdentity.md) | 无（参考选择写文档） | `clipKey`、选择会话化、撤销后修复（提案） |
| [`10-07 MediaResourceDrawer`](../10-audio-color-media/07-MediaResourceDrawer.md) + [`03-06`](../03-host-transport/03-06-script-resource-registry.md) 宿主端口 | 无（外部 SRT 不是游戏资源） | 字幕文件走受控文件输入，不加入 `resource.list` kind，不写进资源根 |
| [`09-03 OverlayImageAndSubtitle`](../09-overlays-composition/03-OverlayImageAndSubtitle.md) | Olive 的静态 text / cue-to-block 对照 | 生成片段的参数在 [`clip.effects`](../06-async-objects/06-ClipEffectControlsPanel.md)（效果控件）与 `selection.properties`（快捷属性）中按真实 schema 编辑；定位时打开该片段的效果控件，不展开主时间轴对象行 |
| [`13-03 ApplicationAndSubtitleParity`](../13-webui-acceptance-release/03-ApplicationAndSubtitleParity.md) | 无 | 导入→批量→编译→游戏播放→重开→重导入的端到端验收 |

## 六、人工使用检查（导入 → 批量 → 保存 → 播放）

1. **导入**：选择一份中文多行 SRT（含 BOM）与一份 VTT（含 NOTE/STYLE）；向导显示格式、编码、cue 数、逐条诊断；取消后脚本不变。
2. **坏文件**：给一条坏时间行和一条空文本 cue；界面定位到源行，默认不提交；修正或明确跳过后才可继续。
3. **批量**：多选 3 条含重叠的 cue，做 +0.5s 偏移与 1.2 倍伸缩；显示影响条数与冲突（负时间/反向）并整批阻止非法值；撤销一次恢复全部。
4. **文本**：对选中 cue 做查找替换与拆分/合并；多行结构与空文本确认策略符合预期；`name` 不承载字幕文本。
5. **编译**：生成差异显示将新增的 OVERLAY 片段数、轨道数、冲突；确认后一次提交；真实 validate 通过；`[1,3]` 与 `[2,4]` 分轨并在 2.5s 同时可见；`text` 为 value，无 keyframes。
6. **保存/重开**：保存并重启编辑器，批次、cue 与生成映射恢复；选择状态不作为文档内容被持久化。
7. **重导入**：手工改一条已生成字幕的文本，再导入更新版 SRT；列出新增/移除/变更/手工冲突，默认不覆盖手工、不重复插入；确认后原子提交。
8. **脱离源文件**：移走原 SRT 与 sidecar，重新打开脚本并进游戏；字幕仍按标准 OVERLAY/subtitle 播放；来源显示"未知"，可手动重新编组。
9. **定位与效果控件**：从批次列表定位某条 cue 生成的片段，主时间轴只高亮该片段、不展开对象行；参数列与节点在 `clip.effects` 中打开，快捷属性显示当前字幕片段摘要；`text` 仍为 VALUE，无关键帧。

## 七、实现状态与局限

- **参考软件未运行**：以上全部来自本地源码静态阅读；未构建、未启动 LosslessCut/Olive，未验证其界面文案与实际交互。
- **参考覆盖局限**：所读LLC路径分别处理外部SRT转段和内嵌流VTT预览，不足以提供本项目VTT Reader、cue身份、来源映射、重导入冲突、分轨与脚本编译。所读Olive分支处理内嵌SubRip、静态字幕块及导出，也不是12.20–23的现成实现。局部入口未见不等于全仓不存在；本文只借分层、分块解析、选区批量和重叠扫描思想，其余按既有任务独立实现。
- **本项目现状**：编辑器只有 `layer_type` 枚举（`EDITOR:src/types.ts:177`）和 demo 夹具（`EDITOR:src/demo.ts:330`），没有字幕导入/批次/编译实现；`12.20–23` 均为提案。生成侧真实合同见 `J:script/schema/TrackSchemas.java:398–456`、`J:overlay/SubtitleLayer.java:55–103`、`J:script/OverlayTrackPlayer.java:180–187,234–239`。
- **不在本文范围**：模组 SRT 播放器、媒体转码/烧录、自动测试/CI、ASS 复杂样式、Olive 渲染器重写、GPL 代码移植。
- **职责边界**：字幕导入/批次/编译仍是 12.20–23 的工作；生成片段的参数与节点只进入 `clip.effects` / `selection.properties`，主时间轴不显示对象行或关键帧汇总。
- **许可边界**：`lossless-cut` 为 GPL-2.0-only（3.69.0），`olive` 为 GPLv3；本文只记录思想来源与复用边界，具体代码/资产复用需另行评估，本文不构成法律结论。
