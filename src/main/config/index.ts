import { ipcMain } from 'electron'
import { INVOKE, SEND } from '../../shared/ipc'
import type { ServiceTestResult } from '../../shared/ipc'
import type { PersistedConfig } from '../../shared/config'
import {
  splitConfigSet,
  hasAsrField,
  asrPatch,
  mergeConfigForPersist,
  type AsrTriple
} from '../config-merge'

export interface ConfigDeps {
  testLLMConnection: (cfg: {
    apiKey: string
    baseUrl: string
    model: string
  }) => Promise<ServiceTestResult>
  testVisionConnection: (cfg: {
    apiKey: string
    baseUrl: string
    visionModel: string
  }) => Promise<ServiceTestResult>
  testASRConnection: (cfg: {
    apiKey: string
    baseUrl: string
    model: string
  }) => Promise<ServiceTestResult>
  // `object` (not Record<string,unknown>): an interface return like LLMConfig has no index
  // signature, so it isn't assignable to Record — `object` accepts it and spreads fine.
  getConfig: () => object
  setConfig: (partial: Record<string, string>) => void
  getASRConfig: () => AsrTriple
  setASRConfig: (cfg: AsrTriple) => void
  loadPersistedConfig: () => PersistedConfig
  persistConfig: (cfg: PersistedConfig) => void
  sendOverlayOpacity: (opacity: number) => void
}

// Registers config:test-*/get/get-public/set. The two config:set write paths (in-memory split
// vs. persisted read-modify-write) are preserved exactly via the config-merge helpers.
export function registerConfigIpc(deps: ConfigDeps): void {
  // Connectivity tests use the values passed from the settings form (may be unsaved)
  ipcMain.handle(INVOKE.testLLM, (_e, cfg) => deps.testLLMConnection(cfg))
  ipcMain.handle(INVOKE.testVision, (_e, cfg) => deps.testVisionConnection(cfg))
  ipcMain.handle(INVOKE.testASR, (_e, cfg) => deps.testASRConnection(cfg))

  // Full config incl. plaintext API keys — for the SETTINGS form (main window) to echo back.
  ipcMain.handle(INVOKE.getConfig, () => {
    const asr = deps.getASRConfig()
    const persisted = deps.loadPersistedConfig()
    return {
      ...deps.getConfig(),
      asrApiKey: asr.apiKey,
      asrBaseUrl: asr.baseUrl,
      asrModel: asr.model,
      overlayOpacity: persisted.overlayOpacity ?? 0.94,
      screenshotMode: persisted.screenshotMode ?? 'direct'
    }
  })

  // Secret-free subset for non-settings windows (the overlay only needs appearance). Keeps the
  // plaintext API keys out of the overlay renderer's memory — least privilege.
  ipcMain.handle(INVOKE.getPublicConfig, () => {
    const persisted = deps.loadPersistedConfig()
    return {
      overlayOpacity: persisted.overlayOpacity ?? 0.94,
      screenshotMode: persisted.screenshotMode ?? 'direct'
    }
  })

  ipcMain.on(SEND.configSet, (_e, partial) => {
    const p = partial as Record<string, unknown>
    // Log only field names — never the values (would leak API keys)
    console.log('[Config] received keys:', Object.keys(p).join(', '))
    // Update in-memory configs for immediate use. screenshotMode is a main-process behavior flag,
    // not an LLM param — pull it out of llmPartial so it never leaks into the LLM config; it's
    // read straight from the persisted file in the screenshot handler.
    const { llmPartial, overlayOpacity } = splitConfigSet(p)
    if (Object.keys(llmPartial).length) deps.setConfig(llmPartial as Record<string, string>)
    if (hasAsrField(p)) deps.setASRConfig(asrPatch(deps.getASRConfig(), p))
    if (overlayOpacity !== undefined) deps.sendOverlayOpacity(Number(overlayOpacity))
    // Persist via read-modify-write: only overwrite fields actually provided, so a partial update
    // (e.g. the opacity slider) can never blank out a saved API key.
    const { merged, changed } = mergeConfigForPersist(
      deps.loadPersistedConfig() as Record<string, unknown>,
      p
    )
    if (changed) deps.persistConfig(merged as PersistedConfig)
  })
}
