import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createOverlayControlMenuTemplate } from './overlay-control-menu'

function invoke(item: MenuItemConstructorOptions | undefined): void {
  expect(item?.click).toBeTypeOf('function')
  ;(item?.click as (() => void) | undefined)?.()
}

describe('createOverlayControlMenuTemplate', () => {
  it('shows the actions for a hidden passthrough overlay and routes every click', () => {
    const toggleOverlayVisibility = vi.fn()
    const toggleOverlayMode = vi.fn()
    const quit = vi.fn()

    const template = createOverlayControlMenuTemplate({
      overlayVisible: false,
      overlayInteractive: false,
      toggleOverlayVisibility,
      toggleOverlayMode,
      quit
    })

    expect(template.map((item) => item.label ?? item.type)).toEqual([
      '显示覆盖层',
      '切到输入模式（可打字·会切屏）',
      'separator',
      '退出'
    ])

    invoke(template[0])
    invoke(template[1])
    invoke(template[3])
    expect(toggleOverlayVisibility).toHaveBeenCalledOnce()
    expect(toggleOverlayMode).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('uses hide and passthrough labels for a visible interactive overlay', () => {
    const template = createOverlayControlMenuTemplate({
      overlayVisible: true,
      overlayInteractive: true,
      toggleOverlayVisibility: vi.fn(),
      toggleOverlayMode: vi.fn(),
      quit: vi.fn()
    })

    expect(template[0]?.label).toBe('隐藏覆盖层')
    expect(template[1]?.label).toBe('切到穿透模式（不抢焦点）')
  })
})
