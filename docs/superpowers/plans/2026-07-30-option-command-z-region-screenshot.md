# Option Command Z Region Screenshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register `Option + Command + Z` on macOS as the global shortcut for the existing local region screenshot selector while preserving the current direct/OCR mode.

**Architecture:** Add a small dependency-injected shortcut registration module that mirrors the existing overlay-mode shortcut pattern. Wire it to `WindowManager.toggleSelector()` during macOS startup, and advertise the shortcut in the existing macOS-only footer without changing screenshot capture or processing.

**Tech Stack:** Electron global shortcuts, TypeScript, React, Vitest, Testing Library

## Global Constraints

- Register Electron accelerator `CommandOrControl+Alt+Z` with user-facing label `Option+Command+Z`.
- Trigger the existing `WindowManager.toggleSelector()`; do not create another screenshot path.
- Continue using the saved `screenshotMode` for direct-answer or OCR processing.
- Keep `Fn + Shift`, `Option + Command + X`, and every other shortcut unchanged.
- Do not change selector appearance, capture coordinates, display selection, OCR, vision, or answer logic.
- Register and advertise the shortcut only on macOS.
- Keep all commits local until the user finishes manual confirmation; do not push or update the Pull Request.

---

### Task 1: Create the region screenshot shortcut registrar

**Files:**
- Create: `src/main/region-screenshot-shortcut.ts`
- Create: `src/main/region-screenshot-shortcut.test.ts`

**Interfaces:**
- Consumes: An Electron-compatible `register(accelerator, handler)` callback, the existing selector toggle action, and the existing shortcut-failure reporter.
- Produces:
  - `REGION_SCREENSHOT_SHORTCUT = 'CommandOrControl+Alt+Z'`
  - `REGION_SCREENSHOT_SHORTCUT_LABEL = 'Option+Command+Z'`
  - `registerRegionScreenshotShortcut(deps: RegionScreenshotShortcutDeps): boolean`

- [ ] **Step 1: Write the failing registrar tests**

Create `src/main/region-screenshot-shortcut.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  REGION_SCREENSHOT_SHORTCUT,
  REGION_SCREENSHOT_SHORTCUT_LABEL,
  registerRegionScreenshotShortcut
} from './region-screenshot-shortcut'

describe('registerRegionScreenshotShortcut', () => {
  it('registers Option+Command+Z and routes it to the existing selector action', () => {
    let handler: (() => void) | undefined
    const toggleSelector = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerRegionScreenshotShortcut({
        register: (accelerator, callback) => {
          expect(accelerator).toBe('CommandOrControl+Alt+Z')
          handler = callback
          return true
        },
        toggleSelector,
        onUnavailable: unavailable
      })
    ).toBe(true)

    expect(REGION_SCREENSHOT_SHORTCUT).toBe('CommandOrControl+Alt+Z')
    expect(REGION_SCREENSHOT_SHORTCUT_LABEL).toBe('Option+Command+Z')
    handler?.()
    expect(toggleSelector).toHaveBeenCalledOnce()
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('reports registration rejection without opening the selector', () => {
    const toggleSelector = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerRegionScreenshotShortcut({
        register: () => false,
        toggleSelector,
        onUnavailable: unavailable
      })
    ).toBe(false)

    expect(toggleSelector).not.toHaveBeenCalled()
    expect(unavailable).toHaveBeenCalledWith('可能被其他应用占用')
  })

  it('reports a registration exception without opening the selector', () => {
    const toggleSelector = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerRegionScreenshotShortcut({
        register: () => {
          throw new Error('registration denied')
        },
        toggleSelector,
        onUnavailable: unavailable
      })
    ).toBe(false)

    expect(toggleSelector).not.toHaveBeenCalled()
    expect(unavailable).toHaveBeenCalledWith('registration denied')
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- src/main/region-screenshot-shortcut.test.ts
```

Expected: FAIL because `region-screenshot-shortcut.ts` does not exist.

- [ ] **Step 3: Implement the minimal registrar**

Create `src/main/region-screenshot-shortcut.ts`:

