# R14-01 Forge 1.20.1 附属模组与 AUI 前置

> 前置：R14-00 合同审计通过；R13 全部出口 PASS
> 后续：R14-02 Screen
> 状态：设计合同；构建/启动未执行时不填 PASS

## 1. 职责

把 `ImmersiveCinematicsEditor` 固定为 **Forge 1.20.1 的附属模组**：

- 依赖主模组 `immersive_cinematics` 与外部 UI 前置 `apricityui 1.3.1`；
- 不把 AUI 变成主模组的硬依赖；
- 不打包 AUI；
- Fabric 模块保留骨架，不接 AUI；
- 构建产物可在 Forge 1.20.1 客户端与主模组一起启动，并由 `EditorEntry` 注册 `INGAME` 载体。

本文件不写 Screen/页面/帧源/端点；只写加载器、依赖、入口、客户端边界。

## 2. 当前事实

### 2.1 仓库与分支

- 编辑器仓库：`E:\Documents\GitHub\ImmersiveCinematicsEditor`。
- `1.20.1` 分支当前只有骨架：
  - `common/.../EditorCommon.java`
  - `common/.../Constants.java`
  - `common/.../platform/Services.java`
  - `common/.../platform/services/IPlatformHelper.java`
  - `forge/.../EditorMod.java`
  - `forge/.../platform/ForgePlatformHelper.java`
  - `fabric/.../EditorMod.java`
  - `fabric/.../platform/FabricPlatformHelper.java`
  - `forge/src/main/resources/META-INF/mods.toml`
- 当前工作树在 `webui` 分支；R14 必须从 `1.20.1` 分支读写，不能拿 `webui/src` 当目标结构。

### 2.2 构建与依赖

`1.20.1:forge/build.gradle` 当前事实：

- Forge `47.4.16`，Minecraft `1.20.1`，Java 17；
- `implementation fg.deobf("com.sighs:ApricityUI-forge-1.20.1:1.3.1")` 已存在；
- AUI 是开发期依赖，不打包；
- `mods.toml` 当前只声明 `forge`、`minecraft`，**没有** `apricityui` 依赖；
- 生产环境缺 AUI 时，加载器不会提前给出“缺前置”的明确提示，可能在类加载期失败。

`1.20.1:fabric/build.gradle` 当前事实：

- AUI 依赖被注释：“Fabric 包当前无法启动，暂不接入”；
- `fabric.mod.json` 存在，入口 `EditorMod`；
- R14 不改 Fabric 的 AUI 接入；保留骨架，WebUI→Fabric 仍按 R13 基线。

### 2.3 AUI 1.3.1 事实

- 文件：`E:\Documents\GitHub\ImmersiveCinematicsEditor\example\[晴雪UI] ApricityUI-forge-1.20.1-1.3.1.jar`。
- `mods.toml`：`modId=apricityui`、`version=1.3.1`、`clientRequired=true`；依赖 `forge [47,)`、`minecraft [1.20.1,1.21)`。
- 关键类：`com.sighs.apricityui.screen.ApricityScreen`、`init.Document`、`init.Element`、`render.Base`、`render.Operation`、`client.Client`。
- `ApricityScreen` 构造只收 `templatePath`；`setPauseGame(boolean)`、`setShowDefaultBackground(boolean)`、`getLinkedDocument()`、`handleViewportZoom(boolean)`、`resetViewportZoom()` 可调用。
- 当前 Forge dev 环境没有 KubeJS/Rhino；页面脚本会被跳过，页面仍渲染。R14 的交互不能依赖页面 JS。

## 3. 方案

### 3.1 模组关系

```text
ImmersiveCinematics（主模组）
  └─ 不依赖 AUI；提供 api/editor、运行时、捕获、播放、飞控

ImmersiveCinematicsEditor（附属模组）
  ├─ 依赖 immersive_cinematics
  ├─ 依赖 apricityui（客户端必需）
  ├─ 注册 INGAME 载体 / 设置 EditorEntry 指针
  └─ 提供 EditorAuiScreen、AUI 页面、进程内适配

ApricityUI（外部前置）
  └─ 不打包；缺失时 Forge 依赖界面提示
```

### 3.2 `mods.toml` 目标

附属模组 `forge/src/main/resources/META-INF/mods.toml` 需要补齐：

| 依赖 | mandatory | versionRange | ordering | side |
|---|---|---|---|---|
| `forge` | true | `[47,)` | NONE | BOTH |
| `minecraft` | true | `[1.20.1,1.21)` | NONE | BOTH |
| `immersive_cinematics` | true | `[0.3.6,0.4)` | AFTER | CLIENT |
| `apricityui` | true | `[1.3.1,1.4)` | AFTER | CLIENT |

约束：

- `apricityui` 只在客户端必需；专用服务端不加载本附属模组。
- `immersive_cinematics` 是主模组，必须先于本模组完成初始化；`ordering="AFTER"`。
- 不把 AUI jar 塞进本模组 jar；`implementation` 只用于编译，发布不含 AUI。
- 不把 `apricityui` 写进主模组 `mods.toml`。
- 缺 AUI 时由 Forge 依赖校验给出明确缺失，不允许“类加载崩溃但无提示”。

### 3.3 版本与显示名

- `gradle.properties.version` 保持 `0.1.0`；不把展示串塞进 `version`。
- Forge 模组显示名/描述使用 AUI 格式：
  - `ImmersiveCinematicsEditor 0.1.0-forge-for IC-0.3.6`
  - `IC` 是 `ImmersiveCinematics` 的缩写；版本名过长时用缩写，不长可全写。
