# 01-01 编辑器总开关

> **状态：已实现**。实现文件：`Config.java`、`ForgeConfig.java`、`FabricConfig.java`、`ClientEventHandler.java`、`CinematicKeyBindings.java`、`WebEditorServer.java`、`WebPreviewScreen.java`、`WebEditorApi.java`、`EditorManager.java`。

## 目标

加一个配置开关，一键关闭所有编辑器相关能力。绝大多数玩家只播放、不编辑，关闭后不承担任何编辑器开销。

## 实际改动

### 1. 配置项

`Config.java`：

```java
// ===== 编辑器总开关 =====

/** 编辑器总开关（仅客户端生效）；关闭时编辑器按键/本地服务/画面捕获/消息处理全部不加载。 */
public static boolean editorEnabled = true;
```

`ConfigValues` record 末尾追加第 16 个分量 `boolean editorEnabled`；`defaults()` 末尾追加 `true`；`apply()` 末尾 `editorEnabled = values.editorEnabled();`。

新增写回接口（`ConfigProvider.setBoolean` 已存在，接口未改）：

```java
public static void setEditorEnabled(boolean value) {
    editorEnabled = value;
    if (provider != null) provider.setBoolean("editorEnabled", value);
}
```

### 2. 平台键

| 平台 | 落点 |
|---|---|
| Forge | `ForgeConfig.EDITOR_ENABLED`（`BUILDER.comment(...).define("editorEnabled", true)`）；`load()` 的 `new Config.ConfigValues(...)` 末位 `EDITOR_ENABLED.get()`；`setBoolean` 增加 `case "editorEnabled"` |
| Fabric | `FabricConfig.load()` 末尾 `getBoolean("editorEnabled", true)`；`saveDefaults()` 追加 `root.addProperty("editorEnabled", true)` |

生成的键位于 `forge/run/config/immersive_cinematics-common.toml`（第 52 行）与 `fabric/run/config/immersive_cinematics.json`。**注意**：Fabric 的旧配置文件不会自动补新键，读取时走默认值 `true`；需要显式关闭时手工加 `"editorEnabled": false`。

### 3. 唯一判定

`EditorManager.isEnabled()` 是唯一开关判定，全部门控点最终都走它（`WebEditorApi` 通过 `EditorHostApi.isEnabled()` 门面读同一实现）：

```java
public boolean isEnabled() { return Config.editorEnabled; }
```

全仓 `Config.editorEnabled` 只出现在 `Config.java`（字段/赋值）与 `EditorManager.java`（读取）。`WebEditorServer.isRunning()` 不参与开关判定——开关开启不等于服务启动。

### 4. 按键注册

`ClientEventHandler.registerKeyMappings`：

```java
registrar.register(CinematicKeyBindings.SKIP_KEY);
if (!EditorManager.INSTANCE.isEnabled()) return;
registrar.register(CinematicKeyBindings.EDITOR_FLIGHT);
registrar.register(CinematicKeyBindings.EDITOR_OPEN);
registrar.register(CinematicKeyBindings.EDITOR_FLIGHT_FOV_IN);
registrar.register(CinematicKeyBindings.EDITOR_FLIGHT_FOV_OUT);
registrar.register(CinematicKeyBindings.EDITOR_FLIGHT_ZOOM_IN);
registrar.register(CinematicKeyBindings.EDITOR_FLIGHT_ZOOM_OUT);
registrar.register(CinematicKeyBindings.EDITOR_FLIGHT_ROLL_LEFT);
registrar.register(CinematicKeyBindings.EDITOR_FLIGHT_ROLL_RIGHT);
registrar.register(CinematicKeyBindings.EDITOR_FLIGHT_MODE);
registrar.register(CinematicKeyBindings.EDITOR_FLIGHT_RESET_OPTICS);
```

跳过键始终注册且在门控之前。

### 5. 打开入口

`CinematicKeyBindings.onClientTick` 的 F6 循环与服务连接提示整体包在开关内：

```java
if (EditorManager.INSTANCE.isEnabled()) {
    while (EDITOR_OPEN.consumeClick()) {
        if (System.currentTimeMillis() - editorClosedAt > EDITOR_REOPEN_COOLDOWN) {
            EditorManager.INSTANCE.openDefault();
        }
    }
    if (WebEditorServer.INSTANCE.isRunning() && !webUiConnectedNotified && WebEditorServer.INSTANCE.hasClients()) { ... }
    if (!WebEditorServer.INSTANCE.hasClients()) webUiConnectedNotified = false;
}
```

跳过键、Ctrl+P 强制退出、冷却逻辑都在门控之外，不受影响。

### 6. 其余入口门控

| 入口 | 实际代码 |
|---|---|
| `WebEditorServer.start()` | 首行 `if (!EditorManager.INSTANCE.isEnabled()) return false;` |
| `WebPreviewScreen.init()` | 首行 `if (!EditorManager.INSTANCE.isEnabled()) return;` |
| `WebPreviewScreen.render()` | 首行 `if (!EditorManager.INSTANCE.isEnabled()) return;` |
| `WebEditorApi.handle()` | 开头 `EditorHostApi host = EditorRuntime.host(); if (host == null \|\| !host.isEnabled()) return;` |
| `EditorManager.open(EditorMode)` | `if (!isEnabled() \|\| mode != EditorMode.WEBUI) return false;` |

`CaptureHub.register(PreviewStreamer.INSTANCE)` 只在 `EditorManager.open()` 成功启动服务后执行，开关关闭时不会走到。

### 7. Forge 配置加载时序（实测结论）

已反编译确认 Forge 的加载顺序：

```
CONFIG_LOAD  <  COMMON_SETUP  <  SIDED_SETUP（FMLClientSetupEvent，按键注册）
```

`ClientModLoader.gatherAndInitializeMods` 在 mod 构造期执行，`Config.init(ForgeConfig.INSTANCE)` 此时 `loaded=false`，返回默认值 `true`；TOML 实际值在初始资源重载的 `CONFIG_LOAD` 阶段才写入。

因此 **Forge 上 `registerKeyMappings` 的开关门控不改变「按键已注册」这一事实**，行为门控由 `onClientTick` / 屏幕 / 服务层完成。Fabric 时序相反（`onInitialize` 早于 `onInitializeClient`），门控在按键注册上真实生效。

## 验收结果

| 用例 | 结果 |
|---|---|
| 开关关闭（Forge）：按 F6 | 3s 内无 8765 监听、日志 0 次 `[IC-WebUI] server started`、token 文件不存在 |
| 开关关闭（Fabric）：按 F6 | 同上 |
| 开关恢复 `true`（两端） | F6 正常启动服务、8765 监听、token 生成 |
| 跳过键不受影响 | 静态确认：`SKIP_KEY` 注册在门控之前；`onClientTick` 跳过逻辑在 `isEnabled()` 块外 |
| 开关只作用客户端 | 服务端播放/触发代码未改动 |

## 与原案的差异

原案第 5 条写「按 `Config.editorEnabled` 决定是否注册编辑器键」。实际在 Forge 上做不到（配置晚于按键注册），已改为「先注册、靠 tick/屏/服务门控」，验收按「F6 无响应、无 8765」执行。
