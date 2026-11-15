# 03-07 打开 / 新建 / 保存 / 推送流水线

## 目标

四个操作各有一条固定步骤链，失败点明确。核心原则：**保存和推送都从同一份 `serializeDoc(doc)` 派生；`dirty` 只在服务端确认后清；文件被外部改动不自作主张覆盖。**

## 打开（script.load）

1. `script.load` → `{path, doc}`。
2. `parseDoc(doc)`（纯函数，不改输入）——失败（根不是对象 / meta、timeline 缺失）→ 阻断错误，不进入编辑器。
3. 从 02 目录取字段表，绑定文档里的轨道类型与对象路径（见 03-08）。
4. `validateStructure` 本地检查（不阻断打开；有 `block` 也打开，顶部标「当前脚本无法播放」）。
5. 选中第一个 CAMERA 片段。
6. 派生有限末端。
7. `resetHistory()`，`dirty=false`。
8. 推送预览 + `seek(0)`。

**打开只读不改写文档**：不改文档、不写总时长、不补默认值。

## 新建（script.new）

1. `script.new` → `{path:'untitled.json', doc}`。
2. `parseDoc`。
3. 骨架规则：
   - `meta`：用 02 目录给出的默认值，补 `author:""`。
   - `timeline.tracks`：7 条内置轨道，各带空 `clips`。
   - 引导片段（可选）：一个 CAMERA 片段，`objects` 写 `position_mode:relative`、`position_space:world`、`position.y:2`、`yaw:0`、`pitch:0`、`roll:0`、`fov:70`、`zoom:1`、`transition:cut`——全部是**固定值**，不建关键帧。
   - LETTERBOX 引导：默认不建。
4. `dirty=true`（新建即脏，还没落盘）。
5. 不自动保存；首次保存要求作者输入路径，**不得**覆盖已有 `untitled.json`。

## 保存（script.save）

1. `validateStructure`，有 `block` → 中止显示清单，不写盘。
2. `payload = serializeDoc(doc)`（不烘焙、不剥离、不裁剪）。
3. 指纹检查：外部改过文件 → 冲突，提示「覆盖 / 另存 / 放弃」，不自动合并。
4. `script.save` 成功 → `dirty=false`，更新指纹，异步 `script.validate`；失败 → `dirty` 保持 true。

## 推送（editor.pushScript）

1. `payload = serializeDoc(doc)`。
2. 预览裁剪：muted 的 AUDIO 轨 `clips=[]`（只改 payload，`doc` 不变）。
3. 160ms 防抖，多次 commit 只推最新一份。
4. 失败（断连）→ 标「预览过期」，下次连接补推。

## 验收标准

- 打开 a.json 无修改保存重载：字段/值/独立时间全保留，`dirty=false`。
- 新建保存到 new1.json：文件可被 parser 解析，`objects` 只写标准叶子字段。
- `block` issue 存在时保存中止，文件未被改动（对比 mtime）。
- 保存失败 `dirty` 不清 false。
- muted AUDIO 轨：推送 payload `clips:[]`，但 `doc` 与保存文件里仍在。
- 外部改文件后回来保存：提示冲突，不覆盖。
- 两次新建都存 `untitled.json`：第二次提示改名。
- 新建时所有默认值来自 02 目录；改 02 目录默认值，新建产物同步变，不需要改 IO 代码。
