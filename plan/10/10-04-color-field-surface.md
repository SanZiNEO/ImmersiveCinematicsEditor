# 10-04 调色字段面：CAMERA lane 与 ADJUST master

## 目标

把当前代码里两条调色路径完整分开：

- `CAMERA` 片段自带的 lane 调色：57 个动画通道 + 10 条曲线；
- `ADJUST` 轨的 master 调色：59 个动画通道 + 10 条曲线 + LUT + 层混合。

两者不是同一层，不是同一组字段，不能互相串。编辑器不新增调色字段，不删减通道，不把 LUT 塞给 `CAMERA`。

## 源码事实

`TrackSchemas`：

- `CAMERA_COLOR_CHANNELS` 57 个：基础校色 6、HSL 4、白平衡 2、通道系数 3、通道混合 9、曲线强度 4、Lift/Gamma/Gain 9、Hue 曲线强度 6、六色带 12、风格化 2。
- `ADJUST_CHANNELS` 59 个：以上 57 个 + `lut_strength` + `blend_amount`。
- `CAMERA` 调色曲线 10 条：`rgb_curve`、`r_curve`、`g_curve`、`b_curve`、`hv_h_curve`、`hv_s_curve`、`hv_l_curve`、`lv_s_curve`、`sv_s_curve`、`sv_l_curve`。
- `ADJUST` 同样有 10 条曲线，另有 `lut`（string）、`lut_input_gamma`（float，min 0）、`blend_mode`（enum）。
- `CAMERA` 对象叶子：57 动画 + 10 曲线 = 67。
- `ADJUST` 对象叶子：59 动画 + 10 曲线 + `lut` + `lut_input_gamma` + `blend_mode` = 72。

`ColorAdjustSampler`：

- CAMERA lane 调色按片段本地时间采样 57 通道 + 10 条曲线强度；
- ADJUST master 调色按片段本地时间采样 59 通道 + 10 条曲线强度；
- 曲线本身是 value-only `STRUCT`，不参与关键帧采样；只有 `*_strength` 可动画。

`AdjustTrackPlayer`：

- 每帧取本轨第一个活跃片段；
- 同实例多条 `ADJUST` 轨后发布者覆盖前发布者，不是叠加；
- 不同 `ScriptPlayer` 实例各自占一层；
- 无活跃片段时不发布，渲染侧拿不到参数就不调色。

`CAMERA` lane 调色由相机 lane 的片段本地时间采样，属于该相机画面；`ADJUST` master 调色作用于合成输出，不作用于 HUD、字幕、黑边。

## 调色分组总表

分组是编辑器显示层，不是脚本字段，也不是第二套 schema。分组表只把现有路径装进窄组，不改字段名、默认值、范围。

| 组 | CAMERA 57 | ADJUST 59 | 控件 |
|---|---|---|---|
| 基础校色 6 | `exposure` / `contrast` / `highlights` / `shadows` / `whites` / `blacks` | 同左 | 数值滑杆 + 数字 |
| HSL 4 | `hue` / `saturation` / `vibrance` / `lightness` | 同左 | 数值滑杆 + 数字 |
| 白平衡 2 | `temperature` / `tint` | 同左 | 数值滑杆 + 数字 |
| 通道系数 3 | `red` / `green` / `blue` | 同左 | RGB 三行 |
| 通道混合 9 | `mix_rr` / `mix_rg` / `mix_rb` / `mix_gr` / `mix_gg` / `mix_gb` / `mix_br` / `mix_bg` / `mix_bb` | 同左 | 3×3 矩阵 |
| 曲线强度 4 | `curve_strength` / `r_curve_strength` / `g_curve_strength` / `b_curve_strength` | 同左 | 0–1 滑杆 |
| Lift/Gamma/Gain 9 | `lift_r/g/b` / `gamma_r/g/b` / `gain_r/g/b` | 同左 | 三组 RGB 三元组 |
| LUT 强度 1 | 无 | `lut_strength` | 0–1 滑杆 |
| Hue 曲线强度 6 | `hv_h_strength` / `hv_s_strength` / `hv_l_strength` / `lv_s_strength` / `sv_s_strength` / `sv_l_strength` | 同左 | 0–1 滑杆 |
| 六色带 12 | `hue_red` / `sat_red` / `hue_yellow` / `sat_yellow` / `hue_green` / `sat_green` / `hue_cyan` / `sat_cyan` / `hue_blue` / `sat_blue` / `hue_magenta` / `sat_magenta` | 同左 | 六行色带，每行 Hue/Sat |
| 风格化 2 | `grayscale` / `invert` | 同左 | 0–1 滑杆 |
| 层级混合 1 | 无 | `blend_amount` | 0–1 滑杆 |
| 曲线定义 | 10 条 `STRUCT` | 同左 | 曲线抽屉 |
| LUT 定义 | 无 | `lut` / `lut_input_gamma` / `blend_mode` | LUT 组 |

## 范围与默认

