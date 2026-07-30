import { useEffect, useRef, useState } from 'react'

interface Rect { x: number; y: number; w: number; h: number }

// Single source of truth for "is this selection big enough" — used for BOTH drawing the box and
// accepting it on release, so a tiny drag never renders a box that's then silently discarded.
const MIN_SIZE = 8

export function App() {
  const [rect, setRect] = useState<Rect | null>(null)
  const [capturing, setCapturing] = useState(false)
  // Refs avoid stale closures inside the window-level listeners
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const rectRef = useRef<Rect | null>(null)
  const capturingRef = useRef(false)

  const submit = (r: Rect) => {
    if (capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)
    // Send our viewport size too — main maps region→thumbnail against THIS, not display.bounds
    window.electronAPI.submitScreenshot({ ...r, vw: window.innerWidth, vh: window.innerHeight })
    // Main process closes this window after capture
  }

  useEffect(() => {
    // Listen on window, NOT a div — so releasing the mouse anywhere still finalizes the drag
    const onDown = (e: MouseEvent) => {
      if (capturingRef.current) return
      startRef.current = { x: e.clientX, y: e.clientY }
      rectRef.current = null
      setRect(null)
    }
    const onMove = (e: MouseEvent) => {
      const s = startRef.current
      if (!s || capturingRef.current) return
      const r: Rect = {
        x: Math.min(s.x, e.clientX),
        y: Math.min(s.y, e.clientY),
        w: Math.abs(e.clientX - s.x),
        h: Math.abs(e.clientY - s.y)
      }
      rectRef.current = r
      setRect(r)
    }
    const onUp = () => {
      const s = startRef.current
      const r = rectRef.current
      startRef.current = null
      if (!s || !r) return
      if (r.w < MIN_SIZE || r.h < MIN_SIZE) { rectRef.current = null; setRect(null); return } // too small — retry
      submit(r)
    }
    // No keydown handler: the selector is a non-focusable panel (so it never steals foreground
    // from the exam), which means it can't receive keyboard.
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const selecting = !!rect && rect.w >= MIN_SIZE && rect.h >= MIN_SIZE
  const DIM = 'rgba(0, 0, 0, 0.22)'

  // Keep the normal arrow cursor — a crosshair/wait cursor would tip off the screen-share
  // viewer that a capture tool is active (the cursor itself isn't hidden by content protection).
  return (
    <div className="fixed inset-0" style={{ cursor: 'default' }}>
      {/* Before selecting: dim the whole screen (still see-through so you can find the target) */}
      {!selecting && <div className="fixed inset-0" style={{ background: DIM }} />}

      {/* Hint */}
      {!rect && !capturing && (
        <div
          className="absolute left-1/2 top-8 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium pointer-events-none"
          style={{ background: 'rgba(15, 15, 30, 0.9)', border: '1px solid rgba(100, 100, 180, 0.5)', color: '#cbd5e1' }}
        >
          拖拽选择区域
        </div>
      )}

      {/* While selecting: the rect punches a clear hole (box-shadow dims only OUTSIDE it) */}
      {selecting && (
        <>
          <div
            className="absolute pointer-events-none"
            style={{
              left: rect!.x,
              top: rect!.y,
              width: rect!.w,
              height: rect!.h,
              border: '2px solid rgba(96, 165, 250, 0.95)',
              boxShadow: `0 0 0 9999px ${DIM}`
            }}
          />
          <div
            className="absolute pointer-events-none px-2 py-0.5 rounded text-xs font-mono"
            style={{
              left: rect!.x,
              top: Math.max(0, rect!.y - 24),
              background: 'rgba(15, 15, 30, 0.9)',
              color: '#60a5fa',
              border: '1px solid rgba(96, 165, 250, 0.4)'
            }}
          >
            {rect!.w} × {rect!.h}
          </div>
        </>
      )}

      {/* Processing */}
      {capturing && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-3 rounded-xl text-sm font-medium"
          style={{ background: 'rgba(15, 15, 30, 0.95)', border: '1px solid rgba(96, 165, 250, 0.5)', color: '#60a5fa' }}
        >
          截图中...
        </div>
      )}
    </div>
  )
}
