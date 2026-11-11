# 0.3.6 源码逐类责任总对照

## 读法与覆盖口径

本表从主模组 Git 跟踪的 common/forge/fabric `src/main/java` 源文件建立，核对共 **489 个 Java 源文件**。一个文件可能含嵌套类，本表以顶层源文件为审计单位；嵌套记录/异常随所属类合同处理。不是489个编辑器面板，也不是要求复制489个引擎类。

J:展开规则见baseline-and-evidence，类名补.java拼包路径定位。R01–R12为WebUI业务责任，R13为WebUI全量验收；R14仅在13完成后迁移AUI。表中的运行时内部依赖在WebUI验收时观察，迁移适配再由14复用，不要求同步建设游戏内。

- **消费/映射**：编辑器字段、命令、诊断或模板需映射该能力，实施任务读对应类。
- **运行时只依赖**：算法/网络/渲染由模组负责，编辑器不重写；通过公共端口/真实预览验收。
- **暂停**：仅编辑器1.20.1分支的游戏内Fabric AUI适配。下表主模组Fabric类仍是WebUI跨加载器正常消费与验收的依据，不暂停。见[host-scope.md](host-scope.md)。

清单覆盖不等于每个文件已逐行审计；功能语义由各轮任务列出的符号/行范围支撑。新提交增加文件时必须重新对照，不因本表存在就假定全懂。reports全部排除。

## 1. 启动、公共 API、控制与环境

| 包／源位置 | 逐类清单 | 编辑器归属与边界 |
|---|---|---|
| J:（根） | Config、ImmersiveCinematics | R03/R13运行环境、开关与生命周期；全局模组配置不是脚本字段，不复制成文档属性 |
| J:api/ | BaseCameraProvider、CameraApi、CameraState、HudLayerRegistry、ImmersiveCinematicsApi、OverlayApi、PlaybackApi、PlaybackListener、ScriptInfo、ServerFactsApi、ServerPlaybackApi、ServerPlaybackApiImpl | R03公共端口/R13兼容；R01屏幕层、R08镜头、R11事实诊断按公共能力消费；public关键字不自动代表稳定编辑器合同 |
| J:control/ | CinematicController、CinematicKeyBindings、CompletionReason、ExitReason、FlightController、FlightModeManager、InputRouter、InputTarget、SkipHudRenderer | R03/R13输入与退出状态，R12飞控取景，R01跳过/结束策略；只消费运行时控制，不复制播放器 |
| J:handler/ | ClientEventHandler、ServerEventHandler | R03/R13开关、世界/连接生命周期；运行时事件不进UI实现 |
| J:client/ | ConfigScreen | R13运行环境/设置入口说明；不把模组配置屏当编辑器工作区 |
| J:command/ | CinematicCommand | R11命令类行为权限、R12现有模板调用链核查；不开放任意服务端命令执行 |

## 2. 相机与播放实例

| 包 | 逐类清单 | 归属 |
|---|---|---|
| J:camera/ | CameraManager、CameraPath、CameraProperties、CameraStateHolder、ClientEntityProbe、ClipModifierGate、DirectControlBase、FlightBase、FrameDriver、PlaybackInstance、PlaybackLedger、PlaybackLifecycle、PlaybackListeners、PlaybackRegistry、PreviewChannel、ScriptDirectorBase、ScriptQueue | R08镜头/多实例/播放关系，R03预览隔离，R12飞控，R11实例诊断；实例、队列、状态推进算法仅运行时 |
| J:camera/cover/ | CameraChannels、CameraCoverChain、CameraModifier、CameraStateBuffer、ClipModifier、ComposeMode、RuleModifier | R08叠加/覆盖通道，R11规则动作；数据表单可编辑，覆盖求值不移植 |
| J:camera/rule/ | RuleActions、RuleArtifact、RuleArtifactLedger | R11动作、产物与释放诊断；不把产物ledger当脚本格式 |
| J:camera/source/ | CameraFrameEvaluator、EntityTargetResolver、LaneMotionStepper、LaneSnapshotCollector、ObjectCameraEvaluator、ObjectWorldContext、WorldPointLocator | R07点源/方向、R08镜头真实结果；求值和实体世界真值只在游戏 |
| J:camera/transition/ | CameraTransitionLayer、TransitionBlend、TransitionFrame、TransitionInterrupt、TransitionMode、TransitionParams、TransitionSpec | R08转场与中断；R12快捷效果按这些元能力编译 |

