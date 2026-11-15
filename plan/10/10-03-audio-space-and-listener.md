# 10-03 AUDIO 空间语义与监听

## 目标

把 `AUDIO` 的空间参数和脚本级 `meta.listener` 分开：

- `category` 决定这条声音是背景音还是环境音；
- `position_mode` 只对 `ambient` 生效；
- `meta.listener` 决定听者是玩家还是相机；
- 相机听者只在顶层实例存在活跃 `CAMERA` 片段时生效，否则回落玩家。

不新增“音频监听器”对象，不新增监听消息，不把 `category=music` 的 x/y/z 当空间定位。

## 源码事实

`CinematicAudioInstance` / `AudioTrackPlayer`：

- `category=music`：强制相对听者、`attenuation=none`、位置取玩家位置；x/y/z 不参与空间定位。
- `category=ambient`：使用 `position_mode` 和 `attenuation`；`relative` 时位置 = `AudioListenerController.getListenerPosition() + offset`；`absolute` 时位置 = offset 世界坐标。
- `attenuation`：`none` 不衰减；`linear` 按距离线性衰减。
- `position_mode`：`relative` / `absolute`，只对 `ambient` 有意义。
- `AudioListenerController.isCameraListener()` 需要同时满足：
  1. `CameraManager.isActive()`；
  2. 顶层实例当前存在活跃 `CAMERA` 片段；
  3. `meta.listener=camera`。
  否则 `getListenerPosition()` 返回玩家位置。

`MetaSchemas.listener` 是脚本级 value：`player/camera`，默认 `player`。

## 字段表

| 字段 | 模式 | 类型 | 默认 | 适用范围 | 面板 |
|---|---|---|---|---|---|
| `category` | value | enum `music/ambient` | `music` | 全部 | 空间组 |
| `position_mode` | value | enum `relative/absolute` | `relative` | `ambient` | 空间组 |
| `attenuation` | value | enum `none/linear` | `linear` | `ambient` | 空间组 |
| `x` | animated | float | 0 | `ambient` | 空间组 / 效果 |
| `y` | animated | float | 0 | `ambient` | 空间组 / 效果 |
| `z` | animated | float | 0 | `ambient` | 空间组 / 效果 |
| `meta.listener` | value | enum `player/camera` | `player` | 脚本 | 脚本属性“监听”卡 |

## 两类声音

### `category=music`

- 背景音乐/非空间声音；
- 强制 `relative` 听者锚点，`attenuation=none`；
- 位置固定到玩家位置；
- `x/y/z` 可以保留在脚本里，但运行时不用；属性面板显示为禁用并标注“music 不参与空间定位”；
- `meta.listener=camera` 不改变 `music` 的听者行为；
- 游戏会压制原版背景音乐，但编辑器不把这件事做成开关。

### `category=ambient`

- 环境声音，参与空间定位；
- `position_mode=relative`：坐标是相对实际听者的偏移；
  - 听者是玩家时：玩家位置 + 偏移；
  - 听者是相机时：相机位置 + 偏移；
- `position_mode=absolute`：坐标是世界绝对坐标，不跟随听者；
- `attenuation=none`：无距离衰减；
- `attenuation=linear`：按距离线性衰减；
- `x/y/z` 可动画；有帧进效果面板。

## `category` 切换

`category` 是语义开关，不是结构类型。切换时：

1. 保留 `position_mode` / `attenuation` / `x/y/z` 原值；
2. 切到 `music` 后，空间组显示但禁用，标注“music 固定相对玩家、无衰减”；
3. 切回 `ambient` 后，原值恢复可编辑；
4. 一次撤销回到切换前。

不自动删除空间字段，不把 `music` 的空间值写死成 0；这样切回 `ambient` 不会丢作者已调好的偏移。

## 监听卡

`Script Properties` 增加“音频监听”卡：

```text
音频监听
listener   [ 玩家 player ][ 相机 camera ]
当前播放头：玩家（没有活跃 CAMERA 片段）
```

### 显示规则

- `listener=player`：显示“相对声源以玩家位置为锚点”。
- `listener=camera` 且当前播放头有活跃 `CAMERA` 片段：显示“相对声源以相机位置为锚点”。
- `listener=camera` 且当前播放头没有活跃 `CAMERA` 片段：显示“当前回落玩家”；这是文档级提示，不修改 `listener`。
- `listener=camera` 但整个脚本没有 `CAMERA` 片段：显示警告“没有 CAMERA 片段，监听始终回落玩家”，并提供“定位到 CAMERA 轨”。
- `category=music` 的片段不参与监听提示；监听卡只说明相对声源锚点。

