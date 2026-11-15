# 07-11 07 验收

## 目标

按可观察结果验收 07：组合编辑、位置/朝向、路径集合、11 种几何、圆形生成器、timing、6 个 `motion_*`、11 种本地预览，以及固定格式写盘。

验收以编辑器行为 + 脚本 JSON + 游戏画面为准；不以“文档写了”作为通过条件。

## A. 组合编辑

| # | 操作 | 通过条件 |
|---|---|---|
| A1 | 选 CAMERA 片段，`position.xyz` 在 `t=2.350` 点“同一时刻建帧” | `position.x/y/z` 各一条 `time=2.350` 的独立关键帧；JSON 无组对象 |
| A2 | 批量改值为 `(1,2,3)` | 三条帧值正确；一次撤销全回退 |
| A3 | `position.x` 已有帧、y/z 无帧，点“抓取当前值” | x 不覆盖；y/z 各建一帧；弹层计数正确 |
| A4 | 删除组合在该时刻的帧 | 三条都删；删到最后一帧的叶子 `keyframes=[]`；撤销恢复 |
| A5 | `t=3` 把 `position_space` 改 `base`，组合只建 x 帧 | 弹“补齐三轴”；补齐后 `script.validate` 通过；取消文档不变 |
| A6 | `authoring-groups.json` 给 `position.xyz` 加 `position_mode` | 重启后成员出现；建帧时提示 step 对齐；无内核代码改动 |
| A7 | 自定义组合勾 `yaw/pitch/roll/orient` | orient 行只静态值；三角度批量正常 |
| A8 | 保存重开 | 脚本无 `authoring`/`groupId`；帧值时间不变；自定义组合消失、默认组合恢复 |
| A9 | 组合弹层打开时开关动画 | 成员跨属性/效果面板迁移；弹层不关、不重复值控件、计数正确 |
| A10 | `serializeDoc` 输出 | `grep authoring.groups` 0；`grep groupId` 0 |

## B. 位置组

| # | 操作 | 通过条件 |
|---|---|---|
| B1 | `relative + world + 原点空` | 三轴可见；`facing_*` 隐藏；保存通过 |
| B2 | 切 `absolute` | `position_space` 锁 `world`；原点禁用；已有原点显示忽略；清除后保存通过 |
| B3 | `relative + base + @p + facing_source=entity` | `facing_entity` 显示；保存通过 |
| B4 | `position_origin=coordinate` + `(10,64,-5)` | origin x/y/z 可编辑；空值占位 0；运行时位置正确 |
| B5 | `t=3` world→base，三轴都有帧 | 直接提交；`script.validate` 通过 |
| B6 | 同操作缺 `position.z@3` | 弹窗列 z；补齐后三轴有帧；一次撤销全回退 |
| B7 | `t=0` 改 `position_mode=absolute` | 不要求三轴帧；保存通过 |
| B8 | `relative + world` 已有 `facing_source=entity` | 显示“不读取”；校验报已忽略；不静默删字段 |
| B9 | 属性面板给 `position.y` 开时钟 | y 进效果面板；x/z 留属性面板；组头计数正确 |
| B10 | 效果面板关 `position.x` 动画 | x 回属性面板；计数减一；撤销恢复 |
| B11 | 主时间轴 | 无位置行、三轴节点、路径端点 |

## C. 朝向组

| # | 操作 | 通过条件 |
|---|---|---|
| C1 | `look_at=none`、`orient=manual`、`yaw_base=world` | yaw/pitch/roll 可编辑；偏移禁用；保存通过 |
| C2 | `look_at=entity` 目标可解析 | yaw/pitch、锁、基准禁用；roll 可编辑；朝向指向实体 |
| C3 | `look_at=entity` 查不到实体 | 显示回退 tangent/manual；不把角度改 0 |
| C4 | `orient=tangent` 有路径 | yaw/pitch 由切线算；偏移叠加 |
| C5 | `orient=manual` 且 yaw_offset 有帧 | 行显示依赖不满足；运行时不读取；切 tangent 恢复 |
| C6 | `yaw_base=entity`、`pitch_base=world` | selector 显示；yaw 用实体，pitch 用 world 0 |
| C7 | `pitch_base=entity`、`yaw_base=world` | selector 仍显示，服务 pitch |
| C8 | `yaw_base=line` 端点 | 显示 from/to；freeze 仅选择器端点可用 |
| C9 | 线端点重合/水平退化 | 角度回退 0；`warn`；不抛异常 |
| C10 | `yaw_lock=90`、`yaw=15`、`yaw_base=entity` | 结果 105；`yaw_lock=null` 用实体基准 |
| C11 | `yaw=720`、`pitch=-540` | 原样写入，不归一化 |
| C12 | `look_at=coordinate` + structure | 坐标字段禁用；清空 structure 恢复 |
| C13 | `look_at_freeze` 在 `look_at=player/coordinate/block` | 控件禁用；已有值 warn；只在 entity 读取 |
| C14 | 属性/效果面板 | `orient` 只在属性；`yaw/pitch/roll` 有帧进效果；不出现“朝向全字段组” |