## 3. 渲染、合成与调色（只消费，不另写渲染器）

| 包 | 逐类清单 | 归属 |
|---|---|---|
| J:client/dimension/ | DimensionView、DimensionViews | R08跨维度镜头，R13真实预览兼容 |
| J:client/lane/ | CameraLease、CameraLeasePool、ColorHistoryCapture、LaneComposeGate、LaneCompositor、LaneCullBridge、LaneCullSlot、LaneCullSlots、LaneDebugCapture、LaneDiagnostics、LaneMask、LaneRenderer、ScriptLaneDriver、ShaderCompat、ShadowColorClear、ViewScope、ViewStateCapture | R08 lane定义/多相机；R09合成/遮罩；R13诊断/资源释放；FBO、裁剪、光影、租约、历史缓冲均留运行时 |
| J:client/post/ | ColorAdjustParams、ColorAdjustPass、LutBindGuard、MasterColorAdjust | R10调色/LUT；参数与资源有UI，着色通路不移植 |
| J:overlay/ | CanvasTransform、CinematicOverlay、ColorMaskRenderer、FadeLayer、ImageGeometry、ImageLayer、LetterboxLayer、OverlayLayer、OverlayManager、SubtitleLayer | R09图像/字幕/遮幅/颜色遮罩/几何，R12字幕批量编译；布局参数来自schema，真实字形/层渲染不由CSS模拟 |

## 4. 顶层脚本和七类轨道

| 包 | 逐类清单 | 归属 |
|---|---|---|
| J:script/（文档） | CinematicScript、Clip、ScriptManager、ScriptMeta、ScriptParser、ScriptValidator、Timeline、TimelineTrack | R01权威字段；R02文档/序列化/身份；R03受控文件与校验；R05时间轴；不把解析器复制到前端 |
| J:script/（播放） | ScriptPlayer、CameraTrackPlayer、CameraLane、CameraLaneComposite、LaneFrame、BreathDisturbance、PlayerMoveController | R08镜头/lane/呼吸/玩家移动，R05播放意图；播放时间真值由游戏持有 |
| J:script/（画面） | OverlayTrackPlayer、OverlayClipRuntime、LetterboxTrackPlayer、ScreenLayer、ColorMaskSpec | R09画面参数；R01屏幕层；R12字幕分轨；当前活动片段/建层语义必须用于编译而非猜测 |
| J:script/（声音） | AudioListenerController、AudioTrackPlayer、CinematicAudioInstance、CustomStreamProvider | R10声音/监听/外部音频；资源状态与参数表单，解码/混音留运行时 |
| J:script/（调色） | AdjustTrackPlayer、ColorAdjustSampler、ColorCurve、CubeLut、CubeLutLoader | R10 ADJUST/曲线/LUT与资源错误；R12可复用预设与LUT辅助不重复实现 |
| J:script/（行为和旧模板） | ContinuitySpec、TriggerDefinition、TriggerRequirement、ModEventTrackPlayer、ScriptTemplate | R11触发/连续/事件；R12核查旧模板并迁移调用；不能声称ScriptTemplate已删除 |
| J:script/track/ | BuiltinTrackDrivers、BuiltinTracks、ExternalTrackDriver、TrackContextImpl、TrackDriver、TrackRegistry | R01发现七类及注册扩展、R02类型与只读保留、R08–11专用面板；第三方驱动留运行时 |

## 5. 对象、身份、执行、规则与路径

