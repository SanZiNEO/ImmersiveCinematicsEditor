# 04 轮验收记录（插件化工作台骨架）

## 环境与结论

| 项 | 值 |
|---|---|
| 仓库 | `E:/Documents/GitHub/ImmersiveCinematicsEditor` |
| 系统 | Windows 11 + Git Bash |
| Node / npm | v24.15.0 / 11.12.1 |
| 依赖 | vue 3.5.42、vite 6.4.3、electron 43.5.0、typescript 5.9.3、vue-tsc 3.3.14、@playwright/test 1.56.1 |
| 游戏 | **未运行**（`icdev doctor`：windows 为空、latest.log 停更 ~23h、8765 未监听；token 文件存在） |

**结论**：逻辑层与自动化端到端层通过；GUI 手工交互项（拖动/拆分/预设/主题视觉/草稿/文件对话框/重启恢复）**未执行**，原因见「未执行项」。

## 交付清单

| 模块 | 路径 |
|---|---|
| 公共契约 | `src/workbench/api/`（16 文件） |
| 插件内核 | `src/workbench/kernel/`（6 文件） |
| 布局 | `src/workbench/layout/` |
| 停靠 | `src/workbench/dock/` |
| 面板宿主 | `src/workbench/host/` |
| 抽屉 | `src/workbench/drawer/` |
| 主题 | `src/workbench/theme/` |
| 偏好 / i18n | `src/workbench/preferences/`、`src/workbench/i18n/` |
| 命令 / 快捷键 / 焦点 | `src/workbench/commands/`、`keybindings/`、`focus/` |
| 外壳 | `src/workbench/shell/` |
| 设置页分区 | `src/workbench/settings/` |
| 应用装配 | `src/workbench/app/` |
| 自检 | `src/workbench/verify.ts` |
| 内置插件 | `src/plugins/core.workbench/`、`src/plugins/demo.kitchen-sink/`、`src/plugins/builtin.ts` |
| 入口 | `src/app/main.ts`、`src/app/global.css`、`index.html` |
| Electron | `electron/main.cjs`、`electron/preload.cjs`、`src/workbench/host/electron/`、`host/webui/`、`host/browser/` |
| E2E | `e2e/workbench.spec.ts`、`playwright.config.ts` |
| 03 扩展 | `src/core/doc/store.ts`（revision/clipKeys/selectionInvalid/close）、`identity.ts`（liveClipKeys）、`index.ts`（barrel）、`verify.ts`（+27 断言） |

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过（0 错误） |
| `npx vue-tsc --noEmit` | 通过（0 错误） |
| `npx vite build` | 通过（`dist/`，index 393.83 kB / gzip 117.93 kB） |
| `node --experimental-strip-types src/core/doc/verify.ts` | `summary ok=187 fail=0`（基线 160，只增不减） |
| `node --experimental-strip-types src/workbench/verify.ts` | `summary ok=171 fail=0` |
| `npx playwright test` | **14 passed**（真 Electron + vite dev + dist 生产构建） |

### E2E 用例（真窗口）

1. 开发模式与安全选项：`isPackaged=false`、`contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`
2. 项目页真实入口与空态（无假统计）
3. 离线点新建：真实失败提示，不伪造成功
4. 视图菜单：布局重置 + 「显示面板」对话框 + Esc 关闭
5. document 页：4 面板 + preview canvas + 抽屉折叠条
6. 抽屉：打开 diagnostics、再点折叠
7. 命令面板：`Ctrl+Shift+P` → 搜索 → 执行 demo 命令 → 状态区 `ping: 1`
8. 快捷键：F6 焦点循环、Esc 关弹窗
9. 设置页：分区导航 + 主题切换真实改根变量
10. 语言切换：en_us 即时生效并切回
11. 窗口：最大化/还原 + 尺寸 ≥1280×720
12. **生产构建（dist）** 启动并渲染外壳（`file://`）
13. 插件全部激活、无 plugin/preload/ipc 级 error 诊断
14. 渲染进程无未捕获错误（离线 WebSocket 连接失败除外）

