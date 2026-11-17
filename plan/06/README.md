# 06 异步对象与片段双面板

## 目标

把 05 挂在 `document` 页的两个宿主分成两种职责：

- `selection.properties` → **属性面板**：当前片段的全部可编辑属性，按效果组排列；静态值、未设置值、片段基础参数都在这里。
- `clip.effects` → **效果面板**：只列已经有关键帧的属性/效果组；每行右侧是该属性自己的关键帧组。
- 主时间轴仍只编排轨道和片段，不显示组、叶子、节点或汇总菱形。

效果面板不是“添加属性”的选择器。属性本身在属性面板里；某属性第一次出现关键帧后才进入效果面板，关键帧删空后回到属性面板。

## 交付物

| 文档 | 交付内容 |
|---|---|
| [06-01-clip-effects-shell](06-01-clip-effects-shell.md) | 效果面板外壳、片段头、工具栏、标尺、空态、面板接线 |
| [06-02-effect-groups-and-rows](06-02-effect-groups-and-rows.md) | 已有关键帧的组与行、组内动画叶子、移除动画、无添加器 |
| [06-03-value-controls](06-03-value-controls.md) | 九种值控件、静态/节点/首帧目标、step/null/enum/ref/struct |
| [06-04-keyframe-groups](06-04-keyframe-groups.md) | 每叶子一个关键帧组、共享局部标尺、节点几何、轴外与事件样式 |
| [06-05-keyframe-edit-ops](06-05-keyframe-edit-ops.md) | 增删移值、拖动、复制粘贴、多选、吸附、原子撤销、面板迁移 |
| [06-06-easing-and-bake](06-06-easing-and-bake.md) | 属性段缓动、试听、显式烘焙、保存前未烘焙提示 |
| [06-07-event-records](06-07-event-records.md) | EVENT/MOD_EVENT 记录列表与字段编辑、非空约束、白名单校验 |
| [06-08-local-viewport-and-out-of-range](06-08-local-viewport-and-out-of-range.md) | 效果面板局部视口、缩放/平移/适配、轴外、无限片段、虚拟化 |
| [06-09-clip-properties-panel](06-09-clip-properties-panel.md) | 属性面板：全部适用组/叶子、静态值、未设置行、时钟、片段摘要 |
| [06-10-object-diagnostics](06-10-object-diagnostics.md) | 对象/节点 issue、行角标、缺失叶子、未知路径、双面板 reveal |
| [06-11-r6-acceptance](06-11-r6-acceptance.md) | 双面板、性能、保存重开、整帧路径移除、验收矩阵 |
| [06-12-architecture-cleanup](06-12-architecture-cleanup.md) | 架构整理：按层分（core / features / plugins），拆胖控制器，跨轮基础设施落位 |

## 面板职责

### 属性面板 `selection.properties`

```text
ClipPropertiesPanel
  ClipPropertiesHeader        片段名 / ID / 轨道 / 起止 / 时长 / 循环
  ClipPropertiesToolbar       搜索、只看未设置、折叠
  ClipPropertyGroup           全部适用效果组
    ClipPropertyRow           组内全部适用叶子
      PropertyValueForm       静态值 / 未设置值
      AnimationClock          开动画 → 建首帧 → 移入效果面板
```

- 列出当前片段全部适用组和叶子，不按“是否出现”过滤。
- 未设置叶子显示“未设置”，编辑时显式创建 `clip.objects[path]`。
- `VALUE` / `STRUCT` 叶子只有值控件；`ANIMATED` 叶子有时钟；`EVENT` 叶子显示“记录”入口。
- 没有关键帧组、没有局部节点轴、没有“添加属性”弹层。
- 100+ 叶子纵向虚拟化；组头吸顶。

### 效果面板 `clip.effects`

