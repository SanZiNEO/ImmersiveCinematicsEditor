# 01-06 共享服务正确性

> **状态：已实现**。核心文件：`editor/shared/ScriptFileService.java`、`editor/shared/ResourceFileService.java`。

## 目标

把共享服务抽到 `editor.shared` 后，把服务本身的几处正确性问题一并收掉：资源扩展名、脚本路径校验、新建冲突、截断提示、scriptRoot 诊断、stage 空值。

## 实际实现

### 1. 资源扩展名与运行时能力对账

`ResourceFileService` 的常量（以实际解码能力为准）：

```java
public static final String KIND_LANG  = "lang";
public static final String KIND_IMAGE = "image";
public static final String KIND_AUDIO = "audio";
public static final String KIND_VIDEO = "video";
public static final String KIND_ALL   = "all";

private static final Set<String> IMAGE_EXT = Set.of("png", "gif", "jpg", "jpeg");

// 音频：ogg/wav 走内存解码 + ExternalPcmDecode 白名单
private static final Set<String> AUDIO_EXT =
        Set.of("ogg", "wav", "mp3", "aac", "flac", "m4a", "opus", "wma", "oga", "ogx");

private static final int MAX_DEPTH = 5;
private static final int MAX_FILES = 2000;
```

`matchesKind`：

```java
if (KIND_ALL.equals(kind)) return true;
String ext = ...;
return switch (kind) {
    case KIND_IMAGE -> IMAGE_EXT.contains(ext);
    case KIND_AUDIO -> AUDIO_EXT.contains(ext);
    case KIND_VIDEO -> VideoFiles.isVideo(name);
    default -> false;
};
```

**webp 不列入图片**：静态图片走 `NativeImage.read`（PNG/JPEG），webp 无法解码。视频以 `media/video/VideoFiles.isVideo` 为准，实际是 `mp4` / `webm` / `mkv`。

### 2. script.save 校验

`ScriptFileService.saveScript` 在 `resolveSafe` 之前：

```java
if (relativePath == null || relativePath.isBlank()) throw new IOException("script path is empty");
if (!relativePath.toLowerCase(java.util.Locale.ROOT).endsWith(".json")) {
    throw new IOException("script path must end with .json: " + relativePath);
}
```

`WebEditorApi` 捕获后走 `sendError`，前端收到 `error`（`data.error` 含 `script path must end with .json`）。

### 3. script.new 唯一名

```java
private static int untitledSeq;

/** 唯一临时名：untitled-1.json, untitled-2.json …（同进程不重复，跳过已存在文件）。 */
public static synchronized String nextUntitledPath() {
    while (true) {
        String candidate = "untitled-" + (++untitledSeq) + ".json";
        if (!Files.exists(SCRIPTS_DIR.resolve(candidate))) return candidate;
    }
}
```

`script.new.result.path` 直接返回该值，同进程多次调用不重复。

### 4. resource.list 截断提示

`listFiles` 先收集全部匹配、排序，再输出：

```java
out.addProperty("total", found.size());
out.addProperty("truncated", found.size() > MAX_FILES);
for (int i = 0; i < Math.min(found.size(), MAX_FILES); i++) files.add(found.get(i));
```

响应形状：`{kind, dir, total, truncated, files[]}`。`lang` 分支同样带 `total`（`entries.size()`）与 `truncated: false`。

### 5. hello_ack.scriptRoot

```java
/** scripts 根绝对路径（诊断用，/ 分隔）。 */
public static String scriptRootDisplay() {
    return SCRIPTS_DIR.toAbsolutePath().normalize().toString().replace('\\', '/');
}
```

绝对路径、`/` 分隔，不参与任何请求。

### 6. registry.stage

`RegistryService.query` 对 `kind="stage"` 返回空列表，本轮不改服务端也不改前端。`registry.query{kind:"stage"}` 的 `matches` 为空数组，前端据此显示「无候选」而非「加载中」。

## 验收结果（Forge 与 Fabric 各一轮）

| 用例 | 结果 |
|---|---|
| `resource.list{kind:"video", dir:"verify"}` | 只返回 `a.mp4`/`b.mkv`/`c.webm`；含 `total`、`truncated=false` |
| `resource.list{kind:"image", dir:"verify"}` | 只返回 `d.png`/`e.jpg`；**不含 `f.webp`**；含 `total`、`truncated=false` |
| `resource.list{kind:"audio", dir:"verify"}` | 返回 `g.mp3`/`h.flac`/`i.ogg`；含 `total` |
| `resource.list{kind:"image", dir:"verify-many"}`（2001 个 png） | `truncated=true`、`total=2001`、`files` 长度 2000 |
| `script.save{path:"a.txt"}` | `error` 含 `script path must end with .json` |
| `script.new` 两次 | 两次 `path` 不同，均匹配 `^untitled-\d+\.json$` |
| `hello_ack.scriptRoot` | 以 `immersive_cinematics/scripts` 结尾 |
| `registry.query{kind:"stage"}` | `matches: []` |

## 与原案的差异

| 原案 | 实际 | 原因 |
|---|---|---|
| 图片补 `webp` | 不列入 | `NativeImage.read` 只能解 PNG/JPEG，webp 无法解码 |
| 视频 `mp4/mkv/mov/webm` | `mp4/webm/mkv` | `VideoFiles.isVideo` 的实际白名单；`mov` 不支持 |
| 音频补 `mp3/flac` | 10 种：`ogg/wav/mp3/aac/flac/m4a/opus/wma/oga/ogx` | 与 `ExternalPcmDecode` 白名单对齐 |
| `script.new` 或「前端保存前查重」 | 服务端唯一名 `untitled-<n>.json` | 前端本轮零改动，服务端保证唯一 |
