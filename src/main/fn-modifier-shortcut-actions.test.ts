import { describe, expect, it, vi } from 'vitest'
import { createFnModifierShortcutDispatcher } from './fn-modifier-shortcut-actions'

describe('createFnModifierShortcutDispatcher', () => {
  it('maps each Fn modifier to exactly one existing feature action', () => {
    const actions = {
      toggleRecording: vi.fn(),
      captureFullScreen: vi.fn(),
      toggleAnswerScrollMode: vi.fn(),
      toggleOverlayVisibility: vi.fn()
    }
    const dispatch = createFnModifierShortcutDispatcher(actions)
    const reset = () => Object.values(actions).forEach((action) => action.mockClear())

    dispatch('control')
    expect(actions.toggleRecording).toHaveBeenCalledOnce()
    expect(actions.captureFullScreen).not.toHaveBeenCalled()
    expect(actions.toggleAnswerScrollMode).not.toHaveBeenCalled()
    expect(actions.toggleOverlayVisibility).not.toHaveBeenCalled()
    reset()

    dispatch('shift')
    expect(actions.toggleRecording).not.toHaveBeenCalled()
    expect(actions.captureFullScreen).toHaveBeenCalledOnce()
    expect(actions.toggleAnswerScrollMode).not.toHaveBeenCalled()
    expect(actions.toggleOverlayVisibility).not.toHaveBeenCalled()
    reset()

    dispatch('option')
    expect(actions.toggleRecording).not.toHaveBeenCalled()
    expect(actions.captureFullScreen).not.toHaveBeenCalled()
    expect(actions.toggleAnswerScrollMode).toHaveBeenCalledOnce()
    expect(actions.toggleOverlayVisibility).not.toHaveBeenCalled()
    reset()

    dispatch('command')
    expect(actions.toggleRecording).not.toHaveBeenCalled()
    expect(actions.captureFullScreen).not.toHaveBeenCalled()
    expect(actions.toggleAnswerScrollMode).not.toHaveBeenCalled()
    expect(actions.toggleOverlayVisibility).toHaveBeenCalledOnce()
  })
})
