# Fn Modifier Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Helper's existing global shortcuts with `Fn+Control`, `Fn+Shift`, `Fn+Option`, and `Fn+Command` while preserving all underlying feature behavior.

**Architecture:** Generalize the existing macOS CoreGraphics polling helper from one Fn chord to four typed events, then route those events through a small tested dispatcher to existing main-process actions. Keep bare-arrow registration and the 30-second answer-scroll timeout in the current state machine, changing only its activation entry from directional command shortcuts to a directionless toggle.

**Tech Stack:** macOS CoreGraphics C helper, Electron 28, Node.js child processes, TypeScript, Vitest, React 18.

## Global Constraints

- Only replace global shortcut entry points; do not change recording, screenshot capture, answer scrolling, overlay visibility, selector, or overlay interaction business logic.
- `Fn+Control` starts/stops recording.
- `Fn+Shift` captures the display under the pointer and submits it directly.
- `Fn+Option` opens/closes answer-scroll mode without scrolling immediately.
- While answer-scroll mode is active, bare `↑` / `↓` keep scrolling and resetting the existing 30-second inactivity timeout.
- `Fn+Command` shows/hides the overlay.
- Remove the old `CommandOrControl+Alt+H`, `CommandOrControl+Alt+E`, `CommandOrControl+Alt+X`, `CommandOrControl+Alt+S`, `Command+Alt+Up`, and `Command+Alt+Down` global registrations.
- Do not add dependencies or new macOS privacy permissions.

---

## File Structure

- Rename `native/fn-shift-hotkey.c` to `native/fn-modifier-hotkeys.c`: identify four exact Fn modifier chords, debounce them, self-test them, and emit typed lines.
- Modify `scripts/build-macos-hotkey.mjs`: compile the generalized native source and output `helper-fn-modifier-hotkeys`.
- Modify `package.json`: package the renamed native executable.
- Rename `src/main/fn-shift-hotkey.ts` to `src/main/fn-modifier-hotkeys.ts`: own the helper process lifecycle and parse typed native events.
- Rename `src/main/fn-shift-hotkey.test.ts` to `src/main/fn-modifier-hotkeys.test.ts`: verify paths, parsing, lifecycle, and failures.
- Create `src/main/fn-modifier-shortcut-actions.ts`: map typed native events to four injected feature actions.
- Create `src/main/fn-modifier-shortcut-actions.test.ts`: verify the mapping does not cross-call actions.
- Modify `src/main/answer-scroll-mode.ts` and its test: expose a directionless toggle while preserving arrows and timeout.
- Modify `src/main/index.ts`: remove old registrations and connect the native dispatcher to existing actions.
- Modify `src/renderer/main-window/App.tsx`, `src/renderer/main-window/App.test.tsx`, `src/renderer/main-window/tabs/Settings.tsx`, `src/main/llm.ts`, `src/main/screenshot/index.ts`, `src/main/window-manager.ts`, and `README.md`: replace stale shortcut labels and comments only.

---

### Task 1: Generalize the Native Fn Shortcut Protocol

**Files:**

- Create by rename: `native/fn-modifier-hotkeys.c`
- Create by rename: `src/main/fn-modifier-hotkeys.ts`
- Test by rename: `src/main/fn-modifier-hotkeys.test.ts`
- Delete by rename: `native/fn-shift-hotkey.c`
- Delete by rename: `src/main/fn-shift-hotkey.ts`
- Delete by rename: `src/main/fn-shift-hotkey.test.ts`
- Modify: `scripts/build-macos-hotkey.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `type FnModifierShortcut = 'control' | 'shift' | 'option' | 'command'`
- Produces: `class FnModifierHotkeys` with `start(onTrigger: (shortcut: FnModifierShortcut) => void, onUnavailable: (reason: string) => void): boolean` and `stop(): void`
- Produces: `FN_MODIFIER_SHORTCUT_LABEL = 'Fn+Control / Fn+Shift / Fn+Option / Fn+Command'`

- [ ] **Step 1: Rename the TypeScript test and write failing protocol expectations**

Change the test import and assertions to the new API:

```ts
import {
  FnModifierHotkeys,
  resolveFnModifierHotkeysExecutablePath
} from './fn-modifier-hotkeys'

