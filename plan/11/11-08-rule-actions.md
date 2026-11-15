# 11-08 规则动作

## 目标

把 `rules[].actions` 和 `policy.on_timeout` 做成九种动作的编辑面：`camera_set`、`overlay_set`、`adjust_set`、`goto_clip`、`pause`、`resume`、`exit`、`play_sound`、`emit_command`。

所有动作作用对象恒为“触发这条规则的播放实例”，没有动作级 target 选择器。动作失败不中断播放，只跳过该动作；编辑器不显示“保证成功”。

## 动作列表

```text
动作
├ camera_set  覆盖链叠加
├ overlay_set fade 临时层
├ adjust_set  15 通道调色层
├ goto_clip   开新分支
├ pause       挂起持有
├ resume      释放挂起
├ exit        结束当前播放实例
├ play_sound  本实例一次性发声
└ emit_command 服务端执行命令
```

- `actions` 至少一条；`on_timeout` 可以为空。
- 顺序 = 执行顺序；可上下移动。
- `hold` 不是第十种动作，不提供；旧数据里的 `hold` 显示为非法，提示“无限等待由绑定的 `timeout=-1` 表达”。
- 动作没有 `target` / `track` / `at` 选择器；`goto_clip` 只用 `clip` + `entry_time`。
- 动作不写关键帧，不建第二套轨道；`camera_set` / `overlay_set` / `adjust_set` 都是运行时临时工件。

## camera_set

```text
{
  "type": "camera_set",
  "channels": ["position", "yaw"],
  "position": {"x": 1, "y": 2, "z": 3},
  "yaw": 90,
  "mode": "add",
  "priority": 0
}
```

### 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `channels` | 是 | 非空、不重复；六通道之一或多个 |
| `position` | 选 `position` 时必填 | `{x,y,z}` 世界坐标，三轴有限数字 |
| `yaw` / `pitch` / `roll` | 选对应通道时必填 | 度，有限数字 |
| `fov` / `zoom` | 选对应通道时必填 | 有限数字 |
| `mode` | 否 | `add` / `multiply` / `replace`；缺省逐通道缺省 |
| `priority` | 否 | 整数，升序应用，缺省 0 |

### 语义

- 六通道：`position`、`yaw`、`pitch`、`roll`、`fov`、`zoom`；`position` 整体一位，三轴一起写。
- 缺省合成模式：`position` / `yaw` / `pitch` / `roll` = `add`；`fov` / `zoom` = `multiply`；`replace` 必须显式写。
- 写了 `mode` 就统一作用于本次所有选中通道。
- 未在 `channels` 中声明的通道值不生效；写了该通道值但没进 `channels` 报错。
- 工件持续到**该动作作用域片段**的活跃窗末；无限片段按无限处理；不是永久全局相机。
- 不进 `CAMERA` 轨关键帧，不改 `CAMERA` 数据；只在覆盖链上叠加一条 `RuleModifier`。

### 界面

- 通道复选：六个；勾选后显示对应值输入。
- `position` 三个数字；其余五个单数字。
- `mode` 选择“缺省（逐通道）/ add / multiply / replace”。
- `priority` 整数，缺省 0。
- 摘要：`相机 yaw +90，priority 0`。

## overlay_set

```text
{
  "type": "overlay_set",
  "layer_type": "fade",
  "color": "#000000",
  "opacity": 0.8,
  "z_index": 10
}
```

### 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `layer_type` | 是 | v1 只有 `fade` |
| `color` | 否 | 六位十六进制，缺省 `#000000` |
| `opacity` | 否 | 0–1，缺省 1 |
| `z_index` | 否 | 整数，缺省 10；越小越先绘制，越大越靠上 |

### 语义

- 建一层临时 `fade` 覆盖层，owner = 当前实例，持续到片段结束移除。
- 只支持 `fade`；`image` / `subtitle` 不是当前动作层类型。
- `z_index` 只在该覆盖层管线内排序，不和相机画面/其他管线做全局合成表。
- 不是 `OVERLAY` 轨的 `fade` 关键帧；不会写 `OVERLAY` 轨。

### 界面

