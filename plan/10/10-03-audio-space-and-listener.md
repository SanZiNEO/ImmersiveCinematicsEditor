# 10-03 · AUDIO 空间语义与监听

> 状态：已实现
> 范围：`category` 的两类声音语义、`position_mode` 与 `attenuation`、脚本级 `meta.listener` 与镜头听者回落
> 关联：10-01 字段面、10-02 播放与包络、10-09 媒体检查

## 一、摘要

把 `AUDIO` 的空间参数和脚本级监听声明分开处理。`category` 决定这条声音是背景音还是环境音：背景音固定贴着听者、不衰减，环境音才参与空间定位。`meta.listener` 决定听者是玩家还是相机，而相机听者只有在存在活跃 `CAMERA` 片段时才真的生效，否则回落到玩家。编辑器要把这两层关系和回落条件说清楚，避免作者以为设了 `camera` 就一定是相机在听。

## 二、为什么做

### 2.1 问题

空间参数目前全靠作者记忆。三件事容易搞错：给 `category=music` 的声音填了 `x/y/z`，以为能摆到某个方向，实际运行时根本不读；把 `position_mode=absolute` 当成「相对相机」，实际它是世界坐标，不跟随听者；把 `meta.listener=camera` 当成开关，但脚本里没有 `CAMERA` 片段、或者播放头正处在镜头空档，听者其实还是玩家。这三种误解都不报错，只表现为「声音方向不对」或「听感没变化」。

### 2.2 目标

- `category=music` 时空间控件禁用并注明「固定相对玩家、无衰减」，值保留不删。
- `ambient` 下 `relative` 明确标为「听者偏移」，`absolute` 明确标为「世界坐标」。
- 监听卡同时展示声明值和当前播放头的实际状态：以相机为锚点、还是回落玩家。
- 脚本没有 `CAMERA` 片段而声明了 `camera` 时，给出「始终回落玩家」的警告。
- `music` 与监听的关系说明白：`listener=camera` 不改变 `music` 的听者行为。

### 2.3 非目标

- 不新增「音频监听器」对象，不新增监听消息。
- 不采样玩家或相机位置，不做 3D 场景预览，不做实时空间试听。
- 不伪造顶层实例选择：多脚本并行时的监听归属属于播放期状态，编辑器不猜。
- 不把 `music` 的空间值写死成 0，也不在切到 `music` 时删除空间字段。

## 三、方案

空间组有四个部分：`category` 分段开关、`position_mode` 分段开关、`attenuation` 分段开关、`x/y/z` 三行数值。`category=music` 时后三者全部禁用，并标注当前不参与空间定位；切回 `ambient` 后原值恢复可编辑。`x/y/z` 的标签随模式变化：`relative` 写「听者偏移」并说明实际听者可能是玩家或相机，`absolute` 写「世界坐标」。

脚本属性里增加一张「音频监听」卡，显示 `listener` 的两个选项和当前播放头的实际状态。声明 `camera` 且当前播放头有活跃 `CAMERA` 片段时，写「以相机位置为锚点」；播放头落在镜头空档时，写「当前回落玩家」——这是提示，不改 `listener` 的值。整个脚本没有 `CAMERA` 片段时升级为警告，并提供跳到 `CAMERA` 轨的入口。

`x/y/z` 一旦有帧，空间组只保留一句「在效果面板编辑」的摘要，不重复放值控件。

## 四、技术细节

### 4.1 核心模型

声音分两类。`music` 是非空间声音：位置固定到玩家位置，无衰减，`position_mode` 与 `attenuation` 都不参与。`ambient` 是空间声音：`relative` 时位置 = 实际听者位置 + 偏移，`absolute` 时位置就是世界坐标，不跟随听者。听者位置的来源由 `meta.listener` 和「当前是否存在活跃 `CAMERA` 片段」共同决定，三个条件同时满足才用相机，否则一律玩家。

### 4.2 契约

- `category` 默认 `music`，`position_mode` 默认 `relative`，`attenuation` 默认 `linear`，`meta.listener` 默认 `player`。
- `category=music` 强制相对听者、`attenuation=none`，与 `meta.listener` 无关。
- `position_mode` 与 `attenuation` 只对 `ambient` 有意义。
- `attenuation=none` 无距离衰减，`linear` 按距离线性衰减。
- `absolute` 声源永远不跟随听者，监听切换只影响 `relative`。
- 相机听者生效需要三个条件同时成立：相机在活跃状态、顶层实例当前存在活跃 `CAMERA` 片段、`meta.listener=camera`。
- 运行时只看顶层实例，并行脚本不叠加监听。

### 4.3 数据形态

