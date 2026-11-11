# 05-01 工作区外壳、默认布局与旧栏退役

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：05-timeline-workspace。前置：01、02、04、05-21（布局树）、05-22（拖动/停靠）；同轮：05-07、05-08。
> 证据前缀同轮 README。

## 1. 职责

把 `EDITOR:src/App.vue` 从「JSON 列 + 左面板 + 预览 + 右面板 + 时间轴」重排为**布局树驱动的外壳**：默认布局是 **文档顶栏 / 左上片段效果控件 / 中央预览 / 右侧快捷属性 / 下部主时间轴 / 可停靠抽屉**；但外壳只负责把 `WorkspaceLayout`（05-21）的 `split/group/panel` 树渲染成区域、分隔条与标签组，**不持有尺寸/折叠/抽屉状态，也不提供第二套布局模型**。同时让旧常驻栏的调用方全部迁走。只做布局与生命周期，不做任何脚本字段编辑，也不实现效果控件/快捷属性的内容或局部时间视口。

默认树按用户截图定制职责：效果控件在预览左上方（参数列 + 节点列需要横向空间），快捷属性独立在右侧，主时间轴横贯下方，资源/模板是**按需抽屉**（默认关闭）。效果控件与快捷属性是**两个独立可停靠面板**，可同时可见，不是同一个 tab 的二选一；效果控件的宽度不得继承旧检查器 280–560px 的窄栏限制。

