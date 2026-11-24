# 0.1.0 · 客户端自动更新本地验证证据（03-06）

> 状态：**完成（2026-11-23 23:35，UTC+8）**。五个用例与单实例均在本机实跑，结论按 `PASS | FAIL | BLOCKED | NOT RUN` 口径记录。
> 本轮验证对象：`electron-updater ^6.8.11` + 03-02 更新模块 + 03-03 八态契约 + 03-04 端口 / IPC + 03-05 设置页。**本轮没有产生任何 Release、tag、上传或本地假 feed。**
> 证据原件（探针输出、日志、userData）位于 `release/_probe/`，已被 `.gitignore` 忽略，不入库；本文件只放文本。

## 0. 结论总表

| 用例 | 结论 | 关键实测 |
|---|---|---|
| 1 · 打包版能起来 | **PASS** | `release:local` 整链 exit 0（80.1s）；e2e smoke 四项 PASS；版本 `0.1.0` |
| 2 · 无 Release → up-to-date | **PASS** | 自动首查 + 两次主动检查均回到「已是最新」；5 s 内二次检查 1.051 s（修复前会卡 `checking`） |
| 3 · 断网 → error + 可读原因 | **PASS** | `error / NETWORK_ERROR`，UI「检查失败：网络不可用…」；切「关于」仍可用 |
| 4 · 浏览器 dev → unavailable | **PASS** | 状态「当前宿主没有更新能力」、按钮禁用、版本 `dev`、294 请求中 GitHub 0 条、无 updater.log |
| 5 · 未打包 Electron → unavailable | **PASS** | `check()` / 推送均 `unavailable`；`install()` `{ok:false,reason:'not-downloaded'}`（按钮禁用）；无 404、无 updater.log、GitHub 0 条 |
| 补充 · 单实例 | **PASS** | 同 userData 第二份自行退出（code 0）；主窗口始终 1 个 |

## 1. 环境与产物

| 项 | 值 |
|---|---|
| 机型 / 系统 | ASUS TUF Gaming F15 FX507ZV4（本机）；Windows 11 专业版 10.0.26300.0 |
| Node / npm | v22.23.2 / 10.9.8 |
| 工具链 | electron 43.5.0、electron-builder 26.15.3、Playwright 1.56.1 |
| 分支 / HEAD | `webui` / `a76e6ba4bbfffa60a8de5a83fdc3b750d4af6565` |
| 本轮代码指纹 | `electron/updater.cjs` 12,558 B；`git hash-object` = `033f84c8b738d49d370414545e3185fe75c2cd71`；SHA256 `B1C1B62B…779FA247` |
| 构建时间 | 2026-11-23 23:03–23:04（`release:local`，80.1 s，exit 0） |
| `v0.1.0-base` tag | `3aa3aff753bb129e2daed2a20600b6b65167f80b`。**tag ≠ Release**：该 tag 不挂任何 Release，不计为本轮产物 |

产物（均为 23:04 构建，随后用例全部基于这一批）：

| 产物 | 大小 | mtime |
|---|---|---|
| `release/win-unpacked/ImmersiveCinematicsEditor.exe` | 238,225,920 B | 23:04:25 |
| `release/win-unpacked/resources/app.asar` | 19,485,812 B | 23:04:24 |
| `release/ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe` | 98,547,366 B | 23:04:50 |
| `release/ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe.blockmap` | 103,793 B | 23:04:56 |
| `release/latest.yml` | 386 B | 23:04:56 |

`latest.yml` 关键行：`version: 0.1.0`；`files[0].url: ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe`；`size: 98547366`；`sha512: 8vkaG5ddiseelgiMwDr5MndCsotB+3OHaK6xWeXXTupU7+Q5VtsbAHpvcPHLf4usYKRM1Gi9U3V6CWOUfap+bw==`。

### Release 前提复核

`GET https://api.github.com/repos/SanZiNEO/ImmersiveCinematicsEditor/releases`（2026-11-23 23:35，`Accept: application/vnd.github+json`）→ HTTP 200，**count=0，body 空数组**。本轮没有创建 Release / tag / 上传资产。无 Release 时「已是最新」是正确结果。

## 2. 用例 1 · 打包版能起来

- **命令**：`npm run release:local`（= `npm run build && npm run electron:build && node scripts/verify-release-assets.mjs && npm run e2e:system:smoke -- --exe release/win-unpacked/ImmersiveCinematicsEditor.exe --hold 3000`）
- **期望**：整链 exit 0；`app-update.yml` 三字段与 `electron-builder.yml` publish 一致；主窗口渲染、无崩溃；版本显示注入值。
- **实际**：整链 exit 0（80.1 s）；产物见 §1；随后对同一 exe 补跑仓库自带 e2e smoke（23:35），四项检查全部 PASS：

