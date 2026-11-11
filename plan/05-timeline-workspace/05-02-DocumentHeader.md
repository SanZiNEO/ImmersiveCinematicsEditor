# 05-02 文档顶栏与文档命令

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：05-timeline-workspace。前置：01、02、03；同轮：05-01、05-07、05-08。

## 1. 职责

定义「当前文档」的唯一顶栏：返回项目、文档身份、脏标记、保存/校验、预览源与连接状态。把旧 `TitleBar.vue` 的菜单命令（新建/保存/打开/撤销/重做/视图切换）收敛成一条可测试的命令面，未保存切换有明确的三选一。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/components/TitleBar.vue:1–44` | `emit('toggle-left'/'toggle-right')`、`openMenu`、`run()`、`openScriptByPrompt()`（用 `window.prompt` 打开脚本，21–31） |
| `EDITOR:src/components/TitleBar.vue:45–94` | 模板：品牌、连接点（`state.connected`）、窗口按钮、菜单（文件/编辑/视图） |
| `EDITOR:src/components/TitleBar.vue:78–84` | 「视图」菜单里同时有「编辑器 / 脚本架构图」与「左侧面板 / 右侧面板」 |
| `EDITOR:src/store.ts:400–420` | `loadScript(path)`：成功后 `resetHistory`、`initTrackView`、`maintainInvariants`、`selectFirstCameraClip`、`pushScript`、`seek(0)` |
| `EDITOR:src/store.ts:422–447` | `newScript()`：走 `script.new`，再 `bootstrapScript(doc)`（766–820 一带，写旧格式字段） |
| `EDITOR:src/store.ts:449–472` | `saveScript()`：深拷贝 → `bakeDocEasing` → `stripScriptDefaults` → 校验 → `script.save` |
| `EDITOR:src/store.ts:379–398` | `validateCurrentDoc()`：本地 `ops.validateScript` + 服务端 `script.validate` 合并去重 |
| `EDITOR:src/store.ts:142–157` | `commit()`：`pushUndo` → fn → `maintainInvariants` → `scheduleScriptPush` |
| `EDITOR:src/App.vue:323–327` | 校验问题横幅（只显示第一条 + 关闭） |
| `MOD:docs/SCRIPT_FORMAT.md:756–773` | 校验分 parser（首错即抛）与 validator（收集 issue）两段 |

## 3. 拟新建（提案）

| 文件 | 导出 | 职责 |
|---|---|---|
| `EDITOR:src/workspace/DocumentHeader.vue` | 组件 | 顶栏布局与命令按钮 |
| `EDITOR:src/workspace/documentCommands.ts` | `DocumentCommands` | `newDoc/openDoc/saveDoc/validateDoc/revertDoc/closeDoc` 的调用面（实现委托 02） |
| `EDITOR:src/workspace/unsavedGuard.ts` | `confirmDiscard()` | 未保存切换的三选一（保存/放弃/取消），宿主无关的 Promise API |
| `EDITOR:src/workspace/docStatus.ts` | `DocStatus` | `{docId, path, dirty, lastSavedAt, validating, issueCount}` 派生状态 |

## 4. 输入 / 输出 / 字段约束

**输入**：02 的 `DocumentSession`（`docId`、`path`、`dirty`、`canUndo/canRedo`）；03 的 `connection`（`connected`、`previewSource`、`playback`）；04 的「打开某脚本」请求。

**输出（命令面）**

| 命令 | 前置 | 失败表现 |
|---|---|---|
| `newDoc()` | 已连接或离线模式 | 显示「未连接：无法新建」；**不**用本地骨架伪造 |
| `openDoc(path)` | 无脏文档，或脏文档已处置 | 打开失败保留当前文档并提示 |
| `saveDoc()` | `dirty && path` | 失败不清脏；错误进诊断抽屉 |
| `validateDoc()` | `doc != null` | 服务端错误以 issue 列表呈现，不弹窗 |
| `closeDoc()` | 脏文档已处置 | 取消则保持原文档 |
| `backToProject()` | 同上 | 同上 |

**字段约束**

- `dirty` 只在文档内容变化时置真；布局/缩放/选区/抽屉状态**不**置脏。
- 保存成功后由服务端回执驱动清脏（`script.saved`），不做乐观清脏（`shared/contracts.md` C04-5）。
- `issueCount` = 最近一次校验的问题数；校验中显示进度态，不显示 0。
- 顶栏不显示 `total_duration`（该字段不存在）；显示「有限末端 / 无限」由 `05-03` 的 `DisplayRange` 提供。

## 5. 修改步骤

1. 新建 `docStatus.ts`，从 02 的会话派生状态；删除 `App.vue` 里对 `state.dirty` 的直接读取。
2. 新建 `unsavedGuard.ts`：三选一返回 `'save' | 'discard' | 'cancel'`；`save` 分支必须等待真实保存回执再继续，失败则停在原文档。
3. 新建 `DocumentHeader.vue`：左「← 项目」、中文档名 + 脏点、右「保存 / 校验 / 预览源状态 / 连接点」。按钮禁用条件写进组件而非散落模板。
4. 把 `TitleBar.vue` 的菜单命令迁入 `documentCommands.ts`；`TitleBar` 只保留窗口控制（最小化/最大化/关闭）与品牌，或整体并入 `DocumentHeader`（二选一，必须删掉另一份）。
5. 删除 `openScriptByPrompt()`（`TitleBar.vue:21–31`）——用 `window.prompt` 输入路径的入口取消；打开脚本只从项目页/关系图进入（04）。
6. 校验横幅（`App.vue:323–327`）替换为顶栏问题徽标（点击开诊断抽屉 `05-08`）。
7. `newDoc` 不再调用 `script.new` 的服务端骨架（`store.ts:422–447` 当前走该链路）；新建由 01/02 的「按 schema 构造空文档」完成。**这是跨轮依赖**：在 02 交付前，本轮把按钮置灰并标注「等待 02」，不得保留旧骨架调用。

## 6. 禁止修改

- 不改 `script.save` / `script.validate` / `script.new` 的协议形状与宿主实现（`MOD:` 侧）。
- 不在顶栏做脚本内容编辑（字段、触发器、模板都别放这里）。
- 不把「新建」实现为「复制当前文档」或「填满默认关键帧」（`shared/contracts.md` C02-6）。
- 不引入第二个保存入口（菜单、快捷键、右键都指向同一个 `saveDoc`）。

## 7. 两分支承载

| 宿主 | 差异 |
|---|---|
| WebUI | 原生窗口按钮可用（`window.electronWindow.minimize/maximize/close`，`TitleBar.vue:33–37`）；未保存三选一用自绘对话框 |
| 游戏内 Forge | 无窗口按钮（游戏全屏/窗口由 MC 管）；`document.title` 无意义；三选一用同一自绘对话框（AUI 的 `<dialog>` 支持未实证 → 用自绘层） |

## 8. 前置

01（schema 驱动的新建骨架）、02（命令与历史）、03（连接/回执）、04（打开脚本入口）。

## 9. 验收

**正例**

1. 修改任一属性 → 脏点出现；Ctrl+S → 保存成功后脏点消失，`lastSavedAt` 更新。
2. 脏文档点「← 项目」→ 三选一；选「取消」→ 仍在原文档，内容与选区不变。
3. 选「保存」但服务端返回错误 → 停在原文档，脏点保留，诊断抽屉出现该错误。
4. 断开游戏连接 → 顶栏状态点红、保存按钮可用（离线草稿语义由 02 定）；新建按钮按 02 状态置灰。
5. 校验 3 个问题 → 徽标显示 3；点开抽屉定位到第一条。

**反例**

1. 保存请求发出但未回执就清脏 → 不通过。
2. 用 `window.prompt` 打开脚本 → 不通过。
3. 顶栏显示 `total_duration` 或 `version` → 不通过。
4. 未保存切换直接丢弃且无提示 → 不通过。

**真实冒烟**：WebUI 连真机，按 1–5 走一遍（本轮出口）；游戏内 Forge 同样走一遍属 14 迁移参考，不构成本轮出口。

## 10. 完成定义

- 顶栏命令全部走 `documentCommands.ts`；`TitleBar.vue` 不再含业务命令。
- 未保存三选一在两种宿主都可用，且「保存」分支等待回执。
- 校验问题从横幅改为徽标 + 抽屉，旧横幅删除。
- `script.new` 旧骨架调用链在本轮代码里不存在（要么等 02 后接新构造，要么按钮置灰并注明）。
