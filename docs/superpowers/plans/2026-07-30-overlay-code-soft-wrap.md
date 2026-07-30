# Overlay Code Soft Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long code lines in the answer overlay wrap visually to the available width without changing the underlying code text or any unrelated behavior.

**Architecture:** Keep the existing Markdown segmentation and code rendering flow in `AnswerText`. Change only the code block presentation from preserved non-wrapping whitespace plus horizontal scrolling to preserved soft-wrapping whitespace with horizontal overflow hidden, and expose `AnswerText` only so its real rendering behavior can be tested directly.

**Tech Stack:** React, TypeScript, Tailwind CSS classes, Vitest, Testing Library, jsdom

## Global Constraints

- Only answer-overlay code blocks may change.
- Preserve short lines, spaces, indentation, and original newlines.
- Very long strings, URLs, and uninterrupted character sequences must wrap.
- Do not insert line breaks into the raw code string.
- Do not change Markdown parsing, ordinary answer text, copy behavior, shortcuts, recording, screenshots, scrolling mode, overlay mode, or any other feature.
- Keep all work local until the user confirms the behavior; do not push or update the Pull Request.

---

### Task 1: Add soft wrapping to overlay code blocks

**Files:**
- Modify: `src/renderer/overlay-window/App.tsx`
- Test: `src/renderer/overlay-window/App.test.tsx`

**Interfaces:**
- Consumes: `AnswerText({ text, streaming }: { text: string; streaming: boolean })`
- Produces: An exported `AnswerText` component whose `<pre>` code blocks use `white-space: pre-wrap`, `overflow-wrap: anywhere`, and `overflow-x: hidden` while rendering the original code string unchanged.

- [ ] **Step 1: Write the failing component test**

Update the import and add this test:

```tsx
import { AnswerScrollModeBadge, AnswerText } from './App'

describe('AnswerText', () => {
  it('soft-wraps long code without changing the source text', () => {
    const code = `const value = '${'x'.repeat(200)}'\n  return value`
    const { container } = render(<AnswerText text={`\`\`\`\n${code}\n\`\`\``} streaming={false} />)
    const codeBlock = container.querySelector('pre')

    expect(codeBlock).not.toBeNull()
    expect(codeBlock).toHaveStyle({
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      overflowX: 'hidden'
    })
    expect(codeBlock?.textContent).toBe(code)
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- src/renderer/overlay-window/App.test.tsx
```

Expected: FAIL because `AnswerText` is not exported and/or because the current code block still uses non-wrapping `white-space: pre` with horizontal scrolling.

- [ ] **Step 3: Implement the minimal presentation change**

In `src/renderer/overlay-window/App.tsx`:

```tsx
export const AnswerText = memo(function AnswerText({
  text,
  streaming
}: {
  text: string
  streaming: boolean
}) {
```

For the existing `<pre>` code block:

```tsx
className="rounded-lg p-3 text-xs"
style={{
  background: 'rgba(20, 20, 40, 0.8)',
  border: '1px solid rgba(60, 60, 100, 0.5)',
  color: '#7dd3fc',
  fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  overflowX: 'hidden'
}}
```

Do not alter `seg.content`, Markdown parsing, or other answer rendering.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
npm test -- src/renderer/overlay-window/App.test.tsx
```

Expected: PASS, including the existing answer-scroll badge regression test.

- [ ] **Step 5: Commit the implementation locally**

```bash
git add src/renderer/overlay-window/App.tsx src/renderer/overlay-window/App.test.tsx
git commit -m "fix: wrap long code in answer overlay"
```

Do not push.

### Task 2: Verify the complete local application

**Files:**
- Verify only; no planned file modifications.

**Interfaces:**
- Consumes: The locally committed soft-wrap behavior from Task 1.
- Produces: Evidence that component tests, all tests, lint, type checking, and production build pass without affecting unrelated behavior.

- [ ] **Step 1: Run the full automated verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit successfully.

- [ ] **Step 2: Confirm local-only branch state**

Run:

```bash
git status --short --branch
git log -3 --oneline
```

Expected: the worktree is clean, `lyf_dev` is ahead of `fork/lyf_dev`, and no remote push has occurred.

- [ ] **Step 3: Hand off manual visual confirmation**

Ask the user to open the local app and verify an answer containing:

```text
const veryLongValue = "a very long uninterrupted value that exceeds the overlay width..."
```

Expected:

- The whole line is readable by scrolling only up and down.
- There is no horizontal scrollbar or sideways dragging.
- Short code, indentation, and ordinary answers still look unchanged.
- GitHub and the existing Pull Request remain untouched until the user confirms.
