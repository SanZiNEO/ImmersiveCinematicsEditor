# 01.01 — SchemaCapabilityIndex（拟新增）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 范围与前置

合同 C01；先读 shared 基线与本轮 README。职责是 schema 原文/索引/能力门禁，不负责 ScriptDoc 序列化（02），不访问 WebSocket（03）。建议路径 `EDITOR:src/core/schema/SchemaCapabilityIndex.ts`；若 02 已定义等价 SchemaSnapshot/SchemaAdapter，应合并为同一职责，禁止平行维护类型表。

## 必读来源

- `J:script/schema/SchemaExporter.java — exportAll（42–141）、exportObject（364–399）`：tracks 的 playControl/objects；mode/type/interp 小写；nullable/min/max/requires/group/appliesTo/labelKey/unit。
- 同文件 `scriptStructure（151–246）`、`field/objectField（275–294）`：脚本级集合及动作/出口/调度/事实枚举。
- `EDITOR:src/types.ts — TrackSchema/Schema（224–243）`、`src/schema.ts — fillClipDefaults/fillKeyframeDefaults（58–78）` 是旧合同迁移点。

## 输入输出

输入：主模组返回的 schema 对象原文或已标记来源的离线快照。输出：只读原始快照、按轨道/叶子路径/结构种类查询的索引、能力清单和可定位的不支持原因。不能因为连接没给 models 就使用旧 keyframe 默认模型。连接态快照不被演示数据覆盖。

## 修改步骤

1. 列出所有 schema 消费点，先冻结新类型；原文与消费索引分开，保留扩展元数据。
2. 导入 meta、七类内置及注册扩展轨道、triggerFields/conditions、models、curveTypes 的 capabilities/params、script_structure。
3. mode/type/interp 使用导出的小写值；文档中的大写 Java 枚举不是 wire 值。分清普通 FieldDef 和 ObjectDef。
4. 提供 capability 状态而不是“全支持”布尔；缺结构/不认识扩展类型只读且保留，禁止丢字段或退回旧格式。
5. schema 切换使旧面板能力失效并重建索引，不复用上一游戏实例缓存；更新 src/schema.ts/types 的调用者由 02 集成所有者原子迁移。

## 禁止项与宿主

不改主模组 SchemaExporter，不在两分支复制独立字段列表；WebUI 与 Forge 使用同一语义索引。AUI JS 可用性留待 14 实证，本轮不预设其支持 Vue。

## 验收与完成定义

- 输入真实 exportAll 快照能列出 playControl/objects 和全部七类轨道；新加注册项无需修改内置枚举才可发现。
- `mode=value` 不允许动画；`interp=step` 不产生连续曲线选项；nullable 与 missing 分别保留。
- models/curveTypes/script_structure 缺失、schema 非对象、扩展字段类型未知时，返回可定位门禁且原文不丢。
- lower-case 导出枚举覆盖测试；旧 clips/keyframes 输入明确识别为不匹配，不悄悄接受。
- 运行现有前端测试入口或一次性行为脚本验证索引；实施阶段 03 建立连接后复验真实 schema。本轮所有索引和门禁必须真实完成，不能只交接口声明。