## 04-11 矩阵逐项

| 矩阵 | 覆盖情况 | 证据 |
|---|---|---|
| 1 启动与默认布局 | 部分 | E2E 1/2/5；1600×900 实测；**1280×720 未测** |
| 2 布局与停靠 | **未测（GUI）** | 逻辑在 04 自检（move/hide/preset/undo/事务/serialize）；拖动/拆分/重启恢复未做 |
| 3 插件矩阵 | 部分 | 真实激活 + 零错误（E2E 13）；**加 demo.extra / 删插件 / 重复 ID / activate 失败未做 GUI 验证**（重复 ID/环/失败隔离由 04 自检覆盖） |
| 4 双宿主 | 部分 | demo 面板渲染（E2E 5）；**四态切换、keepAlive、焦点、快速连点未测**（四态映射由 04 自检覆盖） |
| 5 抽屉 | 部分 | 打开/折叠/诊断（E2E 6）；**拖出/低窗/错误隔离未测**（高度夹取/toggle 由 04 自检覆盖） |
| 6 主题 | 部分 | 切 light/dark 改 `data-theme-*`（E2E 9）；**三主题视觉、跟随系统、导入、覆盖、重启保留未测**（校验/继承/导入拒绝由 04 自检覆盖） |
| 7 偏好与设置 | 部分 | 分区导航 + 语言即时切换（E2E 9/10）；**重启保留、坏 JSON、分项重置未做 GUI 验证**（逻辑由 04 自检覆盖） |
| 8 Electron | 部分 | 安全选项 + 最大化/还原 + 生产构建（E2E 1/11/12）；**文件对话框、草稿恢复、重启 bounds、关闭三选一未测** |
| 9 命令/快捷键/焦点 | 部分 | 命令面板执行、F6、Esc（E2E 7/8）；**IME、输入框白名单、覆盖冲突、冲突拒绝未做 GUI 验证**（逻辑由 04 自检覆盖） |
| 10 外壳与固定栏 | 部分 | 04 自检 grep（无旧尺寸 ref / window.prompt / localStorage / 常驻横幅 / 内核 import 业务面板）；**脏文档三选一未做 GUI 验证** |

## 实测发现并修复的缺陷（真机驱动）

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | 启动即报「缺少 ServiceRegistry 注入」 | 根组件 `inject` 看不到自己 `provide` 的值 | 改 app 级 `provide` |
| 2 | 页面区空白 | 懒加载返回 `{default}` module 被当组件 | 全部 loader `.then(m => m.default)` |
| 3 | 状态区临时提示不刷新 | `StatusApi` 无订阅入口 | 加 `subscribe` + 状态区订阅 |
| 4 | demo 插件失败（命令重复） | manifest 声明 + activate 注册同 ID | 按 `commandId` 去重 |
| 5 | 首启 document 页无面板 | 默认布局在插件激活前生成 | 先 `startPlugins` 再 `loadLayout` |
| 6 | 4 个面板全「不可用」 | `PanelRegistryImpl` 存 `panelId`、查 `pluginId:panelId` | 统一组合键 + 补自检断言 |
| 7 | 「显示面板」对话框 Esc 关不掉 | 无焦点陷阱 | 打开即聚焦 dialog |
| 8 | 抽屉关闭后无入口 | 折叠 group 未渲染 | 抽屉折叠条常驻 |
| 9 | 折叠条变 26px 宽竖条 | `flex: 0 0 26px` 在横向父容器被当宽度 | 改 `width/height` |
| 10 | 整棵布局树高度塌陷，折叠条被顶到顶部 | `.dock-surface` 是 block 容器，`.layout-renderer` 的 `flex:1` 无效 | `.dock-surface` 改 flex column |
| 11 | F6 无反应 | 全 UI 没有 `registerRegion` | 外壳固定区域 + PanelHost 自注册 |
| 12 | 主题名显示英文 | 设置页用 `label` 未走 `labelKey` | 加 `labelOf()` 走 i18n |
| 13 | 切语言界面不变 | i18n 的 locale 非响应式 | 改 `shallowRef` + 订阅偏好 |
| 14 | 状态区文案不随语言变 | 状态项硬编码中文 | `StatusContext.t()` + 状态项返回 key |
| 15 | 语言页切回中文无效 | 分区未订阅偏好，radio 仍显示旧选中 | 分区订阅偏好 |
| 16 | E2E 污染真实用户数据 | 未隔离 userData | 新增 `IC_EDITOR_USER_DATA` + 每轮清空 |

