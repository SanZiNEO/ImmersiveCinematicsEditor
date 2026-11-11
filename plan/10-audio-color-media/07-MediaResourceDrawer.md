# 10-07 媒体资源抽屉（MediaResourceDrawer）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：10-audio-color-media
> 关联：`01-AudioTrackPanel.md`、`03-ExternalAudioDecode.md`、`../09-overlays-composition/03-OverlayImageAndSubtitle.md`、`../12-templates-flight-tools/README.md`

## 1. 职责

把 `resource.list` 的 `lang/image/audio` 资源浏览做成统一抽屉：目录树/列表、扩展名徽标、搜索、点击插入当前字段（`sound`/`path`/`text` 的 `@lang:`）、上限与路径校验。视频/外部音频格式明确「不在列表，需手填」。不实现模板抽屉（12）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 资源列表消息 | `J:webui/WebEditorApi.java — handleResourceList（244-）`、switch `resource.list`（52） | `resource.list` |
| 服务 | `J:webui/ResourceFileService.java — KIND_LANG/IMAGE/AUDIO/ALL（37-43）`、`KINDS（45）`、`IMAGE_EXT（46）`、`AUDIO_EXT（47）`、`MAX_DEPTH（49）`、`MAX_FILES（51）`、`list（65/74）`、`listLang（101-138）`、`listFiles（139-154）`、`matchesKind（155-162）` | lang/image/audio |
| 语言目录 | `ResourceFileService.java:82`（`LangResources.LANG_DIR`）、`J:util/LangResources.java:39-101` | `@lang:` |
| 资源根 | `J:util/ResourcePath.java — getBasePath（24-30）`、`resolve（31-34）`、`exists（35-39）` | `<gameDir>/immersive_cinematics/resource/` |
| 纹理加载 | `J:util/TextureLoader.java — loadTexture（62-120）`、`getTextureSize（194-198）`、`getGif（199-）` | png/gif |
| 视频 | `J:media/video/VideoFiles.java:15/26` | mp4/webm/mkv；不在 resource.list |
| 外部音频 | `J:media/audio/ExternalPcmDecode.java:41-56` | mp3/aac/flac/m4a/opus/wma/oga/ogx；不在 resource.list |
| 注册表 | `J:webui/WebRegistryService.java — query（33-64）` | `sound`/`item`/`block` 等 |
| 旧编辑器 | `EDITOR:src/components/LibraryPanel.vue`（44 行空壳） | 无 `resource.list` 消费 |
| 字段消费 | `EDITOR:src/components/fields/ResourceStringField.vue` | 旧资源字段 |
| 抽屉宿主 | `../05-timeline-workspace/05-08-PanelDrawer.md` | 05 提供容器 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 资源浏览 | 空壳 | `resource.list` 三 kind + all |
| 目录 | 无 | 树/面包屑；`dir` 参数 |
| 扩展名 | 无 | png/gif/ogg/wav/lang 徽标 |
| 搜索 | 无 | 名称过滤（客户端） |
| 插入 | 无 | 当前字段（sound/path/@lang:） |
| 视频/外部音频 | 无 | 「不在列表，需手填」 |
| 上限 | 无 | `MAX_DEPTH=5`/`MAX_FILES=2000` 说明 |
| 模板 | 空壳 | 不属本抽屉（12） |

### 3.2 拟新建（提案）

- `EDITOR:src/components/resources/MediaResourceDrawer.vue`（提案）：抽屉容器 + kind 切换。
- `EDITOR:src/components/resources/ResourceTree.vue`（提案）：目录/文件列表 + 面包屑。
- `EDITOR:src/components/resources/ResourceInsertTarget.vue`（提案）：插入目标（字段/`@lang:`）。
- `EDITOR:src/lib/resourceKinds.ts`（提案）：kind/扩展名/可插入字段的映射；**不**读文件系统。

## 4. 输入输出与字段约束

**输入**：`resource.list(kind, dir)` 回执；当前选区/字段（`sound`、`path`、`text`）；`registry.query(kind=sound)`（可选）。

**输出**：插入值（相对路径/`@lang:` 引用/注册 id）；无脚本结构变更。

| 项 | 约束 |
|---|---|
| `kind` | `lang/image/audio/all` |
| `dir` | 相对资源根；`normalizeRelative`/`resolveSafe` 由服务端校验（以 `ResourceFileService` 为准） |
| `image` | `png/gif` |
| `audio` | `ogg/wav` |
| `lang` | 语言文件/键；`@lang:` 引用 |
| `all` | 全部（不含视频/外部音频） |
| 上限 | 深度 5、文件数 2000；超出截断/提示 |
| 视频 | `mp4/webm/mkv` 不在列表；手填 + `VideoFiles.isVideo` |
| 外部音频 | 8 种扩展名不在列表；手填 + `ExternalPcmDecode.isSupportedExtension` |
| 插入 | `sound` 字段：audio/注册 id；`path`：image/手填；`text`：`@lang:` |

