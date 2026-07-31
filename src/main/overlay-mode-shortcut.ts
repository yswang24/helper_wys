export const OVERLAY_MODE_SHORTCUT = 'CommandOrControl+Alt+X'
export const OVERLAY_MODE_SHORTCUT_LABEL = 'Option+Command+X'

export interface OverlayModeShortcutDeps {
  register: (accelerator: string, handler: () => void) => boolean
  toggleOverlayMode: () => void
  onUnavailable: (reason: string) => void
}

export function registerOverlayModeShortcut(deps: OverlayModeShortcutDeps): boolean {
  try {
    if (deps.register(OVERLAY_MODE_SHORTCUT, deps.toggleOverlayMode)) {
      return true
    }
    deps.onUnavailable('可能被其他应用占用')
  } catch (error) {
    deps.onUnavailable(error instanceof Error ? error.message : '注册时发生未知错误')
  }
  return false
}