## 未执行项与原因

| 项 | 原因 |
|---|---|
| WebUI 真环境往返（`script.load/save/validate` + `editor.pushScript`） | 游戏未运行：`icdev doctor` windows 为空、`latest.log` 停更 23h、8765 未监听；token 文件虽存在但服务端未启动 |
| 拖动/拆分/标签重排/分隔线缩放的真实操作 | 未自动化（Playwright 可做，但本轮先收口逻辑与主链路）；逻辑层由 04 自检覆盖 |
| 主题三套视觉核查、跟随系统、导入主题 | 需要系统主题切换与文件对话框，未自动化 |
| 文件对话框、草稿恢复、窗口 bounds 重启恢复 | 需要多次启停与真实文件选择，未自动化 |
| 1280×720 低窗降级 | 未改窗口尺寸实测（抽屉夹取逻辑由 04 自检覆盖） |
| 加 `demo.extra` / 删 `demo.kitchen-sink` 的 `git diff` 验证 | 未执行（插件清单与激活由 04 自检覆盖） |

## 偏差与决定（实现记录）

1. **`@workbench/api` 别名**：未使用别名，全部相对路径导入（避免 tsconfig/vite 双处漂移）。
2. **引入 `vue-tsc`**：04 需要检查 11 个 `.vue` 组件；版本锁定 `3.3.14`，与 TS 5.9 / Vue 3.5 兼容。
3. **`tsconfig` 只覆盖 `src/**`**：`legacy/` 是参考代码、不参与 04 构建与类型检查；`index.html` 已指向 `src/app/main.ts`。
4. **`src/vue-shim.d.ts`**：仅服务 `tsc` 的 `.vue` 模块声明；`vue-tsc` 仍做严格 SFC 检查。
5. **`core.workbench` 不注册 `clip.effects` / `selection.properties` 业务面板**：这两个 ID 留给 05/06；04 交付宿主合同与 demo 面板（`demo.*` 独立 ID）。默认 document 树的槽位按「已注册面板」生成，未注册槽位不产生占位。
6. **内置三主题由 `ThemeRegistry` 作为 `builtin` 来源注册**（04-07 来源 1），`core.workbench` 不重复声明同 ID。
7. **`workbench.preview` 面板**：真实消费 18 字节帧头（RGBA 直接绘制），H.264 只显示编码器状态；无游戏时显示真实离线空态。
8. **`IC_EDITOR_USER_DATA`**：E2E 隔离 userData，避免把测试语言/主题写进真实用户数据。
9. **临时探针已移除**：`electron/main.cjs` 的 `IC_PROBE` 代码已删除；`src/app/main.ts` 保留 `import.meta.env.DEV` 调试钩子（生产构建不含）。

## 协议缺口（沿用 03 兜底，不在 04 修复）

- `script.save` 回执只有 `{path, serverNotified}`，无指纹/mtime → 冲突检测靠 `script.load` 内容哈希。
- `editor.pushScript` 的 ack 不确认解析成功 → 预览是否更新以帧/状态为准。
- `script.validate` issue 是字符串数组，无结构化 severity/path → 编辑器按 `[警告] ` 前缀与正则定位。
- 服务端 Origin 只精确放行 `file://` → 浏览器 dev 无法连接 WebUI（Electron 正常）。

## 复现命令

```sh
npx tsc --noEmit
npx vue-tsc --noEmit
npx vite build
node --experimental-strip-types src/core/doc/verify.ts
node --experimental-strip-types src/workbench/verify.ts
npx playwright test          # 需要 dist（先 vite build）
```
