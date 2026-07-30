import { useEffect, useRef, type MutableRefObject } from 'react'

const RESUME_LOCK_TIMEOUT_MS = 1_000
const BOTTOM_SLACK_PX = 40

interface ScrollPosition {
  scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
}

interface LiveTailRef {
  readonly current: Pick<HTMLElement, 'scrollIntoView'> | null
}

/**
 * A smooth page scroll can emit late events after scroll mode has already closed. Keep auto-follow
 * armed until one of those events confirms that the instant live-tail jump actually reached the
 * bottom; otherwise a stale non-bottom event would make the next streamed chunk look interrupted.
 */
export function syncAutoFollowFromScroll(
  element: ScrollPosition,
  stickToBottomRef: MutableRefObject<boolean>,
  resumeLiveTailRef: MutableRefObject<boolean>
): void {
  const atBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_SLACK_PX

  if (resumeLiveTailRef.current) {
    stickToBottomRef.current = true
    if (atBottom) resumeLiveTailRef.current = false
    return
  }

  stickToBottomRef.current = atBottom
}

/**
 * Leaving temporary answer-scroll mode after reviewing a live answer immediately returns the
 * viewport to the live tail. A short-lived lock protects that resume from residual smooth-scroll
 * events; reaching the bottom releases it sooner.
 */
export function useResumeStreamingAutoFollow(
  scrollModeActive: boolean,
  streaming: boolean,
  stickToBottomRef: MutableRefObject<boolean>,
  resumeLiveTailRef: MutableRefObject<boolean>,
  liveTailRef: LiveTailRef
): void {
  const previousActiveRef = useRef(scrollModeActive)
  const streamedWhileActiveRef = useRef(scrollModeActive && streaming)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const wasActive = previousActiveRef.current
    previousActiveRef.current = scrollModeActive

    if (scrollModeActive && streaming) {
      streamedWhileActiveRef.current = true
    }

    if (!wasActive && scrollModeActive) {
      resumeLiveTailRef.current = false
      if (releaseTimerRef.current !== null) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      return
    }

    if (!wasActive || scrollModeActive) return

    const shouldResume = streamedWhileActiveRef.current || streaming
    streamedWhileActiveRef.current = false
    if (!shouldResume) return

    if (releaseTimerRef.current !== null) {
      clearTimeout(releaseTimerRef.current)
    }
    resumeLiveTailRef.current = true
    stickToBottomRef.current = true
    liveTailRef.current?.scrollIntoView({ behavior: 'auto' })
    releaseTimerRef.current = setTimeout(() => {
      resumeLiveTailRef.current = false
      releaseTimerRef.current = null
    }, RESUME_LOCK_TIMEOUT_MS)
  }, [
    liveTailRef,
    resumeLiveTailRef,
    scrollModeActive,
    stickToBottomRef,
    streaming
  ])

  useEffect(
    () => () => {
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
    },
    []
  )
}
