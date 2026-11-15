# 08-01 CAMERA 字段面

## 目标

把 CAMERA 轨道除位置/朝向/路径之外的镜头字段接进 06 的属性面板与效果面板：`fov/zoom`、合成矩形与遮罩、调色通道与曲线、手持呼吸、覆盖链修饰符、选择器策略。字段集合来自 02 目录，行控件复用 06；08 只补特殊字段编辑器，不另开一套检查器。`transition*` 是参数过渡字段，不在这套字段检查器里；它和叠化一起归 08-03 的独立转场面板。

## 字段分组

| section | 字段 | 形态 | 面板 | 编辑方式 |
|---|---|---|---|---|
| `camera` | `fov`、`zoom` | `ANIMATED` float | 属性面板；有帧进效果面板 | 数值；`zoom` 标“几何插值” |
| `composite` | `opacity` | `ANIMATED` float | 属性面板；有帧进效果面板 | 0–1 数值 + 百分比显示 |
| `composite` | `dest.x/y/w/h`、`source.x/y/w/h` | `ANIMATED` float | 属性面板；有帧进效果面板 | 归一化矩形；四位数；越界只提示 |
| `composite` | `mask_x/y`、`mask_width`、`mask_height`、`mask_radius` | `ANIMATED` float | 属性面板；有帧进效果面板 | 遮罩几何；按 `mask_shape` 门禁 |
| `composite` | `mask_shape` | `VALUE` enum | 属性面板 | `full / rect / circle` |
| `composite` | `dimension` | `VALUE` string | 属性面板 | 空 = 当前维度；非空显示跨维度徽标 |
| `color` | 57 个调色通道 | `ANIMATED` float | 属性面板；有帧进效果面板 | 06 数值行；min/max 来自 02 |
| `color` | 10 条调色曲线 | `VALUE` struct | 属性面板 | `ColorCurveSheet` 控制点表 |
| `breath` | `cam_breath_enabled` / `intensity` / `seed` / `type` / `speed` / `trauma` / `decay` | `VALUE` | 属性面板 | 开关/数值/枚举；没有时钟 |
| `transition` | `transition` / `transition_duration` / `transition_curve` / `transition_params` / `transition_interrupt` | `VALUE` | `transition.panel` 的参数过渡详情 | 是六通道参数过渡，不是叠化；片段属性面板不出现该组；见 08-02 / 08-03 |
| 叠化 / crossfade | `clips[B].start_time` + `B.composite.opacity` | 片段落点 + `ANIMATED` float | `transition.panel` 的叠化详情 | A 不动、B 前移 D、重叠 D；不是片段属性；不新增字段；见 08-02 / 08-03 |
| `modifier` | `modifier`、`suppress_modifiers` | `VALUE` struct / bool | 属性面板 | `CameraModifierField` |
| `selector` | 6 个通用字段 + 7 个调用点 × 6 | `ANIMATED` | 属性面板；有帧进效果面板 | 通用行 + 调用点覆盖行 |

位置、朝向、`motion_*` 由 07 的行承担；08 不复制对应字段，也不改变 07 的面板归属。

## 面板路由

```text
selection.properties
  CameraFieldRouter
    CameraGroupHeader(section)
      CameraPropertyRow(path)
        PropertyValueForm           普通值
        AnimationClock              ANIMATED 叶子
        CameraCompositeFields       dest/source 组
        CameraMaskFields            mask 组
        CameraBreathFields          breath 组
        CameraModifierField         modifier
        CameraSelectorGroup         selector
        ColorCurveField             10 条曲线
      CameraPropertyRow(motion_*)   07 的 MotionModelRow

transition.panel
  TransitionPanel                   08-03 外壳
    TransitionBoundaryList          交界列表
    TransitionBoundaryDetail
      CrossfadeDetail               叠化
      CameraMorphDetail             参数过渡六通道表
      CoexistDetail                 共存/遮蔽

clip.effects
  ClipEffectsPanel                  06 外壳
    EffectControlGroup(section)
      AnimatedPropertyRow(path)
        PropertyValueForm           节点值
        EffectKeyframeGroup         该叶子节点
```