```text
PASS  页面已创建 — firstWindow() 返回了页面
PASS  无渲染进程异常 — pageerror 0 条
PASS  无 console.error — console.error 0 条
PASS  主进程无 CDP 积压 — 0 条告警
smoke 通过：应用能起来，工作台已渲染，观察期内未崩溃。
```

- 打包版「更新」分区与「关于」分区均显示 `0.1.0`；来源是唯一版本通道 `app:version`（`updates.version()` → `invoke('app:version')` → `app.getVersion()`），不是从渲染层读 `package.json`。
- `app-update.yml` 四行与 `electron-builder.yml` `publish` 块逐字段一致（§5）。
- **结论：PASS。**
- **证据**：`release/_probe/final/case1-smoke.out`；`release/_probe/final/evidence-facts.txt`。

## 3. 用例 2 · 无 Release → up-to-date（含 5 秒内二次检查回归）

- **命令**：打包版 + 隔离 userData + 空 token，`node release/_probe/final/case2-final.mjs`。
- **期望**：自动首查与主动检查均 `up-to-date`；不弹原生错误框；`updater.log` 有 `not available (no release)`；首查结束后 5 s 内再点「检查更新」不能卡在 `checking`。
- **实际**：

| 观测 | 值 |
|---|---|
| 自动首查状态 | `{"status":"up-to-date","checkedAt":"2026-11-23T15:14:16.471Z"}` |
| 首次主动检查 | 1,053 ms →「已是最新」 |
| 5 s 内第二次主动检查 | 1,051 ms →「已是最新」（两次点击间隔 1,051 ms） |
| UI | 「已是最新」；「最近检查 2026/11/23 23:14:18」；按钮恢复「检查更新」且可用 |
| 原生 JS 对话框 | 0 条 |
| 更新相关 console 错误 | 0 条 |
| 「关于」分区 | `["0.1.0","win32"]` |

- **结论：PASS。**
- **修复记录（本轮关键缺陷）**：修复前 `handleError` 用「5 s 内同 code 去重」合并 `error` 事件与 Promise rejection 的双触发；首查结束后 5 s 内的第二次主动检查也被这条去重吞掉，state 停在 `checking`，之后 `check()` 又被 `checking` 守卫直接 return，永久卡死。现改为按 **error 对象身份** 去重（`lastHandledError === error` 才跳过），下一次检查是新对象，照常处理。新包 asar 内已确认 `lastHandledError=True`、旧去重标记 `lastErrorAt=False`。
- **日志尾部**（`release/_probe/final/userdata-case2-2026-11-23T15-14-09-405Z/updater.log`）：

```text
[2026-11-23T15:14:09.792Z] updater started (packaged=true platform=win32 version=0.1.0)
[2026-11-23T15:14:14.799Z] check requested
[2026-11-23T15:14:14.800Z] checking-for-update
[2026-11-23T15:14:16.471Z] not available (no release): 服务器上还没有可用的发布版本（ERR_UPDATER_NO_PUBLISHED_VERSIONS）
[2026-11-23T15:14:17.229Z] check requested
[2026-11-23T15:14:17.229Z] checking-for-update
[2026-11-23T15:14:17.714Z] not available (no release): 服务器上还没有可用的发布版本（ERR_UPDATER_NO_PUBLISHED_VERSIONS）
[2026-11-23T15:14:18.285Z] check requested
[2026-11-23T15:14:18.286Z] checking-for-update
[2026-11-23T15:14:18.779Z] not available (no release): 服务器上还没有可用的发布版本（ERR_UPDATER_NO_PUBLISHED_VERSIONS）
```

## 4. 用例 3 · 断网 → error + 可读原因，应用仍可用

- **命令**：打包版启动参数 `--proxy-server=127.0.0.1:9`（死代理；未改系统网络 / 适配器 / 防火墙 / 系统代理），隔离 userData；`node release/_probe/03-06-case3.mjs`。
- **期望**：状态 `error`，`reason` 可读；应用不崩、其他页面可操作；日志记录原始错误码。
- **实际**：
  - 自动首查：`{"status":"error","reason":"网络不可用，无法连接更新服务器（NETWORK_ERROR）","code":"NETWORK_ERROR"}`。
  - 主动检查：1 s「检查中…」→ 第 2 s 落同一 `error`；UI「检查失败：网络不可用，无法连接更新服务器（NETWORK_ERROR） · NETWORK_ERROR」+「日志：userData/updater.log」。
  - 应用可用：切「关于」分区 IPC 往返成功，`["0.1.0","win32"]`。
  - 主进程 stderr 原始码：`Error: net::ERR_PROXY_CONNECTION_FAILED`；`updater.log` 落分类后的 `error [NETWORK_ERROR]`。
