# 12.20 — SubtitleImportService / SubtitleCue（拟新增）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 目标与前置

完整导入外部字幕为编辑器中间模型，不让主模组解析SRT/VTT。前置03受控宿主文件输入、02文档事务、09字幕元能力；与12模板共享schema能力检查。建议src/core/subtitles/SubtitleImportService.ts，格式适配器SrtSubtitleReader、WebVttSubtitleReader，各自职责单一。

## 必读引用

shared/application-and-integration；EDITOR:electron/main.cjs（1–4、22–36）说明Node只在主进程；preload.cjs、electron-bridge.d.ts 是最小权限扩展点。J:script/schema/TrackSchemas.java — overlayObjects（398–456），overlay/SubtitleLayer.java — render（55–100）：最终产物是标准字幕片段，非富文本网页。没有现成字幕导入类，本任务的新类均为提案。

**参考输入**：[外部字幕与批量流程](../references/04-import-subtitles-batch.md)§3.1–3.5。借选择/解码/解析/cue分层与空行分块，不复制LLC的直接renderer文件访问、正序号必需或坏cue静默丢弃。VTT Reader、源行诊断、编码确认和草稿确认按本任务独立实现，不把视频内嵌字幕track提取当外部VTT导入。

## 输入输出合同

输入：用户明确选择的单个/多个文件，宿主返回受限文件名/字节或文本、确认的编码；不接受renderer任意绝对路径读取。默认UTF-8/BOM；解码异常给出可选编码重试，不用替换字符悄悄吞字。单文件大小/条数受明确上限保护，超限说明原因，不截断后当成功。

输出SubtitleImportResult：来源指纹、格式、cue列表、逐行/逐cue诊断、未支持信息。SubtitleCue字段：editorCueId、sourceCueId可选、startSeconds、endSeconds、原文本/规范文本、源行范围、显式语言/说话者可选、导入状态。cue中间字段不进入运行时脚本。时间以十进制秒处理，不按预览fps量化。

## 格式边界与逐类步骤

1. SrtSubtitleReader：支持序号可有可无、时分秒毫秒时间行、跨行文字、BOM与CRLF/LF；时间行格式不合法、零/负时长、重复序号和空cue逐项诊断。序号不是稳定编辑身份。
2. WebVttSubtitleReader：识别WEBVTT头、可选cue标识、时间行、文本、NOTE/STYLE/REGION等区块；NOTE可作为非字幕信息跳过并报告计数。位置/样式/内联标签/时间戳不能原样塞入text后宣称完全支持：明确列为保留元信息或有损转换诊断，用户确认后按支持的纯文本/时间子集导入。
3. SubtitleImportService：检测格式和编码、统一时间/换行、输出稳定cue身份和错误表；输入cue顺序与按时间排序视图分开。
4. 不支持ASS/SSA复杂样式、图形字幕、自动语音识别或视频烧录；未知格式直接解释，不假称已支持全部字幕格式。
5. 导入结果先处于预览草稿，不立即写doc或pushScript；任何有损转换都展示清单，用户可取消。

## 两宿主与权限

本轮只实现/验收 WebUI 侧；游戏内 Forge+AUI 侧同语义是 14 迁移要求，不阻塞本轮。

WebUI由Electron受控文件选择/读取；Forge由宿主选择器适配同一输入合同。不能假设游戏内AUI可以访问用户任意文件。字幕读取服务与模组资源读写服务分开，导入结束后不持续持有外部文件句柄。

## 验收与完成定义

SRT与VTT各有中文/多行/BOM/不同换行/小数时间/重叠/乱序/空cue/坏时间/非UTF8/超限夹具。坏记录定位到源行，不默默丢整条；全部失败不改脚本；取消不产生历史。验证解析语义与源文件时序一致，不只检查cue数量。真实桌面文件选择和Forge输入路径均冒烟；尚无宿主文件端口则阻塞而不是mock完成。
