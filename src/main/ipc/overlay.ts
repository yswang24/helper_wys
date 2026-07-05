import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { SEND, INVOKE } from '../../shared/ipc'

// Drag state is shared with applyOverlayMode (which clears it), so it stays owned by the caller
// and is reached through getDragStart/setDragStart. Logic is a verbatim move from index.ts.
export interface OverlayDragStart {
  winX: number
  winY: number
  mouseX: number
  mouseY: number
  moved: boolean
}

export interface OverlayIpcDeps {
  getOverlayWindow: () => BrowserWindow | null
  isInteractive: () => boolean
  applyOverlayMode: (interactive: boolean) => void
  getDragStart: () => OverlayDragStart | null
  setDragStart: (d: OverlayDragStart | null) => void
  persistOverlayPos: (x: number, y: number) => void
}

export function registerOverlayIpc(deps: OverlayIpcDeps): void {
  // Current passthrough/interactive mode — the main window queries it after a transcription to
  // decide whether to auto-send (passthrough) or leave the draft for manual send (interactive).
  ipcMain.handle(INVOKE.getOverlayMode, () => (deps.isInteractive() ? 'interactive' : 'passthrough'))

  // 仅穿透模式听渲染层的逐元素命中——输入模式整窗捕获,这里直接忽略,防切换瞬间残留的 mousemove
  // 命中又把窗口设回穿透。
  ipcMain.on(SEND.overlaySetIgnoreMouse, (_e, ignore: boolean) => {
    if (deps.isInteractive()) return
    deps.getOverlayWindow()?.setIgnoreMouseEvents(ignore, { forward: true })
  })

  // 渲染进程(输入模式下头部的模式徽标)请求切换 穿透/输入 模式
  ipcMain.on(SEND.overlayRequestMode, (_e, interactive: boolean) => {
    const win = deps.getOverlayWindow()
    if (win && !win.isDestroyed()) deps.applyOverlayMode(!!interactive)
  })

  // 拖动:按下 drag-start、移动 drag-move(带 e.screenX/Y)、松开 drag-end。位移取差值(渲染层坐标)。
  // 3px 阈值:微小抖动不移动窗口,于是"点击"不再让窗口跳一下。
  ipcMain.on(SEND.overlayDragStart, (_e, m: { x: number; y: number }) => {
    const win = deps.getOverlayWindow()
    if (!win || win.isDestroyed()) return
    const [winX, winY] = win.getPosition()
    deps.setDragStart({ winX, winY, mouseX: m.x, mouseY: m.y, moved: false })
  })
  ipcMain.on(SEND.overlayDragMove, (_e, m: { x: number; y: number }) => {
    const win = deps.getOverlayWindow()
    const drag = deps.getDragStart()
    if (!win || win.isDestroyed() || !drag) return
    const dx = m.x - drag.mouseX
    const dy = m.y - drag.mouseY
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return // 视为点击,不移动
    drag.moved = true
    win.setPosition(drag.winX + dx, drag.winY + dy)
  })
  ipcMain.on(SEND.overlayDragEnd, () => {
    const drag = deps.getDragStart()
    const moved = drag?.moved
    deps.setDragStart(null)
    // 只有真正拖动过才落盘(纯点击没移动,无需写)
    const win = deps.getOverlayWindow()
    if (moved && win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      deps.persistOverlayPos(x, y)
    }
  })
}
