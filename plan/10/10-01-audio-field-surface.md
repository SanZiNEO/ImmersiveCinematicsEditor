# 10-01 AUDIO 字段面与音源

## 目标

把 `AUDIO` 轨道的全部既有字段接进编辑器，并固定三个边界：

- `AUDIO` 只有 `volume/x/y/z` 四个动画字段；其余九个字段是片段级 value-only。
- 音源分 `file` / `minecraft` 两套选择器，字段名相同，但有效取值不同。
- `file_loop` 是音频文件循环，不是片段执行循环。

不新增音频字段，不把视频音轨、规则 `play_sound`、原版背景音乐混进 `AUDIO` 字段面。

## 源码事实

`TrackSchemas.audioObjects()` 的字段面：

- 动画字段：`volume`、`x`、`y`、`z`，全部 `float/linear`。
- value-only：`sound`（string，required）、`source`（`file/minecraft`）、`pitch`（float）、`file_loop`（bool）、`fade_in` / `fade_out`（float，min 0）、`attenuation`（`none/linear`）、`position_mode`（`relative/absolute`）、`category`（`music/ambient`）。

`AudioTrackPlayer` 从 `SampledClip` 读 `volume/x/y/z`；`sound/source/pitch/file_loop/fade_in/fade_out/attenuation/position_mode/category` 从 `ClipValueView` 读，属于片段级 value-only。

`ObjectValidator.checkAudio()` 目前只报 `fade_in + fade_out > duration`。编辑器还要补音源存在性、扩展名、`sound` 为空等文档级检查；这些检查不改模组校验器。

## 字段表

| 字段 | 模式 | 类型/范围 | 默认 | 面板组 | 说明 |
|---|---|---|---|---|---|
| `volume` | animated | float | 1 | 音量 | 采样值乘以包络系数 |
| `x` | animated | float | 0 | 空间 | `relative` = 听者偏移；`absolute` = 世界 X |
| `y` | animated | float | 0 | 空间 | 同上 |
| `z` | animated | float | 0 | 空间 | 同上 |
| `sound` | value | string，required | null | 音源 | `file` 为资源路径；`minecraft` 为声音 ID |
| `source` | value | enum `file/minecraft` | `file` | 音源 | 决定 `sound` 的取值域 |
| `pitch` | value | float | 1 | 音源 | 直接交给游戏，不钳制 |
| `file_loop` | value | bool | false | 播放 | 文件 PCM 循环；不改变片段执行循环 |
| `fade_in` | value | float，min 0 | 0 | 包络 | 片段本地时间 0 起渐入 |
| `fade_out` | value | float，min 0 | 0 | 包络 | 片段结束前渐出；覆盖 `fade_in` |
| `attenuation` | value | enum `none/linear` | `linear` | 空间 | `music` 强制 `none` |
| `position_mode` | value | enum `relative/absolute` | `relative` | 空间 | 只对 `ambient` 生效 |
| `category` | value | enum `music/ambient` | `music` | 空间 | `music` 非空间；`ambient` 空间化 |

## 音源字段

### `source=file`

- `sound` 是 `resource/` 下的相对路径，例如 `audio/theme.ogg`。
- 同步解码：`.ogg`、`.wav`。
- 外部解码白名单：`.mp3`、`.aac`、`.flac`、`.m4a`、`.opus`、`.wma`、`.oga`、`.ogx`。
- 文件选择器使用 `resource.list(kind=all)`，客户端按上述扩展名过滤；也可以手动输入资源相对路径。
- 路径必须是相对资源根，不允许绝对路径、盘符、`..` 逃逸。
- 文件不存在、扩展名不在白名单、路径越界，都在字段下方提示；不阻止保存，但阻止推送为 `error` 的依据由 `10-09` 定义。

### `source=minecraft`

- `sound` 是声音注册表 ID，例如 `minecraft:block.note_block.pling`。
- 选择器使用 `registry.query(kind=sound)`；允许手动输入，未在当前注册表命中的 ID 显示“未找到”，不直接判为非法。
- 只从资源包读取 OGG；不把 `resource/` 文件路径塞进 `source=minecraft`。
- `pitch`、`file_loop`、`volume`、包络仍有效；`source=minecraft` 不改变空间语义。

### `source` 切换

`source` 是语义开关，不改 `sound` 字段名，但会改变 `sound` 的取值域。切换流程：

1. 显示当前 `sound` 值与目标来源；
2. 不清空 `sound`，先标“需要重新选择/确认”；
3. 作者确认后一次提交 `source`；
4. 若 `sound` 仍为空，显示 required 错误；若 `sound` 非空但与目标来源不匹配，显示 `source_mismatch` 警告；
5. 一次撤销回到切换前。

不自动把文件路径改写成声音 ID，也不把声音 ID 改写成文件路径。

## 播放与循环

