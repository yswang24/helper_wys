// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AnswerScrollModeBadge, App } from './App'

const overlayFixture = vi.hoisted(() => ({
  code: `const value = '${'x'.repeat(200)}'\n  return value\n`
}))

vi.mock('./hooks/useStreamingAnswer', () => ({
  useStreamingAnswer: () => ({
    history: [
      {
        id: 1,
        question: 'Show code',
        answer: `\`\`\`\n${overlayFixture.code}\`\`\``,
        status: 'done',
        errorMsg: ''
      }
    ]
  })
}))

vi.mock('./hooks/useAnswerScroll', () => ({
  useAnswerScroll: () => ({
    scrollRef: { current: null },
    stickToBottomRef: { current: true },
    onAnswerScroll: () => undefined,
    scrollModeActive: false
  })
}))

vi.mock('./hooks/useAsrDisplay', () => ({
  useAsrDisplay: () => ({
    listening: false,
    finalLines: [],
    clearFinalLines: () => undefined
  })
}))

vi.mock('./hooks/useOverlayOpacity', () => ({ useOverlayOpacity: () => 0.94 }))
vi.mock('./hooks/useOverlayMode', () => ({ useOverlayMode: () => 'passthrough' }))

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  })
  Object.assign(window, {
    electronAPI: {
      onImageStatus: () => () => undefined,
      onImageText: () => () => undefined,
      onImageError: () => () => undefined
    }
  })
})

describe('AnswerScrollModeBadge', () => {
  it('shows the answer-scroll status only while the temporary mode is active', () => {
    const { rerender } = render(<AnswerScrollModeBadge active={false} />)
    expect(screen.queryByText('↕ 回答滚动')).not.toBeInTheDocument()

    rerender(<AnswerScrollModeBadge active />)
    expect(screen.getByText('↕ 回答滚动')).toBeInTheDocument()
  })
})

describe('overlay answer code blocks', () => {
  it('soft-wraps long lines without horizontal scrolling', () => {
    const { container } = render(<App />)
    const codeBlock = container.querySelector('pre')

    expect(codeBlock).not.toBeNull()
    expect(codeBlock).toHaveStyle({
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      overflowX: 'hidden'
    })
  })

  it('keeps the source code text unchanged', () => {
    const { container } = render(<App />)
    expect(container.querySelector('pre')?.textContent).toBe(overlayFixture.code)
  })
})
