# 06-02 动画效果组与行

## 目标

在效果面板建立“已有关键帧的组 + 已有关键帧的叶子”两级结构。默认 `leaf` 模式下，效果面板只列 `keyframes.length > 0` 的属性；没有关键帧的属性留在属性面板。`group` 模式下整组进入效果面板，无帧叶子作为静态伴随行。面板没有“添加属性”选择器、没有未设置行、没有静态 `VALUE` / `STRUCT` 行（`group` 静态伴随行除外）。

## 数据模型

```ts
interface EffectGroup {
  key: string                 // section/group 稳定键
  label: string
  order: number
  rows: EffectRow[]
  animatedRowCount: number
  staticCompanionCount: number
  totalFrameCount: number
  outOfRangeFrameCount: number
  unknown: boolean
}

interface EffectRow {
  clipKey: string
  path: string
  label: string
  def: ObjectDefView | null
  mode: 'animated' | 'event' | 'value' | 'unknown'
  type: PropertyType | 'unknown'
  interp: Interp | 'none'
  keyframes: ObjectKeyframe[]
  frameCount: number
  outOfRangeCount: number
  hasKeyframeGroup: boolean
  atPlayhead: boolean
  selectedTime: number | null
  unknown: boolean
}

interface PropertyRow {          // 属性面板使用，不直接进效果面板
  clipKey: string
  path: string
  def: ObjectDefView | null
  present: boolean
  mode: 'value' | 'animated' | 'event' | 'unknown'
  value: unknown
  keyframes: ObjectKeyframe[]
}
```

### 效果行派生

```ts
buildEffectGroups({
  propertyRows,
  trackDef,
  panelMembership,
  playheadLocal,
  duration,
  infinite
}): EffectGroup[]
```

1. 从属性面板同一份 `PropertyRow` 集合派生，不另建第二份文档视图。
2. `panelMembership.isRowInEffect(row)` 为真才进入效果行：
   - `leaf`（默认）：`row.keyframes.length > 0`。
   - `group`：组内任一叶子 `keyframes.length > 0`，整个组进入；组内无帧叶子作为静态伴随行。
3. `leaf`（默认）下，效果行必须满足：
   - `mode==='animated'` 且 `keyframes.length>0`；
   - `mode==='event'` 且 `keyframes.length>0`；
   - `mode==='unknown'` 且原文有非空 `keyframes`。
   `hasKeyframeGroup` 一律为 true。
4. `VALUE` / `STRUCT` 叶子在 `leaf` 模式下不进效果面板；`ANIMATED` 的 `keyframes=[]` 也不进，留在属性面板。
5. 组键 `def.section ?? def.group ?? '__ungrouped__'`；组顺序按 schema 声明首次出现；组内行顺序按声明顺序。
6. `frameCount = keyframes.length`；`outOfRangeCount`：有限片段 `time>duration`；无限片段为 0。
7. `atPlayhead`：`hasKeyframeGroup && abs(time-playheadLocal)<=1e-4`。
8. 只返回至少有一个效果行的组；空组不显示。
9. `group` 模式下，任一叶子有帧则整组进入；无帧叶子作为静态伴随行，`hasKeyframeGroup=false`，`mode` 保持 `value` 或 `struct`，右侧显示“组内静态值”；不因此把该组拆到属性面板。
10. `staticCompanionCount = rows.length - animatedRowCount`；组头显示动画行数/帧数，不把静态伴随行算进动画计数。

## 行内容

```text
position.x   [ 1.2 ]   [时钟] [◆] [←][→]   3 帧 · 1 轴外
position.y   [ 0.0 ]   [时钟] [◆] [←][→]   2 帧
yaw          [ 90° ]   [时钟] [◆] [←][→]   2 帧
```

| 区域 | 内容 |
|---|---|
| 名称 | `label`；无 label 用路径末段；tooltip 完整路径 |
| 路径 | 小号等宽字，最多 1 行省略 |
| 值控件 | `PropertyValueForm`；动画行显示当前节点值/无节点 |
| 模式 | `ANIMATED` / `EVENT` / `VALUE（静态伴随）` / `STRUCT（静态伴随）` / `未知` 徽标 |
| 动画控件 | 时钟、当前节点菱形、前后节点；`EVENT` 显示“记录”入口 |
| 节点摘要 | `N 帧`、`M 轴外`、播放头是否有节点 |
| 组内静态行 | `group` 模式下显示“静态值”，无节点组 |
| 操作 | 动画行菜单：关闭动画、删除当前帧、复制路径、定位诊断；静态伴随行只有复制路径、定位诊断 |

