# 01.02 — DynamicForm / FieldRenderer 新模型分发

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 目标、范围、前置

前置 01.01；共享 C01/C08。修改现有 `EDITOR:src/components/DynamicForm.vue`、`fields/FieldRenderer.vue`；字段输入组件见 01.03。拟新增 `FieldPresentationResolver`（src/core/schema 下）只计算显示能力，不操作脚本文档。

## 必读证据

- DynamicForm.vue — VISIBILITY_RULES/isVisible（19–49）、sections/onUpdate（52–62）、template（71–96）：当前用平面 data 与硬编码旧字段显隐。
- FieldRenderer.vue — REGISTRY_KEYS/RESOURCE_KEYS/component（23–58）：当前未知类型回退 StringField，复合 position/bezier_curve 仍存在。
- `J:script/schema/SchemaExporter.java — exportObject（364–394）`：requires、appliesTo、group、labelKey、unit/min/max/nullable 的权威元信息。

## 输入输出与步骤

输入：已索引的字段描述、当前属性值/缺省状态、当前求值时间上下文和合法的字段编辑意图回调。输出：控件选择、分组、可见/不可用原因、单字段意图；不是任意 data[key] 直接写回。

1. 先区分 meta 普通字段、playControl 结构字段、objects 叶子字段和脚本级结构字段四类上下文。
2. 清理 follow、look_at_target 对象、旧 transition 顶层等已失效显隐规则；需要条件的字段从 schema/实际运行规则解析，不用字符串 eval。
3. 被条件隐藏的字段不删除；当前时间不生效也保留数据，并说明条件。未知 requires 只读提示，不默认为满足。
4. group/section/labelKey 驱动归组；翻译缺失展示稳定字段路径，保留单位和来源信息。
5. 引用、资源、结构、事件不默认当字符串。复杂编辑器由 06/07/11 接口注册，01 必须提供安全占位与只读原文，不给假可编辑输入框。
6. 位置与曲线旧复合组件不能序列化出被新 parser 禁止的结构；调用方清理完成后删除废弃路由。

## 两宿主边界

本轮只实现/验收 WebUI 侧；游戏内 Forge+AUI 侧同语义是 14 迁移要求，不阻塞本轮。

WebUI 可继续用 Vue 组件；Forge 可使用同一描述/意图合同的 AUI 适配组件。共享的是字段语义，不能因 AUI 不支持某个 UI 库而用另一个 schema。

## 验收与完成定义

- requires 真假切换不改变脚本文档；nullable、只读 VALUE 和 animated 属性展示正确。
- 未知类型/未知条件不能进入 StringField 后写坏 JSON，诊断能定位字段。
- 中文长标签、无翻译、空枚举、扩展轨道均可观察并有明确状态。
- 同一次提交只产生一个意图；取消输入不产生历史记录；组件卸载不提交旧草稿。
- 实际打开控件页验证键盘焦点、错误提示与数据不丢；只测试组件渲染数量不算验收。所有旧路由迁移完，无半新半旧合同。
