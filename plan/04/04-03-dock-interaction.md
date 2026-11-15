# 04-03 停靠交互与拖动

## 目标

把面板拖动、停靠、拆分、标签重排、分隔线缩放做成一套可取消、可回滚、只提交一次事务的交互。布局模型归 04-02；本文件只把指针/键盘手势翻译成布局命令，不自己存尺寸、不自己写文件。

## 组成

| 文件/模块 | 职责 |
|---|---|
| `src/workbench/dock/DockSurface.vue` | 渲染 group/tab 条/分隔线/落点预览；不持布局状态 |
| `src/workbench/dock/DockLayoutController.ts` | 手势状态机；把拖动/缩放翻译成 04-02 事务 |
| `src/workbench/dock/DockInputAdapter.ts` | 输入抽象：pointerdown/move/up/cancel、keydown、contextmenu、focus |
| `src/workbench/dock/DropTarget.ts` | 合法落点计算：合并/拆分/新组/重排 |
| `src/workbench/dock/ResizeHandle.vue` | 分隔线：指针 + 键盘 |

`DockInputAdapter` 的 WebUI 实现用 `PointerEvent` + `setPointerCapture`；接口保持输入源无关。

## 拖动起点

- 只从**面板标题**或**标签**拖动；面板内容区、参数输入、滚动条、时间轴片段、效果控件节点、属性面板输入框都不是拖动起点。
- 标题/标签必须有 `tabindex="0"`，既能指针拖，也能键盘触发“移动面板”。
- 拖动阈值 4px；小于阈值视为点击，交给标签激活/折叠。
- 拖动时给面板标题一个 `data-dragging` 状态；不改变内容区焦点，不触发 `blur` 保存。

## 手势优先级

同一指针事件只能命中一个手势。优先级从高到低：

1. 文本输入/IME 组合：输入框、文本域、`contenteditable` 内不启动面板拖动。
2. 滚动条：滚动条拖动不启动面板拖动。
3. 主时间轴片段拖动/裁切/播放头拖动。
4. 效果控件节点拖动/框选/局部标尺拖动。
5. 属性面板值输入/下拉/颜色选择。
6. 游戏飞控/相机输入。
7. 面板标题/标签拖动。
8. 空白区域点击。

实现上由 `DockInputAdapter.hitTest` 返回 `dragSource: 'panel' | 'timeline' | 'effect' | 'input' | 'scrollbar' | 'flight' | 'none'`；`DockLayoutController` 只在 `panel` 时启动。不能用“最后点过哪里”推断。

## 落点

拖动时在 `DockSurface` 上显示合法落点；非法区域不显示或显示禁用态。

| 落点 | 行为 |
|---|---|
| group 中心区 | 合并为该 group 的标签；按标签条插入位置排序 |
| group 左/右边缘 25% | 水平拆分：新 group 在左/右 |
| group 上/下边缘 25% | 垂直拆分：新 group 在上/下 |
| 标签条 | 同 group 内重排；不拆分 |
| 空白工作区 | 新建 group；默认放在该页根 split 的末尾 |
| 抽屉区域 | 并入 `document.drawer` group；抽屉保持默认在主轴上方 |
| 面板自己的原位置 | 不提交；视为取消 |
| 视口外/非法区域 | 不提交；显示“不可停靠”提示 |

落点预览只画矩形/插入线/目标标签 ghost，不真实改布局树；松手才提交。

## 拖动状态机

```text
idle
  → pointerdown(panel title) → pending
pending
  → move > 4px → dragging
  → pointerup → idle（点击）
dragging
  → pointermove → updateDropTarget
  → pointerup(valid target) → commit(one transaction)
  → pointerup(invalid) → cancel
  → Esc / pointercancel / window blur / route change / unmount → cancel
```

- `pending/dragging` 时 `setPointerCapture`；`cancel` 必须 `releasePointerCapture`。
- `cancel` 回滚到拖动前快照；不写 `layout.json`，不进布局历史。
- `commit` 只调一次 04-02 的 `movePanel`/`splitGroup`，成功后清空临时预览；失败回滚并提示。
- 拖动过程中不持久化、不触发脚本历史、不重建预览/文档。
- 拖动结束若目标与原位置相同，按取消处理，不产生空历史。

## 分隔线缩放