效果面板行没有“移除属性”。移除整个 `AnimObject` 在属性面板执行；效果面板的“关闭动画”会保留静态值并把行移回属性面板。

## 组头

```text
位置 (2 动画属性 / 7 帧)                       [折叠]
```

- 显示 `animatedRowCount` 与 `totalFrameCount`；有轴外帧时追加“1 轴外”。
- `animatedRowCount = rows.filter(row=>row.hasKeyframeGroup).length`；`staticCompanionCount` 只在 `group` 模式大于 0，组头追加“N 静态伴随”。
- `unknown` 组显示“未知/扩展”。
- 点击组头只改折叠状态，不改选择、不重建片段上下文。
- 默认所有效果组展开；折叠状态存 `session.effectPanels[clipKey].collapsedGroups`。
- 组头右侧显示 block/warn 角标；点击定位到 06-10 诊断条。

## 面板没有添加器

效果面板工具栏没有“+ 添加属性”，内容区没有未设置行，行菜单没有“添加属性”。属性进入效果面板的唯一路径：

```text
属性面板（selection.properties）
  找到叶子
  改静态值 / 点时钟
  时钟创建首帧
  → docRevision 更新
  → 效果面板出现该行
```

- `object.enableAnimation` 是唯一入口；首帧在播放头创建。
- 属性面板中 `ANIMATED` 叶子已有空 `keyframes=[]` 时，点时钟只是添加首帧，不改变模式。
- 效果面板不提供“新建效果组”；组来自 schema，不能凭空创建。

## 关闭动画与移回属性面板

行菜单“关闭动画”：

- `object.disableAnimation`：确认后删除该叶子全部帧，保留确定 `value`。
- 确认框显示路径、帧数、轴外帧数、关闭后的静态值。
- 成功后行从效果面板消失，属性面板出现该叶子静态值；选择从 `node` 退回 `leaf`，再定位到属性面板行。
- 一次撤销恢复帧、面板归属和选择。
- 删除最后一帧也触发移回；`keyframes=[]` 合法，不自动删 `AnimObject`。

## 未知动画路径

`clip.objects` 中存在 schema 不认识的路径且 `keyframes.length>0`：

- 进入 `EffectGroup { key:'__unknown__', label:'未知/扩展', unknown:true }`。
- 行 `def=null`、`mode='unknown'`、`type='unknown'`；显示原始路径与 JSON 摘要。
- 只读：不能改值、不能加帧、不能烘焙；可查看、复制、定位诊断。
- 可关闭动画（删除 keyframes，保留 value）→ 移回属性面板未知组；不删除原文。

## 过滤与搜索

| 过滤 | 行为 |
|---|---|
| 搜索 | 按路径、label、组名匹配；匹配组展开，未匹配行隐藏 |
| `只看轴外` | 只显示有 `time>duration` 节点的动画行；组头保留 |
| 清空搜索 | 恢复过滤前的组展开状态 |

过滤只改显示，不改行集合、不删数据、不清选择。空搜索结果与“片段没有动画”使用不同文案。

## 行布局

`effectRowLayout` 输出统一几何：

```ts
interface EffectRowLayout {
  groupKey: string
  kind: 'group' | 'row' | 'detail'
  path?: string
  top: number
  height: number
  visible: boolean
}
```

- 组头 30px。
- 动画叶子 52px；事件叶子 52px；组内静态伴随行 44px。
- 展开详情 +52px；事件记录展开 +76px。
- 左列与右列消费同一 `top/height`；行展开时两侧一起变高。
- 100+ 动画行只布局可见窗口；滚动时保持组头吸顶。

## 验收

1. 片段只有 `position.x` 有帧：效果面板出现“位置”组和 x 行；y/z 不在效果面板。
2. 属性面板开 `position.y` 时钟：效果面板位置组多一行 y；x 行不消失。
3. 效果面板关闭 `position.x` 动画：x 行消失，属性面板出现 x 静态值；撤销恢复。
4. `ANIMATED` 的 `yaw` 有 `keyframes=[]`：不在效果面板；属性面板显示“动画轨道无帧”。
5. `VALUE` 的 `opacity` 即使 `present=true`：不进效果面板。
6. `EVENT` 的 `event` 记录非空：效果面板出现事件行；删除唯一记录被拒绝。
7. 未知路径 `foo.bar` 有帧：未知组只读出现；不能加帧；关闭动画后移回属性面板。
8. `group` 模式：位置组任一叶子有帧，整组进效果面板；y/z 静态伴随行显示“静态值”，无节点组。
9. 100+ 动画行：只渲染可见行；组头计数正确；滚动不串行。
