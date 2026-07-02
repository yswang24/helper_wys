import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from 'fs'

interface PersistedConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  visionModel?: string
  // 岗位 JD 与候选人简历要点 — 面试往往跨多次启动准备，必须跨会话保留；非密钥，明文即可。
  jobDescription?: string
  resume?: string
  // 回答语言：'zh' / 'en' / 'auto'（跟随提问）
  answerLang?: string
  asrApiKey?: string
  asrBaseUrl?: string
  asrModel?: string
  overlayX?: number
  overlayY?: number
  overlayOpacity?: number
  screenshotMode?: 'direct' | 'ocr'
  screenshotPrompt?: string
}

// Secrets encrypted at rest via the OS keychain (macOS Keychain) using Electron safeStorage.
// All other fields stay plaintext. Legacy plaintext secrets are auto-migrated on next save.
const SECRET_FIELDS: (keyof PersistedConfig)[] = ['apiKey', 'asrApiKey']
const ENC_PREFIX = 'enc:v1:'

// Sentinel distinguishing "decrypt failed" (keychain transiently locked/unavailable) from
// "value is genuinely empty". Critical: a transient failure must NOT be treated as '' and
// written back over the recoverable ciphertext — that would permanently destroy the key.
const DECRYPT_FAILED = Symbol('decrypt-failed')

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

function decryptValue(stored: string): string | typeof DECRYPT_FAILED {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored // legacy plaintext — returned as-is, re-encrypted on next save
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    // keychain transiently locked / changed / unreadable — signal failure so callers preserve
    // the on-disk ciphertext instead of clobbering it with an empty string.
    return DECRYPT_FAILED
  }
}

// Read and JSON-parse a config file; null if missing or unparseable (never throws).
function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export function loadPersistedConfig(): PersistedConfig {
  const file = configPath()
  let raw = readJson(file)

  if (!raw && existsSync(file)) {
    // File exists but is corrupt (e.g. a half-written file after a crash). Preserve it for
    // diagnosis instead of silently discarding everything, then fall back to the last backup.
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
      console.error('[store] config.json unparseable — moved to .corrupt-* and trying backup')
    } catch (e) {
      console.error('[store] failed to quarantine corrupt config:', e)
    }
    raw = readJson(`${file}.bak`)
  }

  if (!raw) return {}

  for (const f of SECRET_FIELDS) {
    const v = raw[f]
    if (typeof v === 'string') {
      const dec = decryptValue(v)
      if (dec === DECRYPT_FAILED) {
        // Drop the field so no caller sees a bogus key — but DON'T surface ''. persistConfig
        // preserves the on-disk ciphertext for any absent secret, so the key survives.
        delete raw[f]
      } else {
        raw[f] = dec
      }
    }
  }
  return raw as PersistedConfig
}

// Atomic write: write to a temp file, snapshot the previous good file as .bak, then rename
// over the live file. A crash/power-loss can never leave a truncated config.json.
function writeFileAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, 'utf-8')
  try {
    if (existsSync(file)) copyFileSync(file, `${file}.bak`)
  } catch { /* best-effort backup */ }
  renameSync(tmp, file)
}

export function persistConfig(config: PersistedConfig): void {
  try {
    const out: PersistedConfig = { ...config }
    // What's currently on disk — used to preserve secrets the caller didn't supply (e.g. a key
    // that was dropped this session due to a transient decrypt failure). Never erase a stored
    // ciphertext just because the in-memory secret is missing.
    const existing = readJson(configPath()) ?? {}

    for (const f of SECRET_FIELDS) {
      if (f in out) {
        const v = out[f]
        if (typeof v === 'string' && v) {
          ;(out as Record<string, unknown>)[f] = encryptValue(v)
        }
        // field present but empty → user deliberately cleared it; leave '' so it's erased
      } else {
        // field absent → keep whatever (encrypted) value is already on disk
        const prev = existing[f]
        if (typeof prev === 'string' && prev) {
          ;(out as Record<string, unknown>)[f] = prev
        }
      }
    }
    writeFileAtomic(configPath(), JSON.stringify(out, null, 2))
  } catch (e) {
    console.error('Failed to persist config:', e)
  }
}
