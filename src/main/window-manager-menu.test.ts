import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const dockSetMenu = vi.fn()
  const quit = vi.fn()
  const buildFromTemplate = vi.fn((template: unknown) => ({ template }))
  const traySetToolTip = vi.fn()
  const traySetContextMenu = vi.fn()
  const trayOn = vi.fn()
  const tray = {
    setToolTip: traySetToolTip,
    setContextMenu: traySetContextMenu,
    on: trayOn
  }
  const Tray = vi.fn(function () {
    return tray
  })
  const resize = vi.fn(() => ({ resized: true }))
  const createFromPath = vi.fn(() => ({ resize }))

  return {
    dockSetMenu,
    quit,
    buildFromTemplate,
    traySetToolTip,
    traySetContextMenu,
    trayOn,
    Tray,
    resize,
    createFromPath
  }
})

vi.mock('electron', () => ({
  app: {
    dock: { setMenu: electronMocks.dockSetMenu },
    quit: electronMocks.quit
  },
  BrowserWindow: vi.fn(),
  Menu: { buildFromTemplate: electronMocks.buildFromTemplate },
  Tray: electronMocks.Tray,
  nativeImage: { createFromPath: electronMocks.createFromPath },
  screen: {}
}))

import { WindowManager, type WindowManagerDeps } from './window-manager'

function createDeps(platform: NodeJS.Platform): WindowManagerDeps {
  return {
    platform,
    hardenWebContents: vi.fn(),
    setMainWindow: vi.fn(),
    overlay: {
      isVisible: () => true,
      isInteractive: () => false,
      toggleVisibility: vi.fn(),
      ensureShownAndToggleMode: vi.fn()
    }
  }
}

describe('WindowManager app menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs a Dock context menu without constructing a macOS Tray', () => {
    const manager = new WindowManager(createDeps('darwin'))

    manager.createAppMenu()

    expect(electronMocks.buildFromTemplate).toHaveBeenCalledOnce()
    expect(electronMocks.dockSetMenu).toHaveBeenCalledOnce()
    expect(electronMocks.Tray).not.toHaveBeenCalled()
    expect(electronMocks.createFromPath).not.toHaveBeenCalled()
  })

  it('retains the existing tray menu on non-macOS platforms', () => {
    const manager = new WindowManager(createDeps('win32'))

    manager.createAppMenu()

    expect(electronMocks.Tray).toHaveBeenCalledOnce()
    expect(electronMocks.traySetToolTip).toHaveBeenCalledWith('Helper')
    expect(electronMocks.traySetContextMenu).toHaveBeenCalledOnce()
    expect(electronMocks.dockSetMenu).not.toHaveBeenCalled()
  })
})
