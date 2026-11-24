# ImmersiveCinematicsEditor

ImmersiveCinematics 的独立 WebUI 编辑器：在游戏外用图形界面编排、预览和调试过场脚本（Electron + Vue 3）。

## 来源

代码来自主模组仓 [ImmersiveCinematics](https://github.com/SanZiNEO/ImmersiveCinematics) 的 `editor` 分支下 `editor/` 目录（导入时该分支 HEAD 为 `980d926`），搬入本仓库后移到根目录。只迁移了文件内容，没有随迁提交历史——原目录的提交仍留在主模组仓的历史里。

## 与主模组的关系

- **主模组是服务端**：游戏内按 **F6**（`EDITOR_OPEN`，默认键，可在「控制 → 按键绑定」改）启动本地 WebSocket 服务（`127.0.0.1:8765`，路径 `/ws`）并打开预览屏，本程序是客户端。关屏即断开。
- **权威在主模组**：字段、schema 与校验都由模组回答（`schema.get` / `registry.query` / `script.validate`），编辑器不定义脚本格式，也不直接读脚本文件。
- 编辑器本体不进模组 jar；本仓库的发布物是独立的 Windows 安装包。
- 每次发布注明对应的主模组版本（`for <主模组版本>`）。当前版本 `0.1.0`，对应主模组 0.3.6 开发线。

## 分支

| 分支 | 用途 |
|---|---|
| `webui` | Electron 前端，单分支跨 Minecraft 版本（当前分支） |
| `ingame/<mc>` | 规划中：基于晴雪 UI（AUI）前置的游戏内编辑器附属模组，按 MC 版本开分支，与 WebUI 共用同一套消息与模型 |

主模组仓不再包含编辑器源码，只保留对外 API、WebSocket 服务端、帧捕获与预览屏。

## 目录

| 路径 | 内容 |
|---|---|
| `src/` | Vue 3 应用：时间轴、属性/关键帧/触发器面板、动态表单、预览、脚本架构图、飞控叠层、i18n |
| `src/lib/previewProtocol.ts` | 预览帧协议解析（18 字节大端头 + H.264 Annex B / 原始 RGBA 回退） |
| `electron/` | Electron 主进程与 preload |
| `build/` | 打包图标 |
| `electron-builder.yml` | Windows NSIS 打包配置 |
| `FEATURE_CHECKLIST.md` | 功能清单 |

## 开发

```sh
npm install
npm run dev             # Vite 开发服务（浏览器里跑 UI）
npm run electron:dev    # Electron 窗口
npm run electron:build  # Windows NSIS 安装包，输出到 release/
```

没连游戏时编辑器以离线演示模式运行（示例脚本 + 内置 schema），可以单独浏览界面。

### 交互走查

```sh
npm run e2e:system:review                                    # 默认夹具 seven-tracks.json
npm run e2e:system:review -- --fixture "D:\path\script.json" # 可选本地 JSON（相对当前 cwd）
```

每次启动独立环境：本会话专属 profile、workspace 与空 token，不连真实游戏；Vite dev server 独占 `127.0.0.1:5174`（配置端口 +1，可与离线回归套件并行），端口被占用会直接报错。默认夹具为仓库内 `src/core/schema/fixtures/scripts/valid/seven-tracks.json`，复制进本次产物工作区后用真实打开路径载入，不改原文件。

终端打印产物目录（`e2e-system/artifacts/review-*/`）和 `REVIEW_READY` 后即可操作窗口：操作到问题界面后自行截图，把图片发到聊天并说明图中编号。页面走 Vite HMR；刷新后可从工作台脚本列表重新打开该隔离夹具。

关闭窗口或按 Ctrl+C 结束，本会话的 Electron/Vite 会被清理；关闭后可用 `netstat -ano | findstr :5174` 确认无本次会话监听。

正常关窗仍会询问如何处理未保存的修改。按 Ctrl+C 中止走查或自动套件收尾时，测试宿主只回收本次启动的进程，不会把未保存的修改写入样例。需要保留走查修改时，先保存到隔离副本。

普通离线回归仍用 `npm run e2e:system:run -- --suite offline`（默认离线夹具，不依赖真实游戏）。

## 注意事项

- 握手 `hello_ack` 携带主模组上报的 `version`，但当前协议不做兼容校验：编辑器与模组版本错配时不会报错，需要人工确认。
- 离线演示用的 `src/demo.ts` schema 与 `src/types.ts` 类型是手工维护的，主模组字段变更时需要同步。

## 发布

- 版本号来自 tag（`vX.Y.Z`）：`package.json` 的 `version` 恒为 `0.1.0`，真实版本在构建时用 `--c.extraMetadata.version` 注入；关于页显示的版本取自主进程 `app.getVersion()`。
- 安装包由构建流水线（CI）产出；本地 `npm run release:local` 只做自测（构建 → 打包 → 资产校验 → 打包产物冒烟）。
- 本地 `0.1.0` 包仅作机器自测，是否对外分发不在本轮决定。

## 许可证

MIT，见 [LICENSE](LICENSE)。
