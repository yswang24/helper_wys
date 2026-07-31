import type { FnModifierShortcut } from './fn-modifier-hotkeys'

export interface FnModifierShortcutActions {
  toggleRecording: () => void
  captureFullScreen: () => void
  toggleAnswerScrollMode: () => void
  toggleOverlayVisibility: () => void
}

export function createFnModifierShortcutDispatcher(
  actions: FnModifierShortcutActions
): (shortcut: FnModifierShortcut) => void {
  return (shortcut) => {
    switch (shortcut) {
      case 'control':
        actions.toggleRecording()
        return
      case 'shift':
        actions.captureFullScreen()
        return
      case 'option':
        actions.toggleAnswerScrollMode()
        return
      case 'command':
        actions.toggleOverlayVisibility()
    }
  }
}
