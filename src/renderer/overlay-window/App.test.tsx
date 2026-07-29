// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnswerScrollModeBadge } from './App'

describe('AnswerScrollModeBadge', () => {
  it('shows the answer-scroll status only while the temporary mode is active', () => {
    const { rerender } = render(<AnswerScrollModeBadge active={false} />)
    expect(screen.queryByText('↕ 回答滚动')).not.toBeInTheDocument()

    rerender(<AnswerScrollModeBadge active />)
    expect(screen.getByText('↕ 回答滚动')).toBeInTheDocument()
  })
})
