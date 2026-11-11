# 02-DocumentIO：打开 / 新建 / 保存 / 推送流水线

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C02 标准脚本文档、C04 编辑命令与历史
> 依赖：[02-ScriptDocument](02-ScriptDocument.md)、[02-SerializationLossless](02-SerializationLossless.md)、[02-ValidationBridge](02-ValidationBridge.md)、[02-EditorStore](02-EditorStore.md)
> 下游：03（宿主传输）、05（工作区）、14（AUI 迁移）
> 证据前缀见 [README](README.md) 开头

## 一、摘要

定义四个操作的完整步骤、失败处理与并发策略：**打开**（`script.load`）、**新建**（`script.new`）、**保存**（`script.save`）、**推送预览**（`editor.pushScript`）。

核心原则：**保存与推送都从同一份 `serializeDoc(doc)` 派生**；`dirty` 只在服务端确认后清除；文件被外部改动时不自作主张覆盖。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| 打开：`script.load` → 直接塞 `state.doc` → `maintainInvariants()`（会改文档）→ 选中第一个 CAMERA → `pushScript()` → `seek(0)` | `EDITOR:src/store.ts — loadScript（400–417）` |
| 新建：`script.new` → 再跑 `bootstrapScript` 生成默认 CAMERA/LETTERBOX 片段（写旧平铺字段） | `store.ts — newScript（419–437）`、`bootstrapScript（766–810+）` |
| 保存：深拷贝 → 烘焙 → 剥离 → 校验（不阻断）→ `script.save` → `dirty=false` | `store.ts — saveScript（439–465）` |
| 推送：深拷贝 → 烘焙 → 静音 AUDIO 裁剪 → 剥离 → `editor.pushScript` | `store.ts — pushScript（530–551）` |
| `script.new` 不写文件，固定返回 `path: "untitled.json"` | `J:webui/WebEditorApi.java — handleScriptNew（210–216）` |
| 新建模板由 `ScriptTemplate.build()` 生成：meta 取 schema 默认值，7 条内置轨道各带 `id` 与空 `clips` | `J:script/ScriptTemplate.java — build（35–58）` |
| 轨道对象上的 `id` 被解析器忽略（`parseTrack` 不读 `id`，也不拒绝额外键） | `J:script/ScriptParser.java — parseTrack（325–343）`；`J:script/TimelineTrack.java（11–29）` 只有 `type`/`clips` |
| 文件根目录 `immersive_cinematics/scripts/`，路径越界抛 `IOException` | `J:webui/ScriptFileService.java（22、86–93）` |
| 保存成功后通知服务端登记指纹 | `WebEditorApi.notifyScriptSaved（147–160）` |

问题：

1. 打开时 `maintainInvariants()` **改写**刚加载的文档（写 `total_duration`），等于"打开即修改"，与无损冲突。
2. 新建时 `bootstrapScript` 写旧模型字段（`kf.position={dx,dy,dz}`、`kf.yaw`…），产物必被 parser 拒绝。
3. 保存/推送各自做一遍烘焙+剥离，两条路径可能不一致。
4. 保存失败时 `dirty` 已被清（`then` 里直接置 false，但异常路径未清——实际是异常时不清，尚可；但**校验失败**时仍继续保存，且没有"保存前阻断"）。
5. `script.new` 不建文件、路径固定 `untitled.json`：两次"新建→保存"会互相覆盖。

### 2.2 目标

1. 四个操作各有一条固定步骤链，失败点明确。
2. 打开不改文档（`parseDoc` 是纯函数；派生值只在 `derived`）。
3. 保存/推送共用 `buildPayload(doc)`。
4. `dirty` 只在服务端回执成功后清。
5. 外部改动检测：保存前比对文件指纹（mtime + 大小或内容 hash），冲突时提示，不覆盖。
6. 新建：由编辑器生成 `objects` 骨架（不依赖 `ScriptTemplate` 的旧语义），并显式选择保存路径。

### 2.3 非目标

- 不实现文件系统直读写（编辑器只经协议；游戏内载体直接调 `ScriptFileService`，属 03/14）。
- 不做自动保存。
- 不做版本控制/历史文件。

## 三、方案

### 3.1 打开（`script.load`）

```text
1. request('script.load', {path})            → {path, doc}
2. parseDoc(doc)                             → ScriptDoc（纯函数，不改输入）
3. buildRegistry(state.schema)               （若尚未取 schema，先 schema.get）
4. validateStructure(doc, registry)          → 本地 issue（不阻断打开）
5. 选择：第一个 CAMERA 片段的第一个有对象的属性（无 CAMERA 则第一个片段）
6. 派生 derived.finiteEnd / displayRange
7. resetHistory()；dirty=false
8. 推送预览：buildPayload(doc) → editor.pushScript
9. seek(0)
10. 异步 validateOnServer(buildPayload(doc))
```

关键点：

- 第 2 步失败（根不是对象 / `meta`/`timeline` 缺失）→ 显示阻断错误，**不进入编辑器**（只读原文预览）。
- 第 2 步成功但第 4 步有 `block` → 仍打开（作者要能修），但顶部显示"此脚本当前无法播放"。
- 第 8 步推送失败（断连）→ 不阻断打开。
- 第 9 步 `seek(0)` 沿用现有行为（`store.ts 414`）。

