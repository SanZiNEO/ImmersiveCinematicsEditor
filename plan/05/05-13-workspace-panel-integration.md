# 05-13 两页接线与插件

## 目标

把 05 的四个真实插件按 04 的合同接进两个页面：脚本页（`project`）与编辑器页（`document`）。面板 ID、槽位、尺寸、命令、状态项一次定死；加面板仍然只加插件目录 + `builtin.ts` 一行，04 内核零改动。

## 两个页面

| 页面 | pageId | 布局来源 | 主体 |
|---|---|---|---|
| 脚本页 | `project` | 04-02 的 `project` 页布局 | `script.graph` 面板占 `project.main` |
| 编辑器页 | `document` | 04-02 的 `document` 页布局 | 左 `clip.effects` / 中预览 / 右 `selection.properties` / 下 `timeline.main` + 抽屉 |

- 没有第三个工作面；`settings` 仍是 04 的设置页。
- 脚本页不再有启动器主体；最近项目/打开脚本/打开文件夹在 04-04 的页面顶栏入口。
- 两个页面共用 04 的顶栏、状态区、命令面板、快捷键、焦点顺序。

## 四个插件

| pluginId | panelId | defaultSlot | 尺寸约束 | keepAlive | closable | available |
|---|---|---|---|---|---|---|
| `core.script-graph` | `script.graph` | `project.main` | 无最小宽；撑满 | true | false | `pageId === 'project'` |
| `core.timeline` | `timeline.main` | `document.bottom` | minHeight 160；maxHeight 560 | true | false | `pageId === 'document'` 且有文档 |
| `core.clip-effects` | `clip.effects` | `document.left` | minWidth 420；折叠 = 0 | true | false | `pageId === 'document'` |
| `core.selection-properties` | `selection.properties` | `document.right` | 280–560；折叠 = 0 | true | false | `pageId === 'document'` |

- 预览面板沿用 04 的 `core.workbench` / `workbench.preview`（`document.center`，minWidth 320），05 不重复注册。
- 四个插件都不 import 彼此；共享能力走 `ServiceRegistry` token。
- 插件 `activate` 只注册贡献与命令，不做重活；面板首次可见才懒加载组件。

## 页面默认布局

```text
project（脚本页）
  project.main  →  script.graph

document（编辑器页）
  顶栏（04-04 DocumentHeader）
  ├ document.left     clip.effects        ≥420
  ├ document.center   workbench.preview   ≥320
  └ document.right    selection.properties 280–560
  下部
  ├ document.drawer   抽屉（diagnostics 等）
  └ document.bottom   timeline.main       160–560（默认窗口 34%）
  状态区
```

- 布局由 04 的 `LayoutService` 生成与持久化；05 只声明 `defaultSlot` 与尺寸约束。
- 用户拖动/拆分/改预设后，重启按 `layout.json` 恢复；05 不持有第二份尺寸。

## 命令

全部在各自插件的 `activate` 里注册（04 的 `CommandRegistry`），菜单/快捷键/命令面板同源：

| commandId | 归属 | 作用 |
|---|---|---|
| `script.new` | core.script-graph | 新建脚本（走 03 `file.newDoc`），成功后刷新并选中新节点 |
| `script.openSelected` | core.script-graph | 打开选中节点（走 03 `openDoc` + `PageRouter`） |
| `script.editDependencies` | core.script-graph | 打开 `DependencyEditor`（05-07），预填选中节点 |
| `script.renameId` | core.script-graph | 改脚本 id（05-06），先预览 |
| `script.refresh` | core.script-graph | 立即刷新图 |
| `script.fit` | core.script-graph | 适配当前可见节点 |
| `script.focusUpstream` | core.script-graph | 选中节点 + 只高亮上游 |
| `script.focusDownstream` | core.script-graph | 选中节点 + 只高亮下游 |
| `script.toggleGrouping` | core.script-graph | 显示/隐藏按目录分组 |
| `script.resetLayout` | core.script-graph | 清空手摆坐标与折叠（保留 view） |
| `timeline.*` | core.timeline | 05-10/05-11 的片段命令 |
| `clipEffects.*` / `selectionProperties.*` | 对应插件 | 面板内命令 |