- 视觉 4px，命中 8px；`role="separator"`，`aria-orientation` 与 split 方向一致。
- 指针拖动：按下后捕获；移动时只改临时比例；松手提交一次 `resizeSplit`。
- 键盘：聚焦分隔线，`←/→` 或 `↑/↓` 调整 8px；`Shift` 加速到 24px；`Home` 到最小，`End` 到最大；`Esc` 取消。
- 最小尺寸由 04-02 的 panel/split 约束给；不能把可见面板压到 0；抽屉/右侧面板可以折叠到 0。
- 拖动中不持久化；松手/键盘提交一次；连续按键可以先预览、在 `keyup` 或 300ms 合并提交，不能每按一次写文件。
- 分隔线不能同时触发面板拖动；两者命中区分离。

## 键盘移动面板

不要求指针也能完成布局：

1. 聚焦面板标题/标签。
2. `Alt+方向键`：把面板移到相邻 group；没有相邻 group 时提示不可移动。
3. `Alt+Shift+方向键`：在相邻 group 的对应边缘拆分。
4. `Enter` 打开“移动到…”目标列表；`↑/↓` 选目标 group，`Enter` 提交，`Esc` 取消。
5. 命令面板提供 `layout.movePanel` / `layout.splitGroup` / `layout.resizeSplit` / `layout.reset`，所有命令都走同一 04-02 服务。

键盘移动同样只提交一次事务；`Esc` 取消不改变布局。

## 隐藏/恢复

- 面板标题右键/菜单提供“隐藏”；隐藏只把 `visible=false`，不销毁组件（`keepAlive` 面板保留状态）。
- 视图菜单/命令面板提供“显示面板”，按 `pluginId + panelId` 恢复到最后所在 group；group 不存在时回默认槽位。
- 隐藏预览/主轴/效果控件/属性面板不能删除文档或停止预览流；恢复后沿用同一会话。
- 面板被拖到其他 group 后，原 group 空出时按 04-02 规则压缩；不能留一个不可见空壳占空间。

## 事件清理

- 不在 `window` 上挂永久 `pointermove/pointerup`；用 `DockSurface` 的指针捕获 + 本地监听。
- 组件卸载、路由切换、文档关闭、应用退出时取消进行中的拖动/缩放，释放捕获，清空临时预览。
- 重复挂载不能重复注册快捷键/监听；`DockSurface` 每次挂载创建自己的控制器实例。
- 拖动中窗口失焦（`blur`）按取消处理；不把面板丢在不可恢复的坐标。

## 宿主边界

- 面板拖动始终在编辑器视口内；不开操作系统窗口、不做 popout、不做多窗口。
- WebUI 用真实鼠标/触控板/键盘验收；`DockInputAdapter` 不假定 DOM 事件一定存在。
- 低精度/触摸输入把命中区从 8px 加宽到 12px；视觉仍 4px。
- 小窗口优先折叠右侧面板/抽屉，不把主轴压到不可用；折叠状态由 04-02 记录，不由控制器私存。

## 验收

- 把 `clip.effects` 从左侧拖到右侧，与 `selection.properties` 合并成标签组：标签顺序正确，主轴高度不变；重启恢复。
- 把预览拖到左侧，原位置压缩；拖回恢复默认槽位。
- 把抽屉里的 demo tab 拖到右侧，再拖回抽屉；两处标签顺序正确。
- 在 group 左边缘放下：水平拆分；在上边缘放下：垂直拆分；在标签条放下：只重排，不拆分。
- 拖到视口外/非法区域：显示不可停靠，松手不改变布局。
- 拖动中按 Esc、丢指针、窗口失焦、切换页面：布局回到拖动前，捕获释放，无残留监听。
- 拖主轴分隔线到 160/560 被夹住；键盘 `←/→`、`Shift`、`Home/End` 可调；松手重启保持。
- 在时间轴拖片段、在效果控件拖节点、在属性面板输入、在飞控模式中拖面板标题：不误触发面板拖动。
- 隐藏预览后恢复：同一文档、同一预览会话，不重复创建流。
- 卸载/重新挂载 DockSurface：无重复 `pointermove` 监听，无重复快捷键。
- 低窗 700px 高：打开抽屉压主轴到 160 并提示；关闭恢复；面板仍可拖出/并入。

## 交互约束

- 只从标题/标签拖动面板；内容区不启动拖动。
- 布局状态只走 `layoutStore`；组件不直接写 `layout.json`。
- 拖动过程中不持久化、不进文档撤销历史；松手后提交一次布局事务。
- 拖拽用 PointerEvent；不引入第三方拖拽库。
- 拖到窗口边界停靠，不创建新窗口。
- 拖动取消（Esc/右键）恢复原布局，不写盘。
