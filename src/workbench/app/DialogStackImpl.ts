/**
 * 弹窗栈（04-10）：命令面板 / 确认框 / 主题选择器共用一个「是否有弹窗」判定。
 *
 * 快捷键与命令面板靠它把背景命令降级；焦点陷阱与 Esc 逐层退出由各弹窗组件自己做。
 */
import type { DialogStackPort } from '../api/commands.ts'

export class DialogStackImpl implements DialogStackPort {
  private readonly stack: string[] = []
  private readonly listeners = new Set<(open: boolean) => void>()

  isOpen(): boolean {
    return this.stack.length > 0
  }

  open(id: string): void {
    if (this.stack.includes(id)) {
      return
    }
    this.stack.push(id)
    this.emit()
  }

  close(id: string): void {
    const index = this.stack.indexOf(id)
    if (index === -1) {
      return
    }
    this.stack.splice(index, 1)
    this.emit()
  }

  /** 关闭最上层（Esc 逐层退出用）。 */
  closeTop(): string | null {
    const top = this.stack.pop()
    if (top === undefined) {
      return null
    }
    this.emit()
    return top
  }

  subscribe(listener: (open: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const open = this.isOpen()
    for (const listener of this.listeners) {
      listener(open)
    }
  }
}