### 3.2 新建（`script.new`）

```text
1. request('script.new')                     → {path: 'untitled.json', doc}
2. parseDoc(doc)
3. 编辑器生成骨架（见下）
4. validateStructure
5. resetHistory()；dirty=true                // 新建即脏（还没落盘）
6. 不自动保存；由作者显式 save
```

骨架规则（替换 `bootstrapScript`，`store.ts 766–810+`）：

| 内容 | 规则 |
|---|---|
| `meta` | 用 `script.new` 返回的 meta（来自 `ScriptTemplate.build` 的 schema 默认值），补 `author:""`（若缺） |
| `timeline.tracks` | 用返回的 7 条内置轨道（各带 `id` 与空 `clips`）；`id` 保留但不依赖（运行时忽略） |
| 引导片段 | **可选**：新建一个 CAMERA 片段（`start_time:0, duration:10`），`objects` 写 `position_mode:{value:"relative"}`、`position_space:{value:"world"}`、`position.y:{value:2}`、`yaw:{value:0}`、`pitch:{value:0}`、`roll:{value:0}`、`fov:{value:70}`、`zoom:{value:1}`、`transition:{value:"cut"}` |
| LETTERBOX 引导 | **默认不建**（旧 `bootstrapScript` 建了；新建脚本不需要黑边，且多一条轨道会改变作者预期）。若产品要"引导内容"，必须是显式菜单项 |
| 关键帧 | **不建**（旧实现建了两帧；新模型下"没有关键帧也能播"，见 `MOD:docs/SCRIPT_FORMAT.md §3.2` 与 `ObjectParser` 不要求 CAMERA 有关键帧） |

保存路径：`script.new` 固定返回 `untitled.json`。编辑器必须在首次保存时要求作者输入路径（或自动递增 `untitled_1.json`），**不得**默认覆盖已有 `untitled.json`。

### 3.3 保存（`script.save`）

```text
1. 若 doc == null → 失败
2. issues = validateStructure(doc, registry)
3. 若 blocksSave(issues) → 中止，显示清单（不写盘）
4. payload = buildPayload(doc)                 // serializeDoc，无 authoring
5. 指纹检查：若已知上次读到的 fingerprint 且当前文件指纹不同 → 冲突，提示三选一（覆盖/另存/放弃）
6. request('script.save', {path, doc: payload})
7. 成功：dirty=false；更新 fingerprint；异步 validateOnServer(payload)
   失败：dirty 保持 true；显示错误
```

`buildPayload` = `serializeDoc`（[02-SerializationLossless](02-SerializationLossless.md)），**不**烘焙、**不**剥离默认值、**不**裁剪轨道。

### 3.4 推送（`editor.pushScript`）

```text
1. 若 doc == null 或未连接 → 返回
2. payload = buildPayload(doc)
3. 预览裁剪：muted 的 AUDIO 轨 → clips = []
4. send('editor.pushScript', {script: JSON.stringify(payload)})
```

- 裁剪只改 `payload`，`doc` 不变（现状已是深拷贝后裁，`store.ts 538–546`）。
- 防抖 160ms（`store.ts 176` 的 `SCRIPT_PUSH_DELAY_MS`），多次 commit 只推最新一份。
- 推送失败（断连）→ 静默丢弃并标记"预览过期"，下次连接时补推一次。

### 3.5 失败与并发

| 情况 | 行为 |
|---|---|
| `script.load` 返回的 JSON 语法错误 | 显示服务端错误；不进入编辑器 |
| `parseDoc` 失败 | 同上（本地结构错误，带 JSON 路径） |
| `script.save` 网络失败 | `dirty` 保持 true；提示重试；不本地缓存 |
| `script.save` 服务端拒绝（路径越界 `IOException`） | 显示原因（`ScriptFileService.resolveSafe 86–93`） |
| 外部修改文件（另一编辑器/手动） | 保存前指纹不符 → 冲突对话框；**不**自动合并 |
| 断连 | 允许编辑与保存（写盘不依赖连接）；`validateOnServer` 标记"未校验" |
| 同一路径两次"新建→保存" | 第二次保存前检测文件已存在 → 提示改名 |

