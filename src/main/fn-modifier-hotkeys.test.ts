import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  FnModifierHotkeys,
  resolveFnModifierHotkeysExecutablePath
} from './fn-modifier-hotkeys'

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

describe('FnModifierHotkeys', () => {
  it('resolves development and packaged helper locations outside ASAR', () => {
    expect(
      resolveFnModifierHotkeysExecutablePath({
        isPackaged: false,
        resourcesPath: '/unused',
        appPath: '/repo'
      })
    ).toBe('/repo/.native-build/helper-fn-modifier-hotkeys')
    expect(
      resolveFnModifierHotkeysExecutablePath({
        isPackaged: true,
        resourcesPath: '/Applications/Helper.app/Contents/Resources',
        appPath: '/Applications/Helper.app/Contents/Resources/app.asar'
      })
    ).toBe('/Applications/Helper.app/Contents/Helpers/helper-fn-modifier-hotkeys')
  })

  it('parses complete and split shortcut lines without accepting other output', async () => {
    const process = fakeChildProcess()
    const trigger = vi.fn()
    const unavailable = vi.fn()
    const spawnProcess = vi.fn(() => process.child)
    const hotkeys = new FnModifierHotkeys({
      resolveExecutable: () => '/tmp/helper-fn-modifier-hotkeys',
      verifyExecutable: vi.fn(),
      spawnProcess
    })

    expect(hotkeys.start(trigger, unavailable)).toBe(true)
    process.stdout.write('con')
    process.stdout.write(
      'trol\nunknown\ntab\nunavailable:tab:-9868\nfn-down\nfn-up\nshift\noption\ncommand\n'
    )
    await vi.waitFor(() => expect(trigger).toHaveBeenCalledTimes(4))
    expect(trigger.mock.calls).toEqual([
      ['control'],
      ['shift'],
      ['option'],
      ['command']
    ])

    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(unavailable).not.toHaveBeenCalled()
    hotkeys.stop()
    expect(process.kill).toHaveBeenCalledOnce()
  })

  it('is idempotent and does not report an intentional stop as a failure', () => {
    const process = fakeChildProcess()
    const unavailable = vi.fn()
    const spawnProcess = vi.fn(() => process.child)
    const hotkeys = new FnModifierHotkeys({
      resolveExecutable: () => '/tmp/helper-fn-modifier-hotkeys',
      verifyExecutable: vi.fn(),
      spawnProcess
    })

    expect(hotkeys.start(vi.fn(), unavailable)).toBe(true)
    expect(hotkeys.start(vi.fn(), unavailable)).toBe(true)
    expect(spawnProcess).toHaveBeenCalledOnce()

    hotkeys.stop()
    process.child.emit('exit', null, 'SIGTERM')
    hotkeys.stop()
    expect(process.kill).toHaveBeenCalledOnce()
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('surfaces a missing executable and an unexpected helper exit', () => {
    const missing = new FnModifierHotkeys({
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
    const running = new FnModifierHotkeys({
      resolveExecutable: () => '/tmp/helper-fn-modifier-hotkeys',
      verifyExecutable: vi.fn(),
      spawnProcess: () => process.child
    })
    expect(running.start(vi.fn(), exitFailure)).toBe(true)
    process.stderr.write('native failure')
    process.child.emit('exit', 2, null)
    expect(exitFailure).toHaveBeenCalledWith(expect.stringContaining('code=2'))
  })
})