- 属性面板按 `section` 顺序：`camera` → `composite` → `color` → `breath` → `modifier` → `selector`；07 的 `position` / `orientation` / `motion` 保持自己的组顺序。`transition` 不在属性面板的 section 顺序里。
- 效果面板只显示有 `keyframes.length > 0` 的叶子；`transition*`、`mask_shape`、`dimension`、`cam_breath_*`、`modifier`、调色曲线、叠化布局永远不进入效果面板。叠化写入的 `composite.opacity` 是普通叶子，有帧时按 06 进入效果面板。
- 组只是 02 `section/group` 的 UI 归类；不创建运行时效果实例，不写组帧。
- `CameraFieldRouter` 按字段路径选择特殊编辑器；普通字段没有分支，不维护第二份显隐表。`transition*` 路由到 `transition.panel`，不在 `CameraFieldRouter` 里出现。

## 转场归属

CAMERA 片段里和“转场”有关的现存字段只有一组：`transition` / `transition_duration` / `transition_curve` / `transition_params` / `transition_interrupt`。它们描述 **相机六参数过渡**，不描述画面叠化。

- `transition*` 不进入 `selection.properties`，也不进入 `clip.effects`；只在 `transition.panel` 的参数过渡详情里出现。
- 叠化没有字段；它由 `clips[B].start_time` 与 `B.composite.opacity` 两端帧表达，编辑入口同样在 `transition.panel` 的叠化详情。
- `B.composite.opacity` 本身仍是普通 `composite` 字段：有帧时在 `clip.effects` 出现；它的归属不改，转场面板只是写入它的两端帧。
- `transition.panel` 以 A→B 交界为对象，不是“选中 A 片段后出现的属性组”；片段属性面板中没有转场组。
- 主时间轴不新增转场节点、转场轨或交界手柄；转场编辑与时间轴编排分离。

## 合成矩形

`dest` / `source` 是窗口归一化矩形：

- `x/y` 左上角，`w/h` 宽高；缺省 `dest=(0,0,1,1)`、`source=(0,0,1,1)`。
- 输入框显示四位小数；右侧可切百分比显示，写盘仍是 0–1 归一化值。
- 值超出 0–1 只给 warning，不自动夹；`w/h` 为负只给 warning，交给运行时决定最终裁切。
- 四行一组，带一个小矩形示意图；示意图只画当前数值，不采样画面。
- 动画帧与普通帧使用同一值控件；效果面板中每行仍是独立关键帧组。

## 遮罩

`mask_shape` 决定哪些遮罩几何参与：

| `mask_shape` | 启用行 | 说明 |
|---|---|---|
| `full` | 无 | 整幅 lane；遮罩几何保留但不参与 |
| `rect` | `mask_x`、`mask_y`、`mask_width`、`mask_height` | 中心为窗口比例；宽高非负 |
| `circle` | `mask_x`、`mask_y`、`mask_radius` | 半径为窗口短边比例；非负 |

- 切到 `full` 时遮罩几何行折叠为“保留值”，不删除已有帧。
- `mask_x/y` 缺省 `0.5`；`mask_width/height` 缺省 `1`；`mask_radius` 缺省 `0.5`。
- 遮罩几何独立于 `source/dest`；不因为 source 改变而自动缩放。
- 属性面板显示一个归一化遮罩示意；不画最终像素，最终像素来自游戏画面。

## 调色通道

- 57 个通道全部来自 02 `section=color`；行顺序按 02 目录，不手写列表。
- 每个通道是 `ANIMATED` float；min/max 来自 02；值控件沿用 06。
- 调色属于该片段产出的 lane；在 lane 合成前生效；不写 ADJUST 轨道。
- lane 面板只显示“调色来自哪个片段”，不复制 57 行。

