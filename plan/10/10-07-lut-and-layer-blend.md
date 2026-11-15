# 10-07 LUT 与层混合

## 目标

把 `ADJUST` 的 LUT 与层混合字段接进编辑器：

- `lut` 只接受 `resource/` 下的 `.cube` 文件；
- `lut_strength`、`lut_input_gamma` 控制 LUT 步；
- `blend_mode`、`blend_amount` 控制本层与下层的混合；
- LUT 只属于 `ADJUST`，`CAMERA` 不出现 LUT 字段。

编辑器只选文件、写字段；不烘焙 LUT、不上传文件、不预览最终画面。

## 源码事实

`TrackSchemas.adjustObjects()`：

- `lut`：string，value-only，默认 null；
- `lut_input_gamma`：float，value-only，schema min 0，validator 要求 >0，默认 1；
- `lut_strength`：animated float，0–1，默认 1；
- `blend_mode`：value enum `normal/multiply/screen/soft_light/overlay`，默认 `normal`；
- `blend_amount`：animated float，0–1，默认 1。

`CubeLut` / `CubeLutLoader`：

- 支持 1D/3D `.cube`；
- 1D 段与两段 DOMAIN 在加载时烘焙成一张合成 3D 表；
- 路径按资源根解析，缓存按路径；
- 缺失/解析失败只报一次，不逐帧重试。

`ColorAdjustPass`：

- 无 LUT、`lut_strength=0`、LUT 绑定自检失败时，跳过 LUT 步；
- 不因为 LUT 缺失把整段调色清空，也不黑屏；
- `blend_amount` 在全部 19 步之后施加；
- `blend_mode` 是 value-only 枚举。

`AdjustTrackPlayer` / `MasterColorAdjust`：

- 同轨只取第一个活跃片段；
- 同脚本多条 `ADJUST` 轨后发布者覆盖前发布者，不是叠加；
- 不同脚本实例各占一层，按实例启动顺序叠。

## 字段表

| 字段 | 模式 | 类型/范围 | 默认 | 适用 | 面板 |
|---|---|---|---|---|---|
| `lut` | value | string，`.cube` 相对路径 | null | ADJUST | 属性“LUT 定义” |
| `lut_input_gamma` | value | float，>0 | 1 | ADJUST | 属性“LUT 定义” |
| `lut_strength` | animated | float，0–1 | 1 | ADJUST | 属性“LUT 强度” / 效果 |
| `blend_mode` | value | enum `normal/multiply/screen/soft_light/overlay` | `normal` | ADJUST | 属性“层级混合” |
| `blend_amount` | animated | float，0–1 | 1 | ADJUST | 属性“层级混合” / 效果 |

## LUT 定义

### 路径

- `lut` 是相对资源根路径，例如 `lut/teal_orange.cube`；
- 只接受 `.cube`，大小写不敏感；
- 不允许绝对路径、盘符、`..` 逃逸；
- 文件选择器使用 `resource.list(kind=all)`，客户端过滤 `.cube`；
- 允许手动输入；未在资源列表命中时显示“未找到”，不把路径清空；
- 不提供上传、删除、重命名；资源文件由资源目录管理。

### 格式

- 支持 1D LUT、3D LUT；
- 支持 `DOMAIN_MIN` / `DOMAIN_MAX`；
- 1D + DOMAIN 由游戏加载期烘焙成单张合成 3D 表；编辑器不重复实现烘焙；
- `.cube` 内部语法错误、尺寸不支持、数据不完整由游戏加载失败处理；编辑器只做扩展名/存在性检查；
- 不提供 LUT 缩略图、不解析 LUT 颜色、不生成预览图。

### 强度与 gamma

- `lut_strength` 0–1：
  - 0 表示 LUT 步关闭；
  - 1 表示全量；
  - 有帧进效果面板，无帧在属性面板。
- `lut_input_gamma`：
  - 必须 >0；0 或负数拒绝提交；
  - 只影响 LUT 输入，不影响其他 19 步；
  - 是 value-only，不进效果面板。
- `lut` 为空时：
  - `lut_strength` / `lut_input_gamma` 仍可显示，但标“未选择 LUT，不生效”；
  - 不自动把强度写 0，保留作者值；
  - 不把 gamma 写 1，保留作者值。

## 层混合

### `blend_mode`

| 值 | 含义 |
|---|---|
| `normal` | 正常覆盖 |
| `multiply` | 正片叠底 |
| `screen` | 滤色 |
| `soft_light` | 柔光 |
| `overlay` | 叠加 |