- `layer_type` 选择器只有 `fade`，不列 image/subtitle。
- 颜色用十六进制输入；接受六位，显示统一带 `#`。
- 不透明度 0–1，滑杆 + 数字。
- `z_index` 整数。
- 摘要：`fade #000000 80% z=10`。

## adjust_set

```text
{
  "type": "adjust_set",
  "exposure": 0.2,
  "contrast": 0.1
}
```

### 字段

十五个基础校色通道，至少一个：

`exposure`、`contrast`、`highlights`、`shadows`、`whites`、`blacks`、`hue`、`saturation`、`vibrance`、`lightness`、`temperature`、`tint`、`red`、`green`、`blue`。

- 每个值是有限数字；未写通道取缺省 0（不改变画面）。
- 只写 `type`、没有任何通道 = 报错“至少一个通道”。
- 不认 59 通道 `ADJUST` 全集，不认曲线、LUT、混合模式、层级。
- 这是**调色**，不是画面合成；动作名和界面都用“调色层”。

### 界面

- 十五个通道分组：基础曝光 / 白平衡 / 色彩。
- 每行数字 + 滑杆；勾选“启用”才写键，不把未启用通道写成 0。
- 摘要：`调色 exposure +0.2, contrast +0.1`。
- 不提供曲线/LUT 入口，不把 `ADJUST` 轨的 59 通道搬进来。

## goto_clip

```text
{
  "type": "goto_clip",
  "clip": "chapter2",
  "entry_time": 1.5
}
```

### 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `clip` | 是 | 当前脚本内已存在的片段 id |
| `entry_time` | 否 | 入口局部秒，>=0 有限数字，缺省 0 |

### 语义

- 规则成立时开一条**新分支**，不是片段内跳转，也不是调用栈。
- 目标片段必须在执行账本内；已经在分支中或目标不可达时启动被拒绝，动作跳过。
- 新分支的入口出口覆盖取**绑定**的 `exit`；绑定没有 `exit` 时取片段默认。
- 旧形态 `track` / `at` 不接受；出现即报错。

### 三个“退出/跳转”要分开

| 名称 | 含义 |
|---|---|
| 动作 `goto_clip` | 规则成立时立刻开新分支 |
| 绑定 `exit.goto` | 分支完成后的去向 |
| 动作 `exit` | 结束当前播放实例 |

界面在 `goto_clip` 详情下固定显示这三行，避免作者混用。

### 界面

- 片段选择器：当前脚本片段 id + 时长；只读展示，不新建片段。
- `entry_time` 秒，默认 0；超过目标片段时长时警告，但不在编辑器夹取。
- 摘要：`跳转 chapter2 @1.5s`。

## pause / resume

```text
{ "type": "pause" }
{ "type": "resume" }
```

- 两者都没有参数；出现其他键报错。
- `pause` 给当前实例加 `ACTION_PAUSE` 持有；`resume` 释放该持有。
- 走实例挂起账本，不冻结脚本字段，不暂停编辑器。
- 可以跨规则配对；编辑器不强制同一规则里成对出现。
- 摘要：`挂起` / `恢复`。

## exit

```text
{ "type": "exit" }
```

- 声明式退出，结束当前播放实例。
- 没有 target、没有 exit 类型选择、没有跳转参数。
- 不是绑定 `exit` 的替代；绑定 `exit` 是分支完成后的出口策略。
- 摘要：`结束当前播放实例`。

## play_sound

```text
{
  "type": "play_sound",
  "sound": "minecraft:ambient.cave",
  "volume": 1,
  "pitch": 1
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `sound` | 是 | 非空音效 id，如 `minecraft:ambient.cave` |
| `volume` | 否 | 有限数字，缺省 1 |
| `pitch` | 否 | 有限数字，缺省 1 |

- 本实例一次性发声，作用对象是触发者本人；不改 `AUDIO` 轨，不建循环。
- 未知音效 id 在运行期跳过；编辑器可提示“未在注册表确认”，不阻止保存。
- 不填文件路径，不填资源 URL。
- 摘要：`播放 minecraft:ambient.cave`。

## emit_command

```text
{
  "type": "emit_command",
  "command": "say hello && weather clear"
 }
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `command` | 是 | 非空白命令原文；不带前导 `/`；多条用 `&&` 分隔 |