## D. 路径集合

| # | 操作 | 通过条件 |
|---|---|---|
| D1 | 新建路径 `shot_a 0→3` | `paths[0]` 字段完整；默认 id `p_1`；axes 三轴；geometry line |
| D2 | 目标片段无 id | 新建禁用；设置 id 后可用 |
| D3 | 片段只有 1 个位置节点 | 新建禁用；已有路径提示节点不足 |
| D4 | 端点下拉 | 只有节点时间；手输/粘贴数字不进入 from/to |
| D5 | 同片段 `0→3` 重复 | 第二条 block；改 `1→4` 可保存；重叠徽标 |
| D6 | 路径区间插入 `t=1.5` 位置帧 | 默认阻止；选“删除路径并继续”后帧插入、路径消失；撤销恢复 |
| D7 | 删除端点 `t=3` | 路径阻止；选“删除路径并继续”后两者一起删 |
| D8 | 片段改名 `shot_a→shot_b` | 路径 clip 同步；路径 id 不变 |
| D9 | 删除目标片段 | 路径引用阻止；删路径后可删片段 |
| D10 | 只勾 `x,z` | 预览只覆盖 x/z；y 用普通位置；保存 axes 正确 |
| D11 | axes 全不勾 | 添加禁用；已有条目 block |
| D12 | 非法 geometry | 本地 block；字段错误展开；修好保存 |
| D13 | 面板关闭再开 | 草稿和 `pathId` 恢复；未提交改动不落盘 |
| D14 | 面板 slot | 默认 `document.drawer`；可拖到其他 slot；不在 `clip.effects` |
| D15 | 主时间轴 | 无路径行、端点、覆盖条 |

## E. 几何

| # | 操作 | 通过条件 |
|---|---|---|
| E1 | 类型下拉 | 11 种 + line 别名；line 只写 type |
| E2 | bezier 控制点 | 恰好 2；多少都 block |
| E3 | rational_bezier | 控制点 1~2；weights 同长度；少一项 block |
| E4 | arc | 参数齐全；end=start block；|Δ|>360 block；法向/参考轴平行 block |
| E5 | ellipse | 半轴 <=0 block；rotation 0 正常；角度跨 0 正常 |
| E6 | bspline | degree 1~总点数-1；knots 长度匹配；空 knots 保存 |
| E7 | nurbs | weights 数量匹配；knots 匹配；空 knots 保存 |
| E8 | catmull_rom | 三种参数化；tension 0~1；endpoint mirror/clamp |
| E9 | hermite | 切线恰好 2；相对/绝对混写 block |
| E10 | clothoid | length>0；锚点 START；to 只绑定 |
| E11 | fourier | period>0；cos/sin 等长；periodic=false 时 a0 零 |
| E12 | 切换类型 | 旧参数清空；确认；撤销恢复 |
| E13 | 未知 type/参数 | 本地 block；显示字段路径 |
| E14 | POINT | x/y/z 或 dx/dy/dz 二选一；混写 block |
| E15 | 锚点 | FREE/START/ENDPOINTS 徽标正确；FREE 端点偏差可见 |
| E16 | 保存重开 | 11 种参数原样；line 仍 line；不自动补参数 |

## F. 圆形生成器

