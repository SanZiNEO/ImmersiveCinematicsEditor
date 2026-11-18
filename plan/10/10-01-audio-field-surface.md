# 10-01 · AUDIO 字段面与音源

> 状态：已实现
> 范围：`AUDIO` 轨 13 个既有字段的编辑面、`source` 的两套取值域、`file_loop` 与片段循环的区分
> 关联：10-02 播放与包络、10-03 空间与监听、10-08 资源抽屉、10-09 媒体检查

## 一、摘要

把模组 `AUDIO` 轨道现有的 13 个字段完整接进编辑器。其中 `volume`、`x`、`y`、`z` 是可动画字段，其余九个是片段级 value-only 字段。音源按 `source` 分成「资源文件」与「声音注册表」两套选择器：字段名不变，但取值域完全不同。编辑器只负责让作者看得见、改得对，不新增字段，也不介入播放实现。

## 二、为什么做

### 2.1 问题

编辑器目前没有 `AUDIO` 字段面，作者只能手改脚本 JSON。手改带来三个可感知的后果：填了不存在的音频文件，脚本能存、游戏里没声音；把资源路径填进 `source=minecraft`，游戏按声音 ID 找不到；`file_loop` 与片段循环被当成同一件事，写出「文件循环却没循环片段」或「片段循环却以为音乐会停」的脚本。这些错误在保存时都不报，作者只能进游戏听。

### 2.2 目标

- 选中 `AUDIO` 片段时，13 个字段全部可见、可编辑，不出现其它轨道的字段。
- 音源按 `source` 分流：文件选择器与声音 ID 选择器各自给出正确候选，错误取值当场可辨。
- `file_loop` 与片段执行循环在两处分别显示，文案不混。
- value-only 字段永远不进效果面板；动画字段开时钟后只出现在效果面板。
- 音源为空、扩展名不支持、路径越界这类可判定问题，在字段旁直接可见。

### 2.3 非目标

- 不新增音频字段，不改模组 `.java`。
- 不把视频音轨、规则动作 `play_sound`、原版背景音乐混进 `AUDIO` 字段面。
- 不做本地解码、混音、波形图、试听器。
- 不提供「添加属性」或字段选择器：`AUDIO` 字段面固定 13 个，界面不能让作者以为能加字段。

## 三、方案

选中一条 `AUDIO` 片段，属性面板出现四组加一个片段头：音源（`sound`/`source`/`pitch`/`file_loop`）、音量（`volume`）、包络（`fade_in`/`fade_out`）、空间（`category`/`position_mode`/`attenuation`/`x`/`y`/`z`），片段头显示起点、时长与循环设置，并给出「在时间轴编辑」的入口。

`source=file` 时 `sound` 是资源相对路径，用文件选择器挑，也可以手输；候选按扩展名白名单过滤，路径必须落在资源根内。`source=minecraft` 时 `sound` 是声音注册表 ID，用注册表搜索挑，手输未命中的 ID 只提示「未找到」，不判非法——注册表会随资源包变化，编辑器不该替它下定论。

`source` 是语义开关而不是结构开关：切换时不改写 `sound`，先把原值保留并标「需要重新选择」，作者确认后一次提交，一次撤销回到切换前。编辑器不会把文件路径改写成声音 ID，也不会反向改写。

`volume`/`x`/`y`/`z` 没有关键帧时在属性面板给静态值，并带「开时钟」；一旦有帧，属性面板不再显示值控件，改由效果面板编辑，删掉最后一帧后回流属性面板。

## 四、技术细节

### 4.1 核心模型

一个 `AUDIO` 片段承载两类字段，区别在时间语义：可动画字段按片段本地时间采样，value-only 字段整段只有一个值。面板路由由「有没有关键帧」唯一决定，同一条路径不会在两处同时出现值控件。片段执行循环属于时间线的片段头，不属于音频字段面，两处入口分开但可互相跳转。

### 4.2 契约

- `sound` 必填；为空即视为不完整脚本，保存与推送都拦。
- `source=file` 的同步解码格式为 `.ogg`、`.wav`；外部解码白名单为 `.mp3`、`.aac`、`.flac`、`.m4a`、`.opus`、`.wma`、`.oga`、`.ogx`。
- 路径必须是相对资源根，禁止绝对路径、盘符与 `..` 逃逸。
- `source=minecraft` 只接受声音注册表 ID，不把 `resource/` 文件路径塞进去。
- `pitch` 原样交给游戏，编辑器不钳制。
- `fade_in`/`fade_out` 下界为 0；`attenuation` 默认 `linear`，`position_mode` 默认 `relative`，`category` 默认 `music`。
- 校验分级：`sound` 为空为 block；扩展名不支持、路径越界为 error；资源列表未命中、注册表未命中为 warn，不阻止保存。

### 4.3 数据形态

