import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { join, resolve } from 'node:path'

export const FN_SHIFT_SHORTCUT_LABEL = 'Fn+Shift'
const HELPER_EXECUTABLE = 'helper-fn-shift-hotkey'

export interface FnShiftHotkeyOptions {
  resolveExecutable?: () => string
  verifyExecutable?: (path: string) => void
  spawnProcess?: (path: string) => ChildProcess
}

export interface FnShiftHotkeyPathContext {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
}

export function resolveFnShiftHotkeyExecutablePath(context: FnShiftHotkeyPathContext): string {
  if (context.isPackaged) {
    return resolve(context.resourcesPath, '..', 'Helpers', HELPER_EXECUTABLE)
  }
  return join(context.appPath, '.native-build', HELPER_EXECUTABLE)
}

function defaultExecutablePath(): string {
  return resolveFnShiftHotkeyExecutablePath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  })
}

function defaultVerifyExecutable(path: string): void {
  accessSync(path, constants.X_OK)
}

function defaultSpawnProcess(path: string): ChildProcess {
  return spawn(path, [], {
    env: {},
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

/**
 * Owns the tiny macOS helper that observes only global modifier flags.
 *
 * Electron accelerators cannot express Fn or a modifier-only chord. The native helper polls
 * CoreGraphics' hardware modifier state and emits one line for each Fn+Shift rising edge.
 */
export class FnShiftHotkey {
  private child: ChildProcess | null = null
  private stdoutBuffer = ''

  constructor(private readonly options: FnShiftHotkeyOptions = {}) {}

  start(onTrigger: () => void, onUnavailable: (reason: string) => void): boolean {
    if (this.child) return true

    const executable = (this.options.resolveExecutable ?? defaultExecutablePath)()
    try {
      const verifyExecutable = this.options.verifyExecutable ?? defaultVerifyExecutable
      verifyExecutable(executable)
    } catch {
      onUnavailable(`原生快捷键组件不存在或不可执行: ${executable}`)
      return false
    }

    let child: ChildProcess
    try {
      child = (this.options.spawnProcess ?? defaultSpawnProcess)(executable)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onUnavailable(`原生快捷键组件启动失败: ${message}`)
      return false
    }

    this.child = child
    this.stdoutBuffer = ''
    let stderr = ''
    let unavailableReported = false
    const reportUnavailable = (reason: string): void => {
      if (unavailableReported || this.child !== child) return
      unavailableReported = true
      this.child = null
      this.stdoutBuffer = ''
      onUnavailable(reason)
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string | Buffer) => {
      if (this.child !== child) return
      this.stdoutBuffer += String(chunk)
      if (this.stdoutBuffer.length > 4096) {
        this.stdoutBuffer = this.stdoutBuffer.slice(-4096)
      }
      let newline = this.stdoutBuffer.indexOf('\n')
      while (newline >= 0) {
        const line = this.stdoutBuffer.slice(0, newline).trim()
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
        if (line === 'trigger' && this.child === child) onTrigger()
        newline = this.stdoutBuffer.indexOf('\n')
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr = (stderr + String(chunk)).slice(-2048)
    })
    child.once('error', (error) => {
      reportUnavailable(`原生快捷键组件运行失败: ${error.message}`)
    })
    child.once('exit', (code, signal) => {
      const detail = stderr.trim()
      const suffix = detail ? ` (${detail})` : ''
      reportUnavailable(
        `原生快捷键组件意外退出: code=${String(code)}, signal=${String(signal)}${suffix}`
      )
    })
    return true
  }

  stop(): void {
    const child = this.child
    this.child = null
    this.stdoutBuffer = ''
    if (child && !child.killed) child.kill()
  }
}
