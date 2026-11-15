# 05-06 脚本移动与重命名事务

## 目标

两件事分开做：移动脚本只改路径，`meta.id`、`requires`、文件内容一字不动；改脚本 `meta.id` 是一次全包引用事务，先预览、再备份、再原子改写、失败回滚。两件事都不允许把整个项目改到一半。

## 移动脚本

### 规则

- 移动 = 改相对路径；`meta.id`、`requires`、`timeline`、所有字段原样保留。
- 源路径、目标路径都必须是 `scripts` 根内、`/` 分隔、`.json` 后缀；越界/绝对路径/`..` 拒绝。
- 目标父目录必须已存在；05 不隐式创建目录（先走 05-02 新建文件夹）。
- 目标文件已存在 → `target_exists`，不覆盖；大小写按文件系统实际行为，不做“自动改名”。
- 源不存在 → `source_missing`；源是目录 → `not_a_file`。
- 移动原子：同盘 `Files.move(source, target, ATOMIC_MOVE)`；不支持原子移动时 `Files.move`，失败回滚（目标不存在、源仍在）。
- 移动不改任何文件内容；如果目标路径就是当前打开文档，03 的 `currentPath` 同步更新，文档不重载、不弄脏。

### 消息

```text
script.move  { from: string, to: string }
  → { ok: true, from: string, to: string }
  → error { code: "source_missing" | "target_exists" | "invalid_path" | "not_a_file" | "io_error", message }
```

执行顺序：

1. 校验 `from` / `to` 都是合法相对路径；`from != to`。
2. `resolveSafe` 两侧；源存在且是常规文件；目标父目录存在且是目录；目标不存在。
3. 若目标路径以 `.json` 结尾且是目录 → 拒绝。
4. `Files.move`；成功后刷新 `ScriptIndexService` 缓存版本，发 `script.graph.invalidated`（path 变化）。
5. 若当前打开文档路径是 `from`，更新 `currentPath=to`；不重新 `script.load`，不重置撤销栈。
6. 图布局按 05-04 的 `scriptId` 兜底重绑定；不发 `script.requires.mutate`。

### 验收

- 移动 `chapter/a.json` → `boss/a.json`：文件内容字节不变；`meta.id` 不变；所有 `requires` 不变；图节点 path/folder 更新；打开中的文档路径更新、脏标记不变。
- 目标已存在：拒绝，源文件仍在，图不乐观移动。
- 目标父目录不存在：拒绝，提示先建文件夹；不自动创建。
- 源路径 `../a.json` / `C:\a.json`：拒绝，错误可读。
- 两个窗口同时移动同一文件：第二个 `source_missing`，不覆盖。
- 移动后撤销：05 不把文件移动进文档撤销栈；作者要移回需再执行一次移动（图/文件操作独立于文档历史）。

## 改 `meta.id`

### 规则

- 只改目标脚本的 `meta.id`；新 id 必须匹配 `^[a-zA-Z0-9_]{1,32}$`。
- 新 id 在**全项目**唯一；与任何其他脚本 `meta.id` 重复 → 拒绝。
- 目标脚本必须有非空 `meta.id`；空 id 先补 id，不走重命名事务。
- 原 id 在全项目重复 → 拒绝 `duplicate_old_id`；先修重复，否则无法确定改哪个引用。
- 新 id 与原 id 相同 → 拒绝 `no_change`，不写盘。
- 文件路径不变；`meta.name`、作者、描述、轨道、触发器、规则、路径、exit 全部原样。
- 触发器 `id` / identity、`triggerIndex`、`requires` 数组顺序不变；只改引用值。

### 引用改写范围

只改以下语义位置：

1. 目标脚本的 `meta.id`。
2. 所有脚本触发器 `requires` 中的**字符串简写**：`"oldId"` → `"newId"`。
3. 所有脚本触发器 `requires` 对象中 `type` ∈ `script_played` / `script_started` / `script_completed` 且 `script === oldId` 的 `script` 值。
4. 条件树中脚本型条件的 `script` 值：`type` ∈ 上述三种、`script === oldId` 的对象（典型为 `conditions.list[]` 里的脚本条件）。

明确不改：

- 自定义前置 `data` 里的其他 `script` 字段（类型不是上述三种）；
- 其他脚本的 `meta.id`；
- `rules` / `rule_bindings` / `paths` / `exit` 里的片段 id；
- 触发器 `id` / identity；
- 文件路径、目录名；
- `meta.name` / `description` / `author`；
- 未知键、注释（JSON 不支持注释）、数组顺序、对象键顺序。

### 预览

```text
script.refs.preview { path: string, oldId: string, newId: string }
  → {
      oldId, newId, targetPath,
      changes: [{ path, jsonPath, kind, oldValue, newValue }],
      affectedFiles: number,
      affectedEntries: number,
      blocked: [{ code, path, message }],
      previewHash: string
    }
```

- `jsonPath` 用点分/`[i]` 形式，如 `meta.triggers[2].requires[1].script`；前端可定位。
- `changes` 只列将要改的叶子，不列整份文件。
- `blocked` 非空 → 不提供“应用”按钮；例如新 id 重复、原 id 重复、目标缺 id、新 id 非法、目标文件读失败。
- `previewHash` 是 `changes + affectedEntries` 的稳定哈希；应用时必须带回。

