import { app } from 'electron'
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
}

const configPath = () => join(app.getPath('userData'), 'config.json')

export function loadPersistedConfig(): PersistedConfig {
  try {
    const file = configPath()
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, 'utf-8')) as PersistedConfig
    }
  } catch {
    // corrupt file — start fresh
  }
  return {}
}

export function persistConfig(config: PersistedConfig): void {
  try {
    writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to persist config:', e)
  }
}
