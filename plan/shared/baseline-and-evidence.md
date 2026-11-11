# 基线、证据与冲突裁决

## 基线范围

- `MOD:` = `E:/Documents/GitHub/ImmersiveCinematics/`。
- `EDITOR:` = `E:/Documents/GitHub/ImmersiveCinematicsEditor/`。
- `J:` = `MOD:common/src/main/java/com/immersivecinematics/immersive_cinematics/`。本计划中 `J:script/Clip.java` 等价于该完整路径。其他 Java 简写若只给包路径，也在此前缀下解释；`forge/`、`fabric/` 必须写完整模块路径。
- `INGAME:` = 编辑器仓库 **1.20.1 分支** 的仓库相对路径；不是当前 webui 工作树里同名目录的残留内容。读取方式是 `git show 1.20.1:<path>`，不得用当前工作树空 `common/forge/` 断言它没有类。
- 本地存在 `webui`、`1.20.1`、`main` 分支；未看到名为 `ingame` 的本地分支。本文将用户所说 ingame 视为游戏内方向，不改名、不新建分支。
- `reports/` 全部排除，不作为事实来源，也不纳入缺陷清理。模组仓库已有未跟踪 `plans/0.3.6/reports/`；本次不处理。编辑器 `webui` 已有领先远端的提交；本次不覆盖、不提交、不推送。
- 当前J:webui/...是源码证据定位；目标editor统一包及webui/ingame子模式见[editor-package-modes.md](editor-package-modes.md)。本次只写文档，目标路径不存在不能当事实引用；实施迁移后必须更新调用方/正式文档，不能留下旧包兼容转发。

## 证据优先级

1. 当前目标版本的解析器、校验器、schema 注册表、实际运行消费者。四者不一致时记录具体冲突，产物至少能被真实 parser/validator 接受；不得擅改运行时语义消除冲突。
2. `MOD:docs/SCRIPT_FORMAT.md` 与各模块说明用于理解；发现与实现不一致不能照抄旧字段。
3. `MOD:plans/0.3.6/Z-editor/` 是设计与历史实现记录，不是每项能力都已经实现的证据。
4. 编辑器旧 `FEATURE_CHECKLIST.md` 只用于迁移对账，不能重新定义 0.3.6。
5. 本计划明确标识的“拟新增／提案”类、方法、消息是待实施设计，不能当已有 API 调用。

引用格式：`J:script/ScriptParser.java — parseMeta（193–211）`。行号为核查时的辅助坐标；文件改动后先读符号所在的新位置。每份任务只准修改授权写入集合；只读引擎类不属于可改文件。

## 已核对的关键冲突

| 项目 | 当前事实／来源 | 实施裁决 |
|---|---|---|
| 格式版本 | `J:script/schema/MetaSchemas.java — all（17–47）` 无 version；`ScriptParser.parseMeta（193–211）` 拒绝未知 meta 键；`EDITOR:src/types.ts（63–99）` 仍有 version | 新产物不含 `meta.version`；不能静默升级旧脚本或留兼容别名 |
| author | `MetaSchemas.all（21）` 标 optional，`docs/SCRIPT_FORMAT.md（31）` 写可选；`ScriptParser.parseMeta（198–200）` 和 `ScriptValidator.validate（108–124）` 实际要求字符串 | 新建时写 `author: ""`；保存不可因 schema optional/default 删除。记录权威不一致，不在本轮修改主模组 |
| 总时长 | `ScriptParser.timelineKeys（83–89）` 只接受 tracks/loop_start/loop_end；`EDITOR:src/types.ts（194–201）` 与 `store.ts（156–157）` 仍写 total_duration | 显示时长派生、Infinity 单独表达；UI 标记和视口不混进脚本；保留 parser 实际接受的 A–B loop 字段 |
| 轨道 schema | `SchemaExporter.exportAll（42–55）` 导出 playControl/objects；`EDITOR:src/schema.ts（58–78）`、types.ts（224–242）仍读 clips/keyframes | 一次迁移全部消费者，禁止把新 objects 假转换回旧同步 keyframes |
| 异步关键帧 | `docs/SCRIPT_FORMAT.md（106–141）` 属性叶子分别 value/keyframes；旧 types.ts（143–182）仍以整帧为容器 | 用属性路径、属性独立节点身份、局部秒作为编辑合同；不得补齐其他属性时间点 |
| HUD | `MetaSchemas.all（41–42）` 与 `ScriptParser.parseMeta（244–253）` 只使用 screen_layers | 15 个规范名 + 动态层名；true=显示，false=隐藏；不复活 hide_hud/hide_* |
| ADJUST | `docs/SCRIPT_FORMAT.md（149）` 七种内置轨道；旧 types.ts（8）只有六种 | schema 枚举来源为运行时注册表，ADJUST 有独立调色工作区；第三方轨道用能力检测 |
| 图维护 | 旧 Z README（107）禁止写依赖；本次用户明确允许移动文件夹/维护依赖 | 本次需求优先；新写操作必须是受控、校验、可回滚的协议能力，不能仅改前端图数据 |
| 预览定义 | Z README（142–155）设计含 HUD/lane/调色、不含编辑器 UI 的游戏原始画面 | 不能用浏览器画假世界；同进程 GPU 共享是待实证能力，不以文件夹存在证明可用 |
| 模板 | Z README（94–106）计划编辑器展开并移除运行时模板；当前源码清单仍有 ScriptTemplate | 按 12 轮先核对调用链，不能声称 runtime 模板已删除，也不把模板语义重新写入产物 |
| 路径axes | J:script/path/PathCollectionParser.parseAxes（193–224）接受x/y/z非空子集，至少一项；旧设计个别位置写至少2轴 | 按实际parser允许单轴，1/2/3轴分别表达，不因旧设计拒绝合法脚本 |
| 路径控制点 | J:script/schema/PathCurveRegistry.readPoint（408–425）接受{x,y,z}或{dx,dy,dz}对象；SCRIPT_FORMAT个别示例仍用数组 | 生成器按实际对象形态输出，文档示例不能覆盖parser |
| 宏观循环区间 | ScriptParser.timelineKeys（83–89）/parseTimeline（315–320）使用timeline.loop_start/loop_end，ScriptPlayer（105–125）解释区间 | 不新增macro_loop_start/end；游戏宏观循环与编辑器A–B浏览分离 |
| 播放关系 | PlaybackLifecycle.playScript（83–124）按已有集合exclusive/interruptible裁决，同脚本重复另看interruptible布尔；priority只排队排序 | 不写新exclusive按priority抢占低优先级，不把两种interruptible混为一谈 |

## 验收证据规则

- **计划已写** ≠ **代码已实现** ≠ **游戏验收通过**。三种状态分别记录。
- 本次仅检查文档完整性、相对链接、源码引用存在性、轮次目录和覆盖；不运行 Gradle/npm/游戏，不将设计验收表填成通过。
- 实施时每个错误与结论必须能跳回具体类/方法或真实命令输出；没有实际运行的注明“未执行”。
- 禁止读取 reports 来补齐来源；需要的事实从源码与正式规格重建。

## 实现结果

状态：未实现（编辑器改造）。本计划基线核查于 2026-11-11：主模组 HEAD `f7b340f5ed5ea4ccb289354e722485039a872194`；编辑器 webui HEAD `e253bd5`，游戏内分支 1.20.1 HEAD `52aab14`。主模组 `gradle.properties（1–17）` 明确 version=0.3.6、Minecraft=1.20.1、Forge=47.4.16；游戏内分支 README 写 AUI=1.3.1，实际兼容性仍必须按 03 轮验证。没有实施偏离记录可填。
