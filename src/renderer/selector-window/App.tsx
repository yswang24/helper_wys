import { useEffect, useRef, useState } from 'react'

interface Rect { x: number; y: number; w: number; h: number }

export function App() {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [capturing, setCapturing] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.electronAPI.cancelScreenshot()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    if (capturing) return
    setStart({ x: e.clientX, y: e.clientY })
    setRect(null)
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!start || capturing) return
    const x = Math.min(start.x, e.clientX)
    const y = Math.min(start.y, e.clientY)
    const w = Math.abs(e.clientX - start.x)
    const h = Math.abs(e.clientY - start.y)
    setRect({ x, y, w, h })
  }

  const onMouseUp = () => {
    if (!start || !rect || rect.w < 10 || rect.h < 10 || capturing) return
    setCapturing(true)
    window.electronAPI.submitScreenshot(rect)
    // Window is closed by main process after capture — don't block here
  }

  const selectionVisible = rect && rect.w > 2 && rect.h > 2

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0"
      style={{
        background: 'rgba(0, 0, 0, 0.35)',
        cursor: capturing ? 'wait' : 'crosshair'
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {/* Instruction hint */}
      {!start && !capturing && (
        <div
          className="absolute left-1/2 top-8 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium pointer-events-none"
          style={{
            background: 'rgba(15, 15, 30, 0.9)',
            border: '1px solid rgba(100, 100, 180, 0.5)',
            color: '#94a3b8'
          }}
        >
          拖拽选择区域 · Esc 取消
        </div>
      )}

      {/* Selection rect with "punch-through" bright border */}
      {selectionVisible && (
        <>
          {/* Bright region cutout (lighter overlay so user can see the content) */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: rect!.x,
              top: rect!.y,
              width: rect!.w,
              height: rect!.h,
              background: 'rgba(59, 130, 246, 0.08)',
              border: '2px solid rgba(96, 165, 250, 0.9)',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.35)',
              outline: '1px solid rgba(96, 165, 250, 0.3)'
            }}
          />
          {/* Size label */}
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

      {/* Processing indicator */}
      {capturing && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-3 rounded-xl text-sm font-medium"
          style={{
            background: 'rgba(15, 15, 30, 0.95)',
            border: '1px solid rgba(96, 165, 250, 0.5)',
            color: '#60a5fa'
          }}
        >
          截图中...
        </div>
      )}
    </div>
  )
}