```ts
export const REGION_SCREENSHOT_SHORTCUT = 'CommandOrControl+Alt+Z'
export const REGION_SCREENSHOT_SHORTCUT_LABEL = 'Option+Command+Z'

export interface RegionScreenshotShortcutDeps {
  register: (accelerator: string, handler: () => void) => boolean
  toggleSelector: () => void
  onUnavailable: (reason: string) => void
}

export function registerRegionScreenshotShortcut(
  deps: RegionScreenshotShortcutDeps
): boolean {
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
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
npm test -- src/main/region-screenshot-shortcut.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit the registrar locally**

```bash
git add src/main/region-screenshot-shortcut.ts src/main/region-screenshot-shortcut.test.ts
git commit -m "feat: add region screenshot shortcut registrar"
```

Do not push.

### Task 2: Wire the shortcut into macOS and show its footer hint

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/renderer/main-window/App.tsx`
- Test: `src/renderer/main-window/App.test.tsx`

**Interfaces:**
- Consumes:
  - `registerRegionScreenshotShortcut()` and `REGION_SCREENSHOT_SHORTCUT_LABEL` from Task 1.
  - Existing `WindowManager.toggleSelector(): void`.
  - Existing `recordShortcutFailure(shortcut: string, reason: string): void`.
- Produces:
  - A macOS startup registration that routes `Option + Command + Z` to `windowManager.toggleSelector()`.
  - A macOS-only footer hint `⌥⌘Z 局部截图`.

- [ ] **Step 1: Write the failing footer test**

In the existing macOS assertion block in `src/renderer/main-window/App.test.tsx`, add:

```tsx
expect(screen.getByText('⌥⌘Z')).toBeInTheDocument()
expect(screen.getByText(/局部截图/)).toBeInTheDocument()
```

In the non-macOS assertion block, add:

```tsx
expect(screen.queryByText('⌥⌘Z')).not.toBeInTheDocument()
expect(screen.queryByText(/局部截图/)).not.toBeInTheDocument()
```

- [ ] **Step 2: Run the footer test to verify it fails**

Run:

```bash
npm test -- src/renderer/main-window/App.test.tsx
```

Expected: the macOS test fails because `⌥⌘Z 局部截图` is not rendered; the non-macOS assertion remains green.

- [ ] **Step 3: Register the shortcut during macOS startup**

Add this import to `src/main/index.ts`:

```ts
import {
  REGION_SCREENSHOT_SHORTCUT_LABEL,
  registerRegionScreenshotShortcut
} from './region-screenshot-shortcut'
```

Inside the existing `if (process.platform === 'darwin')` startup block, after the existing overlay-mode shortcut registration, add:

```ts
registerRegionScreenshotShortcut({
  register: (accelerator, handler) =>
    globalShortcut.register(accelerator, handler),
  toggleSelector: () => windowManager.toggleSelector(),
  onUnavailable: (reason) =>
    recordShortcutFailure(REGION_SCREENSHOT_SHORTCUT_LABEL, reason)
})
```

Do not modify `WindowManager.toggleSelector()` or screenshot submission.

- [ ] **Step 4: Add the macOS-only footer hint**

In `src/renderer/main-window/App.tsx`, beside the existing macOS shortcut hints, add:

```tsx
<span><kbd className="font-mono">⌥⌘Z</kbd> 局部截图</span>
```

- [ ] **Step 5: Run focused shortcut and footer tests**

Run:

```bash
npm test -- src/main/region-screenshot-shortcut.test.ts src/renderer/main-window/App.test.tsx
```

Expected: all registrar and main-window tests pass.

- [ ] **Step 6: Commit the integration locally**

```bash
git add src/main/index.ts src/renderer/main-window/App.tsx src/renderer/main-window/App.test.tsx
git commit -m "feat: bind Option Command Z to region screenshot"
```

Do not push.

### Task 3: Verify and hand off the local build

**Files:**
- Verify only; no planned file modifications.

**Interfaces:**
- Consumes: The locally committed shortcut registrar and macOS integration from Tasks 1 and 2.
- Produces: Automated evidence and a clean local `lyf_dev` branch ready for the user's manual check.

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits successfully.

- [ ] **Step 2: Confirm local-only Git state**

Run:

```bash
git status --short --branch
git log -6 --oneline
```

Expected: the worktree is clean, `lyf_dev` is ahead of `fork/lyf_dev`, and no remote push has occurred.

- [ ] **Step 3: Hand off manual verification**

Ask the user to restart the local app and check:

```text
Option + Command + Z
```

Expected:

- First press opens the region selector on the display under the pointer.
- Second press closes an already-open selector.
- Dragging a region continues through the currently selected direct/OCR mode.
- `Fn + Shift`, `Option + Command + X`, and all other shortcuts behave as before.
- GitHub and the existing Pull Request remain unchanged.
