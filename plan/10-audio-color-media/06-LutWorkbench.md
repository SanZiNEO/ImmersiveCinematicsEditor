# 10-06 LUT 工作台（LutWorkbench）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：10-audio-color-media
> 关联：`05-AdjustColorPanel.md`、`../08-camera-transitions/01-CameraTrackSurface.md`、`../07-position-path-curves/README.md`

## 1. 职责

编辑 `lut`、`lut_input_gamma`、`lut_strength`、`blend_amount`，并呈现 `.cube` 的解析/尺寸/采样器/烘焙约束。LUT 是 ADJUST 与 CAMERA 自带调色共用的字段；本文件负责工作台，通道/曲线归 05，CAMERA 归属归 08-01。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| LUT 字段 | `J:script/schema/TrackSchemas.java:470-473` | `lut` STRING、`lut_input_gamma` FLOAT min 0 默认 1、`blend_mode`；`lut_strength`/`blend_amount` 在 59 通道 |
| CAMERA LUT | `TrackSchemas.java:269`（`getLut`）、`J:script/Clip.java — getLut（269-）` | CAMERA 片段也可带 `lut` |
| 加载 | `J:script/CubeLutLoader.java — load（38-52）`、`loadFile（53-92）`、`forClip（93-105）`、`releaseClip（106-112）`、`clearCache（113-）` | 按片段缓存；失败集合 |
| 解析 | `J:script/CubeLut.java — parse（99/111）`、`MIN_SIZE（44）`、`MAX_SIZE_3D（47）`、`MAX_SIZE_1D（50）`、`COMPOSED_MAX_SIZE（57）` | 1D/3D；尺寸校验 |
| 合成 | `CubeLut.java — composed3D（392-）`、`Composed3D（594-）`、`index3D（616-）` | 单表烘焙；上限 64 |
| 采样 | `J:script/ColorAdjustSampler.java — lut（101）` | `CubeLutLoader.forClip(clipId, lutPath)` |
| pass | `J:client/post/ColorAdjustPass.java — render（117-182）`、`applyTo（183-218）`、`pass（219-322）`、`lutStepReady（362-394）`、`upload（395-）` | 12 采样器上限；fail-safe 直通；alpha 直通 |
| 绑定 | `J:client/post/LutBindGuard.java — DECLARED_SAMPLERS（22-28）`、`LUT_3D（29）`、`LUT_3D_UNIT（32）`、`resolveUnit（44-66）`、`textureReady（67-）` | 采样器单元解析/纹理就绪 |
| 参数 | `J:client/post/ColorAdjustParams.java — record（21-98）`、`BLEND_*（99-103）`、`blendModeCode（109-122）` | `lut` 字段在 params |
| 校验 | `J:script/object/ObjectValidator.java — checkAdjust（737-751）` | `lut_input_gamma>0` |
| 旧编辑器 | 无 | 无 LUT UI |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| LUT 选择 | 无 | 路径输入/宿主文件选择；`.cube` |
| 强度/混合 | 无 | `lut_strength`/`blend_amount` 0–1 |
| 伽马 | 无 | `lut_input_gamma` >0 |
| 解析状态 | 无 | 成功/失败/尺寸越界 |
| 12 采样器 | 无 | 说明 + 失败直通 |
| 烘焙 | 无 | `composed3D` 单表说明 |
| 预览 | 无 | 真实画面；不本地采样 |

### 3.2 拟新建（提案）

- `EDITOR:src/components/color/LutWorkbench.vue`（提案）：路径/强度/伽马/状态。
- `EDITOR:src/components/color/LutStatus.vue`（提案）：解析/尺寸/采样器状态。
- `EDITOR:src/lib/lutMeta.ts`（提案）：从宿主回执读取 LUT 元数据（尺寸/1D/3D）；**不**解析 `.cube`。

## 4. 输入输出与字段约束

**输入**：ADJUST/CAMERA 片段的 `lut`/`lut_input_gamma`/`lut_strength`/`blend_amount`、宿主 LUT 元数据/错误回执、真实画面。

**输出**：字段编辑意图；LUT 选择。

| 字段 | 约束 |
|---|---|
| `lut` | STRING 路径；空 = 无 LUT；`.cube` |
| `lut_input_gamma` | FLOAT >0；默认 1；`0` 被 `ObjectValidator` 拒绝 |
| `lut_strength` | 0–1；默认 1（ADJUST/CAMERA 57 通道之一） |
| `blend_amount` | 0–1；默认 1（仅 ADJUST） |
| `blend_mode` | 5 种（05） |
| 尺寸 | 3D 2–256；1D 2–65536；合成单表上限 64 |
| 采样器 | `LutBindGuard.DECLARED_SAMPLERS` 固定；超限/缺纹理 → fail-safe 直通 |

**必须显示的边界**：

