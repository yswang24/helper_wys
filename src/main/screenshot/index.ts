import { ipcMain, screen, systemPreferences } from 'electron'
import type { BrowserWindow } from 'electron'
import { SEND } from '../../shared/ipc'
import type { ScreenRegion, ScreenshotMode } from '../../shared/ipc'
import { captureRegionNative, captureRegionDesktop } from './capture'

export interface ScreenshotDeps {
  getOverlayWindow: () => BrowserWindow | null
  getSelectorWindow: () => BrowserWindow | null
  getSelectorDisplayId: () => number | null
  ensureOverlayVisible: () => void
  startStreamSafely: (run: (win: BrowserWindow) => void) => void
  streamImageAnswer: (imageBase64: string, win: BrowserWindow) => unknown
  extractImageText: (imageBase64: string, win: BrowserWindow) => unknown
  loadPersistedConfig: () => { screenshotMode?: ScreenshotMode }
}

interface CaptureOptions {
  display: Electron.Display
  modeOverride?: ScreenshotMode
}

// Registers the screenshot:submit handler. Deps are getters/closures so the handler always sees
// the live overlay/selector windows (which may be rebuilt after a crash).
export function registerScreenshotIpc(deps: ScreenshotDeps): void {
  ipcMain.on(SEND.screenshotSubmit, async (_e, region: ScreenRegion) => {
    // Resolve the selector display before close(): the window's `closed` handler may clear its id.
    const selectorDisplayId = deps.getSelectorDisplayId()
    const display =
      screen.getAllDisplays().find((candidate) => candidate.id === selectorDisplayId) ??
      screen.getPrimaryDisplay()
    await captureDisplayRegionAndSubmit(deps, region, { display })
  })
}

/**
 * Captures the complete display under the pointer and sends it straight to the vision model.
 *
 * This deliberately bypasses screenshotMode: Fn+Shift is the one-step capture-and-send path,
 * while the region selector keeps supporting the optional OCR-and-review workflow.
 */
export async function captureFullScreenAndSubmit(deps: ScreenshotDeps): Promise<void> {
  // This path has no selector UI to signal progress, so reveal the overlay before OS capture starts.
  deps.ensureOverlayVisible()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = display.bounds
  await captureDisplayRegionAndSubmit(
    deps,
    { x: 0, y: 0, w: width, h: height, vw: width, vh: height },
    { display, modeOverride: 'direct' }
  )
}

/**
 * Coalesces repeated/held hotkey callbacks while an OS capture is still in flight.
 */
export function createFullScreenCaptureTrigger(deps: ScreenshotDeps): () => void {
  let captureInFlight = false
  return () => {
    if (captureInFlight) return
    captureInFlight = true
    void captureFullScreenAndSubmit(deps).finally(() => {
      captureInFlight = false
    })
  }
}

async function captureDisplayRegionAndSubmit(
  deps: ScreenshotDeps,
  region: ScreenRegion,
  options: CaptureOptions
): Promise<void> {
  // Close the selector FIRST — otherwise its "截图中..." can stay stuck if anything below fails.
  deps.getSelectorWindow()?.close()
  const overlayWindow = deps.getOverlayWindow()
  if (!overlayWindow) return

  try {
    // Permission precheck (macOS): when screen recording isn't granted, desktopCapturer returns a
    // wallpaper-only/blank image with a NON-zero size that slips past the zero-size check and yields
    // a nonsense answer. Fail loudly here instead. (TCC status can lag a mid-session revoke, so the
    // zero-size and native-empty checks below stay as backstops.)
    if (
      process.platform === 'darwin' &&
      systemPreferences.getMediaAccessStatus('screen') !== 'granted'
    ) {
      throw new Error(
        '未授权屏幕录制 —— 请到 系统设置 → 隐私与安全性 → 屏幕录制，给本应用授权后重启（开发时是终端/VS Code，打包后是 Helper）'
      )
    }

    let imageBase64: string
    if (process.platform === 'darwin') {
      try {
        imageBase64 = await captureRegionNative(options.display, region)
      } catch (e) {
        console.warn(
          '[Screenshot] native screencapture failed, falling back to desktopCapturer:',
          e
        )
        imageBase64 = await captureRegionDesktop(options.display, region)
      }
    } else {
      imageBase64 = await captureRegionDesktop(options.display, region)
    }
    console.log(
      `[Screenshot] region ${region.w}x${region.h} → ${Math.round((imageBase64.length * 3) / 4 / 1024)}KB`
    )

    // 'direct' (default): one call — vision model streams the answer straight to the overlay.
    // 'ocr': two calls — extract editable text first, user reviews, then sends to the LLM.
    const mode = options.modeOverride ?? deps.loadPersistedConfig().screenshotMode ?? 'direct'
    if (mode === 'ocr') {
      deps.ensureOverlayVisible() // OCR path doesn't go through startStreamSafely — surface it too
      deps.extractImageText(imageBase64, overlayWindow)
    } else {
      deps.startStreamSafely((win) => deps.streamImageAnswer(imageBase64, win))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    overlayWindow.webContents.send('image:error', `截图失败: ${msg}`)
  }
}
