# 10-04 · 调色字段面：CAMERA lane 与 ADJUST master

> 状态：已实现
> 范围：`CAMERA` 片段的 57 个 lane 调色通道 + 10 条曲线，`ADJUST` 轨的 59 个 master 调色通道 + 10 条曲线 + LUT 与层混合
> 关联：10-05 窄组与控件、10-06 曲线、10-07 LUT 与层混合、10-09 媒体检查

## 一、摘要

把两条调色路径在编辑器里彻底分开。`CAMERA` 片段自带 lane 调色，作用于该相机画面；`ADJUST` 轨有 master 调色，作用于合成输出。前者是 57 个动画通道加 10 条曲线，后者是 59 个动画通道加 10 条曲线，再加 LUT 与层混合。两者不是同一层、不是同一组字段，也不能互相串。编辑器的职责是让 57/59 个通道一个不少地出现在正确的片段上，并且让作者一眼看出自己改的是相机还是全屏。

## 二、为什么做

### 2.1 问题

调色字段数量大、分布在两个不同对象上，最容易出的错不是「调得不好看」，而是「调错了层」：把全屏 LUT 挂到相机上、以为在相机上调的曝光会影响字幕、或者以为两条 `ADJUST` 轨会叠加。这些误解在界面上没有痕迹，只有在游戏里看到画面才发现。另一类问题是丢字段：通道太多，实现时容易为了界面好看而合并或省略，导致作者拿不到完整调色能力。

### 2.2 目标

- 选中 `CAMERA` 片段时只出现 57 个通道 + 10 条曲线，不出现任何 LUT 或层混合字段。
- 选中 `ADJUST` 片段时出现 59 个通道 + 10 条曲线 + LUT 定义 + 层混合。
- 同一路径不会在属性面板与效果面板重复出现值控件。
- 分组配置缺失时仍显示全部通道，不因配置问题丢字段。
- 未知通道只读展示，不被当成新字段写入脚本。

### 2.3 非目标

- 不新增调色字段，不改公式，不重排运行时的处理顺序。
- 不把 57/59 个通道合成一个「总强度」或「风格」滑杆。
- 不做像素级调色、不采样画面、不做编辑器内预览渲染。
- 不把 LUT 塞给 `CAMERA`：`CAMERA` 没有 `lut`、`lut_input_gamma`、`lut_strength`、`blend_mode`、`blend_amount`。

## 三、方案

选中片段后，属性面板按功能窄组展开调色：基础校色、HSL、白平衡、通道系数、通道混合、曲线强度、Lift/Gamma/Gain、Hue 曲线强度、六色带、风格化；`ADJUST` 额外多出 LUT 强度与层级混合两组。分组只影响显示顺序与折叠，不决定字段是否存在——字段是否存在由脚本结构决定。

每个动画通道有两种状态：没有关键帧时在属性面板给静态值并带「开时钟」；有关键帧时属性面板只留一句「在效果面板编辑」的摘要，值控件移到效果面板。10 条曲线定义、`lut`、`lut_input_gamma`、`blend_mode` 属于 value-only，永远留在属性面板，不进效果面板。

`CAMERA` 与 `ADJUST` 的选择互不影响：切换选中片段时字段面整体替换，不残留上一片段的值，也不把上一个片段的调色带到新片段。

## 四、技术细节

### 4.1 核心模型

调色字段分三类：可动画的数值通道、value-only 的曲线定义、value-only 的 LUT 与混合声明。可动画通道按片段本地时间采样；曲线定义是点数组，本身不参与关键帧采样，只有对应的 `*_strength` 通道可动画；LUT 路径、输入 gamma、混合模式是整段一个值。

`CAMERA` 的调色按该相机 lane 的片段本地时间采样，属于这个相机画面。`ADJUST` 的调色作用于合成输出，不作用于 HUD、字幕、黑边。

### 4.2 契约

- `CAMERA` 对象叶子为 57 动画 + 10 曲线；`ADJUST` 为 59 动画 + 10 曲线 + `lut` + `lut_input_gamma` + `blend_mode`。
- `ADJUST` 的 59 个通道 = `CAMERA` 的 57 个 + `lut_strength` + `blend_amount`。
- 10 条曲线：`rgb_curve`、`r_curve`、`g_curve`、`b_curve`、`hv_h_curve`、`hv_s_curve`、`hv_l_curve`、`lv_s_curve`、`sv_s_curve`、`sv_l_curve`，两侧相同。
- 每个 `ADJUST` 轨每帧只取本轨第一个活跃片段；同实例多条 `ADJUST` 轨后发布者覆盖前发布者，不是叠加；不同脚本实例各占一层。
- 无活跃片段时不发布参数，渲染侧拿不到就不调色。
- 范围：`exposure` 为 -5–5；普通调色通道为 -1–1；曲线强度、`lut_strength`、`blend_amount`、`grayscale`、`invert` 为 0–1；`lut_input_gamma` 必须 >0。默认值：普通通道 0，强度类 1，风格化为 0，gamma 为 1。
- 越界与非有限值都拒绝提交，不静默夹取。

### 4.3 数据形态

窄组划分（显示层，不是第二套结构）：