expect(
  resolveFnModifierHotkeysExecutablePath({
    isPackaged: false,
    resourcesPath: '/unused',
    appPath: '/repo'
  })
).toBe('/repo/.native-build/helper-fn-modifier-hotkeys')
```

Replace the single `trigger` parser assertion with:

```ts
const trigger = vi.fn()
expect(hotkeys.start(trigger, unavailable)).toBe(true)
process.stdout.write('con')
process.stdout.write('trol\nunknown\nshift\noption\ncommand\n')
await vi.waitFor(() => expect(trigger).toHaveBeenCalledTimes(4))
expect(trigger.mock.calls).toEqual([
  ['control'],
  ['shift'],
  ['option'],
  ['command']
])
```

Rename the remaining existing test subjects from `FnShiftHotkey` to `FnModifierHotkeys`, change every fixture executable from `/tmp/helper-fn-shift-hotkey` to `/tmp/helper-fn-modifier-hotkeys`, and retain these exact assertions:

```ts
expect(spawnProcess).toHaveBeenCalledOnce()
expect(unavailable).not.toHaveBeenCalled()
hotkeys.stop()
expect(process.kill).toHaveBeenCalledOnce()

expect(hotkeys.start(vi.fn(), unavailable)).toBe(true)
expect(hotkeys.start(vi.fn(), unavailable)).toBe(true)
process.child.emit('exit', null, 'SIGTERM')
expect(unavailable).not.toHaveBeenCalled()

expect(missing.start(vi.fn(), missingFailure)).toBe(false)
expect(missingFailure).toHaveBeenCalledWith(expect.stringContaining('不存在或不可执行'))
expect(exitFailure).toHaveBeenCalledWith(expect.stringContaining('code=2'))
```

- [ ] **Step 2: Run the TypeScript protocol test to verify it fails**

Run: `npx vitest run src/main/fn-modifier-hotkeys.test.ts`

Expected: FAIL because `./fn-modifier-hotkeys` and its renamed exports do not exist.

- [ ] **Step 3: Implement the typed TypeScript protocol and rename the helper path**

Rename the implementation, then make these exact symbol and parser changes:

```ts
export const FN_MODIFIER_SHORTCUT_LABEL =
  'Fn+Control / Fn+Shift / Fn+Option / Fn+Command'
export type FnModifierShortcut = 'control' | 'shift' | 'option' | 'command'

const SHORTCUTS = new Set<FnModifierShortcut>([
  'control',
  'shift',
  'option',
  'command'
])

export class FnModifierHotkeys {
  start(
    onTrigger: (shortcut: FnModifierShortcut) => void,
    onUnavailable: (reason: string) => void
  ): boolean {
    // Existing executable verification and child-process setup remain above this parser.
    child.stdout?.on('data', (chunk: string | Buffer) => {
      if (this.child !== child) return
      this.stdoutBuffer += String(chunk)
      if (this.stdoutBuffer.length > 4096) {
        this.stdoutBuffer = this.stdoutBuffer.slice(-4096)
      }
      let newline = this.stdoutBuffer.indexOf('\n')
      while (newline >= 0) {
        const line = this.stdoutBuffer.slice(0, newline).trim()
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
        if (SHORTCUTS.has(line as FnModifierShortcut) && this.child === child) {
          onTrigger(line as FnModifierShortcut)
        }
        newline = this.stdoutBuffer.indexOf('\n')
      }
    })
    // Existing stderr, error, and exit listeners remain below this parser.
  }
}
```

Rename the executable constant to `helper-fn-modifier-hotkeys`, export `resolveFnModifierHotkeysExecutablePath`, and leave the current `stop()` body byte-for-byte unchanged apart from the class rename.

- [ ] **Step 4: Run the TypeScript protocol test to verify it passes**

Run: `npx vitest run src/main/fn-modifier-hotkeys.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing native self-tests for all four exact chords**

Rename the C source and define an event enum used by the tests:

```c
typedef enum {
  HOTKEY_NONE = 0,
  HOTKEY_CONTROL,
  HOTKEY_SHIFT,
  HOTKEY_OPTION,
  HOTKEY_COMMAND,
} HotkeyEvent;
```

Add predicate expectations for each exact Fn chord, extra target modifiers, Fn alone, and Caps Lock:

```c
{"fn + control", fn | control, HOTKEY_CONTROL},
{"fn + shift", fn | shift, HOTKEY_SHIFT},
{"fn + option", fn | option, HOTKEY_OPTION},
{"fn + command", fn | command, HOTKEY_COMMAND},
{"fn + shift + command", fn | shift | command, HOTKEY_NONE},
{"fn + shift + caps lock", fn | shift | kCGEventFlagMaskAlphaShift, HOTKEY_SHIFT},
```