| 字段 | 模式 | 类型 | 默认 | 适用范围 | 落点 |
|---|---|---|---|---|---|
| `category` | value | `music` / `ambient` | `music` | 全部 | 空间组 |
| `position_mode` | value | `relative` / `absolute` | `relative` | `ambient` | 空间组 |
| `attenuation` | value | `none` / `linear` | `linear` | `ambient` | 空间组 |
| `x` / `y` / `z` | animated | float | 0 | `ambient` | 空间组 / 效果面板 |
| `meta.listener` | value | `player` / `camera` | `player` | 脚本 | 脚本属性监听卡 |

监听卡展示的是「声明 + 当前播放头检查结果」两段信息，前者来自文档，后者来自播放头位置，两者不混写。

### 4.4 边界

- 编辑器按当前文档判断「有没有 `CAMERA` 片段」，按播放头判断「当前有没有活跃 `CAMERA` 片段」，两者分别给不同级别的提示。
- 多脚本并行时的顶层实例归属不展示、不推测。
- 距离为 0 时 `linear` 与 `none` 无差别，只作说明，不改值。
- 不画 3D 空间示意，不读取运行时听者坐标。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 把 `music` 与 `ambient` 做成两种片段类型 | 结构上分开 | 语义最清晰 | 会改动脚本结构，等于新增类型，越过本轮边界 |
| `category=music` 时自动清零 `x/y/z` | 切到 music 就写 0 | 界面干净 | 切回 `ambient` 会丢掉作者调好的偏移 |
| 监听只显示声明值 | 监听卡只写 `player`/`camera` | 实现最简单 | 作者会以为设了 camera 就生效，实际常回落玩家 |
| 监听卡自动改写 `listener` | 检测到没有 `CAMERA` 片段就改成 `player` | 「自动修好」 | 静默改文档，作者不知道被改过 |

**本方案的缺点**：

- 监听卡要同时表达声明和实际状态，文案容易变长。
- `category=music` 时禁用空间控件会让面板出现一整块灰控件，需要靠文案解释。
- 相机听者的真实效果依赖运行时，编辑器只能给文档级与播放头级判断，不能给最终结论。

## 六、实现结果

状态：已实现

`AudioEnumField` 提供 `category`/`position_mode`/`attenuation` 的中文语义选项与提示；`music` 时将 `position_mode`、`attenuation`、`x/y/z` 禁用并保留值。`SliderField` 按 `position_mode` 把 `x/y/z` 标为“听者偏移”或“世界坐标”，并说明实际听者来源；`AudioBanner` 在 `music` 时给出“固定相对玩家、无衰减”的横幅。`meta` 字段面新增 `ScriptListenerField`：声明 `player`/`camera`，按当前文档与播放头区分“以相机为锚点”“播放头空档回落（info）”“无 CAMERA 片段（warning）”，并说明顶层实例由运行时判定；没有自动改 `listener`，提供打开时间轴/跳到第一个 CAMERA 片段的入口。

| 原设计 | 实际实现 | 偏离原因 |
|---|---|---|
| `category=music` 禁用空间控件、值保留 | `x/y/z`、`position_mode`、`attenuation` 禁用；`category` 保持可切换 | 文档 §2.2/§三要求“后三者全部禁用”；`category` 本身是切换开关，不禁用 |
| 监听两种回落分别给不同级别 | 无 CAMERA 片段 `warning`，播放头空档 `info`；卡上不修改值 | 无 |
| 提供跳到 CAMERA 轨入口 | warning 时按钮聚焦 `timeline.main`；播放头空档时按钮选中第一个 CAMERA 片段 | 编辑器没有“轨道跳转”单独 API，用面板焦点/片段选择表达；不改变播放头 |

验证：`verify-10` 覆盖监听三态、`music` 忽略空间字段、x/y/z 默认与范围；`summary ok=96 fail=0`。真实 Electron 冒烟 `R10-1` 通过，AUDIO 字段面可渲染；`meta.listener` 专用卡未在本轮 e2e 的单条断言里单独点击，监听三态与回落提示由 `verify-10` 的纯函数覆盖，不把“未点击”写成已验收。

**验收要点**

- `category=music` 时空间组禁用并提示「固定相对玩家、无衰减」，`x=5` 保留，切回 `ambient` 后可编辑。
- `ambient + relative + x=2` 时标签为「听者偏移」，说明实际听者可能是玩家或相机。
- `ambient + absolute + x=100` 时标签为「世界坐标」，切换 `listener` 不改变该值。
- `listener=player` 时监听卡显示以玩家为锚点。
- `listener=camera` 且播放头在 `CAMERA` 片段内时显示以相机为锚点。
- `listener=camera` 且播放头在镜头空档时显示「当前回落玩家」，`listener` 值不变。
- 脚本无 `CAMERA` 片段时给出「始终回落玩家」警告。
- `category=music` 配 `listener=camera` 时不产生「相机听者已生效」的错误结论。
- `attenuation` 的 `none`/`linear` 在空间组有对应文案。
- 保存重开后 `listener`、`category`、`position_mode`、`attenuation`、`x/y/z` 原样恢复。