- WebUI 仍使用 `ImmersiveCinematicsEditor 0.1.0 for IC 0.3.6`；R14 不改变 WebUI 版本名。
- `mods.toml` 的 `version` 仍填 `${version}`（`0.1.0`）；展示串只用于 `displayName`/描述/关于页，不参与依赖版本匹配。

### 3.4 入口与注册

`forge/.../EditorMod.java` 负责：

1. 构造时检查客户端分布；专用服务端不加载 AUI/Screen 类。
2. 调用 `EditorCommon.init()`；平台 helper 仍由 `Services` 选择。
3. 在客户端初始化阶段：
   - 注册 `INGAME` 载体到 `EditorEntry`；
   - 将 `EditorEntry.activeCarrier` 指向 `INGAME`（AUI 附属模组可改的入口指针）；
   - 注册 `F6` 的 `EDITOR_OPEN` 键（若主模组已注册统一键，则不再重复注册）；
   - 不在此阶段打开 Screen、不 attach 端点、不订阅帧源。
4. 若 AUI 类不可用/页面缺失，注册仍可完成，但 `isAvailable()` 返回 false；`F6` 回退 WebUI 或提示，不崩溃。

**键位归属**：R14 起 `F6` 是主模组统一入口键，不是附属模组另注册的第二键。附属模组只提供载体，不抢全局键位；这样 AUI 不存在时 WebUI 仍能用同一个 `F6`。

### 3.5 客户端边界

- 附属模组只声明客户端入口；`clientRequired=true` 由 AUI 自身声明。
- 专用服务端不加载 `EditorAuiScreen`、不加载 `Document`/`Element`、不加载 AUI mixin。
- 主模组 `api/editor` 不引用任何 AUI 类型；附属模组内部可以引用。
- 构建检查：主模组 jar 的常量池/依赖中不出现 `com.sighs.apricityui`；附属模组 jar 不内嵌 AUI 类。

### 3.6 Fabric 骨架

- 保留 `fabric` 模块与 `fabric.mod.json`；Gradle 能识别，不构建/不运行 AUI。
- 不把 Forge 的 AUI 依赖复制到 Fabric；Fabric AUI 恢复时另立轮次。
- WebUI→Fabric 回归仍走 R13；R14 不改 Fabric 主模组/WebUI 通路。

## 4. 输入输出

### 4.1 输入

- `1.20.1` 分支骨架、`forge/build.gradle`、`mods.toml`。
- AUI 1.3.1 jar 的 `mods.toml` 与类签名。
- 主模组 `gradle.properties`：`mod_id=immersive_cinematics`、`version=0.3.6`、`minecraft_version=1.20.1`、`forge_version=47.4.16`。

### 4.2 输出

- 可构建的 Forge 1.20.1 附属模组 jar。
- `mods.toml` 含主模组 + AUI 的前置声明。
- `INGAME` 载体注册与 `EditorEntry` 指针设置。
- 客户端/服务端边界检查记录。
- Fabric 骨架保留记录。

### 4.3 禁止

- 主模组硬依赖 AUI。
- 把 AUI 打进发布 jar。
- 用 `F8`/`F9` 作为第二个编辑器入口。
- 在 `EditorMod` 构造里打开 Screen 或 attach 资源。
- 用“构建成功”代替 Forge 客户端真实启动。

## 5. 验收

### 5.1 正例

**正例 A**：`gradlew :forge:build` 通过；jar 的 `mods.toml` 含 `immersive_cinematics` 与 `apricityui` 依赖；`META-INF/services` 指向 `ForgePlatformHelper`。

**正例 B**：Forge 1.20.1 客户端同时装主模组 + 附属模组 + AUI 1.3.1；启动日志出现主模组、编辑器、AUI 初始化；无类加载异常。

**正例 C**：只装主模组、不装附属模组/AUI；主模组正常；`F6` 打开 WebUI（或明确无 ingame 载体），不报缺类。

**正例 D**：装附属模组但不装 AUI；Forge 在依赖校验阶段提示缺 `apricityui`，不进入类加载崩溃。

**正例 E**：专用服务端启动不加载 `EditorAuiScreen`/AUI；客户端才注册 `INGAME`。

**正例 F**：Fabric 模块仍可被 Gradle 识别；`fabric.mod.json` 未被改动；WebUI→Fabric 通路不受 R14 影响。

### 5.2 反例

| 反例 | 判定 |
|---|---|
| 主模组 `mods.toml` 写 `apricityui` | 失败：依赖方向错误 |
| 附属模组把 AUI 类打进 jar | 失败：重复类/许可/体积问题 |
| AUI 缺失时直接 `NoClassDefFoundError` | 失败：缺前置应可诊断 |
| 附属模组注册第二个 F6 键 | 失败：双入口冲突 |
| `EditorMod` 构造时 `new EditorAuiScreen()` | 失败：未进世界就建 UI |
| Fabric 也被强行接 AUI | 失败：超出 R14 范围 |

### 5.3 执行记录

| 项 | 结果 | 证据 |
|---|---|---|
| `:forge:build` | NOT RUN | 待执行 |
| `mods.toml` 依赖 | NOT RUN | 待执行 |
| 客户端启动 | NOT RUN | 待执行 |
| 缺 AUI 负例 | NOT RUN | 待执行 |
| 服务端不加载 AUI | NOT RUN | 待执行 |
| Fabric 骨架保留 | NOT RUN | 待执行 |
