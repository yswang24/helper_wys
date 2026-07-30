// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnswerScrollModeBadge } from './App'

describe('AnswerScrollModeBadge', () => {
  it('shows that generation continues while reviewing a streaming answer', () => {
    const { rerender } = render(<AnswerScrollModeBadge active={false} />)
    expect(screen.queryByText('↕ 回答滚动')).not.toBeInTheDocument()

    rerender(<AnswerScrollModeBadge active />)
    expect(screen.getByText('↕ 回答滚动')).toBeInTheDocument()

    rerender(<AnswerScrollModeBadge active streaming />)
    expect(screen.getByText('↕ 回看中 · 生成继续')).toBeInTheDocument()
  })
})