### 应用

```text
script.refs.apply { path, oldId, newId, previewHash, expectAffected: number }
  → { ok: true, affectedFiles, affectedEntries, backupDir }
  → error { code: "stale_preview" | "blocked" | "dirty_document" | "io_error" | "lock_busy", message }
```

执行顺序：

1. 取全局 `RefactorLock`；已有事务 → `lock_busy`。
2. 重新跑预览；`previewHash` 或 `affectedEntries` 与提交值不一致 → `stale_preview`，不写。
3. 备份所有将改文件到 `immersive_cinematics/editor/refactor-backups/<timestamp>-<oldId>-<newId>/`，写 `manifest.json`（原路径、备份路径、sha256、oldId/newId）。
4. 逐文件写 `*.tmp`，再 `Files.move(tmp, target, REPLACE_EXISTING)`；只改上述语义叶子。
5. 写 `refactor.lock`（含 manifest 路径、状态 `writing`），启动时若发现 `writing` 锁 → 按 manifest 回滚未完成事务。
6. 全部成功 → 删除锁，刷新索引，发 `script.graph.invalidated`（全部受影响 path），返回 `backupDir`。
7. 任一失败 → 按 manifest 用备份恢复所有已写文件；删除临时文件；删除锁；返回 `io_error`，不改内存文档。

### 打开文档

- 应用前查所有受影响 path 的打开文档：
  - 任一文档 `dirty=true` → `dirty_document`，不写盘；返回 dirty 路径列表，提示“先保存/放弃这些文档”。
  - 文档只读/保存失败 → 同样阻断，不覆盖。
- 应用成功后，受影响且 `dirty=false` 的打开文档就地更新：
  - 目标文档更新 `meta.id`；
  - 其他文档更新对应 `requires`/条件 `script` 值；
  - `docRevision+1`，`dirty=false`；不重载整份文件、不重置撤销栈。
- 打开文档的更新失败不回滚磁盘事务；标记该文档 `stale`，提示“重新打开以同步”；不把原有数据保存回磁盘。

### 保存锁

事务期间：

- 禁止 `script.save`、`script.delete`、`script.move`、`script.requires.mutate`、`script.folder.*`、第二个 `script.refs.apply`。
- 允许 `script.load`、`script.graph`、`script.validate`、`graph.layout.*`。
- 前端状态区显示“引用事务进行中，保存已暂停”；不是弹窗阻塞整个编辑器。
- 事务通常毫秒级；超过 5 秒显示进度/取消（取消只停止后续文件，已写文件回滚）。

### 备份与清理

- 备份目录不在 `scripts` 下，避免被 `Files.walk` 扫进图。
- 每次事务一个目录；`manifest.json` 记录原文件哈希。
- 保留最近 10 次；更早的由启动清理，不删当前锁引用的备份。
- 备份失败 → 不开始写；不留半份备份。

## 验收标准

- 移动脚本后对文件做 sha256：内容不变；`meta.id` 不变；图 path/folder 变；布局按 id 跟随。
- 改 `chapter/boss.json` 的 `meta.id: boss` → `boss_v2`，三个其他脚本的字符串/对象型 `requires`、一个 `conditions.list` 脚本条件被改；`rules/paths/exit` 一个字节不变。
- 预览列出 1 个 `meta.id` + 4 个引用叶子；`affectedFiles=4`；应用后语义 diff 正好这 5 处。
- 新 id 与现有脚本重复：预览 `blocked`，应用按钮禁用；不写盘。
- 原 id 在全项目重复：预览 `blocked=duplicate_old_id`；不猜改哪一个。
- 预览后另一个窗口改了被引用文件：应用 `stale_preview`；不覆盖别人的修改。
- 目标或受影响文档有未保存修改：应用 `dirty_document`，列出路径；不写盘；作者保存/放弃后再应用。
- 应用成功后打开的目标/引用文档 `meta.id`/requires 就地更新、`dirty=false`、撤销栈不变；不重载整份文件。
- 写第 2 个文件时模拟 IO 失败：第 1 个文件恢复原字节；锁删除；无半写。
- 事务中按 `Mod+S`：保存被拒绝并提示“引用事务进行中”；文档脏标记保留。
- 事务中崩溃：重启发现 `refactor.lock` + `writing`，按 manifest 回滚；图/文档可打开。
- 备份目录不出现在 `script.list`/图节点里；保留 10 次后既有备份清理。
- 重命名事务不改时间轴：总时长字段 0 命中。

## 事务范围

- 文件夹整体移动/递归路径改动走 05-02；本事务只处理单脚本移动与 `meta.id` 改写。
- 只改 `meta.id` 和引用位置；`meta.name`、文件名、目录名保持不变。
- 只改语义位置，不做原 id 的全字符串替换。
- 只处理当前 `scripts` 根，不跨项目/服务器。
- 文件移动独立于文档撤销栈；移回需再执行一次移动。
- 重复 id 由作者先处理；事务不自动修复。
- 不静默覆盖目标文件；不静默创建父目录。
- 序列化只改目标叶子；不重排 JSON 数组/对象键。
