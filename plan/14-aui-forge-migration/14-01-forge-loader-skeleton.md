# 14-01 Forge 1.20.1 加载器骨架与 AUI 依赖（迁移执行）

> 状态：未实现（仅计划；骨架已存在，不是 14 交付）
> 轮次：14-aui-forge-migration
> 前置：`../13-webui-acceptance-release/README.md` 全部出口通过
> 关联：`README.md`、`14-02-aui-host-screen.md`、`14-05-input-focus-routing.md`、`14-08-forge-vertical-slice-acceptance.md`、`../shared/contracts.md`（C12/C15）、`../shared/host-scope.md`、`../shared/editor-package-modes.md`

## 1. 职责

冻结并补齐游戏内宿主的加载器事实：Forge 1.20.1 的 Gradle 模块、AUI 1.3.1 依赖与版本锁定、`mods.toml` 依赖声明、mixin 配置、平台服务、客户端专用边界、Fabric 骨架的保留方式。

本任务是 14 的**入口**，只保证“能加载、能声明依赖、能定位问题”。它不实现 Screen/画面/信号/飞控（见 14-02～14-06），也不把“加载器能启动”当作 14 完成。14-08 才会验证真实宿主链；14-09 才会验证全功能迁移。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 根 Gradle | `INGAME:build.gradle:1-8` | 插件：fabric-loom 1.10.5、ForgeGradle `[6.0,6.2)`、vanilla 0.2.1、Mixin 0.7；`subprojects` |
| Java 版本 | `INGAME:build.gradle:11`、`INGAME:gradle.properties:4` | toolchain 17 |
| 仓库 | `INGAME:build.gradle:41-56` | mavenCentral、Sponge、BlameJared、**Sighs（ApricityUI）`https://maven.sighs.cc/repository/maven-public/`**（52-55） |
| 资源展开 | `INGAME:build.gradle:62-88` | `pack.mcmeta`/`fabric.mod.json`/`mods.toml`/`*.mixins.json` 的 `${...}` 展开 |
| 模块 | `INGAME:settings.gradle:1-20` | `common`、`fabric`、`forge` |
| 版本/坐标 | `INGAME:gradle.properties:2-21` | `version=0.1.0`、`group=com.immersivecinematics`、`minecraft_version=1.20.1`、`forge_version=47.4.16`、`fabric_version=0.92.9+1.20.1`、`mod_id=immersive_cinematics_editor` |
| Forge 插件 | `INGAME:forge/build.gradle:1-6` | `net.minecraftforge.gradle` + `org.spongepowered.mixin` |
| Forge mixin | `INGAME:forge/build.gradle:12-17` | `add(sourceSets.main, "${mod_id}.refmap.json")`；两个 config |
| Forge runs | `INGAME:forge/build.gradle:29-56` | client/server；`workingDirectory project.file('run')`；`mixin.env.remapRefMap` |
| Forge 依赖 | `INGAME:forge/build.gradle:61-69` | MC forge；`compileOnly project(":common")`；mixin processor；**AUI `implementation fg.deobf("com.sighs:ApricityUI-forge-1.20.1:1.3.1")`（67-68）** |
| Forge 重混淆 | `INGAME:forge/build.gradle:87-92` | `jar.finalizedBy('reobfJar')`；`MixinConfigs` |
| Fabric 依赖 | `INGAME:fabric/build.gradle:14-21` | loader/fabric-api；**AUI Fabric 注释「当前无法启动，暂不接入」**（20-21） |
| Fabric runs | `INGAME:fabric/build.gradle:24-40` | client/server；`runDir("run")` |
| Forge 入口 | `INGAME:forge/src/main/java/com/immersivecinematics/editor/EditorMod.java:6-12` | `@Mod(MOD_ID)` 构造 → `EditorCommon.init()` |
| Fabric 入口 | `INGAME:fabric/src/main/java/com/immersivecinematics/editor/EditorMod.java:5-13` | `ModInitializer` → `EditorCommon.init()` |
| 公共常量 | `INGAME:common/src/main/java/com/immersivecinematics/editor/Constants.java:6-10` | `MOD_ID`、`MOD_NAME`、`LOG` |
| 公共初始化 | `INGAME:common/src/main/java/com/immersivecinematics/editor/EditorCommon.java:8-17` | 只打日志（平台名/环境） |
| 平台服务 | `INGAME:common/src/main/java/com/immersivecinematics/editor/platform/Services.java:12-24` | `ServiceLoader.load(IPlatformHelper.class).findFirst()` |
| 平台接口 | `INGAME:common/src/main/java/com/immersivecinematics/editor/platform/services/IPlatformHelper.java:3-33` | `getPlatformName/isModLoaded/isDevelopmentEnvironment/getEnvironmentName` |
| Forge 平台实现 | `INGAME:forge/src/main/java/com/immersivecinematics/editor/platform/ForgePlatformHelper.java:7-26` | `ModList`/`FMLLoader` |
| Fabric 平台实现 | `INGAME:fabric/src/main/java/com/immersivecinematics/editor/platform/FabricPlatformHelper.java:6-24` | `FabricLoader` |
| Forge mods.toml | `INGAME:forge/src/main/resources/META-INF/mods.toml:1-24` | `modLoader=javafml`、`loaderVersion=[47,)`、`modId=${mod_id}`、依赖 `forge` 与 `minecraft`；**无 `apricityui` 依赖** |
| Fabric mod 元数据 | `INGAME:fabric/src/main/resources/fabric.mod.json:1-31` | `environment=client`、`main` 入口、两个 mixin、依赖 fabricloader/fabric-api/minecraft/java |
| 公共 mixin 配置 | `INGAME:common/src/main/resources/immersive_cinematics_editor.mixins.json:1-16` | `package=com.immersivecinematics.editor.mixin`；`mixins/client/server` 均为空 |
| Forge mixin 配置 | `INGAME:forge/src/main/resources/immersive_cinematics_editor.forge.mixins.json:1-16` | 同上 |
| Fabric mixin 配置 | `INGAME:fabric/src/main/resources/immersive_cinematics_editor.fabric.mixins.json:1-16` | 同上 |
| 平台服务注册 | `INGAME:forge/src/main/resources/META-INF/services/com.immersivecinematics.editor.platform.services.IPlatformHelper:1` | `ForgePlatformHelper` |
| Fabric 服务注册 | `INGAME:fabric/src/main/resources/META-INF/services/com.immersivecinematics.editor.platform.services.IPlatformHelper:1` | `FabricPlatformHelper` |
| AUI 元数据（Forge 1.3.1） | `example/[晴雪UI] ApricityUI-forge-1.20.1-1.3.1.jar!/META-INF/mods.toml` | `modId=apricityui`、`version=1.3.1`、`clientRequired=true`、`forge [47,)`、`minecraft [1.20.1,1.21)`、client mandatory |
| AUI Forge 入口类 | 同上 jar：`com/sighs/apricityui/forge/ApricityUIForge.class`、`AuiServicesBootstrap.class`、`ClientServicesBootstrap.class`、`ScriptService.class` | 由 AUI 自身注册服务/网络/脚本 |
| AUI 版本并存 | `example/` | 1.2.7 与 1.3.1 的 Forge/Fabric jar 都在；Gradle 锁 1.3.1 |
| Forge dev 加载证据 | `forge/run/logs/latest.log:24-25` | `Hello Forge world!` + `ImmersiveCinematics Editor on Forge (development)` |
| AUI 加载证据 | 同上 `:28-29` | `startup hooks: none registered`；`[NetworkAutoReg] Metadata scan found: 4` |
| AUI JS 缺失证据 | 同上 `:35` | `[AUI JS] neither KubeJS nor a compatible Rhino runtime is present; page scripts are skipped (pages still render)` |
| AUI 页面渲染证据 | 同上 `:46-59,78-82` | `devtools/toast.html` document create 248ms、layout commit 53ms、READY_PAINT |
| AUI debug 端口 | 同上 `:34` | `Apricity external debugger listening at ws://127.0.0.1:25321/apricity`（dev） |
| Fabric AUI 崩溃 | `fabric/run/crash-reports/crash-2026-11-10_*.txt` | `ServiceConfigurationError: IAnnotationScanner ... FabricAnnotationScanner Unable to get public no-arg constructor`（4 份同因） |
| Fabric AUI 注释 | `INGAME:fabric/build.gradle:20-21` | 明确「Fabric 包当前无法启动，暂不接入」 |

