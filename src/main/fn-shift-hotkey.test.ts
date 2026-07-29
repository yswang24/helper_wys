import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { FnShiftHotkey, resolveFnShiftHotkeyExecutablePath } from './fn-shift-hotkey'

function fakeChildProcess(): {
  child: ChildProcess
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
} {
  const events = new EventEmitter()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const kill = vi.fn(() => true)
  const child = Object.assign(events, {
    stdout,
    stderr,
    killed: false,
    kill
  }) as unknown as ChildProcess
  return { child, stdout, stderr, kill }
}

describe('FnShiftHotkey', () => {
  it('resolves development and packaged helper locations outside ASAR', () => {
    expect(
      resolveFnShiftHotkeyExecutablePath({
        isPackaged: false,
        resourcesPath: '/unused',
        appPath: '/repo'
      })
    ).toBe('/repo/.native-build/helper-fn-shift-hotkey')
    expect(
      resolveFnShiftHotkeyExecutablePath({
        isPackaged: true,
        resourcesPath: '/Applications/Helper.app/Contents/Resources',
        appPath: '/Applications/Helper.app/Contents/Resources/app.asar'
      })
    ).toBe('/Applications/Helper.app/Contents/Helpers/helper-fn-shift-hotkey')
  })

  it('parses complete and split trigger lines without accepting other output', async () => {
    const process = fakeChildProcess()
    const trigger = vi.fn()
    const unavailable = vi.fn()
    const spawnProcess = vi.fn(() => process.child)
    const hotkey = new FnShiftHotkey({
      resolveExecutable: () => '/tmp/helper-fn-shift-hotkey',
      verifyExecutable: vi.fn(),
      spawnProcess
    })

    expect(hotkey.start(trigger, unavailable)).toBe(true)
    process.stdout.write('trig')
    process.stdout.write('ger\nignored\ntrigger\n')
    await vi.waitFor(() => expect(trigger).toHaveBeenCalledTimes(2))

    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(unavailable).not.toHaveBeenCalled()
    hotkey.stop()
    expect(process.kill).toHaveBeenCalledOnce()
  })

  it('is idempotent and does not report an intentional stop as a failure', () => {
    const process = fakeChildProcess()
    const unavailable = vi.fn()
    const spawnProcess = vi.fn(() => process.child)
    const hotkey = new FnShiftHotkey({
      resolveExecutable: () => '/tmp/helper-fn-shift-hotkey',
      verifyExecutable: vi.fn(),
      spawnProcess
    })

    expect(hotkey.start(vi.fn(), unavailable)).toBe(true)
    expect(hotkey.start(vi.fn(), unavailable)).toBe(true)
    expect(spawnProcess).toHaveBeenCalledOnce()

    hotkey.stop()
    process.child.emit('exit', null, 'SIGTERM')
    hotkey.stop()
    expect(process.kill).toHaveBeenCalledOnce()
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('surfaces a missing executable and an unexpected helper exit', () => {
    const missing = new FnShiftHotkey({
      resolveExecutable: () => '/missing/helper',
      verifyExecutable: () => {
        throw new Error('missing')
      }
    })
    const missingFailure = vi.fn()
    expect(missing.start(vi.fn(), missingFailure)).toBe(false)
    expect(missingFailure).toHaveBeenCalledWith(expect.stringContaining('不存在或不可执行'))

    const process = fakeChildProcess()
    const exitFailure = vi.fn()
    const running = new FnShiftHotkey({
      resolveExecutable: () => '/tmp/helper-fn-shift-hotkey',
      verifyExecutable: vi.fn(),
      spawnProcess: () => process.child
    })
    expect(running.start(vi.fn(), exitFailure)).toBe(true)
    process.stderr.write('native failure')
    process.child.emit('exit', 2, null)
    expect(exitFailure).toHaveBeenCalledWith(expect.stringContaining('code=2'))
  })
})
