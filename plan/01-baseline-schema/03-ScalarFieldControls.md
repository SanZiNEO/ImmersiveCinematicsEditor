# 01.03 — 基础字段控件（逐组件分工）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 前置与范围

前置 01.01/02；共享 C01/C04。现有组件位于 `EDITOR:src/components/fields/`。只改原子输入/提交，不实现属性关键帧时间轴，不把结构值塞进文本框。

## 必读引用

`FieldRenderer.vue — component（43–58）` 是现有类型分发点；`J:script/schema/SchemaExporter.java — exportField（331–354）、exportObject（364–394）` 定义输入元数据；`ScriptParser.parseMeta（258–277）` 给出整数百分比的真实边界。执行前逐个读取下表对应组件，不能仅依组件名推断已有实现。

## 类／组件级工作

| 组件 | 输入/输出 | 明确修改与边界 |
|---|---|---|
| NumberField.vue | 原值、min/max/unit/nullable → 合法数值意图 | 区分整数/浮点，阻止 NaN/Infinity；输入中间态 `-` 不提交；空值是 unset/null/错误中的哪一种由 schema 决定；失焦/回车一次提交，Escape 恢复 |
| CommitNumberField.vue | 临时数字草稿 → 单次提交 | 与 NumberField 共用解析规则，拖动调值合并为一条历史；不得再维护第二份默认/舍入规则 |
| BoolField.vue | boolean 或缺省 → 布尔意图 | 不把缺省无条件转 false；控件标明默认/显式状态；禁用不删除值 |
| TristateField.vue | 未设置/true/false → 明确的三态意图 | 不以字符串 true/false 充数，不把 screen_layers 的 bool 值扩成不合法 null；screen_layers 取消覆盖用删键意图 |
| EnumField.vue | 合法枚举列表、当前值 → 枚举意图 | 未知已有值可见、不可静默替成首项；空枚举禁用并解释；STEP 并不意味着不能有关键帧 |
| StringField.vue | 字符串草稿 → 字符串意图 | 保留 Unicode/换行能力，长度限制按实际字段，不能 trim 所有值或把空串当缺省 |
| CommitTextField.vue | 临时文本 → 单次提交 | 处理中文 IME；组合输入期间不触发快捷键或校验提交；取消不修改文档 |
| MapField.vue | 受控结构描述 → 子字段/键的意图 | 只作明确 schema 的简单映射；未知复杂结构显示只读诊断，不能 JSON.parse 成功就宣称合法；规则/路径用各自专用面板 |

每个组件实施时可以独立派单，但表内共享提交解析职责由一个集成所有者先冻结，不能并行重复定义。建议新增 `ScalarCommitPolicy`（提案）承担解析/取消/聚合，不引入通用表单框架。

## 宿主与禁止项

WebUI 的 Vue 控件和 Forge AUI 控件可不同，提交的值和取消/错误语义必须一致。禁止全局快捷键抢占输入；禁止由控件直接 save/pushScript；禁止给 enum/bool 添加无意义的贝塞尔把手。

## 验收与完成定义

输入 `-`、空、1.2、NaN 文本、超范围数、unknown enum、中文 IME、显式 null，逐项检查文档是否改变及错误是否可定位。`skip_vote_ratio=10/100` 可提交，0/10.5/101 不可提交；取消恢复原值。拖动/输入/回车不会生成重复历史；卸载不提交未确认草稿。必须在实际控件界面操作，不以 snapshot 数量测试代替行为证据。所有组件有明确处理规则并接通统一意图合同才完成。