| # | 操作 | 通过条件 |
|---|---|---|
| F1 | 半径 4、0→90、逆时针、Bezier | 1 条 bezier；控制点长度约 0.5523*4；端点落圆上 |
| F2 | 0→360、Bezier 自动 | 4 段；闭合；径向误差 <= 0.1%*4；端点相邻 |
| F3 | 0→360、精确 | 1 条 arc；center 相对 from；radius 4；0→360；validate 通过 |
| F4 | 顺时针 0→360 | delta=-360；Bezier 反向；精确 arc 顺时针 |
| F5 | 3D 平面 normal=(0,0,1) | 半圆；y 恒定；x/z 正确 |
| F6 | replace-range 全圆 | 旧位置键删除；4 边界三轴键；4 路径 |
| F7 | existing-nodes `0,1,2,3` | 3 条路径；节点时间不改；分段角度正确 |
| F8 | 区间内其他路径引用 | impactedPaths 列出；取消不变；删除后生成继续 |
| F9 | 重新生成同范围 | diff 替换 4 条；旧 ID 不存在；新 ID 唯一；撤销恢复 |
| F10 | 半径/半轴 0、角相等、|Δ|>360、法向平行 | 本地 block；生成禁用 |
| F11 | relative+world + coordinate | 世界圆心减原点；片段坐标正确 |
| F12 | relative+base | 按 fwd/up/right 输入；三轴键是局部分量 |
| F13 | 精确模式移动 from 端点 | 形状不变；偏差出现；重算端点可拉回 |
| F14 | 应用后 validate | 通过；模组 `.java` 0 改动；无新 API |
| F15 | 一次撤销 | 键、路径、ID、选择、diff 全回退 |

## G. Timing

| # | 操作 | 通过条件 |
|---|---|---|
| G1 | 新路径默认 | timing 省略/linear；s(t) 对角线 |
| G2 | 切 keyframes | 自动 (0,0)/(1,1)；保存两点 |
| G3 | 添加中间点 | 默认中点；可改；按 t 排序 |
| G4 | 首项 t=.1 / 末项 s=.9 | block；首末不可删 |
| G5 | t 递减 / s 递减 | block；字段定位 |
| G6 | 相同 t / 相同 s | 允许；竖线/水平线；运行跳变/暂停 |
| G7 | 中间 s=0/1 | 允许；路径停住/到终点 |
| G8 | keyframes→linear | 确认移除 points；撤销恢复 |
| G9 | linear→keyframes | 自动首末；中间空；保存通过 |
| G10 | 256 上限 | 第 257 拒绝；256 可保存/滚动 |
| G11 | 改 from/to | timing 点不变；t 重新归一化；s(t) 形状不变 |
| G12 | 切 geometry | timing 保留；validate 通过 |
| G13 | 几何形状 | timing 改变不改变控制点/半径/角度 |

## H. 数学模型

| # | 操作 | 通过条件 |
|---|---|---|
| H1 | 6 个 `motion_*` 默认 | 属性面板“未设置”；无时钟；效果面板 0 行 |
| H2 | motion_yaw spring | 摘要正确；JSON 正确 |
| H3 | motion_position chain | 摘要正确；嵌套数组正确 |
| H4 | motion_roll blend | a/b 可编辑；weight 0~1；越界 block |
| H5 | motion_fov linear | `{type:'linear'}`；摘要 linear |
| H6 | motion_zoom cubic_bezier | 四参数默认；越界 block |
| H7 | chain 3 层嵌套 | 深度/节点计数正确；第 9 层 block |
| H8 | 节点总数 33 | 应用禁用；显示超限路径 |
| H9 | chain 空 / blend 缺分支 | block |
| H10 | 未知类型 | warn“实际 linear”；不自动改写；可转 linear |
| H11 | 未知参数 | warn；保留；可清理 |
| H12 | tau=-1/stiffness=0/damping=-1 | 字段 block |
| H13 | 值域不匹配 | warn；不 block |
| H14 | 重置 linear | 撤销恢复旧树 |
| H15 | 关闭/重开侧面板 | 草稿恢复；未提交不落盘 |
| H16 | 效果面板/主时间轴 | `motion_*` 0 行/0 控件 |
| H17 | 保存重开 | 模型树/参数/未知字段原样；无默认补写/authoring |

## I. 预览

