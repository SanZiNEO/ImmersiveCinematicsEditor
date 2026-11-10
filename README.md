# ImmersiveCinematicsEditor

ImmersiveCinematics 的独立 WebUI 编辑器：在游戏外用图形界面编排、预览和调试过场脚本（Electron + Vue 3）。

## 来源

代码来自主模组仓 [ImmersiveCinematics](https://github.com/SanZiNEO/ImmersiveCinematics) 的 `editor` 分支下 `editor/` 目录（导入时该分支 HEAD 为 `980d926`），搬入本仓库后移到根目录。只迁移了文件内容，没有随迁提交历史——原目录的提交仍留在主模组仓的历史里。

## 与主模组的关系

- **主模组是服务端**：游戏内按 **F9** 启动本地 WebSocket 服务（`127.0.0.1:8765`，路径 `/ws`）并打开预览屏，本程序是客户端。关屏即断开。
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

## 注意事项

- `electron-builder.yml` 的 `electronDist` 写死了本机绝对路径（`E:\Documents\GitHub\liveget\...`），换机器打包前需要按环境调整或删掉该行。
- 握手 `hello_ack` 携带主模组上报的 `version`，但当前协议不做兼容校验：编辑器与模组版本错配时不会报错，需要人工确认。
- 离线演示用的 `src/demo.ts` schema 与 `src/types.ts` 类型是手工维护的，主模组字段变更时需要同步。

## 许可证

MIT，见 [LICENSE](LICENSE)。
