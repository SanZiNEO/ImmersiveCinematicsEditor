# 01.06 — OfflineSchemaFixtures（demo.ts 迁移）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 前置与范围

01.01–05；共享 C01/C02。`EDITOR:src/demo.ts` 只提供标明离线的演示 schema/文档，不能在连接失败时自动覆盖真实工作。拟新增 OfflineFixtureCatalog（名称提案）；不另造离线运行时。

## 必读证据

`EDITOR:src/demo.ts — 旧 meta 字段（13–17）、演示 meta（223–227）、timeline（265–268）`；`src/types.ts（143–208、224–243）`；`src/schema.ts（58–78、117–141）`；`J:script/schema/SchemaExporter.java — exportAll（42–141）、exportObject（364–394）`；`MOD:docs/SCRIPT_FORMAT.md（1–19、106–149）`。测试夹具具体路径应在01实施时从主模组已有测试与cinematics目录发现，不在计划中虚构存在文件。

## 输入输出与步骤

1. schema 来自主模组真实 exportAll 的审定快照，保留来源/校验记录；这些记录在编辑器元数据中，不加到运行时脚本里。
2. 演示文档换成 objects 格式：七类轨道都有小而完整例子，至少一例 x/y/z 时间不同、一例 STEP、一例 VALUE、一例独立 clips + rules/bindings + paths 的引用。
3. 移除 version/total_duration/片段级 keyframes/旧 position 与 hide_*；author保留字符串；所有时间有明确单位。
4. 真实连接与离线演示是显式模式。离线只允许编辑、查看结构和参数辅助；游戏预览显示“未连接”，不得播放假世界视频冒充游戏。
5. 给每个schema能力建立已覆盖/已分配后轮工具/不支持原因的对账，不要求01提前实现轨道专用面板，但任何字段不能悄悄丢失。
6. 02文档模型落地后将这些快照接入同一加载链；不能留两套demo解析器。

## 验收与完成定义

真实 parser/validator 接受作为合法例子的全部脚本；故意非法的夹具必须被对应字段规则拒绝。断连时已编辑真实文档不被demo替换；切模式有未保存确认。schema新增轨道/字段后覆盖账能指出差异，不只比较JSON文本长度。检查演示对象不会因fillDefaults被同步化。01出口交付完整快照/来源/迁移合同；03接通后再以真实schema确认无漂移，不能伪填01已做游戏冒烟。
