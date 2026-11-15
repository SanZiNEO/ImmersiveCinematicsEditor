# 07-05 路径集合与面板

## 目标

建立脚本级 `paths[]` 的完整编辑闭环：条目模型、端点下拉、axes、引用完整性、重复端点对、重叠优先级，以及独立的 `paths.collection` 面板。

`paths[]` 与 `clips[]` 并列，不塞进 `timeline` 或 `clip`。路径面板是脚本级面板，不挂在 `clip.effects` 下。

## 条目模型

```ts
interface PathEntryDoc {
  id: string
  clip: string
  from: number
  to: number
  axes: Array<'x' | 'y' | 'z'>
  geometry: PathGeometry
  timing?: PathTiming
}
```

- `id`：脚本内唯一，匹配 `^[A-Za-z][A-Za-z0-9_.-]{1,63}$`；默认 `p_<n>`，全局计数，作者可改。
- `clip`：目标片段 `id`；必须存在且非空。
- `from` / `to`：片段局部秒；`from < to`；必须命中目标片段位置节点。
- `axes`：至少一项；顺序无关；缺省三轴；编辑器写显式数组。
- `geometry`：必填；`type` 来自 `curveTypes`；`line` 是 `linear` 别名。
- `timing`：可省略；省略 = `linear`；显式时只接受 `linear` / `keyframes`。

示例：

```json
{
  "paths": [
    {
      "id": "p_1",
      "clip": "shot_a",
      "from": 0.0,
      "to": 3.0,
      "axes": ["x", "z"],
      "geometry": {
        "type": "bezier",
        "control_points": [
          { "dx": 1.0, "dy": 0.0, "dz": 0.0 },
          { "dx": 1.0, "dy": 0.0, "dz": 2.0 }
        ]
      },
      "timing": { "type": "linear" }
    }
  ]
}
```

## 面板

```ts
{
  panelId: 'paths.collection',
  title: '路径',
  slot: 'document.drawer',
  minWidth: 420,
  maxWidth: 720,
  closable: true,
  keepAlive: true,
  singleton: true
}
```

- 默认停靠在 `document.drawer`；可通过 04 布局树拖到任意合法 slot。
- 不要求选中片段；路径列表始终显示整份脚本的 `paths[]`。
- 条目编辑器在面板内部；宽 >= 720 时列表与表单左右分栏，窄于 600 时上下堆叠。
- 关闭面板不丢草稿；草稿按 `pathId` 存在面板会话，重新打开恢复。
- 面板不 import `clip.effects` 的组件；只共享 `Selection`、`commit`、字段目录和几何表单。

## 列表

每行显示：

```text
p_1   shot_a   0.000 → 3.000   x,z   bezier   linear   ⚠ 1
p_2   shot_b   3.000 → 6.000   x,y,z arc      linear
```

- `id`、目标片段、时间区间、axes、几何类型、timing 类型、问题数。
- 点击行：`Selection.pathId=id`；不改变当前 clip 选择以外的属性面板状态。
- 双击行：把目标片段设为当前 clip，并把播放头移到 `from`。
- 右键：重命名、复制、删除、定位目标片段、定位起点/终点。
- 顶部：新建路径、按片段筛选、按 id 搜索、只看有问题。
- 空状态：一个“新建路径”按钮和一行说明“路径端点来自片段位置节点”。

## 新建流程

1. 选择目标片段。下拉显示所有 CAMERA 片段；没有 `id` 的片段禁用，旁挂“设置片段 id”命令。
2. 选择起点节点 A。列表来自 `position.x/y/z` 节点时间并集；最后一项不能作为 A。
3. 终点 B 自动锁定 A 的下一个节点；不提供自由输入。
4. 默认 `id=p_<n>`、`axes=[x,y,z]`、`geometry={type:'line'}`、`timing` 省略。
5. 点“添加”生成一条路径；一次 `commit`；列表选中新条目。