**已核对的缺口**：

1. **`mods.toml` 未声明 `apricityui`**：AUI 是 `implementation` 依赖（不打包），生产环境缺 AUI 时 Forge 不会在加载期给出「缺少前置」的友好提示，而是在 `EditorMod`/`ApricityScreen` 类加载时抛 `NoClassDefFoundError`。
2. **`fabric.mod.json` 也未声明 AUI**：符合「Fabric AUI 暂停」，但保留骨架时不要误加。
3. **mixin 配置为空**：14-05 若需要输入/渲染注入，必须新增 mixin 类并登记；空配置本身合法。
4. **`common` 不引用 MC**：`common/build.gradle` 只有 mixin/jsr305 `compileOnly`；14 的共享代码若引用 `net.minecraft` 类型，必须放在 `forge` 模块，或给 `common` 加 vanilla 依赖。
5. **AUI 版本未锁定到具体 artifact 校验**：Gradle 锁 `1.3.1`，但无 checksum/仓库镜像；AUI 升级会直接改变行为。
6. **AUI 的 debug WebSocket（25321）**：dev 默认开启；发布版需确认关闭或至少不与主模组 8765 混淆。
7. **AUI 页面脚本缺失**：Forge dev 环境无 KubeJS/Rhino；14 的 UI 交互不能依赖页面 JS（14-02/14-09 已按 Java 侧绑定设计）。
8. **`version=0.1.0` 与主模组 0.3.6 的对应关系**未写入元数据；发布需注明 `for 0.3.6`（C12）。
9. **没有主模组 `api/editor` 的加载期探测**：若主模组版本过旧，编辑器模组可能在首次访问时抛 `NoClassDefFoundError`，而不是明确提示“主模组缺少 editor API”。
10. **没有客户端专用边界**：`common` 的 `EditorCommon.init()` 在服务端也会跑；14 必须确保 AUI/客户端 Screen/输入类只在客户端加载。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| AUI 依赖声明 | `implementation` only | `mods.toml` 增加 `[[dependencies.${mod_id}]] modId="apricityui" mandatory=true versionRange="[1.3.1,1.4)" ordering="AFTER" side="CLIENT"`（提案；范围按 AUI 兼容策略） |
| AUI 版本 | 1.3.1 | 锁定 1.3.1；升级需跑 14-08/14-09 回归 |
| mixin | 空 | 14-05 若需注入，新增并登记；否则保持空 |
| `common` MC 依赖 | 无 | 共享代码只用 JDK/自有类型；需要 MC 的代码放 `forge` |
| 发布元数据 | 无 `for` 版本 | `mods.toml` 的 `description`/`displayName` 或 README 注明 `for ImmersiveCinematics 0.3.6` |
| 主模组 API 探测 | 无 | 编辑器模组启动时探测 `api/editor`（提案 `EditorApiProbe`）；缺失时明确提示并禁用 ingame，不崩溃到不可读 |
| 客户端边界 | 未明确 | `common` 不引用 AUI/MC 客户端类；Forge 的 Screen/输入/控制器放 `client` 包；服务端不加载 |
| Fabric | 骨架保留，AUI 不接入 | 保持；不删除 `fabric/` 模块与注释；不纳入验收 |