| 字段 | 模式 | 类型/范围 | 默认 | 面板组 |
|---|---|---|---|---|
| `volume` | animated | float | 1 | 音量 |
| `x` / `y` / `z` | animated | float | 0 | 空间 |
| `sound` | value | string，required | null | 音源 |
| `source` | value | `file` / `minecraft` | `file` | 音源 |
| `pitch` | value | float | 1 | 音源 |
| `file_loop` | value | bool | false | 播放 |
| `fade_in` / `fade_out` | value | float，min 0 | 0 | 包络 |
| `attenuation` | value | `none` / `linear` | `linear` | 空间 |
| `position_mode` | value | `relative` / `absolute` | `relative` | 空间 |
| `category` | value | `music` / `ambient` | `music` | 空间 |

`category=music` 时空间字段的值原样保留，只是标「当前不读」；切回 `ambient` 后原值继续可用。界面必须写清「music 不参与空间定位」，不能把 music 的 `x`/`y`/`z` 当坐标。

### 4.4 边界

- 不写片段执行循环的三个字段，那属于时间线片段头。
- 不判定 ffmpeg 是否存在、外部解码是否成功、音频文件内部是否损坏：这些不在资源清单里，编辑器只按扩展名与存在性说话。
- 无限片段（`duration < 0`）没有片段结束，`fade_out` 不生效，但值保留、`file_loop` 仍按文件流循环。
- `fade_in + fade_out > duration` 只给 warn，说明运行时会整段跳过，不自动改值。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 单一音源字符串框 | 一个输入框，`file` 与 `minecraft` 共用 | 少一个字段控件 | 两套取值域混在一起，编辑器无法判断填错，错误只能在游戏里暴露 |
| 切换 `source` 时清空 `sound` | 切换即重置 | 实现最省事 | 丢掉作者已输入的值，且不可撤销回原状 |
| 把 `file_loop` 与片段 `loop` 合成一个「循环」开关 | 界面上只留一个开关 | UI 更短 | 两者语义不同（PCM 回卷 vs 片段重播），合成后会写出错误脚本 |
| 动态字段选择器 | 允许作者自选要暴露的字段 | 灵活 | `AUDIO` 字段面是固定的 13 个，选择器会让人误以为可以新增字段 |

**本方案的缺点**：

- 13 个字段分落两个面板，作者需要理解「有帧就去效果面板」这条规则。
- `source` 切换要二次确认，比直接改写多一步操作。
- `category=music` 时空间字段保留但禁用，看起来像坏掉的控件，需要靠文案解释。

## 六、实现结果

状态：已实现

`shared/audioSpec.ts` 固定 `AUDIO` 13 字段与四个显示组（音源 / 音量 / 包络 / 空间），`core.audio/index.ts` 注册专用控件并把 `fade_out` 合并进包络控件。`SliderField`、`AudioSourceField`、`AudioEnumField`、`AudioFileLoopField` 均只通过 `PanelContext.commands` 写入；`volume`/`x`/`y`/`z` 有帧后由字段面 `hideWhenFramed` 交给效果面板，`pitch` 数值框不钳制、原样写入。`source` 切换前询问并保留 `sound`，一次提交可撤销；`minecraft` 使用 `registry.query` 候选，未命中只提示“未找到”。`category=music` 时 `x/y/z/position_mode/attenuation` 控件禁用并提示“固定相对玩家、无衰减”，值保留。

| 原设计 | 实际实现 | 偏离原因 |
|---|---|---|
| 13 字段、双面板路由、音源双取值域 | 13 字段全部注册；4 个显示组；`pitch` 数值不钳制；`source` 切换保留原值并二次确认；`music` 禁用空间控件 | `README.md` 的字段表把 `file_loop` 标为“播放”组；10-01 §三明确把它归入“音源”，实现按 10-01 执行，界面另行说明文件循环与片段循环的区别 |
| value-only 字段不进效果面板 | 只注册属性面板控件；没有动画字段面注册 | 无 |
| `sound` 为空 block、扩展名/路径 error、清单未命中 warn | `checkAudioSound` 分级实现；保存/推送拦截仍由模组校验器负责 | 编辑器不复制运行时校验器；推送/保存的真实拦截在游戏侧 |

验证：`node --experimental-strip-types src/workbench/verify-10.ts` 覆盖字段数、组顺序、扩展名、相对路径、音源取值域；`summary ok=96 fail=0`。`vue-tsc` 在本轮文件上无错误；真实 Electron 冒烟 `R10-1` 通过：AUDIO 只出现 13 个字段、四组与“文件循环/淡入/淡出”横幅（见 10-09）。

**验收要点**

- 新建 `AUDIO` 片段只出现 13 个字段，不混入 `OVERLAY`/`ADJUST` 字段。
- `source=file` 选到 `.ogg` 能写入相对路径；选 `.txt` 报扩展名错误。
- `source=minecraft` 手输未注册 ID 只提示「未找到」，仍可保存。
- `source` 切换保留原 `sound` 并标「需要重新选择」，一次撤销可回。
- 开时钟后属性面板值控件消失、效果面板出现该行，删最后一帧回流。
- `file_loop` 与片段循环同时开启时两处状态并存，文案不合并。
- `category=music` 时空间字段禁用且值保留，切回 `ambient` 可编辑。
- `fade_in=2`、`fade_out=2`、`duration=3` 时给出「运行时会整段跳过」的警告。
- `sound` 为空时保存与推送都被阻止。
- 保存重开后 13 个字段原样恢复，无新增字段、无丢失 value-only 字段。