- **结论：PASS。**
- **日志尾部**（`release/_probe/userdata-case3-2026-11-23T15-14-31-225Z/updater.log`）：

```text
[2026-11-23T15:14:31.643Z] updater started (packaged=true platform=win32 version=0.1.0)
[2026-11-23T15:14:36.652Z] check requested
[2026-11-23T15:14:36.654Z] checking-for-update
[2026-11-23T15:14:38.704Z] error [NETWORK_ERROR] 网络不可用，无法连接更新服务器（NETWORK_ERROR）
[2026-11-23T15:14:42.401Z] check requested
[2026-11-23T15:14:42.402Z] checking-for-update
[2026-11-23T15:14:44.437Z] error [NETWORK_ERROR] 网络不可用，无法连接更新服务器（NETWORK_ERROR）
[2026-11-23T15:14:45.059Z] updater disposed
```

## 5. 用例 4 · 浏览器 dev → unavailable，不请求网络

- **命令**：使用仓库自带 e2e 的 Vite 配置（其 `watch.ignored` 已排除 `release` / `artifacts` / `fabric` / `forge` 等非源码树，避免默认 `npm run dev` 扫描整根目录导致事件循环占满、HTTP 不响应）：

```text
node node_modules/vite/bin/vite.js --config e2e-system/config/vite.e2e.config.ts --port 5197 --strictPort --host 127.0.0.1
CASE4_URL=http://127.0.0.1:5197/ node release/_probe/final/case4-final.mjs
```

- **期望**：`unavailable`；按钮禁用；版本 `dev`；无 GitHub 更新请求；不产生 `updater.log`。
- **实际**：

| 观测 | 值 |
|---|---|
| 状态 | 「当前宿主没有更新能力」 |
| 说明文案 | 「浏览器 dev 与未打包运行不可用；只有打包后的应用才连接发布源。」 |
| 「检查更新」按钮 | `disabled=true` |
| 版本 | `dev` |
| 网络请求总数 | 294（全部为 dev 模块 / 页面资源） |
| GitHub / releases 请求 | **0 条** |
| 更新相关 console | 0 条 |
| `browser-userdata/updater.log` | 不存在 |

- **结论：PASS。**
- **证据**：`release/_probe/final/case4.out`。

## 6. 用例 5 · 未打包 Electron → unavailable，无 404，不生成 updater.log

- **命令**：`node release/_probe/final/case5-final.mjs`（`electron.exe .`，`app.isPackaged=false`，隔离 userData + 空 token）。
- **期望**：`unavailable`；不请求网络；控制台无 404 / `ERR_UPDATER_*`；不产生 `updater.log`。
- **实际**：

| 观测 | 值 |
|---|---|
| 版本 | `0.1.0`（`app.getVersion()` 读 `package.json`） |
| 订阅推送 | `{"status":"unavailable"}` |
| `check()` | `{"status":"unavailable"}` |
| `install()` | `{"ok":false,"reason":"not-downloaded"}`；界面按钮已禁用，该通道实际不可达 |
| UI | 「当前宿主没有更新能力」；按钮禁用 |
| `updater.log` | 不存在 |
| GitHub 请求 | 0 条 |
| 坏 console（404 / `ERR_UPDATER` / `latest.yml` / github.com） | 0 条 |

- **结论：PASS。**
  - 说明：`install()` 的 `not-downloaded` 是 ElectronHost 转发到 updater 模块后的真实返回（没有已下载更新）；`unavailable` 是 BrowserHost 的返回口径（用例 4）。两者都不假装成功。
- **证据**：`release/_probe/final/case5.out`。

## 7. `app-update.yml` 四行原文

`release/win-unpacked/resources/app-update.yml`（23:04 构建）原文：

```yaml
owner: SanZiNEO
repo: ImmersiveCinematicsEditor
provider: github
updaterCacheDirName: immersive-cinematics-editor-updater
```

与 `electron-builder.yml` `publish` 块比对：

| 字段 | `electron-builder.yml` publish | `app-update.yml` | 一致 |
|---|---|---|---|
| provider | `github` | `github` | 是 |
| owner | `SanZiNEO` | `SanZiNEO` | 是 |
| repo | `ImmersiveCinematicsEditor` | `ImmersiveCinematicsEditor` | 是 |
| updaterCacheDirName | 未显式配置 | `immersive-cinematics-editor-updater` | builder 由包名 `immersive-cinematics-editor` 推导，非不一致 |

## 8. 单实例验证

判据：同一 `IC_EDITOR_USER_DATA` 启动第二份；第二份自行退出；最终只有 1 个非空主窗口标题（不按 tasklist 行数数进程）。

- 脚本：`node release/_probe/final/single-instance.mjs`
- 原始输出：