- 枚举控件用分段按钮/下拉，不用滑杆；
- 默认 `normal`；
- 缺失时按 `normal` 显示；
- 非法值拒绝提交，不静默回退。

### `blend_amount`

- 0–1，默认 1；
- 0 表示本层不参与混合，1 表示全量；
- 在全部 19 步之后施加；
- 有帧进效果面板；
- 与 `blend_mode` 分开：模式是枚举，数量是动画浮点。

### 同脚本多 ADJUST 轨

`ADJUST` 的层不是“同一脚本里多条轨相加”。同一 `ScriptPlayer` 实例下：

- 每条 `ADJUST` 轨都发布到同一个实例 key；
- 后发布的轨覆盖前发布的轨；
- 同一时刻只有最后发布的那条轨参数生效；
- 不同脚本实例才各自占一层，按实例启动顺序叠。

编辑器在 `ADJUST` 片段头显示：

```text
ADJUST 2 · 本脚本 3 条 ADJUST 轨
⚠ 同实例多轨：后发布轨覆盖前轨，不叠加
[查看轨道顺序]
```

- “查看轨道顺序”打开只读列表，按轨道顺序列出；
- 不自动合并轨道，不自动删轨；
- 提供“拆到新脚本实例”的说明入口；需要并行层时由作者另建脚本，编辑器不自动创建并行脚本。

### 同轨重叠

- 同一 `ADJUST` 轨只取第一个活跃片段；
- 同轨重叠片段不各自调色；
- 片段头显示“同轨重叠：后片段不参与调色”；
- 可“定位重叠”或“拆到新 ADJUST 轨”；拆轨写现有结构，不新增字段。

## 属性面板

`ADJUST` 的“LUT 定义”组：

```text
LUT 文件      [ 选择 .cube ] [手动路径]
              lut/teal_orange.cube
              未在资源列表中找到（warn）
LUT 强度      [0.75]  0–1
输入 gamma    [1.00]  >0
```

“层级混合”组：

```text
混合模式      [normal] [multiply] [screen] [soft_light] [overlay]
混合量        [1.00]  0–1
              同脚本多轨覆盖提示 / 轨道顺序入口
```

- `lut` / `lut_input_gamma` / `blend_mode` 永远在属性面板；
- `lut_strength` / `blend_amount` 有帧时只在效果面板，无帧时在属性面板；
- 不把 LUT 放进 `curves` 抽屉；曲线抽屉只编辑 10 条曲线。

## 本地校验

| 检查 | 级别 | 处理 |
|---|---|---|
| `lut` 扩展名不是 `.cube` | error | LUT 行红框；阻止推送 |
| `lut` 路径越界 | block | 拒绝提交 |
| `lut` 不在资源列表 | warn | 显示“未找到”；不阻止保存 |
| `lut_input_gamma<=0` | block | 拒绝提交 |
| `lut_strength` 越界 | block | 拒绝提交 |
| `blend_mode` 非法 | block | 拒绝提交 |
| `blend_amount` 越界 | block | 拒绝提交 |
| 同脚本多条 ADJUST 轨 | warn | 片段头覆盖提示 |
| 同轨重叠 | warn | 后片段不参与调色 |
| 无 LUT 但有强度/gamma | info | 显示“不生效，值保留” |
| LUT 解析/烘焙失败 | 游戏运行时 | 编辑器不伪造；只在缺失/扩展名层提示 |

## 验收标准

1. `ADJUST` 属性面板出现 LUT 定义组和层级混合组；`CAMERA` 不出现。
2. 选择 `lut/teal_orange.cube`：写入相对路径，资源列表命中；选择 `.png` 显示扩展名错误。
3. 手动输入 `../x.cube`：路径越界，拒绝提交。
4. `lut` 为空：强度和 gamma 显示“不生效”但保留值；选 LUT 后恢复可用。
5. `lut_input_gamma=0`：红框拒绝；输入 1.8 可提交。
6. `lut_strength` 开时钟：属性面板值控件消失，效果面板出现；删最后一帧回流。
7. `blend_mode` 选 `screen`：写入枚举；非法值不写入。
8. `blend_amount=0.5`：属性行显示 0.5；开时钟后效果面板出现。
9. 同脚本两条 ADJUST 轨：片段头显示“后发布轨覆盖前轨”；不显示“叠加”文案。
10. 不同脚本实例：提示“不同实例各占一层”；不把同脚本多轨当层。
11. 同轨两个 ADJUST 片段重叠：后片段显示“不参与调色”；拆到新轨后按轨顺序发布。
12. 保存重开：`lut`、gamma、强度、模式、混合量原样恢复；LUT 路径不变成绝对路径。