| 包 | 逐类清单 | 归属 |
|---|---|---|
| J:script/identity/ | ClipIdentity、ClipRef、ClipResolver | R02稳定身份/引用事务，R04图引用边界、R11出口/分支、R12模板/字幕重映射 |
| J:script/object/ | ClipObjects、ClipRuntimeCache、ClipSampler、ClipValueView、ObjectCallpoints、ObjectCodec、ObjectFormatException、ObjectKeyframe、ObjectParser、ObjectSlotLayout、ObjectValidator、PropertyPath、SampledClip、SampledProperty | R02无损标准文档，R06属性独立关键帧/常量/模式，R07曲线；运行时缓存/槽位/采样器只依赖，不给每个缓存造面板 |
| J:script/object/position/ | BaseSource、EntityPoint、FacingSource、FacingSpec、FreezeStore、LookAtKind、LookAtSpec、Orient、OrientationEvaluator、OrientationResult、OrientationSpec、PathTangent、PointFrame、PointKind、PointKinds、PointOffset、PointSourceSpec、PointSpace、PositionEvaluator、PositionMode、PositionResult、PositionSpec、SampledPathTangent、WorldContext | R07位置/空间/点源/时间冻结/朝向/切线；R08消费取景；动态实体求值留游戏 |
| J:script/path/ | PathBinding、PathBindingResolver、PathBindingSource、PathCollection、PathCollectionParser、PathCollectionSource、PathEntry、PathTiming | R07路径集合/区间/引用/时间映射；R02保存引用，R12模板生成路径 |
| J:script/execution/ | BranchSnapshot、ClipBranchController、ClipBranchHost、ClipExecution、ClipExecutionLedger、ClipExitKind、ClipExitPolicy、ClipExitResolver、ClipTimeSource、DependencyKind、ExecutionDependency、ExecutionDiagnostics、ExecutionDirection、LoopMode | R11独立片段/分支/出口/循环/执行诊断；R05显示时间；执行实例不等于静态clip，状态机只在游戏 |
| J:script/rule/ | ClipExitPolicyParser、RuleBinding、RuleCollection、RuleCollectionParser、RuleControl、RuleDefinition、RuleRelease、RuleReleaseKind、RuleSchedule | R11规则定义/绑定/gate/control/schedule/exit；R02结构保留，R12模板引用重写 |
| J:script/rule/runtime/ | PendingAction、RuleActionRunner、RuleActivation、RuleFactStore、RuleRuntime、SuspensionLedger | R11运行诊断和动作/挂起/释放；不在编辑器自运行规则 |
| J:script/event/ | EventClipRuntime、EventKey、EventRecord、EventSeekPlan | R11 EVENT/MOD_EVENT事件编辑与seek安全；R03播放控制不重放副作用的实际语义 |

## 6. schema、数学模型、路径数学与SPI

| 包 | 逐类清单 | 归属 |
|---|---|---|
| J:script/schema/ | MathModelRegistry、MetaSchemas、ObjectSchemaValidator、PathCurveException、PathCurveRegistry、PathParamKind、SchemaExporter、SchemaRegistry、TrackSchemas、TrackTypeSchema、TriggerSchemas | R01权威导出/字段路由，R02标准模型，R06属性，R07模型/曲线，R11触发；编辑器消费动态注册而非硬编码副本 |
| J:math/ | AngleUtil、BlendModel、ChainModel、CubicBezierCurve、CurveFn、CurveModel、Curves、ExponentialSmoothModel、InertiaModel、MathModelInstance、SpringModel、StatefulInstance、ValueDomain | R07参数/缓动/状态模型可视辅助，R06属性模式；数值域与有状态实例规则不改 |
| J:math/path/ | AnalyticArcLength、ArcLength、ArcLengthTable、ArcPathSpec、AxisConstrainedSpec、AxisConstraint、BSplineBasis、BSplinePathSpec、BezierPathSpec、CatmullRomPathSpec、ClothoidPathSpec、ConicSegmentBuilder、Continuity、Curvature、EllipsePathSpec、FourierPathSpec、Fresnel、HermitePathSpec、LinearPathSpec、NurbsPathSpec、PathAnchor、PathDomain、PathEvaluator、PathExpression、PathMath、PathPoint、RationalBezierPathSpec | R07全部注册路径类型/轴约束/能力参数；弧长、Fresnel、基函数等仅数学支撑，不另作独立主面板 |
| J:spi/（schema/模型） | FieldDef、Interp、MathModel、ModelParams、ObjectDef、PathCapability、PathParamDef、PathParams、PathSpec、PropertyMode、PropertyType | R01/R06/R07消费元数据与能力；编辑器不可自行扩运行时枚举 |
| J:spi/（轨道/触发） | ListenStrategy、TrackContext、TrackPlayer、TrackSchema、TrackTypeId、TriggerEvalContext、TriggerPrerequisite、TriggerType | R01扩展发现、R10监听、R11触发；SPI实现不移植到前端 |
| J:selector/ | EntitySelectorService、SelectorPolicy、SelectorSchema | R07实体点源/选择器字段，R11条件，R03 registry端口；服务端选择真值不可本地猜测 |

## 7. 触发、事实、网络和服务器状态

