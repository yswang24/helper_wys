import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Controllable fake of electron's app + safeStorage. Encryption is a reversible utf8→utf8
// stand-in so ciphertext round-trips; flags drive keychain-available / decrypt-throws paths.
const state = vi.hoisted(() => ({ userDataDir: '', encAvailable: true, decryptThrows: false }))

vi.mock('electron', () => ({
  app: { getPath: (_k: string) => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => state.encAvailable,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => {
      if (state.decryptThrows) throw new Error('keychain locked')
      return b.toString('utf8')
    }
  }
}))

import { loadPersistedConfig, persistConfig } from './store'

const ENC_PREFIX = 'enc:v1:'
const cfgPath = () => join(state.userDataDir, 'config.json')

beforeEach(() => {
  state.userDataDir = mkdtempSync(join(tmpdir(), 'helper-store-test-'))
  state.encAvailable = true
  state.decryptThrows = false
})

describe('store secret preservation', () => {
  it('persistConfig keeps the on-disk ciphertext for a secret the caller omitted', () => {
    persistConfig({ apiKey: 'sk-x' })
    const cipher = JSON.parse(readFileSync(cfgPath(), 'utf-8')).apiKey as string
    expect(cipher.startsWith(ENC_PREFIX)).toBe(true)

    // A partial update that does NOT carry apiKey must not blank it.
    persistConfig({ baseUrl: 'https://example.com' })
    const after = JSON.parse(readFileSync(cfgPath(), 'utf-8'))
    expect(after.apiKey).toBe(cipher)
    expect(after.baseUrl).toBe('https://example.com')
  })

  it('persistConfig erases a secret only when explicitly set to empty string', () => {
    persistConfig({ apiKey: 'sk-x' })
    persistConfig({ apiKey: '' })
    expect(JSON.parse(readFileSync(cfgPath(), 'utf-8')).apiKey).toBe('')
  })

  it('persistConfig encrypts a non-empty secret when keychain is available', () => {
    persistConfig({ apiKey: 'sk-x', asrApiKey: 'sk-y' })
    const disk = JSON.parse(readFileSync(cfgPath(), 'utf-8'))
    expect(disk.apiKey.startsWith(ENC_PREFIX)).toBe(true)
    expect(disk.apiKey).not.toBe('sk-x')
    expect(disk.asrApiKey.startsWith(ENC_PREFIX)).toBe(true)
  })

  it('persistConfig falls back to plaintext when keychain is unavailable (never loses the key)', () => {
    state.encAvailable = false
    persistConfig({ apiKey: 'sk-x' })
    expect(JSON.parse(readFileSync(cfgPath(), 'utf-8')).apiKey).toBe('sk-x')
  })

  it('loadPersistedConfig DROPS a secret field on decrypt failure (never surfaces "")', () => {
    persistConfig({ apiKey: 'sk-x' }) // writes enc:v1:...
    state.decryptThrows = true
    const loaded = loadPersistedConfig()
    // Field is dropped, NOT coerced to '' — so persistConfig later preserves the ciphertext.
    expect('apiKey' in loaded).toBe(false)
  })

  it('loadPersistedConfig round-trips a secret through encrypt→persist→load', () => {
    persistConfig({ apiKey: 'sk-x', model: 'deepseek-chat' })
    const loaded = loadPersistedConfig()
    expect(loaded.apiKey).toBe('sk-x')
    expect(loaded.model).toBe('deepseek-chat')
  })

  it('loadPersistedConfig quarantines a corrupt config.json and falls back to .bak', () => {
    writeFileSync(cfgPath(), 'not json {', 'utf-8')
    writeFileSync(`${cfgPath()}.bak`, JSON.stringify({ model: 'from-bak' }), 'utf-8')
    const loaded = loadPersistedConfig()
    expect(loaded.model).toBe('from-bak')
    const quarantined = readdirSync(state.userDataDir).some((f) => f.includes('.corrupt-'))
    expect(quarantined).toBe(true)
    expect(existsSync(cfgPath())).toBe(false) // renamed away
  })
})
