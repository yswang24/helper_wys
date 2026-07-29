import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { AnswerScrollDirection } from '../../../shared/ipc'

const PAGE_RATIO = 0.8
const BOTTOM_SLACK_PX = 40

interface ScrollElement {
  scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
  scrollTo(options: ScrollToOptions): void
}

export function isAnswerAtBottom(element: ScrollElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_SLACK_PX
}

/**
 * Moves one reading "page", retaining 20% of the previous viewport for visual context.
 *
 * Auto-follow is paused synchronously before the smooth animation begins. This prevents the next
 * streaming token from snapping the answer back to the bottom before the first scroll event fires.
 */
export function scrollAnswerByPage(
  element: ScrollElement,
  direction: AnswerScrollDirection,
  stickToBottomRef: MutableRefObject<boolean>
): void {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  const currentScrollTop = Math.min(maxScrollTop, Math.max(0, element.scrollTop))
  const step = Math.max(1, Math.round(element.clientHeight * PAGE_RATIO))
  const delta = direction === 'up' ? -step : step
  const targetScrollTop = Math.min(maxScrollTop, Math.max(0, currentScrollTop + delta))

  if (targetScrollTop === currentScrollTop) {
    stickToBottomRef.current = isAnswerAtBottom(element)
    return
  }

  stickToBottomRef.current = false
  element.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
}

export function useAnswerScroll(): {
  scrollRef: MutableRefObject<HTMLDivElement | null>
  stickToBottomRef: MutableRefObject<boolean>
  onAnswerScroll: () => void
} {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const onAnswerScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    stickToBottomRef.current = isAnswerAtBottom(element)
  }, [])

  const scrollByPage = useCallback((direction: AnswerScrollDirection) => {
    const element = scrollRef.current
    if (!element) return
    scrollAnswerByPage(element, direction, stickToBottomRef)
  }, [])

  useEffect(() => window.electronAPI.onAnswerScroll(scrollByPage), [scrollByPage])

  return { scrollRef, stickToBottomRef, onAnswerScroll }
}