Add state-sequence expectations proving startup-held chords do not fire, held chords do not repeat, blocked multi-modifier entry does not fire when one modifier is released, and a fully released chord can fire again.

- [ ] **Step 6: Point the build script at the renamed source and verify the native test fails**

Use:

```js
const sourcePath = join(projectRoot, 'native', 'fn-modifier-hotkeys.c')
const outputPath = join(outputDirectory, 'helper-fn-modifier-hotkeys')
```

Run: `npm run predev`

Expected: FAIL in the native self-test while the detection function still returns the old single-chord result or a temporary `HOTKEY_NONE` stub.

- [ ] **Step 7: Implement exact-chord detection, debounce, and typed output**

Use only the four target modifier masks when classifying a chord:

```c
static HotkeyEvent get_hotkey_event(CGEventFlags flags) {
  if ((flags & kCGEventFlagMaskSecondaryFn) == 0) return HOTKEY_NONE;

  const CGEventFlags targets =
      flags & (kCGEventFlagMaskControl | kCGEventFlagMaskShift |
               kCGEventFlagMaskAlternate | kCGEventFlagMaskCommand);

  if (targets == kCGEventFlagMaskControl) return HOTKEY_CONTROL;
  if (targets == kCGEventFlagMaskShift) return HOTKEY_SHIFT;
  if (targets == kCGEventFlagMaskAlternate) return HOTKEY_OPTION;
  if (targets == kCGEventFlagMaskCommand) return HOTKEY_COMMAND;
  return HOTKEY_NONE;
}
```

Track whether Fn plus any target modifier is held so adding/removing modifiers within one held chord cannot trigger a second action. Map rising-edge events to:

```c
static const char *hotkey_event_name(HotkeyEvent event) {
  switch (event) {
    case HOTKEY_CONTROL: return "control\n";
    case HOTKEY_SHIFT: return "shift\n";
    case HOTKEY_OPTION: return "option\n";
    case HOTKEY_COMMAND: return "command\n";
    case HOTKEY_NONE: return NULL;
  }
  return NULL;
}
```

Retain the existing `getppid()` parent check, `EINTR` write retry, 20 ms polling interval, and `nanosleep` retry without changing their statements.

- [ ] **Step 8: Update packaging and verify native plus TypeScript tests**

Change `package.json` `build.mac.extraFiles` from `.native-build/helper-fn-shift-hotkey` to `.native-build/helper-fn-modifier-hotkeys` and update the destination name identically.

Run: `npm run predev`

Expected: PASS with `[native] Built and verified .../helper-fn-modifier-hotkeys`.

Run: `npx vitest run src/main/fn-modifier-hotkeys.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the generalized protocol**

```bash
git add native scripts/build-macos-hotkey.mjs package.json src/main/fn-modifier-hotkeys.ts src/main/fn-modifier-hotkeys.test.ts
git add -u native src/main
git commit -m "feat: support Fn modifier shortcut events"
```

---

### Task 2: Make Answer-Scroll Activation Directionless

**Files:**

- Modify: `src/main/answer-scroll-mode.ts`
- Test: `src/main/answer-scroll-mode.test.ts`

**Interfaces:**

- Consumes: existing `AnswerScrollModeDeps`
- Produces: `AnswerScrollMode.toggle(): void`
- Produces: `ANSWER_SCROLL_MODE_SHORTCUTS = { plainUp: 'Up', plainDown: 'Down' }`

- [ ] **Step 1: Rewrite tests for directionless activation**

Change the shortcut constant assertion:

```ts
expect(ANSWER_SCROLL_MODE_SHORTCUTS).toEqual({
  plainUp: 'Up',
  plainDown: 'Down'
})
```

Open the mode with `harness.controller.toggle()` and assert it does not dispatch:

```ts
harness.controller.toggle()
expect(harness.register).toHaveBeenNthCalledWith(1, 'Up', expect.any(Function))
expect(harness.register).toHaveBeenNthCalledWith(2, 'Down', expect.any(Function))
expect(harness.broadcast).toHaveBeenCalledWith(true)
expect(harness.dispatch).not.toHaveBeenCalled()
expect(harness.controller.isActive()).toBe(true)
```

Keep the bare-arrow assertion, 30-second reset assertion, second-toggle close assertion, atomic registration rollback, queued-callback cleanup, and exit cleanup. For registration failure, assert no broadcast and no dispatch.

- [ ] **Step 2: Run the scroll-mode test to verify it fails**

Run: `npx vitest run src/main/answer-scroll-mode.test.ts`

Expected: FAIL because `toggle` still requires a direction, dispatches immediately, and exports command shortcuts.

- [ ] **Step 3: Implement the minimal directionless toggle**

Change:

```ts
export const ANSWER_SCROLL_MODE_SHORTCUTS = {
  plainUp: 'Up',
  plainDown: 'Down'
} as const

