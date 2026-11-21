/**
 * 标签条与所属 group 的注入键（04-05）。
 *
 * `TabStrip` 的公开 props 保持 04-05 约定（panels/activePanelId），
 * groupId 由 `GroupRenderer` provide，避免把布局结构塞进标签条 props。
 */
import type { InjectionKey } from 'vue'

export const TAB_STRIP_GROUP_KEY: InjectionKey<string> = Symbol('host.tabStrip.groupId')