```text
ClipEffectsPanel
  EffectControlsHeader        片段名 / 轨道 / 身份 / 时长 / 校验徽标
  EffectControlsToolbar       搜索、只看轴外、适配片段、适配全部节点
  EffectControlsRuler         局部秒、播放头、缩放
  EffectGroupList
    EffectControlGroup        已有关键帧的组
      AnimatedPropertyRow     已有关键帧的叶子
        PropertyValueForm     当前节点值
        EffectKeyframeGroup   该叶子自己的节点组
```

- 只列“已经有关键帧”的属性/组；没有关键帧的属性不进来。
- 默认 `leaf` 模式：没有“添加属性”选择器，没有未设置行，没有静态 `VALUE` / `STRUCT` 行；`group` 模式静态伴随行有明确标识。
- 组内只列当前在效果面板的叶子；每行都有非空 `keyframes[]`。
- 空态：`该片段还没有关键帧动画。在属性面板打开时钟后，这里显示对应属性。`
- 一个属性从效果面板移出时，保留最后值作为静态 `value`；不删作者数据。

## 层级策略

`src/effects/panelMembership.ts` 冻结一个策略：

```ts
type PanelMembershipMode = 'leaf' | 'group'

interface PanelMembership {
  mode: PanelMembershipMode
  isRowInEffect(row: PropertyRow): boolean
  isGroupInEffect(group: EffectGroup): boolean
  partition(groups: EffectGroup[]): {
    effectGroups: EffectGroup[]
    propertyGroups: EffectGroup[]
  }
}
```

- `leaf`（默认）：`row.keyframes.length > 0` 的叶子进效果面板；其余叶子留属性面板。同一个组可以同时出现在两个面板，各显示自己的叶子。
- `group`：组内任一叶子有关键帧，整个组进效果面板；组内无帧叶子作为静态行一起显示。属性面板只留没有关键帧的组。
- 两种模式共用同一文档模型、同一命令、同一值控件；切换只改 `panelMembership` 一处。
- 面板行由 `partition` 派生；不复制对象、不写 UI 字段。

## 行与出现规则

1. `present = clip.objects` 显式存在该路径；静态值、等于默认值的显式值、空 `keyframes: []` 都算出现。
2. 属性面板的行集合 = 当前轨道全部适用叶子，包括 `present=false`。
3. 效果面板的行集合 = `panelMembership.isRowInEffect(row)` 为真的叶子；`leaf` 模式下这些叶子必须有 `keyframes.length > 0`（`EVENT` 必须非空），`group` 模式可带组内静态伴随行。
4. 组头在属性面板显示总叶子数、已设置数；在效果面板显示动画叶子数、总帧数、轴外帧数。
5. 未知路径：属性面板“未知/扩展”组只读；若它有关键帧且策略允许，也进效果面板的未知组。
6. 组只是 `schema.section/group` 的 UI 归类；不创建运行时效果实例，不写组帧。

## 打开/关闭动画

| 动作 | 命令 | 面板变化 |
|---|---|---|
| 属性面板点时钟 | `object.enableAnimation` | 在播放头建首帧；叶子移入效果面板；组按策略出现/移动 |
| 属性面板改静态值 | `object.setValue` | 只改 `value`；不建帧、不移面板 |
| 效果面板点时钟关闭 | `object.disableAnimation` | 确认后删该叶子全部帧，保留确定 `value`；叶子移回属性面板 |
| 效果面板删最后一帧 | `object.removeKeyframe` | 允许 `keyframes=[]`；叶子移回属性面板，显示静态值/“无帧” |
| 效果面板再加首帧 | `object.addKeyframe` | 叶子移回效果面板；不补其他叶子 |

- `ANIMATED` 的 `keyframes=[]` 是合法静态形态；属性面板显示“动画轨道无帧”+ 值控件 + 时钟。
- `EVENT` 不允许空数组；删除唯一记录被拒绝，始终留在效果面板。
- 面板迁移不改变 `Selection` 的 `clipKey/objectPath/time`；行滚动到新面板对应位置。

