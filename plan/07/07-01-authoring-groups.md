# 07-01 编辑组合 AuthoringGroup

## 目标

在编辑器内存里建立一层 `AuthoringGroup`：把 `position.x/y/z`、`yaw/pitch/roll` 这类作者习惯一起编辑的叶子组合成一个操作单元。组合只提供“同一时刻建帧、抓取当前值、批量改值、删除该时刻帧”，写盘仍然是每个叶子自己的 `AnimObject` 关键帧。

`AuthoringGroup` 不是模组结构，不是 `clip.objects` 里的对象，不是运行时组，也不序列化。

## 数据模型

```ts
interface AuthoringGroupDef {
  id: string                    // position.xyz / orientation.ypr / custom_xxx
  label: string
  members: string[]              // 叶子路径，如 position.x
  builtin: boolean               // 来自配置文件 / 作者自定义
  order: number
  source: 'config' | 'custom'
}

interface AuthoringGroupRegistry {
  defaults: AuthoringGroupDef[]
  custom: AuthoringGroupDef[]
  resolve(groupId: string): AuthoringGroupDef | null
  groupsForPath(path: string): AuthoringGroupDef[]
  validate(def: AuthoringGroupDef): AuthoringGroupIssue[]
}
```

- 默认组从 `src/config/authoring-groups.json` 读取。
- 自定义组存在 `doc.authoring.groups`，只在当前文档内存里；保存、推送、导出时剥离。
- `members` 是叶子路径，不存对象引用、不存数组下标。
- 同一个叶子可以属于多个组合；组合不是互斥分组。

## 默认组合

| groupId | label | members |
|---|---|---|
| `position.xyz` | 位置 XYZ | `position.x` / `position.y` / `position.z` |
| `orientation.ypr` | 朝向 YPR | `yaw` / `pitch` / `roll` |

首版只默认这两组。其他统一组合不预置；作者需要时在配置文件里新增，或在当前文档里建自定义组合。

`position` 的 `group("position")` 在 schema 里包含二十多个字段，不能直接当批量组用；它包含 `position_mode`、`position_space`、`position_origin` 等 step 字段，整组打帧会生成 step 帧并触发三轴对齐。默认组合只装连续叶子，step 字段单独编辑。

## 配置扩展口

`src/config/authoring-groups.json`：

```json
{
  "version": 1,
  "groups": [
    {
      "id": "position.xyz",
      "label": "位置 XYZ",
      "members": ["position.x", "position.y", "position.z"]
    },
    {
      "id": "orientation.ypr",
      "label": "朝向 YPR",
      "members": ["yaw", "pitch", "roll"]
    }
  ]
}
```

- 加成员：在现有组 `members` 里追加路径，重启编辑器后该组变宽；内核、面板、命令不改。
- 加默认组：在 `groups` 里追加一项，重启后出现在属性面板/效果面板的组头菜单。
- `id` 必须匹配 `^[A-Za-z][A-Za-z0-9_.-]{1,63}$`，脚本内唯一。
- `members` 至少一项；重复项去重；未知路径启动时报配置错误并跳过该组，不阻塞其他组。
- 加载时对照 02 字段目录：成员必须是当前轨道存在的叶子；跨轨道字段不合并。
- 加载后标记 `builtin=true`、`source='config'`，作者不能删除；只可在当前会话里临时隐藏。
- 改配置文件即可把 `position_mode`、`position_space` 等 step 字段扩进 `position.xyz`；组合弹层会显示“含 step 字段，建帧会触发三轴对齐”的提示。

## 自定义组合

作者在属性面板或效果面板点“新建组合”：

1. 输入名称。
2. 从当前片段适用叶子列表里勾选成员；`VALUE` / `STRUCT` / `EVENT` 可以勾选，但组合弹层里对应行只显示“静态值/记录”，不参与关键帧批量操作。
3. 保存到 `doc.authoring.groups`，`source='custom'`。
4. 可重命名、增删成员、删除组合；删除组合不删任何 `AnimObject`。
5. 保存文档、推送预览、导出时 `authoring` 整棵剥离。

自定义组合的 `id` 自动生成 `custom_<n>`；作者可改显示名，不改 `id`。

## 组合命令

```ts
authoring.group.addFramesAt   { clipKey, groupId, time }
authoring.group.captureAt     { clipKey, groupId, time }
authoring.group.applyValuesAt { clipKey, groupId, time, values }
authoring.group.removeFramesAt{ clipKey, groupId, time }
```

### `addFramesAt`

- 对组合内每个 `ANIMATED` 叶子：如果该时刻没有关键帧，创建一条；如果已有，保留原值。
- 新帧初值按顺序取：该叶子在 `time` 的当前有效值 → 该叶子静态 `value` → schema `default`。
- 所有新帧使用同一个 `time` 数值；不做容差匹配、不四舍五入、不排序替代。
- 一次 `commit`；任一叶子失败整次回滚。

### `captureAt`

- 读取组合内每个叶子在 `time` 的当前有效值（有关键帧则插值，无关键帧取 `value`/default）。
- 对没有帧的叶子创建同刻帧；已有帧的叶子不覆盖。
- UI 显示“将创建 N 条、已有 M 条、跳过 K 条静态/事件”。

### `applyValuesAt`

- `values: Record<path, JsonValue>` 必须覆盖组合内所有可动画叶子；缺项按当前值填充。
- 每个叶子：有同刻帧则改值；没有则创建帧再写值。
- 静态 `VALUE` / `STRUCT` 只改 `value`，不建帧；`EVENT` 不参与值批量，行显示“记录”。
- 一次 `commit`；一次撤销。

### `removeFramesAt`