| # | 操作 | 通过条件 |
|---|---|---|
| I1 | linear | 直线；端点；无控制多边形；s(t) 对角线 |
| I2 | bezier | 曲线 + 2 控制点 + 虚线多边形；端点等于 from/to |
| I3 | rational_bezier | 权重改形状；数量匹配 |
| I4 | arc 半圆 | 采样落圆；0/.5/1 与 fixture 一致；偏差可见 |
| I5 | ellipse | 半轴/旋转正确；0/90/180 坐标正确 |
| I6 | bspline/nurbs | de Boor 与 fixture 一致；nurbs 权重有效 |
| I7 | catmull_rom | 三参数化形状不同；tension 边界可画 |
| I8 | hermite | 两端切线正确；长度改变形状 |
| I9 | clothoid | 0→0 直线；非零曲率渐变；fixture 通过 |
| I10 | fourier | 周期 u=0/1 同点；非周期端点参与 |
| I11 | 11 fixtures | 全部通过；超差构建失败并显示类型/点 |
| I12 | FREE 端点移动 | 形状不变；偏差更新；虚线连接 |
| I13 | START | 起点锚定；to 只绑定；移动 to 不改形状 |
| I14 | axes x,z / x / 三轴 | 投影/单轴图/2D 投影提示正确 |
| I15 | 未知类型 | 不画；错误卡片；修好恢复 |
| I16 | 100 路径列表 | 只预览选中；参数拖动可用；无全量重算卡顿 |
| I17 | 生成器 Bezier 圆 | 4 段闭合；误差 <=0.1%*r；精确模式单弧 |
| I18 | 游戏检查 | 调现有 pushScript/seek；WebEditorApi 无新增消息 |

## J. 保存、性能、代码护栏

| # | 检查 | 通过条件 |
|---|---|---|
| J1 | 保存/重开 | `paths[]`、objects、timing、models 原样；无 authoring/UI 状态 |
| J2 | 推送/导出 | 输出同一份固定格式；不补默认、不烘焙 |
| J3 | 撤销 | 200 步上限；生成/组合/路径编辑一次撤销全回退；失败回滚 |
| J4 | 100 条路径列表 | 虚拟化/筛选可用；滚动无明显卡顿 |
| J5 | 100+ 属性行 | 虚拟化；宽 280~560；不画第二轴 |
| J6 | `npm run build` | 通过；无未使用模块 import |
| J7 | WebEditorApi 消息清单 | 无新增消息；预览/生成/组合均在编辑器侧完成 |
| J8 | 路径/位置/朝向数据源 | 只读 `objects` / `paths`；不读片段级曲线字段 |
| J9 | `grep motion_position` 效果面板 | 0 命中；`motion_*` 只在属性/侧面板 |
| J10 | 面板状态 | 新路径/位置/预览模块不读面板 tab 状态 |
| J11 | 模组仓库 | `git diff -- '*.java'` 0；不改 TrackSchemas/ObjectValidator/PathCurveRegistry/PathEvaluator/WebEditorApi |
| J12 | 文档 | 07 12 个文件；README 链接可达；每份单 H1；代码围栏闭合；无 `TODO`/`TBD` 占位 |

## K. 真游戏冒烟

构造一份 CAMERA 脚本：

- 片段 A：`position.xyz` 从 `(0,64,0)` 到 `(10,64,0)`，中间 `t=1.5`。
- 片段 A：圆形生成器，半径 4，`0→360`，精确模式。
- 片段 A：`paths[]` 覆盖 x/z；timing `0→1` 线性。
- 片段 B：Bezier 圆，4 段，验证分段接缝。
- 片段 B：`motion_position` chain(spring → linear)。

通过条件：

1. `script.validate` 无 block/error。
2. `editor.pushScript` 成功；游戏内相机沿圆周运动。
3. `editor.seek` 到 `from/to/中间时刻`，位置连续；接缝无跳变。
4. 调 `timing` 关键帧后，路径暂停/跳变可见；几何形状不变。
5. 组合建帧后，游戏内三轴同时到达目标；没有运行时组行为。
6. 保存退出再进入，脚本与预览一致；没有 `authoring`/临时 ID 残留。
7. 模组日志无 `PathCurveException` / `ScriptParseException`。

## 完成定义

07 完成 = A~K 全部通过，且：

- 位置/朝向/路径/几何/timing/模型/预览在编辑器内闭环。
- 组合编辑、圆形生成器、11 种预览都在编辑器侧实现。
- 写盘只有现有 `objects` / `paths` 固定格式。
- 模组代码零改动。
- 属性面板/效果面板/路径面板/主时间轴职责与 05/06 一致。