## 端点选择

```ts
function positionNodeTimes(clip: ClipDoc): number[] {
  // position.x / position.y / position.z 的 keyframes.time 并集
  // 去重、升序
}
```

- 只接受 `position.x/y/z` 的关键帧时间；不看 `value`、不看 `motion_*`、不看路径自身。
- 去重用精确时间；保存匹配用 `1e-4`：下拉存节点原值，写盘写匹配到的节点值。
- 节点数 < 2：禁用新建；已有路径显示“位置节点不足”。
- A 的下一节点是 B；A 是最后节点时没有 B。
- 目标片段没有 `id`：不能建路径；列表行显示“目标片段缺 id”。
- 端点不自由输入；粘贴、手输、拖动都只能选节点。
- 选中端点：`Selection={clipKey, objectPath:'position.x', keyframeTime}`；属性/效果面板滚动到该行；返回路径面板保留 `pathId`。

## 端点引用完整性

### 删除位置节点

删除 `position.x/y/z` 在 `t` 的帧前，扫描：

- 任意 `paths[].from == t` 或 `to == t` → 阻止。
- 弹窗列出受影响路径；提供“先删除这些路径并继续 / 取消”。
- 选“删除路径并继续”时，位置帧删除和路径删除在同一个 `commit`；一次撤销全回退。

### 插入位置节点

在路径区间 `(from,to)` 内插入新的位置帧，会使原路径端点不再相邻：

- 默认阻止插入；弹窗列出路径。
- 提供“删除这些路径并继续 / 取消”。
- 不自动改路径端点、不自动拆路径、不把新节点当端点。

### 移动位置节点

移动端点时间或移动区间内节点：

- 先算移动后端点是否仍命中节点、是否仍相邻。
- 不满足则阻止；弹窗列出路径和原因。
- 提供“删除这些路径并继续 / 取消”。

### 删除片段

删除目标片段前扫描 `paths[].clip`：

- 有引用 → 阻止；列出路径。
- 提供“先删除这些路径并继续 / 取消”。

### 重命名片段 id

- 片段 `id` 改变时，同一 `commit` 把 `paths[].clip` 从旧 id 改为新 id。
- 新 id 与已有片段重复 → 阻止重命名。
- 路径 `id` 不随片段改名。

### 删除 / 重命名路径 id

- 路径 id 空、重复、非法字符 → 阻止提交。
- 重命名只改 `paths[].id`；不触发端点检查。
- 删除路径不影响位置帧、片段或其他路径。

## 重复端点对与重叠

`PathCollectionParser` 规则：

- 同一片段、同一 `from/to` 端点对只能有一条路径。
- 部分重叠合法：`0→3` 与 `1→4` 可以共存。
- 完全包含但不相同也合法；运行期按起点更晚者优先。
- 起点相同：来源列表靠前者胜；编辑器按 `paths[]` 顺序显示优先级。

UI：

- 新建/保存时检测“同 clip + 同 from + 同 to”完全重复 → 本地 block。
- 部分重叠行显示“与 p_x 重叠，起点更晚者生效”。
- 列表可按 `from` 排序查看覆盖关系；不自动合并、不自动裁剪。
- 主时间轴不画路径覆盖条、不画端点；覆盖关系只在路径面板和预览里显示。

## axes

- 复选 `x/y/z`；至少一项；默认全选。
- 取消一项时，该轴继续用 `position` 的普通采样值；路径只覆盖勾选轴。
- `axes` 缺省 = 三轴；编辑器写显式数组，保存不丢用户选择。
- 顺序按 `x,y,z` 归一化显示；写盘保留勾选顺序或归一化顺序均可，解析器顺序无关。
- 预览按 axes 显示覆盖轴；未覆盖轴不参与路径形状。

## 引用与诊断

路径行的问题：