export interface AnswerScrollMode {
  toggle: () => void
  deactivate: () => void
  isActive: () => boolean
}
```

Implement activation without initial scrolling:

```ts
const toggle = (): void => {
  if (active) {
    deactivate()
    return
  }
  if (!registerPlainArrows()) return

  active = true
  resetTimeout()
  if (!active) return
  deps.broadcast(true)
}
```

Leave the bodies of `onPlainArrow`, `clearPendingTimeout`, `unregisterPlainArrows`, `deactivate`, `resetTimeout`, and `registerPlainArrows` unchanged.

- [ ] **Step 4: Run the scroll-mode test to verify it passes**

Run: `npx vitest run src/main/answer-scroll-mode.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the scroll activation change**

```bash
git add src/main/answer-scroll-mode.ts src/main/answer-scroll-mode.test.ts
git commit -m "feat: toggle answer scrolling with one shortcut"
```

---

### Task 3: Bind the Four Shortcuts and Update Shortcut Copy

**Files:**

- Create: `src/main/fn-modifier-shortcut-actions.ts`
- Test: `src/main/fn-modifier-shortcut-actions.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/main-window/App.tsx`
- Test: `src/renderer/main-window/App.test.tsx`
- Modify: `src/renderer/main-window/tabs/Settings.tsx`
- Modify: `src/main/llm.ts`
- Modify: `src/main/screenshot/index.ts`
- Modify: `src/main/window-manager.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `FnModifierShortcut` from Task 1
- Consumes: `AnswerScrollMode.toggle(): void` from Task 2
- Produces: `createFnModifierShortcutDispatcher(actions): (shortcut: FnModifierShortcut) => void`

- [ ] **Step 1: Write a failing action-mapping test**

Create:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createFnModifierShortcutDispatcher } from './fn-modifier-shortcut-actions'

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
```

- [ ] **Step 2: Run the action-mapping test to verify it fails**

Run: `npx vitest run src/main/fn-modifier-shortcut-actions.test.ts`

Expected: FAIL because the dispatcher module does not exist.

- [ ] **Step 3: Implement the action dispatcher**

Create:

```ts
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
```

- [ ] **Step 4: Run the action-mapping test to verify it passes**

Run: `npx vitest run src/main/fn-modifier-shortcut-actions.test.ts`

Expected: PASS.

- [ ] **Step 5: Replace main-process shortcut registrations**

In `src/main/index.ts`:

```ts
import {
  FN_MODIFIER_SHORTCUT_LABEL,
  FnModifierHotkeys
} from './fn-modifier-hotkeys'
import { createFnModifierShortcutDispatcher } from './fn-modifier-shortcut-actions'

const fnModifierHotkeys = new FnModifierHotkeys()
```

Delete all six old command-shortcut registrations. Inside the Darwin block, start the native helper:

```ts
fnModifierHotkeys.start(
  createFnModifierShortcutDispatcher({
    toggleRecording: () => {
      windowManager.getMainWindow()?.webContents.send('asr:ptt-toggle')
    },
    captureFullScreen: triggerFullScreenScreenshot,
    toggleAnswerScrollMode: () => answerScrollMode.toggle(),
    toggleOverlayVisibility: () => overlayController.toggleVisibility()
  }),
  (reason) => recordShortcutFailure(FN_MODIFIER_SHORTCUT_LABEL, reason)
)
```

Rename both quit-path `stop()` calls to `fnModifierHotkeys.stop()`. Keep `registerShortcut` because the answer-scroll state machine still uses it for bare `Up` and `Down`.

- [ ] **Step 6: Write failing renderer shortcut-copy expectations**

Update `src/renderer/main-window/App.test.tsx` to require the four macOS-only labels:

```ts
expect(await screen.findByText('fn⌃')).toBeInTheDocument()
expect(screen.getByText('fn⇧')).toBeInTheDocument()
expect(screen.getByText('fn⌥')).toBeInTheDocument()
expect(screen.getByText('fn⌘')).toBeInTheDocument()
expect(screen.getByText(/滚动模式（再按关闭/)).toBeInTheDocument()
```

