# 07-08 路径时间映射

## 目标

给每条路径条目编辑 `timing`：线性推进或关键帧推进。`timing` 只决定沿路径的归一化弧长进度 `s`，不改变 `geometry` 的形状，也不改变 `from/to` 端点。

## 数据模型

```ts
type PathTimingDoc =
  | { type: 'linear' }
  | { type: 'keyframes'; points: Array<{ t: number; s: number }> }

interface PathEntryDoc {
  // ...
  timing?: PathTimingDoc   // 缺省 = linear
}
```

- `t`：片段局部时间归一化值，`0` = 路径起点，`1` = 路径终点。
- `s`：路径弧长进度，`0` = 起点，`1` = 终点。
- `points` 至少 2 项。
- `points[0].t = 0`、`points[0].s = 0`。
- `points[n-1].t = 1`、`points[n-1].s = 1`。
- `t` 单调非减；允许相等。
- `s` 单调非减；允许相等。
- `t` 相等时按后一条的 `s` 跳变，形成竖直台阶。
- `timing` 省略或 `{type:'linear'}` 等价。

示例：

```json
{
  "timing": {
    "type": "keyframes",
    "points": [
      { "t": 0.0, "s": 0.0 },
      { "t": 0.3, "s": 0.1 },
      { "t": 0.7, "s": 0.6 },
      { "t": 1.0, "s": 1.0 }
    ]
  }
}
```

## 语义

```text
u = (localTime - from) / (to - from)
s = timing.progress(u)
point = geometry.evaluate(s)
```

- `u` 由路径条目自己的 `from/to` 归一化；不是整段脚本时间。
- `s` 再交给几何的弧长反解；`linear` = 匀速弧长。
- `keyframes` 在相邻 `(t,s)` 之间线性插值；`t` 相等时跳变。
- `s` 不变 = 路径暂停；`s` 跳变 = 路径瞬移。
- `timing` 不改变控制点、半径、角度、锚点或端点绑定。
- `timing` 不改变 `paths[].axes`；只改被覆盖轴的推进。
- `FREE` 锚点路径仍按几何弧长算 `s`；端点只用于绑定。

## 校验

| 条件 | 处理 |
|---|---|
| `points < 2` | block |
| 首项不是 `(0,0)` | block |
| 末项不是 `(1,1)` | block |
| `t` 不是 `[0,1]` | block |
| `s` 不是 `[0,1]` | block |
| `t` 递减 | block |
| `s` 递减 | block |
| `t` 有 NaN/无穷 | block |
| `s` 有 NaN/无穷 | block |
| `type` 不是 `linear/keyframes` | block |

- 相等 `t` / 相等 `s` 合法，不报错。
- `points` 数量上限 256；超过时虚拟化并提示，不截断保存。
- 数值写 `float32` 范围的 JSON number；不做隐式四舍五入。
- 校验失败不写文档；草稿保留，切走再回来可继续改。

## 编辑器

```text
时间映射
  (•) 线性   ( ) 关键帧

  t        s
  0.000    0.000   [固定]
  0.300    0.100   [删除]
  0.700    0.600   [删除]
  1.000    1.000   [固定]

  [+ 添加中间点]   [按弧长复位]
  s(t) 预览
```

### 线性

- 默认；`timing` 省略或写 `{type:'linear'}`。
- 从关键帧切线性：弹确认“删除中间点”；提交后 `points` 从文档移除；一次撤销恢复。
- 线性下不显示点表；显示“0→1 匀速弧长”。

### 关键帧

- 首末行固定，不可删除、不可改 `t/s`。
- 中间行可增删、改 `t/s`、上下移动。
- 添加默认：取当前行与下一行的中点；`t/s` 线性插值。
- 排序按 `t` 稳定排序；相同 `t` 保持添加顺序，后值生效。
- 删除中间点不自动重排首末；首末固定。
- “按弧长复位”把中间点 `s` 改成与 `t` 相同（恢复线性），保留 `t`。
- 点表支持键盘：`Enter` 新增下一行，`Backspace` 删除当前行，`↑/↓` 移动行。
- 数值输入显示 3 位小数，但底层保存原值；拖拽/步进按 `0.001`。

### `s(t)` 预览

- 横轴 `t` 0..1，纵轴 `s` 0..1；折线 + 点。
- 相等 `t` 画竖直线；相等 `s` 画水平线。
- 不在预览里改几何；几何预览由 07-10 负责。
- 预览线只读；拖点通过点表输入，不在图上直接拖改（避免和路径预览手势冲突）。

## 与其他模块

- 路径条目编辑器：`PathEntryEditor` 内嵌 `PathTimingEditor`；切换条目时保存/丢弃草稿按 `pathId`。
- 几何表单：切类型不清 `timing`；`timing` 与 geometry 独立。
- 路径生成器：默认写 `{type:'linear'}`；生成后可改。
- 路径预览：读 `timing.points` 画 `s(t)`；不调用运行时。
- 路径集合：timing 错误计入 `PATH_TIMING_INVALID`，行显示问题数。
- 端点/节点变更：不影响 timing；`from/to` 改后 `t` 仍归一化到新长度。

## 组件

```text
src/components/path/timing/
  PathTimingEditor.vue
  TimingModeField.vue
  TimingPointTable.vue
  TimingCurvePreview.vue
src/model/path/timing/
  timingDoc.ts       线性/keyframes 读写、默认点
  timingValidation.ts 端点/范围/单调/上限
  timingCurve.ts     s(t) 折线派生
```

- `timingDoc.ts` 不依赖 Vue；输出 `PathTimingDoc` 或错误。
- `timingValidation.ts` 与 `PathTiming.of` 同规则；错误字段精确到 `points[i].t` / `.s`。
- `TimingCurvePreview` 只读 `points`，不修改文档。

## 验收

1. 新路径默认省略 `timing`；保存后是线性；预览 `s(t)` 为对角线。
2. 切关键帧：自动生成 `(0,0)`、`(1,1)` 两行；保存 `points` 两项。
3. 添加中间点：默认取相邻中点；`t/s` 可改；保存后按 `t` 排序。
4. 首项改 `t=0.1` 被拒；末项改 `s=0.9` 被拒；首末行不可删除。
5. `t=0.3,s=0.8` 后接 `t=0.2,s=0.9`：递减 block，字段定位到第二行。
6. `t=0.3,s=0.8` 后接 `t=0.3,s=0.9`：允许；预览竖线；运行时该时刻跳变。
7. `t=0.3,s=0.8` 后接 `t=0.4,s=0.8`：允许；路径暂停；预览水平线。
8. `s=0` 或 `s=1` 中间点：允许；路径在中间停住/到终点。
9. 关键帧切线性：确认后 `points` 移除；一次撤销恢复所有点。
10. 线性切关键帧：重新生成首末两项；中间点为空；保存通过。
11. 256 点上限：第 257 个添加被拒；已有 256 点可保存、可虚拟化滚动。
12. 改 `from/to`：timing 点不变；`t` 归一化到新长度；预览 `s(t)` 形状不变。
13. 切 geometry 类型：timing 保留；`script.validate` 通过。
14. 路径预览的 `s(t)` 与点表一致；几何形状不因 timing 改变。
15. 保存重开：`linear` 仍省略/线性；`keyframes` 点原样保留；相同 `t` 顺序不变。