| 通道类 | 范围 | 默认 |
|---|---|---|
| `exposure` | -5–5 | 0 |
| 普通调色通道（除强度/风格化/混合） | -1–1 | 0 |
| 10 条曲线强度 | 0–1 | 1 |
| `lut_strength` | 0–1 | 1 |
| `blend_amount` | 0–1 | 1 |
| `grayscale` / `invert` | 0–1 | 0 |
| `lut_input_gamma` | >0 | 1 |

- `0` 对普通调色通道表示无效果；`1` 是上界。
- 强度类默认 1；0 表示该步关闭。
- `lut_input_gamma` schema min 0，但运行时要求 >0；编辑器按 >0 校验，不写 0。
- 不钳制作者输入；越界显示错误并拒绝提交。

## 属性面板与效果面板

### 属性面板

`selection.properties` 对 `CAMERA` / `ADJUST` 片段显示：

- 基础校色、HSL、白平衡、通道系数、通道混合、曲线强度、Lift/Gamma/Gain、Hue 曲线强度、六色带、风格化；
- `ADJUST` 额外显示 LUT 强度、层级混合、LUT 定义、`blend_mode`；
- `CAMERA` 不显示 LUT/层级混合；
- 所有未设置、静态、value-only 字段按默认值显示；
- `exposure` 显示 -5–5，其他按表；
- 强度类显示 0–1 和“0 关闭”。

规则：

- 59/57 个动画通道中，`keyframes.length > 0` 的叶子不在属性面板显示值控件，只在效果面板出现；
- 无关键帧的动画通道显示静态值，并带“开时钟”；
- 10 条曲线、`lut`、`lut_input_gamma`、`blend_mode` 永远不进效果面板；
- 不提供“添加属性”或字段选择器；字段面固定为 57/59 + 曲线 + 值字段。

### 效果面板

`clip.effects` 只显示 `keyframes.length > 0` 的调色叶子：

- 槽位命名与属性面板一致；
- 曲线强度叶子（如 `curve_strength`）进效果面板；曲线定义不进去；
- `lut_strength` / `blend_amount` 有帧时进效果面板；
- `blend_mode` / `lut` / `lut_input_gamma` 不进效果面板。

### 不重复显示

- 同一路径有帧时，只在效果面板出现；
- 同一路径无帧时，只在属性面板出现；
- 曲线抽屉只显示曲线定义，不显示曲线强度值控件；强度仍在属性/效果面板；
- LUT 定义只在属性面板的 LUT 组，不在曲线抽屉。

## 窄组与配置

12 个功能组由编辑器侧 `color-groups.json` 提供：

```json
{
  "camera": ["basic", "hsl", "white_balance", "channel", "mixer", "curve_strength", "lift_gamma_gain", "hue_curve_strength", "bands", "style"],
  "adjust": ["basic", "hsl", "white_balance", "channel", "mixer", "curve_strength", "lift_gamma_gain", "lut_strength", "hue_curve_strength", "bands", "style", "blend"]
}
```

- 配置只决定显示分组和顺序，不决定字段是否存在；字段是否存在仍由 schema 决定。
- 默认窄组：12 个组，不把 59 个通道铺成一个“调色”大组。
- 组内字段顺序与 `TrackSchemas` 通道顺序一致；组间顺序按上表。
- 未知通道进入“扩展”组，只读，不猜测控件；不新建字段。
- 配置缺失时回退为 schema `section`，但 CAMERA/ADJUST 仍按 57/59 字段面显示，不丢字段。

## 本地校验

| 检查 | 级别 | 处理 |
|---|---|---|
| 通道值超出范围 | block | 行红框，拒绝提交 |
| 通道值非有限 | block | 拒绝提交 |
| `lut_input_gamma=0` | block | 按 >0 校验 |
| `CAMERA` 出现 LUT 字段 | block | 不允许写入；不属于 CAMERA 字段面 |
| `ADJUST` 缺 `blend_mode` | info | 默认 `normal`，不报错 |
| 未知调色通道 | info | 扩展组只读，不删除 |

## 验收标准

1. 选中 `CAMERA` 片段：只出现 57 个调色通道 + 10 条曲线，不出现 `lut` / `blend_mode` / `blend_amount`。
2. 选中 `ADJUST` 片段：出现 59 个调色通道 + 10 条曲线 + `lut` / `lut_input_gamma` / `blend_mode`。
3. `exposure` 范围 -5–5；`contrast` 范围 -1–1；`curve_strength` 范围 0–1；默认值分别为 0/0/1。
4. `exposure` 开时钟：属性面板值控件消失，效果面板出现 `exposure` 行；删最后一帧回流。
5. `lut_strength` 有帧：效果面板出现；`lut` 本身仍只在属性面板 LUT 组。
6. 曲线强度有帧、曲线定义为空：效果面板显示强度行，曲线抽屉显示“未定义曲线”。
7. `CAMERA` 和 `ADJUST` 各选一个：两组字段互不串，切换选择不保留上一片段的字段值。
8. `color-groups.json` 缺失：仍显示全部 57/59 字段，不因为分组配置缺失丢字段。
9. 未知通道 `foo`：进入扩展组只读；不生成 `foo` 字段，不写入脚本。
10. 保存重开：57/59 通道、10 条曲线、LUT/混合值原样恢复。
