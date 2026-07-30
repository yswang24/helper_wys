# Option+Command+X Shortcut Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove the unfinished `Fn+Tab` mode shortcut and restore `Option+Command+X` without changing any other feature.

**Architecture:** Keep `OverlayController.ensureShownAndToggleMode()` as the only input/passthrough implementation. Register `CommandOrControl+Alt+X` in the Electron main process on macOS, while restoring the native helper and its TypeScript protocol to the four modifier-only Fn shortcuts. Preserve the already implemented macOS Dock context menu and non-macOS tray behavior.

**Tech Stack:** Electron 28, TypeScript, React 18, Vitest, C11, macOS ApplicationServices

## Global Constraints

- `Fn+Control`, `Fn+Shift`, `Fn+Option`, and `Fn+Command` behavior must not change.
- `Option+Command+X` is the only keyboard shortcut for switching input/passthrough mode.
- Helper must not register, detect, consume, advertise, or report `Fn+Tab`.
- A plain `Tab` must retain normal system and foreground-application behavior.
- macOS must not create a Helper menu-bar status icon.
- The macOS Dock context menu must retain show/hide, mode switch, and quit.
- Windows/Linux must retain the existing tray menu.
- Recording, screenshot, answer scrolling, overlay visibility, focus handling, and quitting must not change.
- No accessibility or input-monitoring permission may be introduced.
- No new package dependency may be added.

---

### Task 1: Restore the Electron mode shortcut

**Files:**
- Create: `src/main/overlay-mode-shortcut.test.ts`
- Create: `src/main/overlay-mode-shortcut.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: Electron-compatible `register(accelerator, handler): boolean`
- Consumes: `OverlayController.ensureShownAndToggleMode(): void`
- Produces: `OVERLAY_MODE_SHORTCUT = 'CommandOrControl+Alt+X'`
- Produces: `OVERLAY_MODE_SHORTCUT_LABEL = 'Option+Command+X'`
- Produces: `registerOverlayModeShortcut(deps): boolean`

- [ ] **Step 1: Write the failing shortcut test**

Create `src/main/overlay-mode-shortcut.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  OVERLAY_MODE_SHORTCUT,
  registerOverlayModeShortcut
} from './overlay-mode-shortcut'