- `CubeLutLoader` 按片段缓存；同一 LUT 多片段共享解析结果，`releaseClip` 释放。
- `composed3D` 把 1D+3D 合成单表，上限 64；超过会报错/降级（以 `CubeLut` 为准）。
- 12 采样器上限是 shader 声明，不是可配置项；`LutBindGuard` 解析单元。
- 失败时 `ColorAdjustPass` fail-safe 直通（不崩），但调色不生效；UI 必须说明「直通」。
- LUT 不影响 alpha（`ColorAdjustPass` alpha 直通）。
- CAMERA 的 LUT 在 lane 级 pass；ADJUST 在 master pass；同一 `.cube` 两处都可引用。

## 5. 修改步骤

1. 新建 `lutMeta.ts`：消费宿主回执的 LUT 元数据/错误；不解析 `.cube` 文本。
2. 新建 `LutWorkbench`：路径输入 + 宿主文件选择（若有）+ `lut_strength`/`blend_amount`/`lut_input_gamma` + 状态。
3. `LutStatus`：解析成功（尺寸/1D/3D）、失败（原因）、采样器不足、烘焙上限；失败时标注「直通，调色不生效」。
4. LUT字段组件复用于clip.effects的ADJUST调色组与CAMERA调色组，沿同一clipKey/完整路径/值控件，明确master/lane归属；专门LUT工作台仍由资源/工具入口打开，不在05新增独占调色页或第二节点轴。
5. `lut_input_gamma<=0`：红条；与 `ObjectValidator.checkAdjust` 一致。
6. 说明 12 采样器/单表烘焙；不提供「强制启用」开关。
7. 保存后重载：`lut`/`lut_input_gamma`/`lut_strength`/`blend_amount` 逐值一致；游戏内 LUT 效果与状态一致。
8. 删除/切换 LUT：`CubeLutLoader.releaseClip` 由运行时按片段生命周期处理；UI 不持有纹理。

## 6. 禁止修改

- 不得改 `CubeLut`/`CubeLutLoader`/`ColorAdjustPass`/`LutBindGuard` 的解析/烘焙/采样器语义。
- 不得在前端解析 `.cube` 或采样 LUT。
- 不得新增 LUT 字段/格式（`.cube` 之外）。
- 不得把 `lut_strength` 与 `blend_amount` 混为一个字段。
- 不得绕过 12 采样器上限或 `lut_input_gamma>0`。
- 不得把 fail-safe 直通显示成「已生效」。

## 7. 两分支承载

- **WebUI**：LUT 工作台 + 状态；提交走 02 命令。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同LUT引用/强度/输入域字段与状态，真实采样由主模组负责；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。12的桌面LUT导出工具是单列宿主扩展，不影响本面板完整性。
- 两分支的权威都是 `CubeLut` + `CubeLutLoader` + `ColorAdjustPass` + `LutBindGuard`。

## 8. 前置

- 01：`lut`/`lut_input_gamma`/`lut_strength`/`blend_amount` schema。
- 02：对象叶子路径 + 原子提交。
- 03：宿主 LUT 元数据/错误回执。
- 05提供效果控件/快捷属性宿主和工具抽屉；06提供局部行/值控件，LUT专门工具只消费同一上下文。
- 08-01：CAMERA 调色入口。

## 9. 验收

**正例**

- 选 `film.cube`（3D 33）：状态「成功（3D 33）」；游戏内 LUT 生效。
- `lut_strength=0.5`：效果半强；`blend_amount=0.5`：混合半强。
- `lut_input_gamma=2.2`：输入伽马生效；`0` 红条。
- 坏 `.cube`：状态「解析失败」；游戏内直通；UI 说明。
- 超 64 的合成：状态「烘焙上限」；不崩。
- CAMERA 与 ADJUST 同用 `film.cube`：两处生效；归属说明不同。

**反例**

- 前端解析 `.cube` 并预览 → 失败。
- `lut_strength` 与 `blend_amount` 合并 → 失败。
- 绕过 12 采样器/伽马校验 → 失败。
- fail-safe 直通显示「已生效」→ 失败。
- 新增 LUT 格式字段 → 失败。
- UI 持有/释放纹理 → 失败。

## 10. 真实冒烟

1. 放 3D `.cube`：选择；游戏内调色。
2. 放 1D `.cube`：选择；合成单表；效果正确。
3. `lut_strength` 0/0.5/1：效果渐变。
4. `lut_input_gamma` 0：编辑器红条；`/icinematics validate` 报错。
5. 坏文件：直通；画面不崩；日志限频。
6. CAMERA + ADJUST 同 LUT：两处生效；切换片段释放缓存。

## 11. 完成定义

- LUT 路径/强度/伽马/混合可编辑；状态（成功/失败/上限/直通）可见。
- 12 采样器/单表烘焙/alpha 直通可解释；不本地解析/采样。
- CAMERA 与 ADJUST 共用工作台，归属清晰。
- 不新增字段/格式；不绕过校验。
- 正例/反例/冒烟全部通过。
