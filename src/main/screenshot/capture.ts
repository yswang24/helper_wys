import { desktopCapturer, nativeImage } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { unlink } from 'fs/promises'
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

// macOS native region capture: screencapture grabs ONLY the requested rect, so we avoid rendering
// the entire screen at retina resolution and then cropping (the desktopCapturer cost). Returns
// base64 JPEG.
export async function captureRegionNative(
  display: Electron.Display,
  region: ScreenRegion
): Promise<string> {
  const { gx, gy, gw, gh } = computeNativeRect(display.bounds, region)
  const tmpPng = join(tmpdir(), `helper_shot_${Date.now()}.png`)
  console.log(`[Screenshot] native -R ${gw}x${gh}@${gx},${gy}`)
  // The await is INSIDE the try so the finally still unlinks if screencapture exits non-zero after
  // writing a partial/0-byte file (otherwise those orphans accumulate in tmpdir on every failure).
  try {
    await new Promise<void>((resolve, reject) => {
      // Absolute path: a packaged GUI app's PATH may not include /usr/sbin. -x = silent, -R = region.
      execFile('/usr/sbin/screencapture', ['-x', '-R', `${gx},${gy},${gw},${gh}`, tmpPng], (err) =>
        err ? reject(err) : resolve()
      )
    })
    let img = nativeImage.createFromPath(tmpPng)
    if (img.isEmpty()) throw new Error('screencapture 输出为空')
    const maxSize = 2000
    const { width, height } = img.getSize()
    if (width > maxSize || height > maxSize) {
      const scale = maxSize / Math.max(width, height)
      img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
    }
    return img.toJPEG(82).toString('base64')
  } finally {
    unlink(tmpPng).catch(() => {
      /* ignore */
    })
  }
}

// Cross-platform fallback: full-screen desktopCapturer thumbnail, then crop to the selection.
// Returns base64 JPEG.
export async function captureRegionDesktop(
  display: Electron.Display,
  region: ScreenRegion
): Promise<string> {
  const { width, height } = display.bounds // logical pixels (same space as selector coords)
  // Timeout guard — desktopCapturer can hang on macOS without screen recording permission
  const capturePromise = desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(width * display.scaleFactor),
      height: Math.round(height * display.scaleFactor)
    }
  })
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('截图超时，请检查屏幕录制权限')), 10000)
  )
  const sources = await Promise.race([capturePromise, timeoutPromise])
  // Pick the source matching our display — desktopCapturer doesn't guarantee sources[0] is it.
  const source = sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0]
  if (!source) throw new Error('无法获取屏幕截图')
  const thumb = source.thumbnail
  const tsize = thumb.getSize()
  if (tsize.width === 0 || tsize.height === 0) {
    throw new Error(
      '截屏内容为空 —— 请到 系统设置 → 隐私与安全性 → 屏幕录制，给运行本应用的程序（开发时是终端/VS Code，打包后是 Helper）授权后重启'
    )
  }
  // Map selector(viewport) coords → thumbnail pixels using the selector's OWN reported viewport
  // size. display.bounds can differ from the actual viewport on notched/scaled Macs.
  const { cx, cy, cw, ch } = computeCropRect(tsize, display.bounds, region)
  let cropped = thumb.crop({ x: cx, y: cy, width: cw, height: ch })
  const maxSize = 2000
  const cropW = cropped.getSize().width
  const cropH = cropped.getSize().height
  if (cropW > maxSize || cropH > maxSize) {
    const scale = maxSize / Math.max(cropW, cropH)
    cropped = cropped.resize({ width: Math.round(cropW * scale), height: Math.round(cropH * scale) })
  }
  return cropped.toJPEG(82).toString('base64')
}