- 删除组合内每个叶子在 `time` 的关键帧；时间精确相等。
- 删到最后一帧允许 `keyframes=[]`；保留确定 `value`。
- 一次 `commit`；面板按 06 `panelMembership` 自动迁移。

## 时间与校验

- 组合操作使用片段局部秒；同一次操作的所有成员写同一个 `time`。
- 三轴切换对齐用精确时间相等：`position.x/y/z` 必须各自存在 `time` 完全相等的那一帧；不用 `1e-4` 容差。
- 组合包含 `position_mode / position_space / position_origin / position_origin_freeze / facing_source` 或在 `base` 下的 `BASE_SWITCH_FIELDS` 时：
  - `time <= 0`：直接提交。
  - `time > 0`：先跑 `switchImpact`；缺三轴帧时弹“补齐三轴并提交 / 取消”。
  - 选“补齐三轴并提交”时，缺的轴用当前值各建一帧，和 step 值写在同一个 `commit`；一次撤销全部回退。
- 组合包含 `requires` 未满足的叶子（如 `orient != tangent` 时的 `yaw_offset`）：该行禁用，不参与 `applyValuesAt`；已有帧保留。
- 组合包含 `VALUE` / `STRUCT`：只允许静态值编辑，不显示时钟，不参与 `addFramesAt` / `removeFramesAt`。
- 组合包含 `EVENT`：显示记录入口，不参与批量建帧/改值/删帧。

## 组合弹层

```text
┌ 组合：位置 XYZ · 当前 2.350s ─────────────────────┐
│ position.x  [ 1.200 ]  3 帧   在效果面板           │
│ position.y  [ 0.000 ]  2 帧   在效果面板           │
│ position.z  [ 未设置 ] 0 帧   属性面板             │
│ [同一时刻建帧] [抓取当前值] [批量改值] [删除此时刻帧]│
│ 将创建 1 条；已有 2 条；1 条静态                    │
└────────────────────────────────────────────────────┘
```

- 从组头“组合编辑”按钮打开；锚在组头，不占独立面板。
- 每行显示路径、当前值、帧数、面板归属徽标；不画节点轴、不画第二条时间线。
- “批量改值”进入行内编辑模式，所有值可一起提交；`Esc` 取消，`Enter` 提交。
- 成员已在效果面板时，组合弹层只显示摘要和“在效果面板”入口，不复制值控件。
- 组合弹层不因面板迁移关闭；提交后按 06 重新分区，组头计数刷新，焦点留在弹层。
- 组头在属性面板/效果面板可同时出现；两边显示同一组合的不同成员集合，计数按 `panelMembership` 计算。

## 面板接入

- 属性面板：每个组头右侧“组合编辑”菜单，列出该组可用的默认组合和自定义组合。
- 效果面板：同样入口；只对当前在效果面板的成员生效，未在效果面板的成员显示“在属性面板”。
- 片段工具栏“组合”命令打开当前选中叶子的所属组合；`Shift` 多选叶子时可临时建一个自定义组合。
- 主时间轴不显示组合、不显示组帧、不显示组标记。

## 序列化

- `doc.authoring.groups` 只存在内存；`serializeDoc` 前剥离。
- 组合定义不改变 `AnimObject` 形态；不写 `group` 字段、不写 `groupId`、不写 `members`。
- 保存重开后默认组合从配置文件恢复；自定义组合丢失，脚本数据无损。
- 撤销/重做只回退 `doc`；组合定义不随文档撤销，除非命令显式修改 `authoring`。

## 组件与模块

```text
src/authoring/
  groups.ts                 AuthoringGroupDef / registry / validate
  groupCommands.ts          addFramesAt / captureAt / applyValuesAt / removeFramesAt
  groupPanelView.ts         组头计数、成员面板归属、弹层行模型
src/components/authoring/
  AuthoringGroupHeader.vue
  AuthoringGroupPopover.vue
  AuthoringGroupMemberRow.vue
src/config/
  authoring-groups.json
```

- `groups.ts` 不 import 任何面板组件；只读 schema 目录和文档。
- `groupCommands.ts` 生成 03 `EditorCommand`，由统一 `commit` 执行。
- 面板组件只消费 `groupPanelView` 的派生结果，不直接改 `doc`。

## 验收

1. 选中 CAMERA 片段，`position.xyz` 默认出现；在 `t=2.350` 点“同一时刻建帧”，`position.x/y/z` 各出现一条 `time=2.350` 的独立关键帧；帧数 3，文档里没有组对象。
2. 紧接着批量改值为 `(1,2,3)`，三条帧值正确；撤销一次全部回到建帧前。
3. `position.x` 已有帧、`position.y/z` 无帧时点“抓取当前值”：x 不覆盖，y/z 各建一帧；弹层显示“已有 1、创建 2”。
4. 删除 `t=2.350` 的组合帧：三条都删；删到最后一帧的叶子 `keyframes=[]`，回属性面板；撤销全恢复。
5. 在 `t=3` 把 `position_space` 改成 `base`，组合只建了 x 帧时：弹“补齐三轴并提交”；补齐后 `script.validate` 通过；选取消则文档不变。
6. 在 `authoring-groups.json` 给 `position.xyz` 加 `position_mode`，重启后组头出现该成员；对它建帧时弹 step 对齐提示；不改任何内核代码。
7. 自定义组合勾选 `yaw`、`pitch`、`roll`、`orient`：`orient` 行只显示静态值，不参与建帧；三个角度正常批量。
8. 保存重开：脚本里没有 `authoring`、没有组字段；帧值/时间不变；自定义组合消失，默认组合仍在。
9. 组合弹层打开时，成员因开/关动画在属性/效果面板间迁移；弹层不关闭、不重复值控件、计数正确。
10. `grep groupId` 在保存 JSON 中 0 命中；`grep authoring.groups` 在 `serializeDoc` 输出中 0 命中。
