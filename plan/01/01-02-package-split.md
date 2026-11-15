# 01-02 包结构拆分与迁移

## 目标

把 `webui` 包 14 个类按职责拆成五层：`editor` 根、`editor.shared`、`editor.webui`、`api/editor`、`editor.ingame`。通用能力和外部传输不再混在同一包。

## 改动

| 现类 | 目标包 |
|---|---|
| ScriptFileService、ResourceFileService、WebRegistryService、ScriptGraphService | `editor.shared` |
| WebEditorApi（去 WebSocketSession 绑定后，见 01-04） | `editor.shared` |
| WebEditorServer、WebSocketSession、WebPreviewScreen、PreviewStreamer、PreviewEncoder、PreviewProtocol、PreviewConfig、H264AuSplitter、OutboundQueue | `editor.webui` |
| 新增 EditorManager、EditorMode、EditorSessionRegistry | `editor` |
| 新增 7 接口（见 01-03） | `api/editor` |
| 占位，不实现 | `editor.ingame` |

1. 移动上述类到新包，改 `package` 声明与所有 `import`。
2. 依赖方向：`editor.shared` 不依赖 `editor.webui`；`editor.webui` 依赖 `editor.shared` 与 `api/editor`；`api/editor` 只依赖普通 Java 类型。
3. `WebRegistryService` 更名去掉 `Web` 前缀（它走 Mojang official mapping，Forge / Fabric 通用）。
4. 删除 `webui` 包目录，不留兼容垫片。

## 迁移顺序

1. 先冻结 `api/editor` 合同（01-03）与开关合同（01-01）。
2. 把共享服务从 `webui` 抽到 `editor.shared`，调用方改用接口。
3. 把 WebSocket / 编码 / 预览屏收进 `editor.webui`，`WebEditorServer` 降为模式传输。
4. `editor.ingame` 只留包边界，不写空实现。
5. 删除 `webui` 包，不留兼容垫片；消息名、脚本 JSON 字段不因包改名改变。

## 验收标准

- 五层包结构成立，import 依赖方向正确。
- 编译通过；消息名、脚本 JSON 字段与迁移前完全一致。
- `webui` 包目录不存在。