**必须显示的边界**：

- `resource.list` 是服务端目录扫描，不是编辑器本地文件系统；断连时显示「不可用」。
- `IMAGE_EXT`/`AUDIO_EXT` 是硬编码白名单；视频/外部音频不在其中。
- `lang` 目录固定 `LangResources.LANG_DIR`（`ResourceFileService.java:82`）。
- 插入 `@lang:` 时保留引用，不写解析后的文本（09-03）。
- 资源路径必须相对资源根；不允许绝对路径/`..`（服务端 `resolveSafe` 校验）。
- 模板抽屉归 12；本抽屉不列模板。

## 5. 修改步骤

1. 新建 `resourceKinds.ts`：kind → 扩展名 → 可插入字段的映射；从常量派生，不复制服务端列表。
2. 新建 `MediaResourceDrawer`：kind 切换（lang/image/audio/all）+ 搜索 + 列表/树 + 面包屑。
3. 调 `resource.list`（经 03 的请求通道）；加载中骨架；失败/断连显示错误，不显示假数据。
4. `ResourceTree`：目录展开/收起；文件行显示扩展名徽标/大小（若回执有）；`MAX_DEPTH`/`MAX_FILES` 提示。
5. 插入：根据当前选区决定目标（`sound`/`path`/`text`）；`text` 插入 `@lang:`；`sound` 插入相对路径或注册 id。
6. 视频/外部音频：列表底部固定一行「视频/外部音频不在列表，请手填」+ 允许手填。
7. 在 05 的抽屉「资源」tab 注册；与 09 的图像/字幕编辑器共享插入动作。
8. 删除旧 `LibraryPanel` 空壳；迁移调用方，不留双入口。

## 6. 禁止修改

- 不得在前端扫描文件系统/读取文件内容。
- 不得扩展 `IMAGE_EXT`/`AUDIO_EXT` 或把视频/外部音频塞进列表。
- 不得把 `@lang:` 解析值写回 `text`。
- 不得允许绝对路径/`..` 绕过服务端校验。
- 不得在本抽屉实现模板（12）。
- 不得伪造资源列表/缩略图（真实画面来自游戏；缩略图可选，必须来自真实纹理加载，不本地解码）。

## 7. 两分支承载

- **WebUI**：`resource.list` 浏览/插入；服务端目录扫描。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同资源浏览/插入/未知状态面板，经03公共资源端口，不直接依赖内部文件服务；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `ResourceFileService` + `ResourcePath` + `LangResources`。

## 8. 前置

- 01：字段 schema（`sound`/`path`/`text`）。
- 03：`resource.list` 请求/回执通道。
- 05：抽屉容器。
- 09-03：`@lang:` 插入语义。
- 12：模板抽屉（边界）。

## 9. 验收

**正例**

- `kind=image`：列出 png/gif；点击插入 `path`；游戏内显示。
- `kind=audio`：列出 ogg/wav；点击插入 `sound`；`source=file` 生效。
- `kind=lang`：列出语言文件/键；插入 `@lang:key`；`text` 保留引用。
- `kind=all`：混合列表；扩展名徽标正确。
- 目录深度 >5：服务端截断；UI 提示上限。
- 视频 mp4：不在列表；底部提示手填；手填后 09-04 接受。
- 断连：显示「资源不可用」；不显示假列表。

**反例**

- 前端扫描目录 → 失败。
- mp4/mp3 出现在 image/audio 列表 → 失败。
- 插入 `@lang:` 时写解析文本 → 失败。
- 允许绝对路径 → 失败。
- 模板出现在资源抽屉 → 失败。
- 断连显示缓存假数据并称最新 → 失败。

## 10. 真实冒烟

1. 资源根放 png/gif/ogg/wav/lang；打开抽屉：四 kind 正确。
2. 插入图片/音频/语言引用：游戏内生效。
3. 放mp4/mp3：列表范围仍按原资源合同，手填或受控选择后由clip.effects的视频/外部音频组校验并引用；不另开独占素材播放页，主轴只定位片段。
4. 深层目录/大量文件：上限提示；不崩。
5. 断连：错误态；恢复后重新加载。
6. 与 09 的图像/字幕编辑器共享插入：同一字段同步。

## 11. 完成定义

- `resource.list` 的 lang/image/audio/all 可浏览；扩展名/上限/路径边界明确。
- 插入 `sound`/`path`/`@lang:` 正确；不写解析值。
- 视频/外部音频不在列表的边界明确，支持手填。
- 不本地扫描/伪造资源；断连不显示假数据。
- 正例/反例/冒烟全部通过。
