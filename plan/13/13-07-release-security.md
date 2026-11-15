# 13-07 发布基线与安全

## 目的

把“能跑”收成“能发布”：

- 版本号固定，不再各处各写；
- 构建/打包可重复；
- 包内没有本机绝对路径、token、调试文件；
- 安装/首启/连接/卸载可验收；
- 已知限制写清楚，不把 AUI/未实现能力混进 WebUI 发布说明。

13-07 不改业务语义；它只产出发布包、发布说明和验收记录。

## 一、版本号

### 显示名

版本名不是 npm 的 `version` 字段，而是发布显示名。格式：

```text
WebUI：ImmersiveCinematicsEditor <编辑器版本> for <模组版本>
AUI：  ImmersiveCinematicsEditor <编辑器模组版本>-<加载器>-for <模组版本>
```

当前冻结值：

| 类型 | 默认显示名 | 说明 |
|---|---|---|
| WebUI | `ImmersiveCinematicsEditor 0.1.0 for IC 0.3.6` | IC = ImmersiveCinematics |
| WebUI 全称 | `ImmersiveCinematicsEditor 0.1.0 for ImmersiveCinematics 0.3.6` | 关于页/宽布局可用 |
| AUI | `ImmersiveCinematicsEditor 0.1.0-forge-for IC-0.3.6` | 14 才产出；13 只冻结格式 |

缩写规则：

- `IC` 只作为 `ImmersiveCinematics` 的缩写；
- 默认用缩写，因为完整模组名较长；
- 空间足够时（关于页、发布说明标题）可用全称；
- 同一个发布物只使用一个显示名，不在标题/状态栏/关于页各写一套；
- 不把显示名塞进 `package.json.version`；npm 版本仍是 `0.1.0`。

`package.json` 当前：

```json
"name": "immersive-cinematics-editor",
"version": "0.1.0",
"description": "ImmersiveCinematics standalone Web editor"
```

发布时保留 `version: 0.1.0`；模组版本 `0.3.6` 记录在发布清单/关于页，不改成 npm 版本。

### 文件名

显示名含空格，产物文件名用连字符：

```text
ImmersiveCinematicsEditor-0.1.0-for-IC-0.3.6-win-x64.exe
ImmersiveCinematicsEditor-0.1.0-forge-for-IC-0.3.6.jar   // 14 AUI
```

`electron-builder.yml` 的 `productName` 可保持 `ImmersiveCinematicsEditor`；`artifactName` 另配。关于页/状态栏读同一份版本清单，不硬编码多处。

## 二、构建与打包

### 现有入口

只使用现有 npm scripts：

```text
npm run dev
npm run build
npm run preview
npm run schema:export
npm run electron:dev
npm run electron:build
```

当前没有 `test` 脚本。13 不新增 `npm test`，不虚构自动化测试工程。

### 必跑

| 步骤 | 命令 | 产物/证据 |
|---|---|---|
| 前端产物 | `npm run build` | `dist/`，构建日志 |
| Electron 开发运行 | `npm run electron:dev` | 真窗口启动、首启、连接 |
| Windows 打包 | `npm run electron:build` | `release/` 下的 NSIS 安装包 |
| 安装/卸载 | 手动 | 安装截图、首启截图、卸载后残留检查 |

`npm run build` 通过 ≠ 发布通过；`electron:build` 通过 ≠ 游戏通过。两者都只是 13-04 的前置。

### `electron-builder.yml` 的发布阻断项

当前配置：

```yaml
electronDist: E:\Documents\GitHub\liveget\app\node_modules\electron\dist
```

这是本机绝对路径，不能作为发布基线。13-07 要求：

- 删除该绝对路径，或改为环境变量/本机覆盖文件；
- 默认走 electron-builder 的 electron 依赖解析；
- 不把 `E:\Documents\GitHub\...` 写进仓库发布配置；
- 打包日志里不出现本机私有路径；
- 如果必须保留本机覆盖，放在不入包的本地配置文件，并在发布说明标注“构建机特定设置不随包发布”。

其他打包项按现状保留：

- `asar: true`；
- `compression: maximum`；
- `electronLanguages: zh-CN, en-US`；
- `win.target: nsis`；
- `oneClick: false`；
- `allowToChangeInstallationDirectory: true`；
- `shortcutName: ImmersiveCinematics Editor`。

### 包内容

发布包只应包含：

- `dist/**/*`；
- `electron/**/*`；
- `package.json`；
- 必要的图标/许可/关于文件。

不应包含：

- `plan/`、`docs/`、测试夹具；
- `.git/`、`node_modules` 源目录；
- 本机 token、日志、截图；
- `release/` 旧产物；
- 绝对路径配置；
- 开发用的 `.env` / 私有证书。

## 三、安全

### 进程边界

当前 `electron/main.cjs`：

- BrowserWindow `frame: false`；
- `contextIsolation: true`；
- 窗口最小化/最大化/关闭走 IPC；
- token 由主进程读文件，经 preload 同步 IPC 给渲染进程。

