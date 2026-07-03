import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { INVOKE } from '../../shared/ipc'

export interface AppIpcDeps {
  getOverlayWindow: () => BrowserWindow | null
  failedShortcuts: string[]
}

export function registerAppIpc(deps: AppIpcDeps): void {
  ipcMain.handle(INVOKE.getStatus, () => ({
    contentProtection: true,
    overlayVisible: deps.getOverlayWindow()?.isVisible() ?? false,
    platform: process.platform,
    version: app.getVersion(),
    failedShortcuts: deps.failedShortcuts
  }))
}