```text
WINDOWS_BEFORE=1
SECOND_EXIT={"exited":true,"code":0}
WINDOWS_AFTER=1
ASSERTIONS={
  "secondExited": true,
  "singleWindow": true
}
SINGLE_INSTANCE=PASS
```

- 代码顺序复核：`app.requestSingleInstanceLock()` 在 `whenReady()` / `createWindow()` / `updater.start()` 之前；未拿到锁直接 `app.quit()`；`second-instance` 对已有窗口 `restore/show/focus`。
- **结论：PASS。**

## 9. 通道、契约与依赖（按代码实际核对）

- **版本通道（唯一）**：`app:version`（invoke）→ `app.getVersion()`。`app.version()` 与 `updates.version()` 均复用它；全仓无 `updates:version` 第二版本通道。
- **更新通道**：`updates:state` / `updates:check` / `updates:install`，全部是 `handleMain` + `isMainSender` 校验的 invoke；状态由主进程 `sendToMain` 推送。
- **preload 暴露面**：`window.workbench.updates` 仅 `version / check / install / onState` 四个方法；未暴露裸 `ipcRenderer`，未开放任意通道名。
- **八态契约**：`idle`、`checking`、`up-to-date{checkedAt}`、`available{version}`、`downloading{version,percent,transferred,total,bytesPerSecond}`、`downloaded{version}`、`error{reason,code?}`、`unavailable` 逐字段对齐 03-03；无第九态。原生事件映射六项齐全。
- **feed 约束**：自有源码无 `setFeedURL` 调用（仅注释）；无 `dev-app-update.yml`；无 `forceDevUpdateConfig`。feed 只来自 `app-update.yml`。
- **BrowserHost**：`version()→'dev'`；`check()→{status:'unavailable'}`；`install()→{ok:false,reason:'unavailable'}`；`onState` 异步推一次 `unavailable`，无 fetch / IPC / updater 引用。
- **依赖**：`electron-updater ^6.8.11` 位于 `dependencies`；实装 6.8.11；无 7.x；asar 内 electron-updater 70 个条目、整仓一份副本。
- **启用条件**：仅 `app.isPackaged === true` 且 `win32/darwin` 初始化 updater；未打包 / 非支持平台恒 `unavailable`，懒加载 `autoUpdater`，不接触网络、不落 `updater.log`。
- **设置页**：`updates` 分区 order 55（about 50 → updates 55 → advanced 60）；中英文 `updates.` 19 个 key 完全对齐；「关于」分区不硬编码 `0.1.0`，读 `updates.version()`。

## 10. 基线命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | **0** | 无诊断输出（`release/_probe/final/typecheck.out`） |
| `npm run verify:all` | **2**（NOT RUN 语义，非失败） | PASS 14 / FAIL 0 / BLOCKED 0 / NOT RUN 1；`verify-09` 因未显式设置 `IC_MODULE_ROOT` 记 NOT RUN；各段断言数 171 / 51 / 204 / 598 / 85 / 399 / 96 / 389 / 568 未降（`release/_probe/final/verify-all.out`） |
| `npm run e2e:system:smoke -- --exe release/win-unpacked/ImmersiveCinematicsEditor.exe --hold 3000` | **0** | 四项 PASS（§2） |

## 11. 本轮不验证的链路

**「有更新 → 下载 → 安装 → 重启」整条链路不在本轮验证**：它需要真实 Release，归 05-04 首版演练。本轮未调用 `setFeedURL`、未写 `dev-app-update.yml`、未起本地 HTTP 假 feed、未改 `app-update.yml` / `electron-builder.yml`，也未创建任何 GitHub Release 或 tag。`updates:install` 的未保存守卫仅在 `downloaded` 态可达，本轮没有真实下载，因此未触发。

## 12. 证据文件索引（均在 gitignore 的 `release/_probe/`）

| 文件 | 内容 |
|---|---|
| `final/case1-smoke.out` | 打包版 e2e smoke 四项 PASS |
| `final/case2.out` / `final/case2-final.mjs` | 用例 2 全部断言与日志 |
| `final/case3.out` / `03-06-case3.mjs` | 用例 3 断网结果与日志 |
| `final/case4.out` / `final/case4-final.mjs` | 用例 4 浏览器 dev 结果 |
| `final/case5.out` / `final/case5-final.mjs` | 用例 5 未打包结果 |
| `final/single-instance.out` / `final/single-instance.mjs` | 单实例原始输出 |
| `final/evidence-facts.txt` | 产物大小 / mtime / app-update.yml / Release API / asar 标记 |
| `final/verify-all.out` | `verify:all` 输出（如已生成） |
| `03-06-contract-audit.md` | 逐 file:line 静态契约核对 |
