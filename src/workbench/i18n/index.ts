/**
 * 国际化（04-08）。
 *
 * 语言来自偏好（由外部 `locale()` 读取、通过 `onChange(set)` 注入 setter），
 * 缺失 key 返回原 key：含 `.` 的视为翻译键并记诊断（去重），
 * 不含 `.` 的可读文本原样返回，不把插件标题之类误报成缺失翻译。
 */
import { shallowRef, type ShallowRef } from 'vue'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import type { Locale } from '../api/context.ts'
import type { I18nApi } from '../api/context.ts'

/** 04 外壳、设置页、抽屉与主题选择器需要的最小文案表。 */
export const MESSAGES: Record<Locale, Record<string, string>> = {
  zh_cn: {
    'app.title': '沉浸式电影编辑器',
    'nav.project': '项目',
    'nav.document': '文档',
    'nav.settings': '设置',
    'menu.file': '文件',
    'menu.edit': '编辑',
    'menu.view': '视图',
    'menu.help': '帮助',
    'doc.save': '保存',
    'doc.validate': '校验',
    'doc.undo': '撤销',
    'doc.redo': '重做',
    'doc.back': '返回项目',
    'doc.dirty': '未保存',
    'status.connected': '已连接',
    'status.offline': '离线',
    'status.preset': '预设',
    'status.issues': '问题',
    'status.plugins': '插件',
    'settings.appearance': '外观',
    'settings.workspace': '工作区',
    'settings.shortcuts': '快捷键',
    'settings.language': '语言',
    'settings.about': '关于',
    'settings.advanced': '高级',
    'drawer.diagnostics': '诊断',
    'drawer.resources': '资源',
    'drawer.colorCurves': '调色曲线',
    'panel.missing': '面板不可用',
    'panel.loading': '正在加载…',
    'panel.error': '面板加载失败',
    'panel.retry': '重试',
    'theme.followSystem': '跟随系统',
    'theme.import': '导入主题…',
    'theme.reset': '重置外观',
    'theme.darkDefault': '深色默认',
    'theme.lightDefault': '浅色默认',
    'theme.highContrast': '高对比',
    'prefs.reset': '重置偏好',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.save': '保存',
    'common.discard': '放弃',
    'guard.unsavedTitle': '文档未保存',
    'guard.unsavedDetail': '「{name}」有未保存的修改。保存后再继续？',
    'doc.untitled': '未命名文档',
    'doc.saved': '已保存',
    'doc.pendingBakeTitle': '有未烘焙的段缓动',
    'doc.pendingBakeDetail': '会话缓动不会写进文档。选择如何处理这些段：',
    'doc.pendingBakeBake': '烘焙后保存',
    'doc.pendingBakeDiscard': '仅保存节点',
    'doc.stale': '已过期',
    'doc.revertTitle': '从磁盘重载',
    'doc.revertDetail': '「{name}」的本地修改会被丢弃，重新读取磁盘上的文件。',
    'doc.revertConfirm': '重载',
    'menu.pages': '页面',
    'menu.viewNoItems': '没有可用菜单项',
    'page.error': '页面加载失败',
    'page.loading': '正在加载页面…',
    'page.missing': '页面未注册：{pageId}',
    'palette.placeholder': '输入命令名…',
    'palette.empty': '没有匹配的命令',
    'panel.noneHidden': '没有隐藏的面板',
    'panel.preview': '预览',
    'preview.offline': '预览未接入（游戏 WebUI 未连接）',
    'preview.waiting': '等待预览帧…',
    'preview.lastFrame': '最后一帧',
    'preview.refresh': '刷新',
    'preview.unavailable': '宿主没有提供预览流服务',
    'project.title': 'ImmersiveCinematics 编辑器',
    'project.subtitle': '打开脚本或最近项目，进入文档工作区。',
    'project.newScript': '新建脚本',
    'project.openScript': '打开脚本文件',
    'project.openFolder': '打开文件夹',
    'project.recent': '最近项目',
    'project.recentEmpty': '还没有最近项目。用上面的按钮打开脚本或文件夹。',
    'project.missing': '文件不存在',
    'project.relocate': '重新定位',
    'project.remove': '移除',
    'project.offlineHint': '离线仍可打开本地脚本；保存到服务端需要游戏内 WebUI。',
    'project.folderRecorded': '已记录为最近项目（未扫描目录）',
    'project.workspaceSet': '工作区：{path}',
    'project.workspaceFailed': '设置工作区失败：{reason}',
    'project.openFailed': '打开失败',
    'project.newFailed': '新建失败',
    'settings.missingSection': '设置分区未注册：{sectionId}',
    'cmd.file.newDoc': '新建脚本',
    'cmd.file.openDoc': '打开脚本…',
    'cmd.file.revertDoc': '从磁盘重载',
    'cmd.file.closeDoc': '关闭文档',
    'cmd.app.commandPalette': '命令面板',
    'cmd.workspace.focusNext': '下一个焦点区域',
    'cmd.workspace.focusPrev': '上一个焦点区域',
    'cmd.layout.reset': '恢复默认布局',
    'cmd.layout.showPanel': '显示面板…',
    'cmd.camera.inspect.open': '打开镜头检查…',
    'cmd.camera.inspect.locate': '在镜头检查中定位片段',
    'cmd.camera.playback.open': '打开回放检查…',
    'cmd.theme.pick': '选择主题…',
    'cmd.window.minimize': '最小化',
    'cmd.window.maximize': '最大化 / 还原',
    'cmd.window.close': '关闭窗口',
    'cmd.help.shortcuts': '快捷键帮助',
    'cmd.help.about': '关于',
    'theme.source.builtin': '内置',
    'theme.source.plugin': '插件',
    'theme.source.user': '用户',
    'theme.slotLight': '浅色时用',
    'theme.slotDark': '深色时用',
    'theme.slotHighContrast': '高对比时用',
    'theme.slotNone': '不指定',
    'theme.importFailed': '读取主题文件失败',
    'theme.imported': '已导入主题：{label}',
    'theme.resetDone': '外观已恢复默认',
    'theme.overrides': '高级：token 覆盖',
    'theme.overridesHint': '只允许核心 token；留空恢复主题自身的值。',
    'settings.density': '界面密度',
    'settings.densityComfortable': '舒适',
    'settings.densityCompact': '紧凑',
    'workspace.hint': '当前页：{page}。布局只写 layout.json，不写脚本。',
    'workspace.builtinPresets': '内置预设',
    'workspace.userPresets': '用户预设',
    'workspace.noUserPresets': '还没有用户预设。',
    'workspace.presetName': '预设名称',
    'workspace.savePreset': '保存当前布局为预设',
    'workspace.presetApplied': '已切换布局预设：{id}',
    'workspace.presetSaved': '已保存预设：{id}',
    'workspace.presetDeleted': '已删除预设：{id}',
    'workspace.resetDone': '布局已恢复默认',
    'workspace.openUserData': '打开 userData 目录',
    'workspace.resetKeepPresets': '恢复默认只回 default 预设，不删除用户预设。',
    'shortcuts.hint': '点「录制」后按目标组合键；Esc 取消，Backspace 清空绑定。同作用域冲突会被拒绝。',
    'shortcuts.command': '命令',
    'shortcuts.category': '分类',
    'shortcuts.scope': '作用域',
    'shortcuts.chord': '当前键位',
    'shortcuts.unbound': '未绑定',
    'shortcuts.overridden': '（已覆盖）',
    'shortcuts.record': '录制',
    'shortcuts.clear': '清空',
    'shortcuts.recording': '请按键…',
    'shortcuts.resetAll': '恢复默认键位',
    'shortcuts.resetDone': '快捷键已恢复默认',
    'shortcuts.saved': '已保存键位：{chord}',
    'shortcuts.conflict': '冲突：{chord} 已被 {command} 使用',
    'language.hint': '语言即时生效，写入 preferences.json。',
    'language.changed': '语言已切换：{language}',
    'language.missingKeyHint': '缺失翻译会显示原始 key 并在诊断里记录。',
    'about.version': '编辑器版本',
    'about.platform': '宿主平台',
    'about.diagnostics': '诊断',
    'about.diagnosticsValue': '共 {total} 条（错误 {errors}、警告 {warnings}）',
    'about.userData': '用户数据文件',
    'about.copyDiagnostics': '复制诊断',
    'advanced.resetTitle': '确认重置？',
    'advanced.resetSectionDetail': '将清空「{section}」这一项偏好；布局、窗口、草稿与脚本不受影响。',
    'advanced.resetAllDetail': '将清空全部偏好；不删除布局、窗口状态、草稿与脚本。',
    'advanced.reset': '重置',
    'advanced.resetDone': '已重置',
    'advanced.showPreferences': '查看 preferences.json',
    'advanced.hidePreferences': '收起 preferences.json',
    'advanced.errors': '错误快照',
    'advanced.pluginErrors': '插件错误：{count}',
    'advanced.layoutErrors': '布局诊断：{count}',
    'advanced.themeErrors': '主题诊断：{count}',
    'advanced.noErrors': '当前没有诊断记录。',
    'advanced.resetPluginsPlaceholder': '',
    'settings.advancedPlugins': '插件偏好段',
    'diagnostics.source.plugin': '插件',
    'diagnostics.source.layout': '布局',
    'diagnostics.source.theme': '主题',
    'diagnostics.source.preload': 'preload',
    'diagnostics.source.ipc': 'IPC',
    'diagnostics.source.panel': '面板',
    'diagnostics.source.command': '命令',
    'diagnostics.source.document': '文档',
    'diagnostics.source.preferences': '偏好',
    'status.page': '页面：{page}',
    'status.docDirty': '文档：未保存',
    'status.docSaved': '文档：已保存',
    'status.presetValue': '布局：{preset}',
    'status.issuesValue': '问题：{count}',
    'status.pluginsValue': '插件错误：{count}',
    'status.previewGame': '预览：游戏内',
    'status.previewOffline': '预览：未接入',
  },
  en_us: {
    'app.title': 'Immersive Cinematics Editor',
    'nav.project': 'Project',
    'nav.document': 'Document',
    'nav.settings': 'Settings',
    'menu.file': 'File',
    'menu.edit': 'Edit',
    'menu.view': 'View',
    'menu.help': 'Help',
    'doc.save': 'Save',
    'doc.validate': 'Validate',
    'doc.undo': 'Undo',
    'doc.redo': 'Redo',
    'doc.back': 'Back to project',
    'doc.dirty': 'Unsaved',
    'status.connected': 'Connected',
    'status.offline': 'Offline',
    'status.preset': 'Preset',
    'status.issues': 'Issues',
    'status.plugins': 'Plugins',
    'settings.appearance': 'Appearance',
    'settings.workspace': 'Workspace',
    'settings.shortcuts': 'Shortcuts',
    'settings.language': 'Language',
    'settings.about': 'About',
    'settings.advanced': 'Advanced',
    'drawer.diagnostics': 'Diagnostics',
    'drawer.resources': 'Resources',
    'drawer.colorCurves': 'Color curves',
    'panel.missing': 'Panel unavailable',
    'panel.loading': 'Loading…',
    'panel.error': 'Panel failed to load',
    'panel.retry': 'Retry',
    'theme.followSystem': 'Follow system',
    'theme.import': 'Import theme…',
    'theme.reset': 'Reset appearance',
    'theme.darkDefault': 'Dark Default',
    'theme.lightDefault': 'Light Default',
    'theme.highContrast': 'High Contrast',
    'prefs.reset': 'Reset preferences',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.save': 'Save',
    'common.discard': 'Discard',
    'guard.unsavedTitle': 'Unsaved document',
    'guard.unsavedDetail': '"{name}" has unsaved changes. Save before continuing?',
    'doc.untitled': 'Untitled',
    'doc.saved': 'Saved',
    'doc.pendingBakeTitle': 'Unbaked segment easing',
    'doc.pendingBakeDetail': 'Session easing is never written to the document. Choose how to handle it:',
    'doc.pendingBakeBake': 'Bake then save',
    'doc.pendingBakeDiscard': 'Save nodes only',
    'doc.stale': 'stale',
    'doc.revertTitle': 'Reload from disk',
    'doc.revertDetail': 'Local changes to "{name}" will be discarded and the file reloaded.',
    'doc.revertConfirm': 'Reload',
    'menu.pages': 'Pages',
    'menu.viewNoItems': 'No menu items',
    'page.error': 'Page failed to load',
    'page.loading': 'Loading page…',
    'page.missing': 'Page not registered: {pageId}',
    'palette.placeholder': 'Type a command…',
    'palette.empty': 'No matching commands',
    'panel.noneHidden': 'No hidden panels',
    'panel.preview': 'Preview',
    'preview.offline': 'Preview unavailable (game WebUI not connected)',
    'preview.waiting': 'Waiting for preview frames…',
    'preview.lastFrame': 'Last frame',
    'preview.refresh': 'Refresh',
    'preview.unavailable': 'Host does not provide a preview stream',
    'project.title': 'ImmersiveCinematics Editor',
    'project.subtitle': 'Open a script or a recent project to enter the document workspace.',
    'project.newScript': 'New script',
    'project.openScript': 'Open script file',
    'project.openFolder': 'Open folder',
    'project.recent': 'Recent projects',
    'project.recentEmpty': 'No recent projects yet. Use the buttons above.',
    'project.missing': 'Missing',
    'project.relocate': 'Relocate',
    'project.remove': 'Remove',
    'project.offlineHint': 'Offline still opens local scripts; saving to the server needs the in-game WebUI.',
    'project.folderRecorded': 'Recorded as a recent project (not scanned)',
    'project.workspaceSet': 'Workspace: {path}',
    'project.workspaceFailed': 'Failed to set workspace: {reason}',
    'project.openFailed': 'Open failed',
    'project.newFailed': 'New document failed',
    'settings.missingSection': 'Settings section not registered: {sectionId}',
    'cmd.file.newDoc': 'New script',
    'cmd.file.openDoc': 'Open script…',
    'cmd.file.revertDoc': 'Reload from disk',
    'cmd.file.closeDoc': 'Close document',
    'cmd.app.commandPalette': 'Command palette',
    'cmd.workspace.focusNext': 'Focus next region',
    'cmd.workspace.focusPrev': 'Focus previous region',
    'cmd.layout.reset': 'Reset layout',
    'cmd.layout.showPanel': 'Show panel…',
    'cmd.camera.inspect.open': 'Open camera inspect…',
    'cmd.camera.inspect.locate': 'Locate clip in camera inspect',
    'cmd.camera.playback.open': 'Open playback check…',
    'cmd.theme.pick': 'Pick theme…',
    'cmd.window.minimize': 'Minimize',
    'cmd.window.maximize': 'Maximize / Restore',
    'cmd.window.close': 'Close window',
    'cmd.help.shortcuts': 'Keyboard shortcuts',
    'cmd.help.about': 'About',
    'theme.source.builtin': 'Builtin',
    'theme.source.plugin': 'Plugin',
    'theme.source.user': 'User',
    'theme.slotLight': 'Use in light',
    'theme.slotDark': 'Use in dark',
    'theme.slotHighContrast': 'Use in high contrast',
    'theme.slotNone': 'Not set',
    'theme.importFailed': 'Failed to read theme file',
    'theme.imported': 'Imported theme: {label}',
    'theme.resetDone': 'Appearance reset to default',
    'theme.overrides': 'Advanced: token overrides',
    'theme.overridesHint': 'Core tokens only; leave empty to use the theme value.',
    'settings.density': 'UI density',
    'settings.densityComfortable': 'Comfortable',
    'settings.densityCompact': 'Compact',
    'workspace.hint': 'Current page: {page}. Layout is stored only in layout.json, never in scripts.',
    'workspace.builtinPresets': 'Builtin presets',
    'workspace.userPresets': 'User presets',
    'workspace.noUserPresets': 'No user presets yet.',
    'workspace.presetName': 'Preset name',
    'workspace.savePreset': 'Save current layout as preset',
    'workspace.presetApplied': 'Preset applied: {id}',
    'workspace.presetSaved': 'Preset saved: {id}',
    'workspace.presetDeleted': 'Preset deleted: {id}',
    'workspace.resetDone': 'Layout reset to default',
    'workspace.openUserData': 'Open userData folder',
    'workspace.resetKeepPresets': 'Resetting layout only returns to the default preset; user presets stay.',
    'shortcuts.hint': 'Click Record, then press the chord. Esc cancels, Backspace clears. Same-scope conflicts are rejected.',
    'shortcuts.command': 'Command',
    'shortcuts.category': 'Category',
    'shortcuts.scope': 'Scope',
    'shortcuts.chord': 'Chord',
    'shortcuts.unbound': 'Unbound',
    'shortcuts.overridden': '(overridden)',
    'shortcuts.record': 'Record',
    'shortcuts.clear': 'Clear',
    'shortcuts.recording': 'Press a chord…',
    'shortcuts.resetAll': 'Reset keybindings',
    'shortcuts.resetDone': 'Keybindings reset',
    'shortcuts.saved': 'Chord saved: {chord}',
    'shortcuts.conflict': 'Conflict: {chord} is already used by {command}',
    'language.hint': 'Language applies immediately and is stored in preferences.json.',
    'language.changed': 'Language changed: {language}',
    'language.missingKeyHint': 'Missing translations show the raw key and are recorded in diagnostics.',
    'about.version': 'Editor version',
    'about.platform': 'Host platform',
    'about.diagnostics': 'Diagnostics',
    'about.diagnosticsValue': '{total} total ({errors} errors, {warnings} warnings)',
    'about.userData': 'User data files',
    'about.copyDiagnostics': 'Copy diagnostics',
    'advanced.resetTitle': 'Reset this setting?',
    'advanced.resetSectionDetail': 'Clears the "{section}" preference. Layout, window state, drafts and scripts are untouched.',
    'advanced.resetAllDetail': 'Clears all preferences; layout, window state, drafts and scripts are not deleted.',
    'advanced.reset': 'Reset',
    'advanced.resetDone': 'Reset done',
    'advanced.showPreferences': 'Show preferences.json',
    'advanced.hidePreferences': 'Hide preferences.json',
    'advanced.errors': 'Diagnostics snapshot',
    'advanced.pluginErrors': 'Plugin errors: {count}',
    'advanced.layoutErrors': 'Layout diagnostics: {count}',
    'advanced.themeErrors': 'Theme diagnostics: {count}',
    'advanced.noErrors': 'No diagnostics recorded.',
    'advanced.resetPluginsPlaceholder': '',
    'settings.advancedPlugins': 'Plugin preference sections',
    'diagnostics.source.plugin': 'Plugin',
    'diagnostics.source.layout': 'Layout',
    'diagnostics.source.theme': 'Theme',
    'diagnostics.source.preload': 'preload',
    'diagnostics.source.ipc': 'IPC',
    'diagnostics.source.panel': 'Panel',
    'diagnostics.source.command': 'Command',
    'diagnostics.source.document': 'Document',
    'diagnostics.source.preferences': 'Preferences',
    'status.page': 'Page: {page}',
    'status.docDirty': 'Document: unsaved',
    'status.docSaved': 'Document: saved',
    'status.presetValue': 'Layout: {preset}',
    'status.issuesValue': 'Issues: {count}',
    'status.pluginsValue': 'Plugin errors: {count}',
    'status.previewGame': 'Preview: in game',
    'status.previewOffline': 'Preview: offline',
  },
}