- `file_loop`：只控制音频 PCM 是否在文件末尾回到开头；由 `CinematicAudioStream` 读取循环。
- 片段执行循环：`playControl.loop` / `loop_count` / `loop_mode`，由时间线片段头编辑；`file_loop` 不写这三个字段。
- 属性面板在 `file_loop` 行显示“文件循环”，在片段头显示“片段循环”；两者不相邻混排。
- `source=minecraft` 时 `file_loop` 仍可设置；运行时同样按 PCM 流循环。
- 无限片段（`duration < 0`）没有片段结束；`fade_out` 不生效；`file_loop` 仍按文件流循环。

## 属性面板与效果面板

### 属性面板

`selection.properties` 对 `AUDIO` 片段显示：

- 音源组：`sound` / `source` / `pitch` / `file_loop`；
- 音量组：`volume` 静态值；
- 包络组：`fade_in` / `fade_out`；
- 空间组：`category` / `position_mode` / `attenuation` / `x` / `y` / `z`；
- 片段头：起点、时长、`loop` / `loop_count` / `loop_mode`，点击“在时间轴编辑”。

规则：

- `volume/x/y/z` 有 `keyframes.length > 0` 时不在属性面板显示值控件，只在效果面板出现。
- `volume/x/y/z` 无关键帧时显示静态值，并带“开时钟”入口。
- `sound`、`source`、`pitch`、`file_loop`、`fade_in`、`fade_out`、`attenuation`、`position_mode`、`category` 永远不进效果面板。
- 不提供“添加属性”或字段选择器；`AUDIO` 字段面固定为 13 个。

### 效果面板

`clip.effects` 只显示 `AUDIO` 中 `keyframes.length > 0` 的叶子：`volume`、`x`、`y`、`z`。

- 每个叶子显示节点时间、值、插值、轴外帧；
- `x/y/z` 在 `relative` 模式下显示“听者偏移”，在 `absolute` 模式下显示“世界坐标”；
- 效果面板不显示 `sound` 等 value-only 字段，也不提供“添加属性”。

## 字段适用与提示

| 条件 | 显示 | 提示 |
|---|---|---|
| `source=file` | 文件选择器、路径输入 | 扩展名白名单、文件存在性 |
| `source=minecraft` | 声音 ID 选择器、注册表搜索 | 当前注册表未找到只警告 |
| `category=music` | 空间组显示但禁用 | “music 固定相对听者、无衰减，x/y/z 不参与空间定位” |
| `category=ambient` | 空间组可编辑 | `relative` 为听者偏移，`absolute` 为世界坐标 |
| `file_loop=true` | 文件循环开关高亮 | 与片段循环分开 |
| `fade_in+fade_out>duration` | 包络行警告 | 运行时会整段跳过 |
| `sound` 为空 | 音源组 required 错误 | 不允许保存为完整脚本 |

`category=music` 时空间字段的值保留，不自动删除；切回 `ambient` 后原值继续可用。界面必须明确标“当前不读”，不能把 music 的 x/y/z 当作空间定位。

## 本地校验

| 检查 | 级别 | 处理 |
|---|---|---|
| `sound` 为空 | block | 音源行红框；保存/推送阻止 |
| `source=file` 路径不在资源列表 | warn | 显示“未在资源列表中找到”；不阻止保存 |
| `source=file` 扩展名不支持 | error | 显示支持列表；阻止推送 |
| `source=minecraft` 未在声音注册表找到 | warn | 显示“当前注册表未找到”；不阻止保存 |
| `fade_in+fade_out>duration` | warn | 包络行黄点；提示运行时跳过 |
| `file_loop` 与片段 `loop` 同时开 | info | 显示“文件循环 + 片段循环会各自生效” |
| `volume` 越界/非有限 | block | 拒绝提交，不夹取 |

## 验收标准

1. 新建 `AUDIO` 片段：属性面板出现 13 个字段，不出现 `OVERLAY` / `ADJUST` 字段。
2. `source=file` 选择 `audio/theme.ogg`：`sound` 写入相对路径，资源列表命中；选择 `.txt` 显示扩展名错误。
3. `source=minecraft` 搜索 `minecraft:block.note_block.pling`：写入声音 ID；手输未注册 ID 显示“未找到”，不阻止保存。
4. `source` 从 `file` 切到 `minecraft`：`sound` 原值保留但标“需要重新选择”；不自动改写路径。
5. `volume` 开时钟：属性面板值控件消失，效果面板出现 `volume` 行；删最后一帧回流属性面板。
6. `file_loop=true`、片段 `loop=true`：两处状态同时可见，文案不混。
7. `category=music`：`x/y/z` 仍显示但禁用，提示“music 不参与空间定位”；切回 `ambient` 后原值可编辑。
8. `fade_in=2`、`fade_out=2`、`duration=3`：包络行显示警告“运行时会整段跳过”。
9. `sound` 为空：音源行 required 错误；保存/推送阻止。
10. 保存重开：13 个字段原样恢复，没有新增字段、没有丢 value-only 字段。