| 问题 | 处理 |
|---|---|
| `PATH_CLIP_MISSING` | 目标片段不存在 / 为空；block |
| `PATH_CLIP_ID_MISSING` | 目标片段没有 id；block，提供设置 id |
| `PATH_FROM_AFTER_TO` | `from >= to`；block |
| `PATH_ENDPOINT_NOT_NODE` | 端点不在节点并集；block，重新下拉 |
| `PATH_ENDPOINT_NOT_ADJACENT` | A/B 不相邻；block |
| `PATH_ENDPOINT_DUPLICATE` | 同片段端点对重复；block |
| `PATH_AXES_EMPTY` | axes 为空；block |
| `PATH_GEOMETRY_MISSING` | 没有 geometry/type；block |
| `PATH_GEOMETRY_INVALID` | 类型/参数不被注册表接受；block |
| `PATH_TIMING_INVALID` | timing 不是 linear/keyframes；block |

- 本地诊断即时显示；保存/推送前再跑 `script.validate`，以服务端结果为准。
- 错误行展开显示字段和修复入口；不把错误压成一条 toast。
- 路径面板与 05 项目图的诊断共享 `pathId`，可从图节点跳到路径行。

## 组件

```text
src/plugins/core.path-collection/
  manifest.ts
  PathCollectionPanel.vue
src/components/path/
  PathList.vue
  PathRow.vue
  PathEntryEditor.vue
  PathEndpointPicker.vue
  PathAxesField.vue
  PathRefBadge.vue
  PathOverlapBadge.vue
src/model/path/
  pathEntry.ts          create/validate/normalize
  pathNodes.ts          positionNodeTimes / adjacency / matchTolerance
  pathRefs.ts           clip/path 引用扫描、删除/重命名联动
  pathSelection.ts      Selection.pathId ↔ panel row
```

- `pathEntry.ts` 不依赖 Vue；只做纯数据。
- `PathEndpointPicker` 只产出节点时间，不产出自由数字。
- `PathRefBadge` 点击发 `Selection`，不直接改播放头以外状态。
- `PathCollectionPanel` 通过 `@workbench/api` 拿文档、选择、命令。

## 验收

1. 新建路径：选 `shot_a`，A=0，B=3，默认 id `p_1`，axes 三轴，geometry `line`；保存后 `paths[0]` 字段完整。
2. 目标片段没有 id：新建禁用；点“设置片段 id”后可用。
3. 片段只有一条位置节点：新建禁用；列表已有路径显示“节点不足”。
4. 只选 A=0 不选 B：无法添加；A 选最后节点时 B 为空。
5. 端点下拉只有节点时间；手输/粘贴数字不进入 `from/to`。
6. 同片段建 `0→3` 与 `0→3`：第二条 block；改 `1→4` 可保存；两行都显示重叠徽标。
7. 在 `0→3` 路径中间插入 `t=1.5` 的位置帧：默认阻止；选“删除路径并继续”后路径消失、帧插入；一次撤销全恢复。
8. 删除 `t=3` 的位置帧：路径 `0→3` 阻止；选“删除路径并继续”后两者一起删。
9. 重命名片段 id `shot_a` → `shot_b`：路径 `clip` 同步；路径 id 不变。
10. 删除 `shot_a` 片段：路径引用阻止；删路径后可删片段。
11. 只勾 `x,z` 的路径：预览只覆盖 x/z；y 用普通位置采样；保存 `axes=["x","z"]`。
12. axes 全不勾：添加按钮禁用；已有条目 block。
13. 非法 geometry：本地 block，展开显示 `type` 和参数错误；修好后保存。
14. 路径面板关闭再开：草稿和选中 `pathId` 恢复；文档未提交的改动不落盘。
15. 主时间轴：没有路径行、端点、覆盖条；路径面板可停靠 `document.drawer` 或拖到其他 slot。
16. `grep pathId`：路径面板选中使用 `Selection.pathId`，没有数组下标定位。