| 包 | 逐类清单 | 归属 |
|---|---|---|
| J:client/rule/ | ClientConditions、FactSource | R11条件支持/事实来源与激活预览；不与服务端触发混作同一套真值 |
| J:trigger/client/ | AudioListenerReporter、CameraCenterReporter、CameraViewPacketRouter、CameraViewReporter、ClientEntitySelectorCache、ClientScriptCache、ClientScriptNotifier、ClientScriptReceiver | R03/R13状态/资源/换世界；R08相机中心与实体可见、R10监听、R11触发诊断；缓存/网络内部只依赖 |
| J:trigger/network/ | AckTracker、C2SAudioListenerPacket、C2SCameraCenterPositionPacket、C2SCameraCenterRequestPacket、C2SCameraViewPacket、C2SPlaybackStartedPacket、C2SResolveEntitySelectorPacket、C2SRuleCommandPacket、C2SScriptFinishedPacket、C2SScriptPausePacket、C2SScriptSavedPacket、C2SScriptSeekPacket、C2SSkipVotePacket、CinematicC2SPacket、CinematicPacket、CinematicS2CPacket、NetworkBridge、NetworkGuard、NetworkHandler、PacketGuard、S2CCameraViewPacket、S2CDimensionInfoPacket、S2CPlayScriptPacket、S2CResolveEntitySelectorResultPacket、S2CScriptPauseAckPacket、S2CScriptReloadPacket、S2CScriptSeekAckPacket、S2CSkipVoteUpdatePacket、S2CStopScriptPacket、ScriptFingerprint | R03/R13通信/同步/权限错误，R11规则动作与服务端事实；游戏包不直接泄露给编辑器，也不复写 |
| J:trigger/server/ | AudioListenerServerState、CameraAnchorManager、CameraAnchorVirtualPlayer、CameraCenterDiagnostics、CameraCenterManager、CameraEntityStream、CameraViewManager、CameraVirtualCenterState、EntitySelectorResolver、PlaybackGrant、RuleCommandAudit、RuleCommandRateLimiter、RuleCommandTable、ScriptEventManager、ScriptSyncState、TriggerEngine、TriggerRegistration、TriggerRegistry | R11完整触发/命令权限/事实，R08相机中心上下文，R10听者，R13诊断；虚拟中心/区块/实体流不做前端开关乱改 |
| J:trigger/server/action/ | StartPlaybackAction、TriggerAction | R11触发后动作语义，R04边解释 |
| J:trigger/server/continuity/ | MotionSample、PlayerMotion、SegmentSweep、TriggerEdge | R11 sweep/dwell/window可视参数与诊断，几何扫描不复制 |
| J:trigger/server/evaluator/ | Evaluators | R11全部注册触发条件；按TriggerSchemas对账，不以一张通用JSON框替代 |
| J:trigger/server/fact/ | EventFactMatch、Fact、FactCodec、FactLedger、FactQueries、FactResult、FactScene、FactType、FactWindow、PlayerFacts | R11事实查询/窗口/作用域/空结果/未知状态；服务端ledger不能当客户端可直接访问对象 |
| J:trigger/server/prereq/ | BuiltinPrerequisites、PrerequisiteRegistry | R04真实依赖边、R11前置条件；只对受支持边开放维护 |
| J:trigger/shared/ | GeometryConditions | R11位置/结构/朝向条件辅助；动态真值取游戏 |

## 8. 媒体、预览、文件、语言与公共支撑

| 包 | 逐类清单 | 归属 |
|---|---|---|
| J:media/ | ErrorTexture | R10媒体失败可见状态，R03预览失败区分 |
| J:media/audio/ | ExternalPcmDecode | R10外部声音能力/错误；不把解码器搬到编辑器 |
| J:media/capture/ | CaptureHub、CapturedFrame | R03/R13真实帧生命周期，R12捕获辅助；线程/纹理/释放留宿主 |
| J:media/video/ | DecodedFrame、Ffmpeg、ProcessPcmStream、VideoAudioInstance、VideoAudioTrack、VideoDecoder、VideoFiles、VideoFrameTexture、VideoLayer、VideoMetadata、VideoProbe | R09视频覆盖层，R10音视频资源/音轨/依赖与降级；真实解码/探测/进程管理不重写 |
| J:webui/（当前事实路径） | H264AuSplitter、OutboundQueue、PreviewConfig、PreviewEncoder、PreviewProtocol、PreviewStreamer、ResourceFileService、ScriptFileService、ScriptGraphService、WebEditorApi、WebEditorServer、WebPreviewScreen、WebRegistryService、WebSocketSession | R03先按[editor统一包设计](editor-package-modes.md)逐类迁入editor共享服务及webui模式，统一EditorManager管理webui/ingame与总开关；R04图、R10资源、R13游戏内适配消费新职责，当前源码锚点不冒充目标路径 |
| J:util/ | AudioConstants、BlockLocator、Clock、ErrorLog、FatalErrors、GameClock、GifAnimation、LangResources、MathUtil、PreviewClock、ResourcePath、RuleCommandSource、StructureLocator、SuccessOnlySource、TextureLoader、TimeInterpolation | R03诊断/时钟，R07点源与曲线辅助，R09图像/GIF，R10资源/声音/语言，R11命令权限；工具类不各自造UI |

