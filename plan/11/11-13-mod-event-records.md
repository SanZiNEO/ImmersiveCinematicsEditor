# 11-13 MOD_EVENT 事件记录

## 目标

把 `MOD_EVENT` 轨的 `objects.mod_event` 做成“模组扩展事件”的记录编辑器：每条记录有片段局部时间、事件名和任意对象数据。它不执行命令、不驱动玩家移动，也不进规则动作。

MOD_EVENT 是给模组消费者的数据通道；当前内置播放器不消费它，编辑器只保证格式、校验和落盘，不伪造“已触发效果”。

## 对象结构

```text
clip.objects.mod_event:
{
  "value": {
    "event_type": "mod_event",
    "data": { "chapter": 1 }
  },
  "keyframes": [
    {
      "time": 0.0,
      "value": {
        "event_type": "weather_change",
        "data": { "rain": true, "duration": 120 }
      }
    }
  ]
}
```

- `mod_event` 是 `mode=event`、`type=event_record`，必须有 `keyframes`。
- 每条 keyframe：`time` 非负有限、严格递增；`value` 是记录对象。
- 一个片段只能有一个 `mod_event` 对象；不新建第二条轨。
- `time > duration` 的记录在运行时编译期丢弃；编辑器新建限制在时长内，旧记录显示“超出时长，运行时丢弃”。
- 对象级 `value` 可提供 `event_type` / `data` 缺省；记录级可覆盖。
- 记录里的 `value` 必须是对象；不能直接写数组或字符串。

## 记录字段

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `event_type` | 记录级可省，最终必须有值 | string | 事件名；可自定义；空串非法 |
| `data` | 否 | object | 任意嵌套数据；顶层必须是对象；缺省取对象级 data |

- 记录级 `event_type` 缺省时取对象级显式 `event_type`；对象级也没写就报错“缺少 event_type”。
- 对象级 schema 缺省是 `mod_event`，但校验器只认**显式写出**的对象级 `event_type` 作为记录回退；编辑器默认在每条记录写 `event_type`，不依赖这个回退。
- `event_type` 没有固定枚举；`weather_change`、`chapter_2`、`mymod:cutscene` 都合法，只要非空。
- `data` 顶层只能是 JSON 对象；对象内部可以是对象、数组、字符串、数字、布尔、null 任意嵌套。
- `data` 数字必须是有限数；未知成员不拒绝，因为 data 是自由结构。
- `id`、`command`、`position` 都不属于 MOD_EVENT；写了报错。

## data 编辑

- 默认“结构化键值”编辑：键值行，值类型可选 object / array / string / number / boolean / null。
- 高级“原始 JSON”视图：直接编辑对象；应用前校验是 JSON 对象，不是数组/标量。
- 顶层数组、字符串、数字、布尔、null：block；提示“data 顶层必须是对象”。
- 嵌套数组/对象允许；不展开成脚本字段，不建 schema。
- 数字保持 JSON 数字，不强制转字符串；布尔保持布尔，不写成 `"true"`。
- 空对象 `{}` 合法；省略 `data` 与 `{}` 不同：前者回退对象级/空，后者显式空对象。
- 不提供“绑定到规则/触发器”的按钮；MOD_EVENT 是独立数据通道。

## 对象级缺省

```text
对象缺省
├ event_type: mod_event
└ data: { "chapter": 1 }
```

- 对象级 `event_type` 写进 `value`；记录级不写时继承。
- 对象级 `data` 写进 `value`；记录级不写时继承。
- 记录级 `data` 写 `{}` 时覆盖为显式空对象，不继承。
- 对象级 `event_type` 为空串：block；不要让记录落回 schema 默认。
- 改对象级缺省不批量改已有记录；只在记录未写该字段时生效。

## 时间与消费

- 事件是离散记录，不插值、不采样。
- `time=0` 在第一次推进时触发；区间 `(上次, 本次]`。
- 片段循环、宏观循环不重放已 fired 的记录；显式 seek 前跳不补，后跳可重新触发目标之后。
- `pingpong` 在事件轨上拒绝。
- 当前内置 `ModEventTrackPlayer` 不消费 MOD_EVENT；记录由第三方消费者自行编译读取。
- 编辑器不显示“已触发/未触发”“生效/未生效”，只显示格式与时间。
- 事件名不映射到命令；不要写 `/say` 之类命令语法，MOD_EVENT 不是命令通道。

## 行为页详情

```text
MOD_EVENT · intro · 3 条
├ 对象缺省：event_type=mod_event，data={chapter:1}
├ 记录 1  t=0.0s  weather_change  data={rain:true}
├ 记录 2  t=2.0s  继承 event_type，data={chapter:1}
└ 记录 3  t=4.0s  chapter_2  data={}
```

每条记录编辑：

- 时间：秒，片段局部；显示全局时间换算。
- `event_type`：文本输入；空串报错；显示“继承对象缺省”状态。
- `data`：结构化/原始 JSON 双视图；顶层对象校验。
- 删除、复制、上下移动；复制需改时间避免相同。
- 排序按 time 升序；不允许相同 time。
- 超出时长：新建阻止；旧记录红框。

## 摘要

- `t=1.5s · weather_change · data 3 键`
- `t=2.0s · 继承 mod_event · data {chapter:1}`
- `t=4.0s · chapter_2 · data {}`
- 超时长：`t=5.0s · 超出时长（运行时丢弃）`
- `event_type` 为空：`缺少 event_type`

## 校验

| 检查 | 级别 | 处理 |
|---|---|---|
| `mod_event` 对象不是 mode=event / 无 keyframes | block | 对象红框 |
| 一个片段多个 `mod_event` 对象 | block | 只允许一个 |
| keyframe 缺 time/value | block | 帧红框 |
| `time` 负数/非有限/非递增 | block | 时间红框 |
| `time > duration` | warn | “运行时丢弃”；新建阻止 |
| 记录 `value` 非对象 | block | 记录红框 |
| `event_type` 记录与对象级都缺失 | block | “缺少 event_type” |
| `event_type` 空串/非字符串 | block | 事件名红框 |
| `data` 顶层非对象 | block | data 红框 |
| `data` 数字非有限 | block | data 红框 |
| `command` / `position` / `id` 出现 | block | 只读报错 |
| 未知记录成员 | block | 只读报错 |
| 对象级 `event_type` 空串 | block | 缺省区红框 |

## 验收标准

1. 新建 MOD_EVENT：对象级 `event_type=mod_event`，一条 t=0 记录；记录可继承。
2. 记录级不写 `event_type`、对象级写了：显示“继承 mod_event”，保存合法。
3. 记录级与对象级都不写：block“缺少 event_type”。
4. `event_type` 空串：block；不落回默认。
5. `data` 顶层数组/字符串/数字：block；提示“顶层必须是对象”。
6. `data` 嵌套对象/数组/布尔/null：保存原样，不转字符串。
7. 记录级 `data:{}`：显示显式空对象，不继承对象级 data。
8. 记录省略 `data`：显示继承对象级 data；对象级也没有则显示空。
9. `command` / `position` / `id` 写进 MOD_EVENT：block。
10. `time=0` 首次推进触发；`time>duration` 显示丢弃。
11. 两条 time 相同：阻止；提示改时间。
12. 片段循环不重放；seek 后跳可重新触发目标之后。
13. `pingpong` 用在 MOD_EVENT：block。
14. 内置播放器不消费：详情不显示“已生效”，只显示“数据记录”。
15. 保存重开：对象缺省、记录 event_type/data/time 原样恢复。
