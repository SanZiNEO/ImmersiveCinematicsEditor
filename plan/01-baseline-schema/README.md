# 01 — 基线、schema 消费与脚本属性

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 一、摘要

状态：未实现。先建立能被新模型所有面板共用的 schema 能力索引、基础字段控件、完整 meta 面板和离线夹具契约。已有前端能打开不等于本轮可跳过：其 clips/keyframes schema 形状已经过时。

## 二、为什么做

目标是“每个字段有权威描述、有归属、有合适控件”，不是先画空壳。非目标是重写主模组注册表、模板或所有轨道面板；后者分别由既定轮次承接。author 的 schema/parser 不一致必须在本轮明确。

## 三、方案

| 顺序 | 任务 | 交付职责 |
|---|---|---|
| 1 | [01-SchemaCapabilityIndex](01-SchemaCapabilityIndex.md) | 原始 schema 快照、能力索引、漂移/缺失检测 |
| 2 | [02-DynamicFormAndFieldRenderer](02-DynamicFormAndFieldRenderer.md) | 新 schema 分发、显隐与不支持类型门禁 |
| 3 | [03-ScalarFieldControls](03-ScalarFieldControls.md) | 数字/枚举/布尔/字符串及提交边界 |
| 4 | [04-ScriptMetaPanel](04-ScriptMetaPanel.md) | 身份、环境、输入/播放/循环/跳过参数 |
| 5 | [05-ScreenLayerPolicyPanel](05-ScreenLayerPolicyPanel.md) | 唯一 screen_layers 规范层/动态层策略 |
| 6 | [06-OfflineSchemaFixtures](06-OfflineSchemaFixtures.md) | 可审计的新模型离线数据与能力覆盖账 |

## 四、技术细节

前置：无；先读 shared/baseline-and-evidence、contracts C01。01 冻结 schema 消费合同，02 才实现标准文档和命令；本轮控件输出明确的编辑意图/字段值，不私自构造旧 ScriptDoc。当 02 接通时按已冻结合同装配，不重复发明字段接口。

本轮交付库级控件与 schema 驱动属性页面，可用真实导出快照和局部意图宿主验证；这不是 03 的真实游戏预览或 05 的工作区提前完成。生产保存必须等 02/03 接通后接受真实模组校验，不能把本轮本地检查命名为“游戏校验通过”。

轮次出口：六份任务的字段/错误/回归场景均闭合；所有导出类型均有已分配的控件或明确不可编辑状态；meta 新建草稿不含旧字段；静态与离线 schema 不漂移。后续轨道专用工具的归属明确，但本轮不得留“未来修 author／未来补基础类型”。

## 五、为什么不选别的

不从旧 FEATURE_CHECKLIST 反推字段，不把 unknown schema 类型强制变成 string，不给每个面板维护一份硬编码字段表。代价是开始阶段要仔细处理 schema 的 lower-case 枚举、字段种类和原始元数据，而不是只增加一个 ADJUST 枚举。

## 六、实现结果

未实现。本次只写计划。