| 组 | 通道数 | `CAMERA` | `ADJUST` |
|---|---|---|---|
| 基础校色 | 6 | `exposure` `contrast` `highlights` `shadows` `whites` `blacks` | 同左 |
| HSL | 4 | `hue` `saturation` `vibrance` `lightness` | 同左 |
| 白平衡 | 2 | `temperature` `tint` | 同左 |
| 通道系数 | 3 | `red` `green` `blue` | 同左 |
| 通道混合 | 9 | `mix_rr` `mix_rg` `mix_rb` `mix_gr` `mix_gg` `mix_gb` `mix_br` `mix_bg` `mix_bb` | 同左 |
| 曲线强度 | 4 | `curve_strength` `r_curve_strength` `g_curve_strength` `b_curve_strength` | 同左 |
| Lift/Gamma/Gain | 9 | `lift_r/g/b` `gamma_r/g/b` `gain_r/g/b` | 同左 |
| LUT 强度 | 1 | 无 | `lut_strength` |
| Hue 曲线强度 | 6 | `hv_h_strength` `hv_s_strength` `hv_l_strength` `lv_s_strength` `sv_s_strength` `sv_l_strength` | 同左 |
| 六色带 | 12 | `hue_red` `sat_red` … `hue_magenta` `sat_magenta` | 同左 |
| 风格化 | 2 | `grayscale` `invert` | 同左 |
| 层级混合 | 1 | 无 | `blend_amount` |
| 曲线定义 | 10 | 10 条曲线 | 同左 |
| LUT 定义 | 3 | 无 | `lut` `lut_input_gamma` `blend_mode` |

分组配置只决定分组与顺序；配置缺失时回退到脚本自带的分组信息，仍然把 57/59 个字段全部显示出来。未知通道进只读的「扩展」组，不猜控件、不新建字段。

### 4.4 边界

- `CAMERA` 上不存在 LUT 与层混合字段，界面不显示，也不允许通过其它路径写入。
- 曲线抽屉只显示曲线定义，不显示强度控件；强度仍在属性面板或效果面板。
- LUT 定义只在属性面板的 LUT 组，不进曲线抽屉。
- `ADJUST` 缺少 `blend_mode` 时按 `normal` 显示，不报错。
- 编辑器不判断 LUT 是否能被游戏解析，只按扩展名与存在性说话。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 把 57/59 个通道铺成一个大组 | 一个「调色」组里全列 | 实现最省事 | 几十行连续滑杆无法浏览，作者找不到目标通道 |
| 合并相似通道减少控件 | 例如把 `saturation`/`vibrance` 合成一个 | 面板更短 | 合并会丢字段，等于削减作者的调色能力 |
| 让 `CAMERA` 也能用 LUT | 统一两条调色路径 | 心智模型更简单 | 脚本结构上 `CAMERA` 没有 LUT 字段，界面不能显示不存在的字段 |
| 分组配置作为字段存在性的依据 | 没配到就不显示 | 配置即真相 | 配置是显示层，字段存在性由脚本结构决定；配置缺失不能导致丢字段 |

**本方案的缺点**：

- 12 个窄组仍有 59 个数值控件，作者需要按组查找。
- `CAMERA` 与 `ADJUST` 字段面高度相似但不等价，切换选中时容易记错自己在哪一层。
- 未知通道只能只读展示，作者看到但不明白为什么改不了。

## 六、实现结果

状态：已实现

`shared/colorSpec.ts` 按字段目录导出 `COLOR_GROUPS`（基础校色 / HSL / 白平衡 / 通道系数 / 通道混合 / 曲线强度 / Lift·Gamma·Gain / Hue 曲线强度 / 六色带 / 风格化 / 层级混合 / 曲线定义 / LUT 定义等），并区分 `CAMERA` 与 `ADJUST`：前者不出现 `lut`、`lut_input_gamma`、`lut_strength`、`blend_mode`、`blend_amount`，后者保留 LUT 与层混合。`core.audio/index.ts` 对 57/59 通道全部注册字段面与专用控件；未注册路径仍由 06 的通用控件只读/未知组处理，不删通道。`COLOR_ANIMATED_PATHS` 决定“开时钟/有帧走效果面板”；曲线定义、`lut`、`lut_input_gamma`、`blend_mode` 保持 value-only。

| 原设计 | 实际实现 | 偏离原因 |
|---|---|---|
| 57/59 通道 + 10 曲线 + LUT/混合的字段面 | 全部接入；`CAMERA` 与 `ADJUST` 各自注册 | 10-04 §4.3 的 12 个窄组之外，曲线定义 10 条与 LUT 定义另列显示组，最终 `COLOR_GROUPS` 为 14 组；不合并、不删字段 |
| 12 个窄组 | 14 个显示组 | 曲线定义/ LUT 定义需要独立可编辑落点；归入窄组会让 value-only 字段混进动画组 |
| 未知通道只读扩展组 | 沿用 06 的未知路径只读处理；字段面不注册未知路径 | 无 |

验证：`verify-10` 覆盖 57/59 通道数、CAMERA 无 LUT、ADJUST 有 LUT、范围/默认值、曲线定义 value-only；`summary ok=96 fail=0`。真实 Electron 冒烟 `R10-2` 通过：ADJUST 渲染调色组，CAMERA 不出现 LUT 控制；逐字段输入交互未逐项点击。

**验收要点**

- 选中 `CAMERA` 只出现 57 通道 + 10 曲线，不出现 `lut`、`lut_input_gamma`、`blend_mode`、`blend_amount`。
- 选中 `ADJUST` 出现 59 通道 + 10 曲线 + LUT 定义 + 层混合。
- 范围与默认值符合契约：`exposure` -5–5、普通通道 -1–1、强度类 0–1、gamma >0。
- 开时钟后属性面板值控件消失、效果面板出现该行，删最后一帧回流。
- `lut_strength` 有帧时进效果面板，`lut` 仍只在属性面板。
- 曲线强度有帧但曲线定义为空时，效果面板显示强度行，曲线抽屉显示「未定义」。
- `CAMERA` 与 `ADJUST` 各选一次，字段互不串，切换选择不残留上一片段的值。
- 分组配置缺失时仍显示全部 57/59 字段。
- 未知通道进只读扩展组，不写入脚本。
- 保存重开后通道、曲线、LUT 与混合值原样恢复。
