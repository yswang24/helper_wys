import type { MenuItemConstructorOptions } from 'electron'

export interface OverlayControlMenuOptions {
  overlayVisible: boolean
  overlayInteractive: boolean
  toggleOverlayVisibility: () => void
  toggleOverlayMode: () => void
  quit: () => void
}

export function createOverlayControlMenuTemplate(
  options: OverlayControlMenuOptions
): MenuItemConstructorOptions[] {
  return [
    {
      label: options.overlayVisible ? '隐藏覆盖层' : '显示覆盖层',
      click: options.toggleOverlayVisibility
    },
    {
      label: options.overlayInteractive
        ? '切到穿透模式（不抢焦点）'
        : '切到输入模式（可打字·会切屏）',
      click: options.toggleOverlayMode
    },
    { type: 'separator' },
    {
      label: '退出',
      click: options.quit
    }
  ]
}