## 时间与节点规则

- 效果面板使用片段局部秒；主时间轴使用全局秒，只有播放头时间经 `global = clip.start_time + local` 互通。
- 效果面板所有组、叶子共用一条局部标尺和一个局部视口；节点横坐标 `x=(time-originLocalSeconds)*pxPerSecond`。
- 同刻不同叶子不合并、不联选；`position.x@2` 与 `yaw@2` 是两条独立记录。
- 有限片段 `0 ≤ t ≤ duration` 轴内；合法 `t > duration` 轴外，保留、可编辑、可拖回；主时间轴片段宽度不变。
- 无限片段合法 `t ≥ 0` 全部轴内；局部窗口有限，不写 `Infinity`，不把可视末端当片段时长。
- 属性面板没有时间轴；只显示当前静态值/未设置。

## 命令规则

所有写入走 03 `EditorCommand`：

```text
object.setValue
object.enableAnimation
object.disableAnimation
object.addKeyframe
object.removeKeyframe
object.moveKeyframe
object.setKeyframeValue
object.moveKeyframes
object.removeKeyframes
object.pasteKeyframes
object.setEasing
object.bakeEasing
object.remove
```

- 一个拖拽一次提交；拖动中只预览，不写文档。
- 同属性重复时间按 `1e-4` 拒绝；不自动排序、不自动合并、不钳制到 `[0,duration]`。
- 批量移动/删除原子提交；失败整次回滚。
- 选择身份使用 `clipKey + objectPath + keyframeTime`，不用数组下标。
- 保存、预览推送共用 `serializeDoc`；`authoring`、`clipKey`、UI 状态不写盘。

## 合同来源

| 合同 | 使用点 |
|---|---|
| 02-04 | 轨道、对象叶子、`mode/type/interp/requires/section`、七型轨道 |
| 03-02 | `AnimObject`、`ObjectKeyframe`、九种值类型、三种形态 |
| 03-03 | `Selection`、`clipKey`、节点时间身份、引用完整性 |
| 03-05 | `commit`、快照撤销、失败回滚、`doc/session/derived/transport` |
| 03-06 | 本地 L01–L34、issue 级别、服务端 `script.validate` |
| 04-05 | `PanelContext`、`clip.effects` / `selection.properties` 双宿主四态 |
| 05-13 | 两个宿主的 panelId、槽位、尺寸、keepAlive |

## 实施顺序

1. 把 `selection.properties` 内容换成 `ClipPropertiesPanel`，先列全部适用组/叶子、静态值和时钟。
2. 把 `clip.effects` 内容换成只显示动画叶子的 `ClipEffectsPanel`；空态与属性面板联动。
3. 冻结 `PropertyRow` / `EffectGroup` / `PanelMembership` / `EffectViewport`，再并行做效果行、值控件、关键帧组。
4. 跑通“属性面板改值 → 开时钟 → 效果面板出现 → 加帧/拖动/撤销 → 关动画 → 回属性面板”的迁移闭环。
5. 接局部视口、轴外、无限片段、事件、缓动、诊断和双面板定位。
6. 移除整帧路径和主轴节点入口，跑 06-11 全矩阵。
7. 按 06-12 收口结构：业务内核落 `features/`，插件目录只留装配；`core/` 与 `plugins/` 的分层约束保持成立。

## 完成定义

- 属性面板列全部适用属性；默认 `leaf` 模式下效果面板只列已有关键帧属性；效果面板没有添加器。
- 开/关动画、加/删最后一帧时，叶子在两个面板之间正确迁移，值/帧/选择不丢。
- 每个效果行有独立关键帧组；主轴无对象节点；属性面板无节点轴。
- 100+ 属性、500+ 节点仍可滚动、选中、拖动、撤销。
- 真实 `script.validate` 通过；保存重开无损；无 UI 字段写盘。
