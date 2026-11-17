# 05-06 脚本 id 重命名与引用同步

## 目标

改一个脚本的 `meta.id` 时，把项目里所有指向它的前置引用一次性改对：先预览影响面，再备份、原子改写、失败回滚。要么全改，要么全不改。

脚本**移动/改名（文件路径）不在本轮**：目录与文件名由外部文件管理，05 不做移动、不做目录 CRUD。本文件只处理 `meta.id`。

## 为什么需要它

图上的一条边指向的是 `meta.id`，不是文件路径：

```text
A.meta.triggers[i].requires[0] = { type: "script_played", data: { script: "old_id" } }
```

把 `old_id` 改成 `new_id` 时，所有引用 `old_id` 的前置都要一起改，否则图上的边会全部变成「缺失」。

## 预览

```text
script.refs.preview { from: string, to: string }
→ {
    ok: true,
    from, to,
    files: [{ path, references: number }],
    totalReferences: number,
    warnings: string[]
  }
→ error { code, message }
```

- `from` = 当前 `meta.id`；`to` = 新 id。
- 扫描全部脚本，统计 `requires[].data.script === from` 的处数；字符串简写同样计数。
- 引用面由 `ScriptRefactorService` 枚举，不在编辑器里硬编码字段表；至少覆盖：
  - 每个脚本每个触发器的 `requires`（内置条目的 `data.script`，以及字符串简写）；
  - 其他由服务端登记的「脚本 id 引用」（如规则条件里引用脚本的字段，由服务端给出清单）。
- 预览不改任何文件；不改索引缓存。
- 当前脚本自己引用自己的条目：在预览里单独标出，默认**一起改**（否则改完立刻变自引用）。

## 应用

```text
script.refs.apply { from: string, to: string, expectedFiles: number }
→ { ok: true, changed: [{ path, references }], graphVersion }
→ error { code, message, rolledBack: boolean }
```

校验顺序：

1. `from` 非空且匹配脚本 id 规则；`to` 非空且匹配同一规则。
2. `to` 在项目内不存在（按 `meta.id`）；`from` 至少在一个脚本里存在。
3. `to !== from`。
4. `RefactorLock` 可用；否则 `lock_busy`，不排队。
5. `expectedFiles` 与当前扫描结果一致；不一致 → `stale_preview`（项目在预览后被改过），要求重新预览。

写回：

1. 对每个受影响文件：读原文 → 只替换引用处（保留缩进/键序/其他字段）→ 写 `path.tmp` → 原文件复制为 `path.bak`。
2. 全部文件写成功后，把被改名脚本自己的 `meta.id` 改成 `to`（同一套原子写）。
3. 任一文件失败 → 用各自的 `.bak` 回滚**所有已写文件**；回滚失败要报告具体文件，不假装成功。
4. 成功后：刷新 `ScriptIndexService`，发 `script.graph.invalidated { kind: "refactor", paths }`，返回 `graphVersion`。
5. 若当前文档打开的是被改名脚本且未脏：内存 `meta.id` 同步为新值，`docRevision+1`，不重载、不弄脏。
6. 若当前文档已脏且涉及被改文件：拒绝执行并提示「先保存/放弃当前修改」。

## 图上与编辑器页的入口

- 编辑器页：文档顶栏 / 元信息表单里的「改脚本 id」，必须先走预览。
- 脚本页：节点右键「改脚本 id…」，同样先预览；不提供「直接改」。
- 两个入口调同一对消息，不各写一套。

## 与图上改前置的边界

| 操作 | 命令 | 改什么 |
|---|---|---|
| 图上加/删/换前置 | `script.requires.mutate`（05-07） | 只改依赖方脚本的一条 `requires` |
| 改脚本 id | `script.refs.apply`（本文件） | 改 id 本身 + 所有引用它的前置 |

- 两者都占用 `RefactorLock`，不能并发写同一项目。
- 改 id 不改变「谁依赖谁」的拓扑：边只是换了 id 字符串，图的形状不变。
- 改前置不改任何 id。

## 验收标准

- 预览 `old_id → new_id`：列出 3 个文件、共 5 处引用；不改文件；`totalReferences=5`。
- 应用后：3 个文件的引用都变成 `new_id`；被改名脚本 `meta.id=new_id`；其他字段、缩进、键序不变（对比 sha256 只在这些位置变化）。
- 新 id 已存在：`target_exists`，不写任何文件。
- 新 id 非法：`invalid_id`，不写。
- 预览后有人改了项目：`stale_preview`，要求重新预览；不半写。
- 写第 2 个文件失败：第 1 个文件已回滚；`rolledBack=true`；原文件内容与操作前一致。
- 回滚失败：报告具体文件与原因；不谎报成功。
- 当前脚本自引用自己：预览标出，应用时一起改；改完不自引用（除非 `to` 等于自己，已被校验拒绝）。
- 当前文档打开被改名脚本且未脏：内存同步、`dirty=false`、不重载、不重置撤销栈。
- 当前文档已脏且涉及：拒绝并提示；不覆盖内存。
- 引用事务进行中再发起：`lock_busy`。
- 图上节点右键改 id：走同一预览；不直接改。
- 改完回脚本页：边仍连在原来的两个节点之间，没有变成「缺失」。
- `grep window.prompt`：0 命中（用内联输入或对话框）。
- `grep Files.move`：本模块不移动文件，只改内容。

## 边界

- 不改文件路径、不改目录、不做目录 CRUD。
- 不改触发器 identity、条件、`delay`、`repeatable`、`continuity`、片段、规则、路径、exit。
- 不做「批量改多个 id」。
- 不自动挑新 id（不生成 `old_id_2`）；由作者输入。
- 不改脚本内容以外的任何东西（布局、偏好、窗口状态都不动）。