## 9. Mixin 与软兼容（内部，只依赖）

`J:mixin/` 全部类：BiomeAmbientSoundsHandlerMixin、BubbleColumnAmbientSoundHandlerMixin、CameraAccessor、CameraMixin、ChunkMapCameraEntityMirrorMixin、ChunkMapMixin、ChunkMapTrackedEntityCameraMixin、ClientChunkCacheMixin、ClientLevelAccessor、ClientPacketListenerAccessor、EntityAccessor、GameRendererAccessor、GameRendererMixin、IrisCameraTrackerCaptureMixin、IrisPreviousCaptureMixin、ItemUseMixin、KeyboardHandlerMixin、LaneCullStateMixin、LaneRendererMixin、LevelRendererMixin、LevelRendererVanillaMixin、LivingEntityMixin、LocalMobCapCalculatorMixin、LocalPlayerMixin、MinecraftAccessor、MinecraftMixin、MobDespawnCameraMixin、MouseHandlerAccessor、MouseHandlerMixin、NaturalSpawnerMixin、NaturalSpawnerSpawnStateMixin、ParticleEngineMixin、PlayerListAudioBroadcastMixin、ServerChunkCacheCameraMixin、ServerEntityMixin、ServerPlayerTeleportMixin、SoundEngineMixin、SoundManagerMixin、UnderwaterAmbientSoundHandlerMixin。

归属R13兼容/输入/捕获/HUD/世界生命周期真实冒烟；参数能力分别归08/09/10/11。它们是引擎注入点，不因要覆盖模组全部功能就复制到编辑器或给它们做面板。

common/src/main/java/net/irisshaders/iris/ 下：pipeline/CompositeRenderer、pipeline/FinalPassRenderer、pipeline/IrisRenderingPipeline、shadows/ShadowRenderer、uniforms/CameraUniforms、uniforms/MatrixUniforms。R13软兼容构建/运行边界核查，绝不作为编辑器API。CompositeRenderer（3–12）明确是不会打包的compile-only stub；其余类实施时按各自源码注释核对，不据名称当完整Iris源码。

## 10. 加载器模块

模块路径前缀均为 `<loader>/src/main/java/com/immersivecinematics/immersive_cinematics/`。

| 包／模块 | 逐类清单 | 归属 |
|---|---|---|
| forge/forge/ | ForgeClientEvents、ForgeConfig、ForgeEvents、ForgeNetwork、ImmersiveCinematicsForge | R03 Forge优先垂直链路、R13启动/关闭/配置/通信完整验收；主模组现有启动代码只读依据 |
| forge/forge/hud/ | ForgeHudLayerRegistry | R01屏幕层，R13实际HUD预览 |
| forge/forge/mixin/ | SoundEngineMixin | R10声音，R13兼容；运行时内部 |
| forge/mixin/ | ImmersiveCinematicsMixinPlugin | R13加载/软兼容，仅运行时 |
| fabric/fabric/ | FabricConfig、FabricEvents、FabricNetwork、ImmersiveCinematicsFabric | R03/R13/R14主模组Fabric运行/配置/通信与WebUI正常对接，现有加载器实现只依赖，不做AUI修复 |
| fabric/fabric/client/ | FabricClientEvents、ImmersiveCinematicsFabricClient | R03/R13主模组Fabric客户端启动/真实预览，WebUI功能完整 |
| fabric/fabric/hud/ | FabricHudLayerRegistry、FabricHudTakeover、FabricHudVisibility | R01/R13 WebUI→Fabric屏幕层与真实HUD预览，非暂停项；R14只迁移游戏内Forge |
| fabric/fabric/mixin/ | FabricGuiTakeoverMixin、ItemEntityMixin、MinecraftServerMixin、PlayerAdvancementsMixin、PlayerMixin、ResultSlotMixin、SoundEngineMixin | WebUI→Fabric真实行为验收依据；运行时内部不移植编辑器 |
| fabric/mixin/ | ImmersiveCinematicsMixinPlugin | R13/R14主模组Fabric加载器/兼容依赖，不改写 |