**参考输入**：[工作台/偏好/宿主适配](../references/03-workspace-preferences-host.md)的默认停靠布局和面板身份。只借容器职责与恢复思想，不搬Olive素材树、Qt类或布局进项目文件的做法；唯一布局仍归05.21，旧常驻脚本栏不能作为合法panelId复活。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/App.vue:23–26` | `jsonColWidth` / `leftPanelWidth` / `rightPanelWidth` / `timelineHeight` 四个布局 ref（另有一个 `dragging`） |
| `EDITOR:src/App.vue:29–38` | `leftTabs`（脚本/轨道/预设）与 `rightTabs`（属性/片段/关键帧/触发器）写死 |
| `EDITOR:src/App.vue:50–67` | `initSizes()` 按窗口比例分配四列宽度 |
| `EDITOR:src/App.vue:68–89` | `startDrag` / `onMouseMove` / `onMouseUp` 拖拽分隔条 |
| `EDITOR:src/App.vue:290–294` | `onResize()`：用户未手动拖拽时重新 `initSizes()` |
| `EDITOR:src/App.vue:319–393` | 模板：`validation-banner`（323）、`body-row`（329）、`json-column`+`ScriptDock`（331–332）、`editor-left-panel`+`TabbedPanel`（340–356）、`preview-area`（360）、`right-panel`（366–379）、`timeline-area`（383–384） |
| `EDITOR:src/App.vue:394–567` | 全局样式：`:root` 变量（395–410）、`.body-row`（481–488）、`.json-column`（489–497）、`.editor-left-panel`（498–505）、`.scripts-tab`/`.scripts-list-section`（506–517）、`.timeline-area`（560–566） |
| `EDITOR:src/components/TabbedPanel.vue:15–30` | 通用「tabs + 内容」容器，可 `showList` 分栏 |
| `EDITOR:src/components/PanelTabs.vue:12–24` | 纯 tab 条 |
| `EDITOR:src/components/ScriptDock.vue:1–19` | 只包 `ScriptContent`，无独立状态 |
| `EDITOR:src/components/ScriptContent.vue:1–167` | JSON 高亮渲染，`watch(state.doc, deep)` 每 200ms 重算（31–40） |
| `EDITOR:src/components/ScriptList.vue:1–58` | 脚本列表 + 新建/保存/刷新/删除 |
| `EDITOR:src/components/TrackListPanel.vue:1–263` | 轨道增删改排序（与时间轴轨道头重复） |
| `EDITOR:src/components/PresetsPanel.vue:1–251` | 旧预设面板（归 12 的模板面板） |

## 3. 拟新建（提案，全部未实现）

| 文件 | 导出 | 职责 |
|---|---|---|
| `EDITOR:src/workspace/WorkspaceShell.vue` | 组件 | 渲染布局树：区域容器、分隔条、标签组、抽屉挂载点、键盘作用域容器；**不持有**布局状态 |
| `EDITOR:src/workspace/RegionHost.vue` | 组件 | 区域外壳：空态/错误边界/加载骨架/拖拽落点指示 |
| `EDITOR:src/workspace/ResizeHandle.vue` | 组件 | 分隔条：指针 + 键盘（方向键）改比例，提交一条布局命令给 05-22/21 |
| `EDITOR:src/workspace/panels.ts` | `PanelRegistry` | 稳定 `panelId` 注册表（id/labelKey/组件/懒加载/最小尺寸/所属默认区域/是否可关闭） |

**不新建** `layoutStore.ts`。旧提案里的 `layoutStore` 与 `21-WorkspaceLayoutService.md` 同职责，必须合并：布局树、比例、可见性、标签顺序、预设、恢复默认全部归 21；持久化归 23；拖动/停靠交互归 22。05-01 只消费。

## 4. 输入 / 输出 / 字段约束

**输入**

- `WorkspaceLayout`（05-21）：当前布局树、当前预设 id、可用面板集合。
- 窗口尺寸（`ResizeObserver`，不是 `window.innerWidth` 一次性读取）。
- 文档会话状态（来自 02）：`docId`、`dirty`、`connected`。
- 面板注册表（编译期静态表 + 运行时按能力裁剪：例如 ADJUST 轨道不存在时隐藏「调色」相关面板入口）。

**输出**

- 渲染结果：区域/标签组/分隔条。
- 布局命令（委托）：`movePanel(panelId, targetGroupId, index)`、`splitRegion(...)`、`resizeRegion(splitId, ratio)`、`hidePanel(panelId)`、`showPanel(panelId)`、`applyPreset(presetId)`、`resetLayout()`。这些命令的**唯一实现**在 21/22，外壳只发意图。
- 事件：`onSave`、`onValidate`、`onBackToProject`、`onOpenPanel(id)`、`onClosePanel(id)`。

**字段约束（权威在 05-21，外壳只读）**

| 字段 | 范围 | 缺省 | 说明 |
|---|---|---|---|
| `timelineH` | 160–560 px | 窗口高 × 0.34（夹到区间） | 小于 240 时轨道行高切到紧凑档 |
| `effectsW` | ≥ 420 px 宽 | 窗口宽 × 0.32 | 参数列 + 节点列的最小可用宽度；折叠 = 0。**不套用旧检查器 280–560** |
| `propsW` | 280–560 px | 窗口宽 × 0.20 | 快捷属性常用参数；折叠 = 0，用按钮/快捷键恢复 |
| `drawerH` | 200–420 px | 280 | 抽屉默认关闭（高度 0），按需打开 |
| `previewFlex` | ≥ 320 px 宽 | 剩余空间 | 低于 320 时提示「窗口过小」并允许折叠快捷属性/效果控件 |

约束规则：尺寸用**比例 + 最小/最大像素**双写；所有 split 至少两个子节点；禁止零宽/负宽；未知 `panelId` 在加载时忽略并记录，不阻止启动。效果控件与快捷属性各有自己的宽度约束，不能把两者合并成一个 `inspectorW`，也不能用 280–560 的旧上限压扁效果控件。持久化由 23 的 `PreferencesStore` 负责（键域 `ic.editor.layout.v1`），外壳**不直接读写** `localStorage`；宿主无本地存储时 23 退化为内存态。

## 5. 修改步骤

1. 新建 `panels.ts`：从 `App.vue:29–38` 的 `leftTabs`/`rightTabs` 与 `TabbedPanel`/`PanelTabs` 的消费者中提取稳定 `panelId`；同时注册 `clip.effects` 与 `selection.properties` 两个宿主 id。每个 id 唯一注册，标注默认区域与最小尺寸。旧常驻脚本列表**不是**合法 panelId。
2. 新建 `WorkspaceShell.vue`：递归渲染 21 的布局树。默认树 = 五区（上：效果控件 + 预览 + 快捷属性；下：抽屉 + 主轴；顶栏固定）——效果控件在预览左侧、快捷属性在预览右侧，抽屉默认折叠。`body-row` 结构删除，改为 split 树。
3. 新建 `ResizeHandle.vue`：把 `startDrag/onMouseMove/onMouseUp`（`App.vue:68–89`）替换为指针捕获 + 键盘方向键；每次拖动结束向 21 提交一次比例事务，拖动过程不持久化、不入脚本历史。删除 `App.vue:23–26` 的四个 ref 与 `initSizes()`（50–67）、`onResize()`（290–294）；默认比例由 21 的 `defaultLayout(viewport)` 给。
4. 删除json-column、ScriptDock与旧ScriptContent整脚本源码展示；诊断只保留问题/字段路径/定位与复制错误，不换成源码子页复活旧功能。
5. 删除左面板（`App.vue:340–356`）与 `leftTabs`（29–33）：`ScriptList` 的「新建/打开/保存/删除」迁到 `DocumentHeader` + 项目页（04）；`TrackListPanel` 的轨道管理并入主轴轨道头（`05-04`）；`PresetsPanel` 由 12 的模板面板替代。
6. 右侧 `right-panel` 换成快捷属性宿主 `selection.properties`（`05-07`），预览左侧新增效果控件宿主 `clip.effects`（`05-07`）；`rightTabs` 从 `store.ts:78` 删除。两个宿主各自读写布局树里的宽度/折叠，不合并为一个旧 `inspectorW`，也不套旧检查器 280–560 的窄栏上限。
7. 底部 `timeline-area` 上方插入 `PanelDrawer` 挂载点（`05-08`）；抽屉本身是一个可停靠面板组（21 的 group），可以被移到其他区域，但默认在主轴上方。
8. 校验横幅（`App.vue:323–327`）改为顶栏状态点 + 诊断抽屉计数徽标；横幅不再常驻占位。
9. 清理旧固定列样式与四组尺寸状态；统一迁到ThemeService token，迁移全部引用后删除旧变量，不保留一个版本的别名或下一轮清理债务。
10. 全局 `onKeydown`（`App.vue:91–317`）迁到 `05-10` 的 `ShortcutRegistry`，`App.vue` 只保留挂载。
11. 在 `WorkspaceShell` 挂载时向 21 注册可用面板集合；卸载时解除。不新增全局 `window` 监听（键盘监听归 05-10，窗口尺寸归 21 的 `ResizeObserver`）。

## 6. 禁止修改

- 不改 `MOD:` 下任何文件；不改协议消息；不改 `store.ts` 里属于 02 的文档/命令实现。
- 不新增第二套「脚本列表」或「源码常驻」入口（含快捷键、菜单、开发者面板）。
- 不把旧整脚本高亮面板搬到诊断抽屉；旧展示组件无其他必要调用方后删除。
- 不改 `Timeline.vue` 内部实现（由 `05-03`/`05-04` 整体替换）；本文件只替换它的**挂载点**。
- 不在外壳里读取 `state.doc` 的字段结构（外壳不知道 `objects`/`clips`，只拿到 `docId`/`dirty`）。
- **不新建 `layoutStore`、不自己存布局尺寸、不自己写 `localStorage`**；布局状态只认 05-21，持久化只认 05-23。
- 不把「默认五区」写成不可变的硬限制：面板移动/停靠/缩放/隐藏必须由 21/22 提供，外壳不得拒绝未知但合法的布局树。

## 7. 两分支承载

本轮只实现/验收 WebUI 侧；游戏内 Forge+AUI 侧同语义是 14 迁移要求，不阻塞本轮。

| 宿主 | 承载 | 差异 |
|---|---|---|
| WebUI（`webui` 分支，Electron/Chromium） | 全部 | `ResizeObserver`、`pointer` 事件、本地存储均可用；分隔条可用 4px 命中区 + hover 高亮；面板拖动有落点预览 |
| 游戏内（`INGAME:` Forge 1.20.1 + AUI，14 迁移参考） | 同一份组件与布局树 | 分隔条命中区加宽到 8px（触摸/低精度鼠标）；本地存储**可能**不可用 → 23 的内存态；窗口高度常小于 720 → 默认 `timelineH=200`、快捷属性默认折叠、效果控件以标签/抽屉折叠保证可达；AUI 的 `pointer`/`ResizeObserver`/`sticky` 等能力**未实证**，按 `shared/art-direction.md` §三 降级，不假定缺失也不假定可用 |
| 游戏内 Fabric + AUI | 暂缓 | 只指这条宿主适配链；不阻塞 WebUI → Forge/Fabric 的完成；游戏内 Forge 承载属 14 迁移（`shared/host-scope.md`） |

## 8. 前置

- 01：`schema.get` 的 `tracks[].playControl/objects` 快照可用（用于决定面板入口是否显示）。
- 02：`docId`/`dirty`/命令接口。
- 04：项目页入口与「打开脚本」回调。
- 21/22的真实布局/拖动能力是同轮前置，未就绪则本任务不完成；不交固定默认树加禁用拖动的半成品，也不建临时layoutStore。

## 9. 验收

**正例**

1. 首次启动（无偏好）：界面是默认五区（效果控件/预览/快捷属性/主轴/按需抽屉），无 JSON 列、无脚本列表；窗口 1600×900 下预览可视高度 ≥ 360px。
2. 把「模板」面板从抽屉拖到右侧、与「快捷属性」组成标签组：标签顺序正确，主轴高度不变；重启后恢复同一位置与标签。
3. 拖动主轴分隔条到 160px 与 560px 都被夹住；松手后重启，尺寸保持（由 23 持久化）。
4. 折叠快捷属性后预览宽度增加，主轴宽度不变；快捷键恢复后回到折叠前宽度；折叠效果控件同理，且效果控件宽度不受 280–560 上限约束。
5. 抽屉打开/关闭不改变主轴高度（抽屉占据预览下方、主轴上方的新增高度），关闭后预览恢复；抽屉被移到别的区域后，原位置留空并按 21 的规则压缩。资源/模板抽屉默认关闭，按需打开。
6. 断连（`state.connected=false`）时外壳仍可用，顶栏状态点变红，主轴与抽屉不消失。
7. 「视图 → 恢复默认布局」回到五区，且文档、选区、未保存修改不受影响。

**反例**

1. 通过菜单/快捷键仍能打开旧脚本列表或常驻 JSON 列 → 不通过。
2. 外壳读取 `state.doc.timeline.tracks` 决定布局 → 不通过（越界）。
3. 外壳自己维护 `timelineH`/`effectsW`/`propsW` 或写 `localStorage` → 不通过（第二套布局状态）。
4. 面板只能显示/隐藏，不能移动或停靠 → 不通过（退化为固定布局）。
5. 折叠快捷属性后主轴被挤到 < 120px 且无提示 → 不通过。
6. 效果控件被限制在 280–560px，参数列与节点列挤到不可用 → 不通过（沿用旧检查器窄栏）。
7. 尺寸持久化写进脚本或项目文件 → 不通过。

**真实冒烟**

- WebUI：`npm run dev` 起前端，连本机模组 F9 服务，打开一个脚本，按上述 1–7 操作并截图记录尺寸与标签顺序。
- （14 迁移参考，本轮不作为出口）游戏内 Forge 1.20.1：14 实施时装 `INGAME:` 附属模组，窗口 1280×720，确认默认布局可用、分隔条可拖、抽屉可开合、面板可移动；AUI 无本地存储时确认不报错。
- 本轮不运行构建/测试命令（计划期约束）；实施时由执行者运行并记录输出。

## 10. 完成定义（无遗留出口）

- `App.vue` 中不再出现 `ScriptDock`、`ScriptList`、`leftTabs`、`json-column`、`editor-left-panel`、布局尺寸 ref。
- 布局状态的唯一来源是 `WorkspaceLayoutService`（05-21）；代码库中不存在 `layoutStore` 或第二份尺寸状态。
- 效果控件与快捷属性是两个独立注册的 dock panel（`clip.effects` / `selection.properties`），可同时可见、各有宽度约束；外壳不把两者压回一个旧右栏 tab。
- 默认五区在 1280×720 与 1920×1080 下均可用；面板移动/停靠/隐藏/恢复默认各有可复现记录。
- 旧ScriptDock/ScriptList/ScriptContent及重复轨道/预设入口本轮退役；PresetsPanel旧格式生成器不等12才删除。12后续注册真实模板组件，05只完成已冻结容器合同，未实现内容不创建占位组件。
