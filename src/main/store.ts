import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

interface PersistedConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  visionModel?: string
  asrApiKey?: string
  asrBaseUrl?: string
  asrModel?: string
  overlayX?: number
  overlayY?: number
  overlayOpacity?: number
}

// Secrets encrypted at rest via the OS keychain (macOS Keychain) using Electron safeStorage.
// All other fields stay plaintext. Legacy plaintext secrets are auto-migrated on next save.
const SECRET_FIELDS: (keyof PersistedConfig)[] = ['apiKey', 'asrApiKey']
const ENC_PREFIX = 'enc:v1:'

const configPath = () => join(app.getPath('userData'), 'config.json')

function canEncrypt(): boolean {
  // safeStorage is only valid after app 'ready'; guard so a corrupt/locked keychain can't crash us
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encryptValue(plain: string): string {
  if (!plain || !canEncrypt()) return plain // graceful fallback: store plaintext rather than lose the key
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
  } catch {
    return plain
  }
}

function decryptValue(stored: string): string {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored // legacy plaintext — returned as-is, re-encrypted on next save
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return '' // keychain changed / unreadable — drop rather than expose ciphertext as a key
  }
}

export function loadPersistedConfig(): PersistedConfig {
  try {
    const file = configPath()
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as PersistedConfig
      for (const f of SECRET_FIELDS) {
        const v = raw[f]
        if (typeof v === 'string') {
          ;(raw as Record<string, unknown>)[f] = decryptValue(v)
        }
      }
      return raw
    }
  } catch {
    // corrupt file — start fresh
  }
  return {}
}

export function persistConfig(config: PersistedConfig): void {
  try {
    const out: PersistedConfig = { ...config }
    for (const f of SECRET_FIELDS) {
      const v = out[f]
      if (typeof v === 'string' && v) {
        ;(out as Record<string, unknown>)[f] = encryptValue(v)
      }
    }
    writeFileSync(configPath(), JSON.stringify(out, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to persist config:', e)
  }
}