### 3.2 拟修改（提案）

- `INGAME:forge/src/main/resources/META-INF/mods.toml`
  - 增加 AUI 依赖块（client mandatory）；`ordering="AFTER"`，确保 AUI 先初始化。
  - `description` 增加 `for ImmersiveCinematics 0.3.6`。
  - 若 Forge 1.20.1 元数据支持客户端专用声明，则加上；具体键以实现期 Forge 文档为准，不虚构键名。若不能声明，则用 `Dist.CLIENT` 守卫 + 专用服务端不加载客户端类来实现同等边界。
- `INGAME:forge/build.gradle`
  - AUI 版本改为 `gradle.properties` 的 `apricityui_version=1.3.1`，避免散落。
  - 可选：`resolutionStrategy` 锁定版本，防止传递依赖升级。
- `INGAME:forge/src/main/resources/immersive_cinematics_editor.forge.mixins.json`
  - 仅在 14-05 需要时增加；否则保持空。
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/`（提案）
  - 新增客户端入口/探测：`EditorApiProbe` 检查 `EditorHostApi`/`api/editor` 是否存在；`EditorClientInit` 注册键/屏幕（14-05）。
- **不新建**独立 `ingame` 模块；沿用 `common`/`forge`。主模组的 `editor.ingame` 是主模组内部包，不是编辑器仓库的新模块。

## 4. 输入输出与字段约束

### 4.1 构建输入

| 项 | 值 | 约束 |
|---|---|---|
| MC | 1.20.1 | `gradle.properties:7` |
| Forge | 47.4.16 | `gradle.properties:21`；AUI 要求 `[47,)` |
| Java | 17 | `gradle.properties:4` |
| AUI | 1.3.1（Forge） | `forge/build.gradle:68`；`mods.toml` 声明 `[1.3.1,1.4)` |
| 映射 | `official` | `forge/build.gradle:20` |
| 运行目录 | `forge/run` | `forge/build.gradle:31` |

### 4.2 输出

- `immersive_cinematics_editor-forge-1.20.1-0.1.0.jar`（`archivesName`，`forge/build.gradle:9-10`）。
- `META-INF/mods.toml` 含 AUI 依赖。
- `META-INF/services/...IPlatformHelper` 指向 `ForgePlatformHelper`。
- mixin refmap 生成（`forge/build.gradle:12-17`）。
- 客户端入口/探测类只在 Forge 客户端分布加载。

### 4.3 失败行为

| 场景 | 期望 |
|---|---|
| 缺 AUI | Forge 加载期提示「缺少前置 apricityui」，不进入游戏 |
| AUI 版本过低 | 同上（versionRange 不满足） |
| AUI 版本过高（1.4+） | 同上（范围上限；升级需改合同） |
| mixin 注入失败 | 启动日志明确；不静默降级 |
| 服务注册缺失 | `Services.load` 抛 NPE（`Services.java:19-22`）；应在构建期发现 |
| 主模组缺 `api/editor` | `EditorApiProbe` 提示「主模组版本过旧/缺少 editor API」，禁用 ingame；WebUI 不受影响 |
| 专用服务端 | 不加载 AUI/Screen/输入类；无 `NoClassDefFoundError` |
| AUI 页面脚本缺失 | 页面仍渲染；14 的交互走 Java 绑定，不把“无 JS”当加载失败 |

## 5. 修改步骤

1. `gradle.properties` 增加 `apricityui_version=1.3.1`；`forge/build.gradle:68` 引用它。
2. `mods.toml` 增加 AUI 依赖块；`description` 加 `for 0.3.6`。
3. 确认 `example/` 的 AUI jar 不作为运行时依赖打包；只通过 Maven 坐标。
4. 若 14-05 需要 mixin：在 `forge.mixins.json` 的 `client` 数组登记，`refmap` 保持。
5. 保留 Fabric 模块与注释；不删除、不改 `fabric.mod.json` 的 AUI 缺失状态。
6. 新增 `EditorApiProbe`/客户端入口（提案）；确保 `common` 不引用 AUI/MC 客户端类。
7. 记录 AUI 升级回归清单（14-08/14-09）。
8. 本任务只交付加载器；14-02～14-09 另行验收，不得以本任务完成宣布 14 完成。

## 6. 禁止修改

- 不把 AUI jar 打进编辑器模组 jar（`implementation` 不打包；不要改 `jarJar`/`shadowJar`）。
- 不删除 `fabric/` 模块或把 Fabric 骨架改成「已暂停」以外的状态。
- 不改 MC/Forge/Java 版本（1.20.1/47.4.16/17）。
- 不把 AUI 的内部类写进 `common` 的公共 API。
- 不在 `mods.toml` 声明 `mandatory=false` 的 AUI（会让缺前置时静默崩溃）。
- 不在 `common` 初始化里创建 Screen/注册键/订阅帧源；这些属于 14-02/14-05。
- 不以“AUI 能加载自带页面”证明编辑器宿主可用。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `1.20.1` | `common`/`forge` 骨架、`mods.toml`、`forge/build.gradle`、mixin 配置；Fabric 骨架保留 |
| 编辑器 `webui` | 不承载加载器；共享文档/协议/模型 |
| 主模组 `main` | 不承载编辑器加载器；只提供 `api/editor` 合同与 `editor.ingame` 实现 |

## 8. 前置

- AUI 1.3.1 的 Maven 仓库可用（`INGAME:build.gradle:52-55`）。
- ForgeGradle 能解析 `com.sighs:ApricityUI-forge-1.20.1:1.3.1`。
- 主模组已提供 `api/editor`（或本任务只完成加载器，14-03/04/06 再落地接口；不得用私有类替代）。
- 13 的 WebUI 出口通过；14 不从本任务开始做 WebUI 功能。

## 9. 正反例验收

**正例 A**：`sh gradlew :forge:build` 通过；jar 的 `mods.toml` 含 `apricityui` 依赖；`META-INF/services` 指向 `ForgePlatformHelper`。
**正例 B**：Forge dev run 启动，日志出现 `Hello Forge world!`、`ImmersiveCinematics Editor on Forge (development)`、AUI `startup hooks`、`NetworkAutoReg`。
**正例 C**：Fabric 模块仍可被 Gradle 识别（不构建/不运行），`fabric.mod.json` 未被改动。
**正例 D**：AUI 1.3.1 的 `mods.toml` 与编辑器 `mods.toml` 的版本范围兼容（`[47,)`、`[1.20.1,1.21)`）。
**正例 E**：专用服务端启动不加载 AUI/Screen/输入类；日志无 `NoClassDefFoundError`。
**正例 F**：删除/替换主模组为无 `api/editor` 的构建 → 启动时明确提示，ingame 禁用，WebUI 不受影响。

**反例 A**：删除 AUI 依赖后启动 → Forge 应提示缺少 `apricityui`（不是 `NoClassDefFoundError`）。
**反例 B**：把 AUI 版本改成 1.4.0（不存在）→ Gradle 解析失败，不静默降级。
**反例 C**：把 AUI jar 打进模组 jar → 与外部前置重复，类冲突；验收不通过。
**反例 D**：Fabric 侧接入 AUI（当前崩溃：`FabricAnnotationScanner` 无 public 无参构造，见 crash 报告）→ 不纳入验收；不得因此删除 Fabric 骨架。
**反例 E**：`common` 直接 import `ApricityScreen` → 专用服务端类加载失败；验收不通过。
**反例 F**：以“AUI 自带 `toast.html` 能渲染”证明 `editor/index.html` 可用 → 不通过；页面属于 14-02。

## 10. 真实游戏冒烟（未执行）

前置：ForgeGradle 可联网/有缓存；AUI 1.3.1 可解析；AUI 依赖声明已加。

1. `sh gradlew :forge:build`（只读验证，实际执行留待 14-08）。
2. 启动 Forge client run，确认 4.2 的日志行。
3. 启动专用服务端，确认不加载 AUI/客户端 Screen。
4. 删除 `mods.toml` 的 AUI 依赖块做对照，确认加载期提示。
5. 检查 jar 内无 `com/sighs/apricityui/**` 类。
6. 用无 `api/editor` 的主模组构建做对照，确认 `EditorApiProbe` 提示。

**本轮未执行**：未运行 Gradle/游戏；以上为 14-08 统一冒烟的前置步骤。

## 11. 完成定义

- `mods.toml` 的 AUI 依赖声明落地；版本范围与 AUI 1.3.1 兼容。
- AUI 版本集中在 `gradle.properties`；升级有 14-08/14-09 回归清单。
- 客户端/专用服务端边界明确：`common` 不引用 AUI；服务端不加载客户端类。
- 主模组 `api/editor` 缺失时有明确探测/提示，不崩溃到不可读。
- Fabric 骨架保留且不纳入验收；主模组 Fabric 与 WebUI→Fabric 不受影响。
- 本任务只证明加载器；14-02～14-09 未完成时，14 不算完成。
- 未执行的真实冒烟明确标注。