指纹：`{size, mtimeMs, sha256?}`。WebUI 无法直接读文件系统 → 由服务端提供：`script.load` 返回内容后可算 hash 并缓存；保存前用 `script.list` 或新增只读查询确认 mtime。**注意**：当前协议没有"stat"消息，属**提案前置**（`script.stat`），必须在 03 轮显式提出；本轮不假设它已存在。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `openScript(path)` | 路径 | `{ok, doc?, issues?}` |
| `newScript()` | — | `{ok, doc, suggestedPath}` |
| `saveScript(path)` | 路径 | `{ok, error?, conflicts?}` |
| `pushPreview()` | — | `void`（内部记录"预览过期"） |
| `buildPayload(doc)` | 文档 | JSON |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/io.ts`（提案）：`openScript`/`newScript`/`saveScript`/`pushPreview`/`buildPayload`。
2. 改 `EDITOR:src/store.ts — loadScript（400–417）`：删除 `maintainInvariants()`（第 411 行）与 `bootstrapScript` 依赖；改调 `openScript`。
3. 改 `EDITOR:src/store.ts — newScript（419–437）`：删除 `bootstrapScript`（766–810+）与 `fillClipDefaults`/`fillKeyframeDefaults` 调用；改调 `newScript` 的骨架生成。
4. 改 `EDITOR:src/store.ts — saveScript（439–465）`：按 §3.3；删除 `bakeDocEasing` 与 `stripScriptDefaults`；加 `blocksSave` 与指纹检查。
5. 改 `EDITOR:src/store.ts — pushScript（530–551）`：按 §3.4；删除烘焙与剥离；保留裁剪。
6. 新增"另存为"命令（提案）：保存到新路径；`script.save` 支持任意相对路径（`ScriptFileService.saveScript 62–68` 会按需建父目录）。
7. 新增"预览过期"状态：`derived.previewStale: boolean`。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/DocIO.java`（提案）：直接调 `ScriptFileService.loadScript/saveScript/listScripts/newScriptJson`（同进程）。
2. 指纹：Java 侧可直接 `Files.getLastModifiedTime` + `size`；无需新协议。
3. 保存前用主模组 `ScriptParser.parse` 做一次"可解析性"检查（编辑器本地结构检查之外的硬兜底）；解析失败即阻止写盘并显示 `ScriptParseException.getMessage()`。
4. Forge 入口：命令（提案）→ `DocIO`；不直接操作 `Path`。

### 4.4 禁止修改

- 不在打开/新建路径里改写文档（不写 `total_duration`、不补默认值、不建关键帧）。
- 不在保存/推送路径里烘焙缓动。
- 不在断连时伪造保存成功。
- 不覆盖已被外部修改的文件。
- 不默认覆盖 `untitled.json`。

## 五、正反例验收

### 5.1 正例

1. 人工打开a.json、无修改保存并重载，检查字段/值/独立时间保留、dirty=false与显示范围正确；不要求assertLossless比较器。
2. 新建：返回文档含 7 条轨道、0 个片段（若产品未启用引导）；保存到 `new1.json` 后文件可被 `ScriptParser` 解析。
3. 保存：`block` issue 存在时中止，文件未被修改（对比 mtime）。
4. 保存成功：`dirty=false`；再次保存不产生"未保存"提示。
5. 推送：`muted` 的 AUDIO 轨在推送 payload 里 `clips: []`，但 `doc` 与保存的文件里仍在。
6. 冲突：打开后外部改文件 → 保存时提示冲突，文件未被覆盖。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| 打开时 `maintainInvariants` 写 `total_duration` | 禁止（打开后 `grep total_duration` 0 命中） |
| 新建写 `kf.position={dx:0,dy:2,dz:0}` | 禁止（旧模型） |
| 保存失败但 `dirty=false` | 禁止 |
| 保存时静默剥离默认值 | 禁止（见 02-SerializationLossless） |
| 两次新建都保存到 `untitled.json` | 第二次提示改名 |
| 推送失败后仍显示"预览已更新" | 禁止；标"预览过期" |

### 5.3 异步关键帧专项

**正例**：打开脚本（`yaw` 2 帧、`position.x` 2 帧），只改 `yaw` 一帧的值，保存。

- 期望：保存内容里 `position.x` 两帧逐字段不变；`yaw` 只有被改的那帧变化；无新增帧。

**反例**：保存时"为了补齐首帧"给 `position.x` 在 `t=0` 补一帧。

- 期望：人工操作后只出现作者确认的改动；保存重载与游戏表现不变，不新增自动比较脚本。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；`immersive_cinematics/scripts/io_smoke.json` 已存在。
2. F9 → 编辑器连接 → 打开 `io_smoke.json`；确认无 `block`、画面出现。
3. 改 `meta.name`，保存；确认文件 mtime 变化且内容只差该字段。
4. 新建 → 保存为 `io_new.json`；确认文件存在且游戏内可播放。
5. 在外部（文本编辑器）改 `io_smoke.json` 的 `meta.name`；回到编辑器再保存 → 出现冲突提示，文件未被覆盖。
6. 断开预览屏 → 保存 → 允许（写盘成功）；重连后确认 `script.validate` 通过。

通过判定：第 3 步差异只有一处；第 4 步可播放；第 5 步文件内容仍是外部改动版；第 6 步无"未校验"误报为通过。

## 七、完成定义

1. `EDITOR:src/model/io.ts` 存在，四个操作按 §3 实现。
2. `EDITOR:src/store.ts` 不再有 `bootstrapScript`；`loadScript` 不再调用 `maintainInvariants`。
3. 保存/推送共用 `buildPayload`，两处都不烘焙不剥离。
4. §5 的 6 条正例、6 条反例通过。
5. §6 冒烟 6 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同流程通过（用 `ScriptFileService` + `ScriptParser` 兜底）。
