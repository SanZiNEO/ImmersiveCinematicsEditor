# 06-07 事件记录编辑

## 目标

编辑 `EVENT` / `MOD_EVENT` 叶子的记录列表。事件不是值关键帧，不参与插值、不画段缓动；记录非空时事件叶子进入效果面板，记录编辑器在效果面板内打开。属性面板只负责空事件叶子的首次记录入口和概览。

## 数据模型

```ts
interface EventRecord {
  time: number
  value: unknown          // 记录体，字段由 def.eventRecord 描述
}

interface EventDefView {
  path: string
  label: string
  eventKind: 'instant' | 'interval' | string
  fields: EventFieldDef[]
  nameWhitelist?: string[]
  unknown: boolean
}

interface EventFieldDef {
  key: string
  label: string
  type: PropertyType | 'enum' | 'string' | 'number' | 'boolean'
  required: boolean
  enumValues?: string[]
  readonly?: boolean
}
```

- 事件叶子 `mode==='event'`；`keyframes` 是记录数组，必须非空。
- 事件记录没有 `interp`、没有缓动、没有前后段。
- 记录体原样保留未知字段；UI 只编辑 `fields` 声明的字段，不删除未知键。
- 记录时间精度 `1e-4`；同路径同刻重复拒绝 `duplicate_time`。
- 事件不写 `authoring`，不进 `serializeDoc` 的 UI 部分。

## 面板归属

| 状态 | 属性面板 | 效果面板 |
|---|---|---|
| `EVENT`，`keyframes=[]` | 显示“暂无记录”+“添加首条记录” | 不显示该行 |
| `EVENT`，有记录 | 显示“N 条记录”+“在效果面板编辑” | 显示事件行 + 记录条 |
| `EVENT` 删除最后一条 | 拒绝；保持有记录 | 保持事件行 |
| `EVENT` 未知字段/未知路径 | 概览 + 只读入口 | 只读记录条 |

- 首条记录在属性面板创建；创建成功后事件叶子进入效果面板。
- 效果面板行菜单“添加记录”只对已存在的事件行；不是“添加属性”。
- 事件叶子不能通过关闭动画回到属性面板；`EVENT` 必须保持至少一条记录。

## 记录条

- 区间事件：起止端点 + 横条；`time` 为起点，终点来自 `value.end_time` 或 `def.eventKind` 约定的字段。
- 瞬时事件：竖菱形；宽度 8px。
- 记录条最小宽度 6px；零时长也不隐藏。
- 点击记录条选中该记录并打开编辑器；双击只打开编辑器，不新增记录。
- 记录条与动画节点分开绘制；不共用节点选择，不参与关键帧框选。
- 事件行没有段线、没有播放头命中节点样式；播放头只显示位置。

## 编辑器

```text
事件  camera_shake        1 条记录
  时间     2.40s
  名称     [ shake ]
  强度     [ 0.60 ]
  时长     [ 1.20 ]
  [删除记录] [复制记录]
```

- 顶部显示路径、事件名/类型、记录数。
- 字段按 `EventFieldDef` 顺序渲染：文本、数字、开关、枚举、引用。
- 必填字段空值阻止提交；错误内联显示。
- `nameWhitelist` 存在时，名称字段只接受白名单值；其他值拒绝 `event_name_invalid`。
- 未知字段折叠到“原始记录”只读 JSON；不提供删除未知键。
- 时间字段可改：`object.moveKeyframe` 对事件同样适用；同刻冲突拒绝。
- 删除记录：`object.removeKeyframe`；删除最后一条拒绝 `event_requires_record`。
- 复制记录：复制记录体 + 时间偏移 0.1s；同刻冲突拒绝；粘贴后打开新记录。

## 添加首条记录

属性面板的空 `EVENT` 行：

- 显示“暂无记录”与“添加首条记录”。
- 点击后在播放头创建记录；记录体按 `def.default` 或字段默认值生成。
- 必填字段缺失时，先打开编辑器，不写入半成品记录。
- 创建成功：事件叶子进入效果面板；属性面板行变“N 条记录 / 在效果面板编辑”。
- 一次撤销恢复空事件和属性面板状态。

## 修改记录

```ts
setEventRecord({ clipKey, path, time, value })
addEventRecord({ clipKey, path, time, value })
removeEventRecord({ clipKey, path, time })
moveEventRecord({ clipKey, path, fromTime, toTime })
```

- 修改记录体只替换声明字段；未知键原样保留。
- 修改不改变 `time`；移动时间用 `moveEventRecord`。
- 记录体类型不匹配拒绝；不把数字转字符串、不把布尔转 0/1。
- 连续编辑同一字段 600ms 合并撤销；切换记录/失焦结束合并。
- 批量删除事件记录：同路径原子提交；跨路径分批，任一失败整批回滚。
- 事件记录不参与普通关键帧复制/粘贴；复制走事件专用剪贴板。

## 校验

- 本地 L 系列：`event_requires_record`、`event_name_invalid`、`event_field_required`、`event_field_type`、`duplicate_time`、`negative_time`。
- 服务端 `script.validate` 权威；本地 issue 只做即时提示。
- 事件行角标：block/error/warn；点击打开 06-10 诊断。
- 未知事件路径只读；不能添加记录、不能改字段、不能删除；可复制原始 JSON。

## 验收

1. 属性面板空 `EVENT` 行点“添加首条记录”：播放头建 1 条记录；事件行进入效果面板；一次撤销恢复空态。
2. 效果面板事件行显示记录条；点击打开编辑器；不显示通用菱形/段线。
3. 修改名称到白名单外：拒绝 `event_name_invalid`；原值保留。
4. 必填字段清空：阻止提交；记录体不变。
5. 删除唯一记录：拒绝 `event_requires_record`；事件行仍留在效果面板。
6. 添加第二条记录：记录条两条；同刻重复拒绝。
7. 修改记录时间到已有记录同刻：拒绝；不覆盖。
8. 未知字段：显示在“原始记录”只读区；保存后原样保留。
9. 未知事件路径：只读；无添加入口；不能删除。
10. 事件记录 100 条：记录条虚拟化；编辑器只渲染当前记录；滚动不卡死。