发布要求：

- 渲染进程不开 `nodeIntegration`；
- preload 只暴露白名单 API（窗口控制、token 读取），不暴露 `fs`、`child_process`、任意 IPC；
- 文件选择/保存走主进程对话框，不由渲染进程直接拼路径；
- 外部链接不在应用内任意导航，必要时走系统浏览器；
- 没有远程调试端口、没有开发服务器暴露到 0.0.0.0。

### token

- 路径：`IC_WEBUI_TOKEN_FILE` 或 `<home>/.immersivecinematics/webui-token`；
- 服务端生成，客户端只读；
- 不写进日志、不写进发布包、不写进脚本；
- 关闭/世界退出后不残留；
- token 轮换后重连重新读取；
- 无 token 时不发起无意义连接；
- token 文件权限尽力 600（Windows 按当前用户 ACL 尽力收紧），失败不阻断但记录。

### WebSocket

- 只监听 `127.0.0.1:8765`；
- `/ws`；
- Origin 白名单；
- 多客户端不选举、不互相踢；
- 单会话关闭只释放本会话；
- 关键文本不能静默丢；
- 错误在状态栏可见。

### 脚本与资源路径

- 脚本保存要求 `.json`；
- 资源路径只接受 `immersive_cinematics/resource/` 下的相对路径；
- 拒绝绝对路径、盘符、UNC、`..` 逃逸；
- 资源列举与应用内打开同一份根；
- 不把本地绝对路径写进脚本；
- 不把 token/用户目录写进脚本。

## 四、兼容性

### WebUI

- 模组 `ImmersiveCinematics` 0.3.6；
- Forge 与 Fabric 两条加载器；
- Minecraft 版本以模组构建为准；
- Windows 10/11 优先；macOS/Linux 不作为 13 发布门禁，未验证就不写“支持”；
- 预览固定 1920×1080@60；
- H.264 需要 ffmpeg；无 ffmpeg 回退 RGBA；
- 外部音频格式需要 ffmpeg；无 ffmpeg 只保证 ogg/wav。

### AUI

13 不发布 AUI。AUI 的加载器版本、进程内端点、GPU 帧源、游戏内输入由 14 处理。13 只冻结 AUI 版本格式：

```text
ImmersiveCinematicsEditor <编辑器模组版本>-<加载器>-for <模组版本>
例：ImmersiveCinematicsEditor 0.1.0-forge-for IC-0.3.6
```

## 五、已知限制

发布说明必须如实写：

- AUI 未发布；游戏内编辑、进程内 GPU 帧源、游戏内输入不在本包；
- 没有 `npm test` / CI 自动化门禁；验收是真机手工执行；
- JPEG/WebP/MOV 当前不支持；不要写成可用；
- 视频播放依赖运行时/ffmpeg 能力；无 ffmpeg 时按实际回退；
- 外部音频格式依赖 ffmpeg；
- 不本地合成画面、不本地混音；最终画面/声音由游戏完成；
- 不做纯数据模板、模板包、模板 DSL；
- 不做字幕样式批处理、拆分合并、ASS 样式；
- 不做全局 z 表、第二套字幕 JSON、字幕 sidecar；
- 预览只有固定 1080p60，不提供 original/720p/30fps；
- macOS/Linux 未验证，不宣称支持；
- 发布包不含自动更新/遥测；未实现的能力不写成“已支持”。

已知限制不是“失败借口”：P0/P1 项不能靠一句“已知限制”放行；只有 P2 或用户明确接受的降级才能进这一段。

## 六、发布清单

| 项 | 必须 |
|---|---|
| 显示名 | `ImmersiveCinematicsEditor 0.1.0 for IC 0.3.6` |
| npm version | `0.1.0` |
| 模组版本 | `0.3.6` |
| 构建 | `npm run build` 成功 |
| 打包 | `npm run electron:build` 成功 |
| 安装 | NSIS 安装成功 |
| 首启 | 真窗口启动，无白屏/崩溃 |
| 连接 | 游戏 F6 后能连接 |
| 黄金脚本 | 至少 01/09 能打开/推送/播放 |
| 关闭 | 关闭幂等通过 |
| 已知限制 | 发布说明已写 |
| 证据 | 构建日志、安装截图、首启截图、连接截图、脚本哈希 |

## 七、发布阻断

以下任一情况，13-07 不产出发布包：

- `electronDist` 绝对路径仍在发布配置；
- 包内出现 token、本机绝对路径、开发日志；
- 安装后首启崩溃/白屏；
- 连接不上或连接后无预览；
- 关闭幂等未通过；
- 发布说明把 AUI/未实现能力写成已支持；
- 13-01 仍有 P0/P1 `FAIL` 或 `BLOCKED`。

## 通过标准

- 版本名固定且各处一致；
- 构建/打包/安装/首启/连接/关闭全部有证据；
- 包内容干净；
- 安全边界成立；
- 已知限制完整；
- 发布说明不夸大、不伪造。