- 脚本页命令的 `enabled` 必须按真实条件：无选中时 `script.openSelected`/`editDependencies`/`renameId` 为 disabled；`script.new` 在断连时 disabled 并给出原因。
- 不在 04 的 `WorkspaceShell` 里写 `if (pageId === 'project')` 这类业务分支；页面差异由插件 `available` 与面板自己处理。

## 状态项

| itemId | 归属 | 内容 |
|---|---|---|
| `workbench.status.connection` | 04 core | 已连接/离线 |
| `workbench.status.document` | 04 core | 页面/文档/脏标记 |
| `script.status.counts` | core.script-graph | `N 脚本 · M 前置` |
| `script.status.anomalies` | core.script-graph | 异常数（invalid/dangling/duplicate/self/cycle） |
| `script.status.stale` | core.script-graph | 图已过期（收到失效但未刷新）时显示 |
| `workbench.status.preset` | 04 core | 当前布局预设 |
| `workbench.status.issues` | 04 core | 文档问题数 |
| `workbench.status.plugins` | 04 core | 插件错误数 |

- 状态项只读；点击执行命令（`script.refresh` / `script.editDependencies`），不直接改数据。
- 计数必须与图内统计条、诊断列表一致。

## 快捷键（只列 05 新增）

| chord | scope | command | 守卫 |
|---|---|---|---|
| `Enter` | panel | `script.openSelected` | 图聚焦且有选中；输入框内不触发 |
| `F2` | panel | `script.renameId` | 图聚焦且有选中 |
| `Mod+Shift+R` | page | `script.refresh` | 脚本页；不占用浏览器保留键 |
| `Mod+0` | page | `script.fit` | 脚本页 |
| `Alt+ArrowLeft` | panel | `script.focusUpstream` | 图聚焦且有选中 |
| `Alt+ArrowRight` | panel | `script.focusDownstream` | 图聚焦且有选中 |

- 04 的 `F6` 焦点循环、`Mod+Shift+P` 命令面板、`Mod+S` 保存在两个页面都可用。
- 用户覆盖快捷键时与 04 的规则一致：同 scope 同 chord 冲突拒绝。

## 加面板零改动（验收口径）

1. 新建 `src/plugins/demo.extra/manifest.ts` + 一个 panel 组件，`defaultSlot: 'document.right'`。
2. `src/plugins/builtin.ts` 加一行。
3. 启动：该面板出现在右侧标签组；可拖到左侧/抽屉；重启恢复。
4. `git diff` 只出现新插件目录 + `builtin.ts` 一行；不改 `PanelHost` / `WorkspaceShell` / `LayoutRenderer` / `ScriptGraphPanel`。

## 验收标准

- 脚本页：`script.graph` 占满 `project.main`；没有启动器主体；顶栏有新建/打开入口。
- 编辑器页：四区（左/中/右/下）+ 抽屉；尺寸约束生效；拖动/拆分后重启恢复。
- 断连时脚本页仍显示上次图并标「已过期」；编辑器页打开本地脚本仍可用（走 03 本地通道）。
- 命令：10 条脚本页命令都能在命令面板搜到；disabled 条件正确（无选中/断连）。
- 状态项计数与图统计、诊断列表三处一致。
- 快捷键：`Enter`/`F2`/`Alt+←/→` 在图聚焦时生效；输入框内不触发；`F6` 可在两页之间切焦点。
- 加 `demo.extra` 面板：只改两处（新目录 + `builtin.ts` 一行），面板出现、可停靠、重启恢复。
- 删 `demo.kitchen-sink`：demo 面板变缺失占位；四个真实插件不受影响。
- `grep if (pageId ===`：`src/workbench/` 0 命中。
- `grep plugins/.*/panels`：内核与宿主 0 命中。

## 边界

- 05 只注册四个真实插件 + 沿用 04 的预览面板；不注册假面板。
- 不在外壳里写页面/面板业务分支。
- 面板之间不互相 import；共享走 token。
- 布局树只存 `{pluginId, panelId}`；不存组件路径。