## 调色曲线

10 条曲线都是 `VALUE` + `STRUCT`：

```text
rgb_curve / r_curve / g_curve / b_curve
hv_h_curve / hv_s_curve / hv_l_curve
lv_s_curve / sv_s_curve / sv_l_curve
```

数据形态是控制点数组：

```json
{
  "rgb_curve": {
    "value": [[0, 0], [0.25, 0.18], [0.5, 0.55], [1, 1]]
  }
}
```

`ColorCurveSheet`：

```text
┌ 调色曲线：rgb_curve ───────────────────────────────┐
│ 控制点                                            │
│   x [0.000]  y [0.000]  [×]                       │
│   x [0.250]  y [0.180]  [×]                       │
│   [+ 添加控制点]                                  │
│ 曲线示意（0→1，PCHIP）                            │
│ [清空曲线] [应用]                                 │
└───────────────────────────────────────────────────┘
```

- 至少 2 个点；`x` 严格递增；`x/y` 各 0–1。
- 点表可增删、上下移动；`x` 冲突只给字段错误，不自动改序。
- 曲线示意按 PCHIP 采样；只读，不写 LUT 文件。
- “清空曲线”删除该 `objects` 路径；一次撤销恢复。
- 未知键/多余字段原样保留，不静默删除。
- 所有曲线行共用同一个 `ColorCurveSheet`；不按曲线名复制表单。

## 手持呼吸

7 个字段都是 `VALUE`：

| 字段 | 类型 | 缺省 | UI |
|---|---|---|---|
| `cam_breath_enabled` | bool | false | 开关 |
| `cam_breath_intensity` | float | 0.05 | 数值 |
| `cam_breath_seed` | int | 0 | 整数 |
| `cam_breath_type` | enum | `perlin` | `perlin / perlin_axis / sine / trauma` |
| `cam_breath_speed` | float | 1 | 数值 |
| `cam_breath_trauma` | float | 1 | 数值 |
| `cam_breath_decay` | float | 0.5 | 数值 |

- 七行在属性面板 `breath` 组；没有时钟、没有效果面板入口。
- `enabled=false` 时其余行折叠，但保留值；打开开关恢复上一组值。
- `trauma` 与 `type=trauma` 的关系只在行内提示，不自动改类型。

## 覆盖链修饰符

`modifier` 是单个 `VALUE` 对象，结构如下：

```json
{
  "channels": ["position", "yaw"],
  "mode": "add",
  "priority": 0,
  "position": { "x": 0, "y": 0, "z": 0 },
  "yaw": 15
}
```

- `channels` 至少一个、六通道名子集、不重复。
- `mode` 缺省 = 逐通道缺省：`position/yaw/pitch/roll` 为 `add`，`fov/zoom` 为 `multiply`；显式可选 `add / multiply / replace`。
- `priority` 整数，缺省 0；升序应用，同值先注册者先。
- 声明了 `channels` 的通道必须有值；`position` 必须是 `{x,y,z}` 三个有限数。
- 未声明通道不允许出现值键；出现只在本地 block。
- `suppress_modifiers` 是片段级 bool；打开时本片段胜出 Base 后跳过 Modifier 链。
- UI 是 `channels` 多选 + `mode` 三态（含“逐通道缺省”）+ `priority` + 已选通道的值行；未选通道不显示值行。
- 一个 `modifier` 的修改一次 `commit`；不拆成逐字段命令。

## 选择器

通用 6 字段：

```text
selector_refresh              float  step  1
selector_switch_while_alive   bool   step  true
selector_switch_interval     float  step  1
selector_switch_smooth       float  step  0
selector_anchor              enum   step  camera / player / target / origin
selector_pick                enum   step  first / nearest / alive
```

调用点覆盖 7 组：

```text
position_origin / look_at / yaw_base / yaw_base_from / yaw_base_to
facing_target / facing_entity
```