describe('registerOverlayModeShortcut', () => {
  it('registers Option+Command+X and routes it to the existing mode action', () => {
    let handler: (() => void) | undefined
    const toggleOverlayMode = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerOverlayModeShortcut({
        register: (accelerator, callback) => {
          expect(accelerator).toBe('CommandOrControl+Alt+X')
          handler = callback
          return true
        },
        toggleOverlayMode,
        onUnavailable: unavailable
      })
    ).toBe(true)

    expect(OVERLAY_MODE_SHORTCUT).toBe('CommandOrControl+Alt+X')
    handler?.()
    expect(toggleOverlayMode).toHaveBeenCalledOnce()
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('reports registration rejection without changing overlay mode', () => {
    const toggleOverlayMode = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerOverlayModeShortcut({
        register: () => false,
        toggleOverlayMode,
        onUnavailable: unavailable
      })
    ).toBe(false)

    expect(toggleOverlayMode).not.toHaveBeenCalled()
    expect(unavailable).toHaveBeenCalledWith('可能被其他应用占用')
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/main/overlay-mode-shortcut.test.ts
```

Expected: FAIL because `src/main/overlay-mode-shortcut.ts` does not exist.

- [ ] **Step 3: Implement the minimal registration wrapper**

Create `src/main/overlay-mode-shortcut.ts`:

```ts
export const OVERLAY_MODE_SHORTCUT = 'CommandOrControl+Alt+X'
export const OVERLAY_MODE_SHORTCUT_LABEL = 'Option+Command+X'

export interface OverlayModeShortcutDeps {
  register: (accelerator: string, handler: () => void) => boolean
  toggleOverlayMode: () => void
  onUnavailable: (reason: string) => void
}

export function registerOverlayModeShortcut(
  deps: OverlayModeShortcutDeps
): boolean {
  try {
    if (deps.register(OVERLAY_MODE_SHORTCUT, deps.toggleOverlayMode)) {
      return true
    }
    deps.onUnavailable('可能被其他应用占用')
  } catch (error) {
    deps.onUnavailable(
      error instanceof Error ? error.message : '注册时发生未知错误'
    )
  }
  return false
}
```

- [ ] **Step 4: Connect the wrapper only on macOS**

Import both exports in `src/main/index.ts`, then call this inside the existing
`if (process.platform === 'darwin')` block:

```ts
registerOverlayModeShortcut({
  register: (accelerator, handler) =>
    globalShortcut.register(accelerator, handler),
  toggleOverlayMode: () =>
    overlayController.ensureShownAndToggleMode(),
  onUnavailable: (reason) =>
    recordShortcutFailure(OVERLAY_MODE_SHORTCUT_LABEL, reason)
})
```

Keep the existing `globalShortcut.unregisterAll()` in `will-quit`, which releases
this shortcut together with answer-scroll shortcuts.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/main/overlay-mode-shortcut.test.ts
```

Expected: both shortcut tests pass.

---

### Task 2: Completely remove Fn+Tab

**Files:**
- Modify: `src/main/fn-modifier-hotkeys.test.ts`
- Modify: `src/main/fn-modifier-hotkeys.ts`
- Modify: `src/main/fn-modifier-shortcut-actions.test.ts`
- Modify: `src/main/fn-modifier-shortcut-actions.ts`
- Modify: `src/main/index.ts`
- Modify: `native/fn-modifier-hotkeys.c`
- Modify: `scripts/build-macos-hotkey.mjs`
- Delete: `src/main/fn-tab-shortcut.test.ts`
- Delete: `.tmp-electron-hotkey-probe.cjs`

**Interfaces:**
- Preserves: `FnModifierShortcut = 'control' | 'shift' | 'option' | 'command'`
- Preserves: stdout protocol `control\n`, `shift\n`, `option\n`, `command\n`
- Removes: `tab`, `unavailable:tab:*`, `fn-down`, and `fn-up`

- [ ] **Step 1: Make the parser test reject all Tab-related lines**

In the existing complete/split-line parser test, send:

```ts
process.stdout.write(
  'trol\nunknown\ntab\nunavailable:tab:-9868\nfn-down\nfn-up\nshift\noption\ncommand\n'
)
```

Keep the literal expected calls:

```ts
expect(trigger.mock.calls).toEqual([
  ['control'],
  ['shift'],
  ['option'],
  ['command']
])
```

Delete the temporary Fn-state parser test added during the abandoned approach.

- [ ] **Step 2: Remove Tab from the Fn dispatcher test**

Use exactly these four action properties:

```ts
const actions = {
  toggleRecording: vi.fn(),
  captureFullScreen: vi.fn(),
  toggleAnswerScrollMode: vi.fn(),
  toggleOverlayVisibility: vi.fn()
}
```

Keep the four existing dispatch assertions and delete the `dispatch('tab')`
section.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npm test -- src/main/fn-modifier-hotkeys.test.ts src/main/fn-modifier-shortcut-actions.test.ts
```

Expected: FAIL because the current parser still accepts `tab` and the current
dispatcher interface still requires `toggleOverlayMode`.

- [ ] **Step 4: Restore the four-shortcut TypeScript protocol**

In `src/main/fn-modifier-hotkeys.ts`, restore:

```ts
export const FN_MODIFIER_SHORTCUT_LABEL =
  'Fn+Control / Fn+Shift / Fn+Option / Fn+Command'
export type FnModifierShortcut =
  | 'control'
  | 'shift'
  | 'option'
  | 'command'

const SHORTCUTS = new Set<FnModifierShortcut>([
  'control',
  'shift',
  'option',
  'command'
])
```

Restore `start(onTrigger, onUnavailable)` to two callbacks and remove
`UNAVAILABLE_TAB_PREFIX` parsing.

In `src/main/fn-modifier-shortcut-actions.ts`, remove `toggleOverlayMode` and the
`case 'tab'` branch. In `src/main/index.ts`, remove the Tab action and the
per-shortcut-unavailable callback from `fnModifierHotkeys.start()`.

- [ ] **Step 5: Restore the modifier-only native helper**

In `native/fn-modifier-hotkeys.c`:

- remove `#include <Carbon/Carbon.h>`;
- restore `<time.h>`;
- restore `kPollIntervalNanoseconds = 20L * 1000L * 1000L`;
- remove `HOTKEY_TAB`, `tab_held`, Tab self-tests, Carbon event handling, and
  `unavailable:tab:*`;
- restore `sleep_until_next_poll()` using `nanosleep()`;
- leave all four existing Fn modifier predicates and debounce sequences unchanged.

In `scripts/build-macos-hotkey.mjs`, remove only:

```js
'-framework',
'Carbon',
```

- [ ] **Step 6: Remove abandoned probe and test files**

Delete:

```text
.tmp-electron-hotkey-probe.cjs
src/main/fn-tab-shortcut.test.ts
```

- [ ] **Step 7: Run the focused tests and native build**

Run:

```bash
npm test -- src/main/fn-modifier-hotkeys.test.ts src/main/fn-modifier-shortcut-actions.test.ts src/main/overlay-mode-shortcut.test.ts
node scripts/build-macos-hotkey.mjs
```

Expected: TypeScript tests pass; the universal arm64/x86_64 helper builds and
prints a successful self-test result.

---

### Task 3: Preserve the Dock menu and user-facing behavior

**Files:**
- Verify/retain: `src/main/overlay-control-menu.ts`
- Verify/retain: `src/main/overlay-control-menu.test.ts`
- Verify/retain: `src/main/window-manager.ts`
- Verify/retain: `src/main/window-manager-menu.test.ts`
- Verify/retain: `src/main/overlay-controller.ts`
- Verify/retain: `src/renderer/main-window/App.tsx`
- Verify/retain: `src/renderer/main-window/App.test.tsx`
- Verify/retain: `README.md`

**Interfaces:**
- Preserves: `WindowManager.createAppMenu(): void`
- Preserves: `WindowManager.updateAppMenu(): void`
- Preserves: `createOverlayControlMenuTemplate(...)`
- Preserves: `OverlayController.ensureShownAndToggleMode(): void`

- [ ] **Step 1: Verify the UI advertises only the restored mode shortcut**

Keep these macOS assertions in `App.test.tsx`:

```ts
expect(screen.getByText('⌥⌘X')).toBeInTheDocument()
expect(screen.getByText('输入/穿透模式')).toBeInTheDocument()
expect(screen.queryByText('fn+Tab')).not.toBeInTheDocument()
```

Keep the non-macOS assertion that `⌥⌘X` is absent.

- [ ] **Step 2: Verify menu routing and platform separation**

Run:

```bash
npm test -- src/main/overlay-control-menu.test.ts src/main/window-manager-menu.test.ts src/renderer/main-window/App.test.tsx
```

Expected: the macOS path sets a Dock menu without constructing `Tray`; the
non-macOS path constructs `Tray`; all three menu actions call their existing
overlay/quit operations; UI tests pass.

- [ ] **Step 3: Check docs and source for stale Fn+Tab runtime references**

Run:

```bash
rg -n "Fn\\+Tab|fn\\+Tab|unavailable:tab|HOTKEY_TAB|kVK_Tab|kEventKeyModifierFnMask" \
  README.md src native scripts \
  --glob '!**/*.map'
```

Expected: no matches. Historical design documents are excluded because they
record decisions rather than runtime behavior.

---

### Task 4: Full regression verification and commit

**Files:**
- Verify: all tracked application and test files
- Commit: the complete validated implementation on `lyf_dev`

**Interfaces:**
- Produces: a tested local `lyf_dev` commit ready to push to the existing PR branch

- [ ] **Step 1: Run formatting and static checks**

Run the repository-provided check commands from `package.json`:

```bash
npm run lint
npm run typecheck
```

Expected: both exit with status 0.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests pass with no failed test files.

- [ ] **Step 3: Rebuild the native helper and production application**

Run:

```bash
node scripts/build-macos-hotkey.mjs
npm run build
```

Expected: the native universal helper self-test passes and the Electron
production build exits with status 0.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff
```

Confirm the diff contains:

- the restored `Option+Command+X` registration and tests;
- no Fn+Tab runtime implementation;
- the retained Dock-menu migration;
- no unrelated feature changes.

- [ ] **Step 5: Commit the validated code**

Stage only the intended files and commit:

```bash
git add README.md native/fn-modifier-hotkeys.c scripts/build-macos-hotkey.mjs \
  src/main src/renderer/main-window/App.tsx \
  src/renderer/main-window/App.test.tsx
git commit -m "feat: restore Option Command X mode shortcut"
```

- [ ] **Step 6: Inspect the committed branch**

Run:

```bash
git status --short
git log --oneline -4
```

Expected: the working tree is clean and the latest commit is on `lyf_dev`.
