# 06-10 对象与节点诊断

## 目标

把本地校验和服务端 `script.validate` 的 issue 落到行、节点和组头上，并能按面板归属正确定位：静态问题去属性面板，动画问题去效果面板。缺失必填字段不再通过“添加属性”弹层处理，而是在属性面板显示未设置行。

## 数据模型

```ts
interface ObjectIssue {
  id: string
  code: string                 // L01–L34 / server code
  severity: 'block' | 'error' | 'warn' | 'info'
  clipKey: string
  objectPath?: string
  keyframeTime?: number
  message: string
  source: 'local' | 'server'
  panel: 'properties' | 'effects'  // 由 panelMembership 派生，不写死
  fix?: { kind: 'focus'; path?: string; time?: number }
}
```

- issue 只读；不直接改文档。
- `id` 由 `code+clipKey+path+time` 生成，稳定；重算不重复。
- `panel` 由 `resolveIssuePanel(issue, panelMembership)` 派生：动画行/节点 → `effects`；静态/未设置/必填缺失 → `properties`。
- 同一路径多个 issue 聚合到行；节点 issue 聚合到节点 tooltip；组头显示最高 severity。

## 严重级别与样式

| 级别 | 行 | 组头 | 节点 | 头部 |
|---|---|---|---|---|
| `block` | 红边框 + 红点 | 红点 | 红环 | 红徽标 |
| `error` | 橙边框 + 橙点 | 橙点 | 橙环 | 橙徽标 |
| `warn` | 黄点 | 黄点 | 黄点 | 黄徽标 |
| `info` | 灰点 | 灰点 | 灰点 | 灰徽标 |

- 颜色只做辅助；每处有图标/tooltip 文本，不只靠颜色。
- 行 hover 显示最高级别消息摘要；点击打开诊断条。
- 节点 tooltip 追加 issue 首条；多条显示“+N”。

## 诊断条

效果面板和属性面板底部各有一条可折叠诊断条：

```text
⚠ 2 errors · 1 warning        [只看当前片段] [展开]
  L12 position.y 必填未设置                [定位]
  S03 yaw@2.0 服务端拒绝: ...              [定位]
```

- 默认显示最高级别 + 计数；展开显示当前片段 issue 列表。
- `只看当前片段` 默认开；关闭后显示全局 issue，但定位仍按 clipKey。
- 点击“定位”调用 `revealIssue(issue)`。
- 诊断条不占文档高度；折叠后只留一行。
- 面板无 issue 时显示“无问题”；不显示空白条。

## 定位

```ts
revealIssue(issue: ObjectIssue)
```

1. 若 `issue.panel==='effects'`：
   - 确保 `clip.effects` 可见；若被抽屉收起，先恢复。
   - 选择片段（不改变主时间轴选择），展开对应效果组和行。
   - 若带 `keyframeTime`，把局部播放头移到该时间并选中节点。
   - 滚动到行/节点；显示 tooltip 或行内错误。
2. 若 `issue.panel==='properties'`：
   - 确保 `selection.properties` 可见；恢复抽屉。
   - 展开对应属性组，滚到行；未设置行聚焦值控件。
   - 若 issue 同时关联效果面板（例如动画节点校验失败），仍在属性面板显示摘要，并提供“在效果面板查看”二次入口。
3. 定位不改变文档、不新增选择、不展开主时间轴对象行。
4. 定位失败（clipKey 失效）：显示失效原因 + 撤销入口；不跳到相邻片段。

## 必填与缺失字段

- 必填叶子 `present=false`：属性面板对应行显示“必填未设置”+ 错误边框；不弹“添加属性”选择器。
- 点击“定位”：属性面板展开组并聚焦该行；不自动创建对象。
- 用户输入值后 `object.add` 创建对象；issue 重算；若仍有其他缺失，保留下一条。
- 必填缺失不进入效果面板；效果面板不显示该叶子。
- 服务端返回的必填 issue 与本地同 code 时合并，保留 server 来源和消息。

## 未知路径

- 无关键帧的未知路径：属性面板“未知/扩展”组只读；issue 定位到属性面板。
- 有关键帧的未知路径：效果面板未知组只读节点；issue 定位到效果面板。
- 未知路径 issue 不提供“删除字段”按钮；只提供复制路径/复制 JSON。
- `mode/type` 无法解析时行标“未知”，不猜测控件。

## 组头与计数

- 组头显示本组最高 severity 圆点 + `N issues`。
- 组内隐藏行（在另一面板）有 issue 时，组头仍计数；点击组头徽标打开诊断条，不强行展开另一面板。
- 属性面板组头“在效果面板”徽标旁可带 issue 点；效果面板组头同样。
- 折叠组保留 issue 点；不因折叠丢失计数。

## 服务端校验

- 打开片段/保存/推送后调用 `script.validate`；结果写 `services.status`，不写 `doc`。
- 服务端 issue 覆盖同 code 本地 issue；本地只保留未覆盖的即时提示。
- `block` 阻止保存/推送；`error` 阻止推送但允许本地保存草稿；`warn/info` 只提示。
- 服务端返回未知 `objectPath`：进“未知/扩展”组只读；不创建对象。
- 服务端超时/失败：诊断条显示“服务端校验未完成”，本地 issue 仍可见；不把超时当通过。
- 保存前未烘焙缓动的提示由 06-06 负责；诊断条可并列显示，不合并级别。

## 与行/节点交互

- 行内错误不阻挡其他行编辑；`block` 行控件禁用，`error` 行可编辑但提示。
- 节点 issue 不阻止拖动其他节点；当前节点 `block` 时禁止提交该节点修改。
- 修复后 issue 自动消失；不需要手动“清除”。
- 撤销/重做后按 `docRevision` 重算；不保留过期 issue。
- 诊断条展开状态存 `session`，不写文档。

## 验收

1. 必填 `position.y` 缺失：属性面板行“必填未设置”+ 红框；效果面板不出现该行；点定位聚焦属性行。
2. 输入 `position.y` 值：创建对象；issue 消失；一次撤销恢复未设置和 issue。
3. `yaw@2.0` 服务端 error：效果面板节点橙环；诊断条列出；定位选中节点并移播放头。
4. 同一路径两个 issue：行只显示最高级别；hover 显示两条；诊断条计数 2。
5. 组折叠时仍有 issue：组头保留红点；展开后行仍标记。
6. 未知路径无帧：属性面板只读；定位不打开效果面板。
7. 未知路径有帧：效果面板未知组只读；定位不打开属性面板。
8. 服务端超时：诊断条显示“未完成”；本地 warn 仍显示；保存不被误判通过。
9. `block` 行：控件禁用；其他行仍可编辑；保存按钮显示阻止原因。
10. 撤销修复：issue 重新出现；不需要刷新整页。
11. 两个面板同时打开：定位只切目标面板的展开/滚动，不关闭另一个面板。