/** i18n 构造参数。 */
export interface I18nServiceOptions {
  /** 当前语言（读偏好）。 */
  locale: () => Locale
  /** 把内部 setter 交给偏好层，由它订阅语言变化。 */
  onChange?: (set: (locale: Locale) => void) => void
  diagnostics?: DiagnosticSink
}

/** i18n 实现。 */
export class I18nService implements I18nApi {
  private readonly readLocale: () => Locale
  private readonly diagnostics: DiagnosticSink | undefined
  private readonly listeners = new Set<(locale: Locale) => void>()
  private readonly missingKeys = new Set<string>()
  /** 用 shallowRef 存语言：模板里调 `t()` 会建立依赖，切语言自动重渲染。 */
  private readonly current: ShallowRef<Locale>

  constructor(options: I18nServiceOptions) {
    this.readLocale = options.locale
    this.diagnostics = options.diagnostics
    this.current = shallowRef(options.locale())
    options.onChange?.((locale) => {
      this.setLocale(locale)
    })
  }

  locale(): Locale {
    return this.current.value
  }

  t(key: string, params?: Record<string, string | number>): string {
    const table: Record<string, string> = MESSAGES[this.current.value]
    const template: string | undefined = table[key]
    if (template === undefined) {
      if (key.includes('.')) {
        this.reportMissing(key)
      }
      return key
    }
    if (params === undefined) {
      return template
    }
    return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, name: string) => {
      const value = params[name]
      return value === undefined ? match : String(value)
    })
  }

  subscribe(listener: (locale: Locale) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 切换语言；同值不触发订阅。 */
  setLocale(locale: Locale): boolean {
    if (locale !== 'zh_cn' && locale !== 'en_us') {
      return false
    }
    if (locale === this.current.value) {
      return false
    }
    this.current.value = locale
    for (const listener of this.listeners) {
      listener(locale)
    }
    return true
  }

  /** 重新读一次偏好里的语言（外部未通过 setter 通知时兜底）。 */
  refresh(): void {
    this.setLocale(this.readLocale())
  }

  /** 取消全部订阅。 */
  dispose(): void {
    this.listeners.clear()
    this.missingKeys.clear()
  }

  private reportMissing(key: string): void {
    const marker = `${this.current.value}\u0000${key}`
    if (this.missingKeys.has(marker)) {
      return
    }
    this.missingKeys.add(marker)
    this.diagnostics?.report({
      severity: 'warning',
      source: 'panel',
      message: `缺少翻译：${key}`,
    })
  }
}