- 客户端只发动作引用（绑定 id + 动作下标）；命令原文由服务端按脚本命令表解析。
- 只有该播放实例的观看者可触发；服务端按权限等级执行，命令表只存服务端内存。
- 不是“动作级 target 选择器”，不提供“对谁执行”的选项。
- 前导 `/` 去掉再写；`&&` 分段不在编辑器拆分执行，整串交给服务端。
- `on_timeout` 里禁用 `emit_command`：当前服务端命令表只编译 `rules[].actions`，超时动作的命令没有表项，写了也解析不到。需要命令时放进普通动作。
- 摘要：`执行命令 say hello && weather clear`。

## 动作详情通用

- 顶部显示“作用于触发实例”，不显示 target。
- 动作 `type` 只能从九种选；未知类型只读报错。
- 旧字段 / 未登记字段进“旧字段”只读块，不静默删。
- 每个动作行显示序号；移动后序号更新，`emit_command` 的服务端动作下标随之变化，保存后重编译。
- 动作不提供“实时预览”“试执行”；编辑器不连服务端命令表。

## 校验

| 检查 | 级别 | 处理 |
|---|---|---|
| `type` 缺失/未知 | block | 动作行红框 |
| `hold` | block | “无限等待用 timeout=-1” |
| `camera_set.channels` 空/重复/未知 | block | 通道区红框 |
| `camera_set` 声明通道缺值 | block | 值行红框 |
| `camera_set` 写了未声明通道值 | block | “该通道不生效” |
| `camera_set.mode` 非三种 | block | 模式行红框 |
| `camera_set.priority` 非整数 | block | 优先级红框 |
| `overlay_set.layer_type` 非 fade | block | 层类型红框 |
| `overlay_set.opacity` 越界 | block | 不透明度红框 |
| `overlay_set.color` 非六位十六进制 | block | 颜色红框 |
| `overlay_set.z_index` 非整数 | block | z 行红框 |
| `adjust_set` 无通道 | block | “至少一个通道” |
| `adjust_set` 未知通道/非数字 | block | 通道行红框 |
| `goto_clip.clip` 缺失/未知 | block | 目标片段红框 |
| `goto_clip.entry_time` 负数/非有限 | block | 入口时间红框 |
| `goto_clip` 旧 `track`/`at` | block | “用 clip / entry_time” |
| `pause/resume/exit` 带参数 | block | 参数只读报错 |
| `play_sound.sound` 空 | block | 音效行红框 |
| `play_sound.volume/pitch` 非有限 | block | 数值行红框 |
| `emit_command.command` 空白 | block | 命令框红框 |
| `emit_command` 前导 `/` | warn | 提示去掉 |
| `emit_command` 在 `on_timeout` | block | 命令表不编译超时动作 |
| 未登记键 | info | 只读块 |

## 验收标准

1. 动作列表能加九种；没有 `hold` 可选。
2. `camera_set` 选 `position`+`yaw`：必须填三轴和 yaw；未选 `pitch` 时填 pitch 报“该通道不生效”。
3. `camera_set` 不写 `mode`：显示“逐通道缺省”；写 `replace` 明确覆盖。
4. `camera_set` 工件说明“持续到片段活跃窗末”，不显示“永久”。
5. `overlay_set` 只有 `fade`；颜色、透明度、z_index 正确；不出现 image/subtitle。
6. `overlay_set` 的 z 说明只在该覆盖层管线内排序，不画全局合成表。
7. `adjust_set` 只列 15 通道；不出现 59 通道、曲线、LUT。
8. `adjust_set` 只写 type：报“至少一个通道”。
9. `goto_clip` 用片段 id + entry_time；旧 track/at 报错；详情显示三种跳转区别。
10. `pause` / `resume` / `exit` 没有参数输入。
11. `play_sound` 填 sound/volume/pitch；不出现文件路径。
12. `emit_command` 空白命令报错；前导 `/` 警告；`&&` 原样保留。
13. `emit_command` 放进 `on_timeout`：block，提示命令表不编译超时动作。
14. 动作任意移动后序号更新；`emit_command` 下标随位置变化。
15. 保存重开：九种动作字段、顺序、旧字段只读块原样恢复。
