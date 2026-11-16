# 02-04 tracks 对象表与 playControl

## 目标

登记 `tracks` 段：七条内置轨道、每轨的 `playControl` 5 字段、每轨 `objects` 表里的每个叶子属性。所有对象都是独立叶子，`group` 只是界面分组标签，不是嵌套结构。查询接口见 02-02；本文件定义 tracks 段的内容与 `requires` 求值语义。

## 七条内置轨道

`CAMERA` / `LETTERBOX` / `AUDIO` / `EVENT` / `MOD_EVENT` / `OVERLAY` / `ADJUST`。

- 轨道类型表来自 `TrackSchemas` 登记，不写死前端枚举。
- 第三方轨道类型形如 `modid:xxx`，目录只登记「已发现」：`FieldCatalog.discovered.tracks` 收 `{type, sourceRef}`，字段由该模组自己的 schema 提供；不替它编字段。触发器同口径，收在 `discovered.triggers`。
- 轨道类型大小写以源码 wire 名为准。

## `playControl`（每条轨道都有，5 字段）

| 字段 | type | default | required | enum | section |
|---|---|---|---|---|---|
| `start_time` | float | null | true | — | playback |
| `duration` | float | null | true | — | playback |
| `loop` | bool | `false` | false | — | playback |
| `loop_count` | int | `-1` | false | — | playback |
| `loop_mode` | enum | `"repeat"` | false | `repeat` / `pingpong` | playback |

`start_time` / `duration` 必填；`duration != 0`。其余按默认值。

## `ObjectDef`（每个叶子属性 16 项）

| 项 | 含义 |
|---|---|
| `path` | 点分路径，如 `position.x` |
| `mode` | `value` / `animated` / `event` |
| `type` | 九种值类型之一 |
| `default` | 默认值；没有就 `null` |
| `interp` | `none` / `linear` / `angle` / `geometric` / `step` |
| `requires` | `path=value` / `path!=value` |
| `required` | 是否必填 |
| `enumValues` | `enum` 专用 |
| `nullable` | 仅 `nullable_float` |
| `min` / `max` | 数值范围 |
| `section` / `group` | 界面分组标签 |
| `appliesTo` | 适用轨道/场景 |
| `labelKey` | 展示键 |
| `unit` | 单位，如 `degree` |

构造期规则（`ObjectDef` 36–52）：`interp` 缺省为 `NONE`；`requires` 空白归一为 `null`；`nullable_float` 隐含 `nullable=true`。目录登记的是**构造后的值**，不是构造参数。

## 路径语法

`PropertyPath.java`：`.` 分隔，每段匹配 `[a-z][a-z0-9_]*`；无空段、无首尾点、无数组下标、无大写、无连字符。

- `position.x` 合法；`position[0]`、`Position.X`、`position..x` 拒绝。
- 路径是**叶子键**，不是对象导航：`position` 本身不是对象，`position.x/y/z` 才是三个叶子。

## 所有对象都是叶子

任何轨道的每一个对象，都是独立的 `AnimObject`：

- `position.x` / `position.y` / `position.z` 是三条独立记录，各自持有自己的关键帧组。
- 它们通过 `group("position")` 归在一起，只用于「切换对齐校验」和界面分组，不是嵌套对象。
- `yaw` / `pitch` / `roll`、`fov` / `zoom`、`opacity`、`event`、`modifier`、调色曲线，全部同一套模型；差别只在 `mode` / `type` / `interp`。
- 编辑器不因为「它们看起来是一组」就把它们合成一个对象，也不做跨属性关键帧对齐。

## 各轨内容（按源码登记，不编字段）

| 轨道 | 主要内容 |
|---|---|
| `CAMERA` | 位置 `position.x/y/z`（float/linear/section=position/group=position）；朝向 `yaw` / `pitch` / `roll`（float/angle/unit=degree）；`yaw_lock` / `pitch_lock`（nullable_float/angle）；`position_mode`（enum relative/absolute，step）；`position_space`（enum world/base，step）；`look_at`（enum none/player/coordinate/entity/block，step）；构图、遮罩、调色曲线与调色通道按 `TrackSchemas` 的 CAMERA objects 表逐条登记 |
| `LETTERBOX` | 边框形状、颜色、淡入淡出参数；按 `TrackSchemas` 的 LETTERBOX objects 表登记 |
| `AUDIO` | 音源、播放、空间参数；按 AUDIO objects 表登记 |
| `EVENT` | `event` 记录（`command` / `event_type` / `id` + `position {x,z}` 或 `{dx,dz}`） |
| `MOD_EVENT` | `mod_event` 记录（`event_type` + `data` 递归） |
| `OVERLAY` | 图片 / 字幕 / 视频 / 淡入淡出参数；按 OVERLAY objects 表登记 |
| `ADJUST` | 47 个标量关键帧通道 + 10 条调色曲线 + `blend_mode` / `blend_amount`；按 ADJUST objects 表登记 |

以上只列已核对的代表字段；完整字段以目录里每条 `sourceRef` 指向的 `TrackSchemas` 声明为准。**不凭印象补字段名，不把相似轨道的字段抄到另一轨。**

## `requires` 与 `appliesTo`

- `requires` 只支持 `path=value` / `path!=value`，求值与 `ObjectValidator.evalRequires` 同语法。
- 不满足时字段置灰 + 提示，不删除字段、不删关键帧；作者切回条件时数据还在。
- 当前唯一用 `requires` 的是 `yaw_offset` / `pitch_offset`（`requires="orient=tangent"`）。
- `appliesTo` 只登记适用轨道/场景，不做跨轨复制；域 = 02-04 的轨道类型 / 层类型与轨道子类型（`fade` / `image` / `subtitle`）/ `modid:xxx`。

## 语义组名（界面分组用）

目录不提供第二份字段语义表；界面需要知道「哪些路径构成位置组/朝向组」时，用 `section` / `group` 字段聚合：

- `position`：`position.x/y/z`、`position_mode`、`position_space` 等。
- `orientation`：`yaw`、`pitch`、`roll`、`yaw_lock`、`pitch_lock` 等。
- `look_at`、`yaw_base_from/to` 等同理。

这些是组名，不是嵌套结构；编辑器不硬编码第二份表。

## 验收标准

- `objectDef('CAMERA','position.x')` 返回 `{mode:'animated', type:'float', interp:'linear', section:'position', group:'position'}`。
- `objectDef('CAMERA','position.y')` / `position.z` 是两条独立记录，不是嵌套在 `position` 下。
- `availability('CAMERA','yaw_offset',{orient:'manual'})` = `{available:false, reason:'需要 orient=tangent（当前 orient=manual）'}`；`{orient:'tangent'}` = `{available:true}`。
- 切 `orient` 从 `manual` 到 `tangent`：`yaw_offset` 从置灰变可用，keyframes 数量不变。
- 内置轨道列表含 `ADJUST`；第三方 `modid:foo` 在 `discovered.tracks` 登记，不进入内置 `tracks` 表。
- `playControl` 五字段齐全；`start_time` / `duration` 缺一即拒绝。
- 非法路径 `position[0]` / `Position.X` / `position..x` 全部拒绝。
- `grep` 目录：没有把 `position` 写成嵌套对象的结构。
