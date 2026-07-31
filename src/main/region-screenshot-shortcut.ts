export const REGION_SCREENSHOT_SHORTCUT = 'CommandOrControl+Alt+Z'
export const REGION_SCREENSHOT_SHORTCUT_LABEL = 'Option+Command+Z'

export interface RegionScreenshotShortcutDeps {
  register: (accelerator: string, handler: () => void) => boolean
  toggleSelector: () => void
  onUnavailable: (reason: string) => void
}

export function registerRegionScreenshotShortcut(deps: RegionScreenshotShortcutDeps): boolean {
  try {
    if (deps.register(REGION_SCREENSHOT_SHORTCUT, deps.toggleSelector)) {
      return true
    }
    deps.onUnavailable('可能被其他应用占用')
  } catch (error) {
    deps.onUnavailable(error instanceof Error ? error.message : '注册时发生未知错误')
  }
  return false
}
