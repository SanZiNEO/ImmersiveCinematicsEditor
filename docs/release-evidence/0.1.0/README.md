# 0.1.0 本地自测证据

执行环境：Windows 本机、Node v22.23.2、npm 10.9.8、electron 43.5.0、electron-builder 26.15.3。
本目录只放文本；exe / blockmap / `latest.yml` 本体在 `release/`（`.gitignore:4` 忽略，不入库）。

## 1. 两次 `npm run release:local`

| 轮次 | 退出码 | 总耗时 | 构建段 | 打包段 | 校验段 | 冒烟段 | exe 字节数 | 校验输出 |
|---|---|---|---|---|---|---|---|---|
| 第 1 次 | 0 | 88.0 s | 13.09 s（vite 自报） | 67.5 s（探针） | 1.4 s（探针） | 7.6 s（探针） | 98,215,388 B | `PASS: ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe（98215388 B），五条断言全过` |
| 第 2 次 | 0 | 95.1 s | 16.34 s（vite 自报） | 67.5 s（探针） | 1.4 s（探针） | 7.6 s（探针） | 98,215,390 B | `PASS: ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe（98215390 B），五条断言全过` |

说明：

- 总耗时是两次 `npm run release:local` 实跑的 Stopwatch 值；构建段取 vite 输出 `✓ built in …`。
- 打包 / 校验 / 冒烟段时长来自同配置的单独计时探针（`npm run electron:build` 67.5 s、`node scripts/verify-release-assets.mjs` 1.4 s、`npm run e2e:system:smoke` 7.6 s）；不是两次实跑的内嵌计时。
- 两次 exe 字节数相差 2 B（98,215,388 → 98,215,390）。两次都用 `compression: maximum`，差异来源是打包时间戳与压缩产物内嵌时间字段；不承诺字节级一致，也不把差异解释为配置漂移。

两次尾部（冒烟段相同）：

```text
PASS: ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe（98215388 B），五条断言全过
...
  PASS  页面已创建 — firstWindow() 返回了页面
  PASS  无渲染进程异常 — pageerror 0 条
  PASS  无 console.error — console.error 0 条
  PASS  主进程无 CDP 积压 — 0 条告警
smoke 通过：应用能起来，工作台已渲染，观察期内未崩溃。
```

## 2. 产物名 / `latest.yml` / 磁盘三处同名

- `electron-builder.yml`：`artifactName: ${productName}-Setup-${version}-${arch}.${ext}`
- 磁盘：`release/ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe`
- `release/latest.yml`：`files[0].url: ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe`
- 逐字比较（PowerShell `-ceq`，区分空格/连字符/大小写）：`exact=True`。
- `release/win-unpacked/resources/app-update.yml`：

```yaml
owner: SanZiNEO
repo: ImmersiveCinematicsEditor
provider: github
updaterCacheDirName: immersive-cinematics-editor-updater
```

最终本地 0.1.0 产物指纹：exe 98,215,388 B、blockmap 103,387 B、`latest.yml` 中
`sha512: i7+epWx3TigepHi9RjyQw+lgTP3SxCvoBZPlSiIAKkS2eL2h+PN2eP2dSLMN0EWoFIHJFSYy3byzYOpY2wCwog==`、`size: 98215388`。

## 3. 版本注入与关于页

| 运行形态 | `window.workbench.app.version()` | 关于页「编辑器版本」 |
|---|---|---|
| 未打包（`node_modules/electron/dist/electron.exe .`，读 `package.json`） | 0.1.0 | 0.1.0 |
| 打包版（`release:local` 第 2 次产物） | 0.1.0 | 0.1.0 |
| 打包版（`npx electron-builder --win --publish never --c.extraMetadata.version=0.1.1`） | 0.1.1 | 0.1.1 |

- 0.1.1 注入构建的产物为 `ImmersiveCinematicsEditor-Setup-0.1.1-x64.exe`（98,215,098 B），
  `node scripts/verify-release-assets.mjs --version 0.1.1` 同样 `PASS`，五条断言全过。
- `src/workbench/settings/AboutSection.vue` 模板里已无 `0.1.0` 字面量，版本行是 `<dd>{{ version }}</dd>`；
  取不到时显示 `—`，不回退任何版本号。

## 4. 资产校验脚本三态

| 场景 | 命令 | 退出码 | 输出尾部 |
|---|---|---|---|
| 正例 | `node scripts/verify-release-assets.mjs --version 0.1.0` | 0 | `PASS: ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe（98215388 B），五条断言全过` |
| 负例（exe 改名加空格） | 同上（文件改名为 `ImmersiveCinematicsEditor Setup 0.1.0 x64.exe`） | 1 | `[2] files[0].url 磁盘存在 期望=true 实际=false（ImmersiveCinematicsEditor-Setup-0.1.0-x64.exe）`、`[3] sha512 … 实际=无法计算（文件不存在）`、`[3] size … 实际=无法计算（文件不存在）`、`FAIL: 3 条断言不成立` |
| 空目录 | 在临时目录的空 `release/` 下运行 | 2 | `NOT RUN: release/ 下没有 exe，尚未打包` |

补充：在 0.1.1 产物未清理、又叠加 0.1.0 打包后，`release/` 同时存在两份 exe，
脚本入口直接 `FAIL: release/ 残留 2 份 exe（应只有一份）` 并退出 1，未进入后续断言——旧产物清点生效。

## 5. 基线 tag

- 标签：`v0.1.0-base`
- 指向提交：tag 自身，即包含本记录的最终提交；实测 `git rev-parse v0.1.0-base` 输出的完整 SHA 见本轮执行回复。
- 创建时间：2026-11-23
- 对应 Release：无。`gh release list` 在本机 **NOT RUN**（未安装 gh CLI）；改用 GitHub REST API
  `GET /repos/SanZiNEO/ImmersiveCinematicsEditor/releases`，返回 `[]`（count=0）。
- 用途：仅作 `git rev-list --count` 的计数起点，不承担版本语义、不挂任何 Release。

## 6. 其他命令

```text
npm run typecheck  → exit 0（无输出）
npm run verify     → summary ok=171 fail=0，exit 0
```