### 顶层实例规则

- 运行时只检查顶层实例的活跃 `CAMERA` 片段；并行脚本不叠加监听。
- 编辑器按当前文档检查“是否有 CAMERA 片段”，按播放头检查“当前是否有活跃 CAMERA 片段”。
- 多脚本并行属于播放期状态，编辑器不伪造顶层实例选择；监听卡只展示当前文档的声明和当前播放头检查。

## 空间控件

`AudioSpatialField` 由四部分组成：

1. `category` 分段开关：`music` / `ambient`；
2. `position_mode` 分段开关：`relative` / `absolute`；
3. `attenuation` 分段开关：`none` / `linear`；
4. `x/y/z` 三行数值，带“相对听者偏移”或“世界坐标”标签。

规则：

- `category=music` 时 2/3/4 全部禁用；
- `ambient + relative`：标签“听者偏移”；说明“实际听者 = 玩家或相机”；
- `ambient + absolute`：标签“世界坐标”；
- `ambient + none`：标签“无衰减”；
- `ambient + linear`：标签“线性衰减”；
- `x/y/z` 有帧时，空间组只显示“在效果面板编辑”摘要，不重复值控件；
- 不画 3D 场景、不采样玩家/相机位置、不做实时空间预览。

## 监听与相对声源

| `listener` | `position_mode` | 相对声源锚点 | 绝对声源 |
|---|---|---|---|
| `player` | `relative` | 玩家位置 + 偏移 | 世界坐标，不受影响 |
| `player` | `absolute` | 不适用 | 世界坐标 |
| `camera`（有活跃 CAMERA） | `relative` | 相机位置 + 偏移 | 世界坐标，不受影响 |
| `camera`（无活跃 CAMERA） | `relative` | 玩家位置 + 偏移（回落） | 世界坐标，不受影响 |

- `music` 不按上表；它固定相对玩家、无衰减。
- `absolute` 声源永远不跟随听者；监听切换只影响 `relative`。
- `camera` 监听不会把 `absolute` 坐标改成相对坐标。

## 本地校验

| 检查 | 级别 | 处理 |
|---|---|---|
| `meta.listener=camera`，脚本无 `CAMERA` 片段 | warn | 监听卡黄点；“始终回落玩家” |
| `meta.listener=camera`，播放头无活跃 `CAMERA` 片段 | info | 监听卡“当前回落玩家” |
| `category=music`，`x/y/z` 有非零值 | info | 空间组标“music 不读，值保留” |
| `category=music`，`position_mode=absolute` | info | 只提示不生效，不自动改值 |
| `category=ambient`，`attenuation=linear` 且距离为 0 | info | 空间组提示“距离 0 无衰减差” |
| `x/y/z` 非有限 | block | 拒绝提交 |

## 验收标准

1. `category=music`：空间组禁用，提示“固定相对玩家、无衰减”；`x=5` 仍保留，切回 `ambient` 后 5 恢复可编辑。
2. `category=ambient`、`position_mode=relative`、`x=2`：标签“听者偏移”，说明实际听者可能是玩家或相机。
3. `category=ambient`、`position_mode=absolute`、`x=100`：标签“世界坐标”，切换 `listener` 不改变 x。
4. `listener=player`：监听卡显示“相对声源以玩家为锚点”。
5. `listener=camera` 且播放头在 CAMERA 片段内：显示“以相机为锚点”。
6. `listener=camera` 且播放头在 CAMERA 空档：显示“当前回落玩家”；`listener` 值不改。
7. `listener=camera` 且脚本无 CAMERA 片段：监听卡警告“没有 CAMERA 片段，始终回落玩家”。
8. `category=music` + `listener=camera`：监听卡仍显示 camera，但说明“music 不受监听影响”；不产生“相机听者生效”的错误结论。
9. `attenuation=none`：空间组显示“无距离衰减”；`linear` 显示“线性衰减”。
10. 保存重开：`listener`、`category`、`position_mode`、`attenuation`、`x/y/z` 原样恢复。