每组 6 个 `selector_<field>_<callpoint>` 字段，缺省 `null`。

- 属性面板先显示通用 6 行，再显示 7 个调用点折叠组；调用点组只在相关点源/朝向分支出现。
- 覆盖值为 `null` 显示“继承通用”；编辑后写显式值；清除写回 `null`。
- 调用点字段名从 02 路径派生：`selector_` 前缀 + 通用字段 + `_` + 调用点名；不维护第二份调用点表。
- 这些是 `ANIMATED` step 字段；有帧时进入效果面板，节点横轴沿用 06。
- 选择器只影响运行时选实体/点；不改变 lane 顺序、不改变覆盖链。

## 组件

```text
src/camera/fieldSurface.ts              section 顺序、特殊路径路由、遮罩门禁
src/camera/compositeDoc.ts              归一化矩形/遮罩值转换
src/camera/colorCurveDoc.ts             控制点数组/校验/PCHIP 采样
src/camera/selectorCatalog.ts           从 02 路径派生通用+调用点字段
src/components/camera/
  CameraFieldRouter.vue
  CameraCompositeFields.vue
  CameraMaskFields.vue
  CameraBreathFields.vue
  CameraModifierField.vue
  CameraSelectorGroup.vue
  ColorCurveField.vue
  ColorCurveSheet.vue
```

- `CameraFieldRouter` 只认路径和 02 `mode/type`；不读文档 store。
- `ColorCurveSheet` 从属性面板行打开，宽度 420–560；不新建 layout panel。
- `CameraModifierField` 的通道列表来自 `CameraChannels` 的编辑器侧冻结配置，顺序固定六通道。
- 所有写入走 03 `EditorCommand`；一次应用一次 `commit`。

## 验收

1. 选中 CAMERA 片段，属性面板按 `camera/composite/color/breath/modifier/selector` 顺序显示全部适用行；没有 `transition` 组，也没有任何转场组/叠化组；位置/朝向/`motion_*` 仍由 07 显示。
2. `fov=70`、`zoom=1` 静态值可改；给 `fov` 打帧后，`fov` 行进效果面板，属性面板只留未打帧行。
3. `dest.x/y/w/h` 与 `source.x/y/w/h` 写 0–1 值；百分比显示只改显示，不改写盘值；越界给 warning。
4. `mask_shape=full` 时遮罩几何行折叠；切 `rect` 启用宽高；切 `circle` 启用半径；切回 `full` 不删除已有帧。
5. 57 个调色通道按 02 顺序出现；给 `color.r` 打帧后进入效果面板；调色行不复制到 lane 面板。
6. 10 条曲线分别打开 `ColorCurveSheet`；`[[0,0],[1,1]]` 保存为两个点；少于 2 点、x 非递增、x/y 越界都 block。
7. `cam_breath_enabled=true` 后 7 个字段可编辑；关闭后值保留；属性面板没有呼吸时钟。
8. `modifier` 选 `channels=[position,yaw]`：出现 position 三轴与 yaw 值行；未选通道不出现值键；缺 position 的 z 轴 block。
9. `selector` 通用 6 行可编辑；`look_at` 覆盖组出现在对应分支；覆盖 `null` 显示“继承通用”，清除后回到 `null`。
10. 效果面板没有 `transition`、叠化布局、`mask_shape`、`dimension`、`cam_breath_*`、`modifier`、调色曲线行；`grep` 这些路径在效果面板组件 0 命中；片段属性面板同样 0 命中 `transition*`。
11. 保存重开：所有字段值/关键帧/调色曲线控制点/未知键原样保留；没有 UI 字段写盘。
12. `script.validate` 通过；主时间轴没有新增 lane 轨或字段节点。
13. 打开 `transition.panel`，能编辑 `transition*` 和叠化；关闭面板后片段属性面板仍不出现这些字段；两处不重复渲染。