For `win32`, assert all four are absent. Also assert the old `⌘⌥H`, `⌘⌥X`, `⌘⌥S`, and `⌘⌥↑ / ⌘⌥↓` labels are absent on macOS.

```ts
expect(screen.queryByText('⌘⌥H')).not.toBeInTheDocument()
expect(screen.queryByText('⌘⌥X')).not.toBeInTheDocument()
expect(screen.queryByText('⌘⌥S')).not.toBeInTheDocument()
expect(screen.queryByText('⌘⌥↑ / ⌘⌥↓')).not.toBeInTheDocument()
```

- [ ] **Step 7: Run the renderer test to verify it fails**

Run: `npx vitest run src/renderer/main-window/App.test.tsx`

Expected: FAIL because the footer still advertises the old shortcuts.

- [ ] **Step 8: Update user-visible shortcut copy and code comments**

Render only the four new shortcuts in the macOS footer:

```tsx
{status?.platform === 'darwin' && (
  <>
    <span><kbd className="font-mono">fn⌃</kbd> 录音开关</span>
    <span><kbd className="font-mono">fn⇧</kbd> 全屏截图</span>
    <span>
      <kbd className="font-mono">fn⌥</kbd>{' '}
      滚动模式（再按关闭；↑↓ 由 Helper 接管；30 秒无操作关闭）
    </span>
    <span><kbd className="font-mono">fn⌘</kbd> 覆盖层</span>
  </>
)}
```

Change shortcut-specific comments and labels only:

- `Settings.tsx`: remove the stale `（⌘⌥S）` suffix from the region screenshot mode label.
- `llm.ts`: describe the prompt as belonging to screenshot direct-solve mode without old shortcut names.
- `screenshot/index.ts`: use `Fn+Shift` for the full-screen path.
- `window-manager.ts`: describe `toggleSelector` without `⌘⌥S`.
- Rename the three `useAsrCapture.test.tsx` descriptions from `⌘⌥X` to `Fn+Control`; do not change their test bodies.
- Replace the README shortcut table with:

```md
| 快捷键 | 作用 |
|---|---|
| fn⌃ | 开始 / 停止录音 |
| fn⇧ | 截取鼠标所在显示器的全屏截图并直接解答 |
| fn⌥ | 开启 / 关闭回答滚动模式 |
| fn⌘ | 显示 / 隐藏浮层 |
```

- State immediately below the table that answer-scroll mode captures bare `↑` / `↓`, resets the 30-second inactivity timer after each arrow, and releases both arrows on manual or timed close.
- Remove README claims that `⌘⌥H`, `⌘⌥E`, `⌘⌥X`, `⌘⌥S`, `⌘⌥↑`, or `⌘⌥↓` are registered or can cancel/toggle a feature.

- [ ] **Step 9: Run focused tests**

Run:

```bash
npx vitest run \
  src/main/fn-modifier-hotkeys.test.ts \
  src/main/fn-modifier-shortcut-actions.test.ts \
  src/main/answer-scroll-mode.test.ts \
  src/renderer/main-window/App.test.tsx \
  src/renderer/main-window/hooks/useAsrCapture.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 10: Run full verification**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

Run: `npm run build`

Expected: native Universal helper builds and self-tests, typecheck passes, and Electron bundles complete.

Run: `git diff --check`

Expected: no whitespace errors.

Run: `rg -n "CommandOrControl\\+Alt|Command\\+Alt|⌘⌥|FN_SHIFT|FnShiftHotkey|helper-fn-shift-hotkey" src native scripts package.json README.md`

Expected: no stale shortcut registrations, symbols, executable paths, user-facing labels, or comments.

- [ ] **Step 11: Commit the bindings and documentation**

```bash
git add src README.md
git commit -m "feat: bind features to Fn modifier shortcuts"
```

---

## Final Review

- [ ] Confirm `git status --short` is clean.
- [ ] Confirm the final diff contains no recording, screenshot, overlay, selector, or scrolling implementation changes outside shortcut activation.
- [ ] Confirm `Fn+Option` does not scroll on activation and still times out after 30 seconds.
- [ ] Confirm native startup/exit failures still appear through the existing failed-shortcut status path.
- [ ] Confirm no new dependency, entitlement, or privacy permission was added.
