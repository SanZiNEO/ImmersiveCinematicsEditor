# 03 编辑器脚本文档模型

## 定位

02 已经把「模组声明了哪些字段」整理成字段目录。本轮只做一件事：**编辑器怎么持有、编辑、保存这份文档**。字段的类型、形态、取值范围、枚举只从 02 目录查。

## 交付物

- `ScriptDoc` 顶层形状、四类集合、未知键策略。
- `AnimObject` / `ObjectKeyframe` 的文档侧形状与值转换。
- 片段身份、选择、引用完整性。
- 无损序列化、状态分层、命令撤销。
- 文档级结构检查 L01–L34、服务端桥。
- 打开/新建/保存/推送流水线。

## 权威口径

- 文档形状以运行时 `ScriptParser` / `ObjectParser` 接受的结构为准。
- 字段定义以 02 字段目录为准；03 只引用，不复制。
- 本地只查结构，语义以服务端 `script.validate` 为权威。

## 任务文档

| 文档 | 任务 |
|---|---|
| [03-01-script-document.md](03-01-script-document.md) | 脚本文档顶层模型 |
| [03-02-anim-object.md](03-02-anim-object.md) | 属性对象与值模型 |
| [03-03-selection-identity.md](03-03-selection-identity.md) | 片段身份与选择 |
| [03-04-serialization.md](03-04-serialization.md) | 无损序列化 |
| [03-05-editor-store.md](03-05-editor-store.md) | 文档状态与命令撤销 |
| [03-06-validation-bridge.md](03-06-validation-bridge.md) | 校验分层 |
| [03-07-document-io.md](03-07-document-io.md) | 打开 / 新建 / 保存 / 推送 |
| [03-08-field-binding.md](03-08-field-binding.md) | 字段目录接入与绑定 |

## 完成标准

- 任意一份真实脚本打开 → 编辑 → 撤销 → 保存 → 重载，除 `authoring` 与内部身份外逐字段不变。
- 保存产物能被真实 `ScriptParser` / `script.validate` 接受。
- 字段查询全部走 02 目录，编辑器代码里没有第二份字段表。
