# 04.11 — GraphDependencyMutationController / DependencyMaintenanceDialog（拟新增）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 用户目标与边界

关系图入口本身必须可维护脚本依赖；不能把功能缩成只读边或只能跳入文档才能改。这里的编辑仅限脚本之间真实触发前置关系，不开放轨道/片段/关键帧/完整触发器参数。前置02标准文档与事务、03宿主端口、04项目索引/边身份。11完整条件编辑器后续复用同一命令合同，不是04交付依赖维护的前置。

## 必读源码与现状

- J:trigger/server/prereq/BuiltinPrerequisites.java — registerAll（17–34）：script_played、script_started、script_completed三种实际前置。
- J:script/ScriptParser.java — parseTriggerRequires（1010–1051）：requires数组AND语义；字符串等价script_played，对象允许注册扩展。
- J:webui/ScriptGraphService.java — SCRIPT_REQUIREMENT_TYPES（37–44）、边构造（89–140）、readTriggers/readRequirement（246–295）：当前是只读投影；目标按meta.id解析，不按路径。
- EDITOR:src/components/ScriptGraph.vue、src/graphLayout.ts：实施前读取实际选择/悬停/边命中入口。

当前没有图内依赖写协议，本任务规定新增受控能力合同，消息名与方法名均为提案，不能调用一个尚不存在的现成dependency.edit。

**参考输入**：[Olive项目浏览与节点画布](../references/05-project-graph-navigation.md) G8。只借鉴连线手势的起止反馈；不得照搬计算节点的直接接线/断线语义。所有入口共用本对话框及真实requires条目身份，确认前不改文件、不假画边。

## 输入输出与类级职责

GraphDependencyMutationController输入依赖方脚本身份/文件指纹、既有触发器身份、具体requires条目身份或新增位置、目标脚本ID和受支持前置类型；输出待确认差异、真实校验结果与原子写回命令。DependencyMaintenanceDialog只显示依赖方/触发器/目标/类型、影响和错误，不显示其他脚本编辑参数。

## 实施步骤

1. 关系图节点/边菜单提供新增、修改目标/前置类型、移除依赖；可选拖线只作为打开同一确认表单的手势，不直接写脚本。
2. 新增依赖必须选择依赖方已有触发器及目标脚本，三内置类型按真实语义展示。没有合适触发器时说明需先进入文档创建，不偷偷新建一个任意触发器。
3. 多个触发器/重复边不能按两端节点删掉整组；边身份包括来源触发器和requires位置/稳定标识。自定义或组合派生边未知可写能力时只读并说明原因，仍可导航。
4. 保存前检查目标存在、ID唯一、触发器仍存在、源文件指纹未变；展示环/自引用与真实validator结果，不自行宣布所有环都非法。保留其余conditions/continuity/自定义前置原文。
5. 游戏受控服务以标准脚本为基础做局部差异、真实parse/validate并原子写回；失败不改文件、不假更新图。成功后增量刷新边与摘要，维护撤销/外部冲突策略。
6. 模组需要新增受控公共写入口时只记录其文件/权限/事务/返回合同，实际实现归本轮集成者经授权执行；不得由前端直接访问主模组内部类或任意文件。

## 两载体与完成定义

本轮只实现/验收 WebUI 侧；游戏内 Forge+AUI 侧同语义是 14 迁移要求，不阻塞本轮。

本轮要求WebUI→Forge/Fabric使用相同写合同并通过图内维护交付；游戏内Forge通过同义公共端口是14迁移要求，仅游戏内Fabric+AUI适配暂缓。正常新增script_started、改为script_completed、仅删除指定触发器的一条依赖，图与保存重载一致；无目标/重复ID/并发修改/断连失败均无半写，未改其他条件。WebUI修改后在真实游戏观察触发链按新关系工作，属于本轮人工验收；14再对游戏内AUI入口复验。04轮必须完成图内维护，不可以未来11表单代替；图仍不提供具体轨道内容编辑。

## 验收归档

按本文正常/冲突/失败/真实游戏四类场景逐项记录；图内维护是必做，无法定位条目或缺受控写能力时任务阻塞，不以跳转完整编辑页替代完成。