## 11. 编辑器既有前端逐文件入口

| EDITOR:src 下文件／组件 | 归属与迁移 |
|---|---|
| types.ts、schema.ts、demo.ts | R01/02新schema、标准文档、离线快照；不能保留旧格式兼容垫片 |
| store.ts、operations.ts | R02文档命令/历史，R03宿主，R05时间轴，R06属性；一个集成所有者迁移，不让多代理并写 |
| main.ts、App.vue、electron-bridge.d.ts | R05应用工作台，R03/13载体适配；05.20–23正式应用能力 |
| graphLayout.ts、components/ScriptGraph.vue | R04触发关系入口/布局/悬停/维护 |
| components/ScriptList.vue、ScriptDock.vue、ScriptContent.vue | R04/05迁移所需入口能力，删除旧常驻最左列表/源码视图与废弃调用 |
| components/Timeline.vue、TrackListPanel.vue、ClipPanel.vue | R05仅主轴轨道/片段编排及播放参数；旧节点绘制/拖动/菜单从主轴移除，不改成对象子行；R06完整片段效果控件承接节点 |
| components/KeyframePanel.vue | R06以ClipEffectControlsPanel/EffectControlsRows替换整帧与单属性独占入口；多组同屏、独立节点、局部视口与轴外；R07专门路径工具仍保留 |
| components/PropertyPanel.vue、DynamicForm.vue | R01脚本meta/schema；R06对象组参数列与PropertyValueForm/SelectionPropertiesPanel，独立快捷属性不等于旧meta页改名；同值命令无第二节点轴 |
| components/Preview.vue、lib/previewProtocol.ts | R03真实帧与控制，R12飞控，R13关闭释放 |
| components/TriggerPanel.vue | R11完整条件/事实/规则行为；R04依赖维护复用受控部分 |
| components/PresetsPanel.vue、LibraryPanel.vue | R12模板与整合；R10资源；12.20–23字幕批量工作流 |
| components/TitleBar.vue、TabbedPanel.vue、PanelTabs.vue | R05主题/布局/命令/窗口，R13 WebUI全验，之后R14 AUI适配 |
| i18n/index.ts、zh_cn.ts、en_us.ts | R01–12同步标签/语言偏好，R13 WebUI全量对账；R14迁移同语义 |
| components/fields/ | BezierCurveField、BoolField、CommitNumberField、CommitTextField、EnumField、FieldRenderer、MapField、NumberField、PositionField、RegistryStringField、ResourceStringField、StringField、TristateField、resourceHint.ts：R01基础/R07位置路径/R10资源；旧复合位置/曲线路由迁移完再删 |
| components/trigger/ | DimensionChangeTriggerEditor、EntityKillTriggerEditor、InventoryTriggerEditor、ItemOnInteractTriggerEditor、LocationTriggerEditor、NoConditionTriggerEditor、ObservationTriggerEditor、SingleFieldTriggerEditor、StructureTriggerEditor、XpTriggerEditor：R11逐类型条件与递归/连续语义，不能以现有10个组件代表全注册类型 |

Electron的main.cjs/preload.cjs归03/05/13安全宿主端口。package.json/lock、Vite/TS配置、electron-builder配置归13/14构建发布，不在本次改动。图标等静态资源归美术规范与05，不能用主题改变游戏预览。

## 12. 游戏内分支现有类

INGAME:common/src/main/java/com/immersivecinematics/editor/下Constants、EditorCommon、platform/Services、platform/services/IPlatformHelper；INGAME:forge下EditorMod、platform/ForgePlatformHelper；INGAME:fabric下EditorMod、platform/FabricPlatformHelper。现有骨架/服务/resources/Gradle仅14迁移使用，前提13 WebUI已完整验收；Fabric+AUI适配暂缓，不把骨架当已完成编辑器。

## 13. 非Java资产与最终校验

非Java资产由对应业务轮消费：R01/02/13用真实脚本校验格式，R09/10真实媒体/shader结果，R13验证WebUI主模组通路；R14在WebUI完成后验证AUI宿主/输入/帧源迁移。字幕外部文件只在编辑器导入，运行资产仍是标准脚本/合法资源。

**执行指导**：本表用于找责任，不是直接派单。主代理从对应轮README选择具体类任务，连同shared合同和真实源码符号一次性派发；运行时只依赖类不得变为子代理随手改引擎的授权。
