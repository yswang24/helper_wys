import { useEffect, useRef, type MutableRefObject } from 'react'

/**
 * Leaving temporary answer-scroll mode must release the manual-review pause. The next streaming
 * chunk can then move the viewport to the live tail again, while the toggle-off action itself
 * remains scroll-free.
 */
export function useResumeStreamingAutoFollow(
  scrollModeActive: boolean,
  streaming: boolean,
  stickToBottomRef: MutableRefObject<boolean>
): void {
  const previousActiveRef = useRef(scrollModeActive)

  useEffect(() => {
    const wasActive = previousActiveRef.current
    previousActiveRef.current = scrollModeActive
    if (wasActive && !scrollModeActive && streaming) {
      stickToBottomRef.current = true
    }
  }, [scrollModeActive, streaming, stickToBottomRef])
}
