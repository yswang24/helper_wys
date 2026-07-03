import type { ScreenRegion } from '../../shared/ipc'

// Pure coordinate math for region capture, extracted so it is unit-testable without electron.
// The selector reports viewport coords (region.x/y/w/h) plus its own viewport size (vw/vh);
// these map to the display's logical bounds, which can differ on notched/scaled Macs.

interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}
interface Size {
  width: number
  height: number
}

// Native `screencapture -R` rect in global logical points. `sx/sy` rescale from the selector
// viewport to the display bounds; width/height are floored to at least 1.
export function computeNativeRect(
  bounds: DisplayBounds,
  region: ScreenRegion
): { gx: number; gy: number; gw: number; gh: number } {
  const vw = region.vw || bounds.width
  const vh = region.vh || bounds.height
  const sx = bounds.width / vw
  const sy = bounds.height / vh
  const gx = Math.round(bounds.x + region.x * sx)
  const gy = Math.round(bounds.y + region.y * sy)
  const gw = Math.max(1, Math.round(region.w * sx))
  const gh = Math.max(1, Math.round(region.h * sy))
  return { gx, gy, gw, gh }
}

// desktopCapturer thumbnail crop rect. Maps selector-viewport coords → thumbnail pixels via the
// selector's reported viewport size; the crop is clamped inside the thumbnail bounds.
export function computeCropRect(
  tsize: Size,
  bounds: Size,
  region: ScreenRegion
): { cx: number; cy: number; cw: number; ch: number } {
  const vw = region.vw || bounds.width
  const vh = region.vh || bounds.height
  const scaleX = tsize.width / vw
  const scaleY = tsize.height / vh
  const cx = Math.max(0, Math.round(region.x * scaleX))
  const cy = Math.max(0, Math.round(region.y * scaleY))
  const cw = Math.min(Math.round(region.w * scaleX), tsize.width - cx)
  const ch = Math.min(Math.round(region.h * scaleY), tsize.height - cy)
  return { cx, cy, cw, ch }
}
