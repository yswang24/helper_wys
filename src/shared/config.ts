// Screenshot solve mode: 'direct' = vision model streams the answer in one call; 'ocr' =
// extract editable text first, then send to the LLM. Canonical home (ipc.ts re-imports it).
export type ScreenshotMode = 'direct' | 'ocr'

// Single canonical config shape, split into domains. Legacy code defined this concept FOUR
// times (llm.ts LLMConfig, asr.ts ASRConfig, store.ts PersistedConfig, env.d.ts LLMConfig),
// already drifted. `AppConfig` is the in-memory truth; `PersistedConfig` is the flat on-disk /
// wire view. `toPersisted`/`fromPersisted` are the ONLY bridge between them.
//
// overlayX/overlayY are deliberately NOT part of AppConfig — the overlay position is persisted
// through a separate path (persistOverlayPos) and never reaches the renderer config surface.

export interface ProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
  visionModel: string
}

export interface AsrConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface PromptConfig {
  jobDescription: string
  resume: string
  answerLang: string // 'zh' | 'en' | 'auto' — kept as string (see answerLangPhrase widening)
  screenshotPrompt: string
}

export interface UiPrefs {
  overlayOpacity: number
  screenshotMode: ScreenshotMode
}

export interface AppConfig {
  provider: ProviderConfig
  asr: AsrConfig
  prompt: PromptConfig
  ui: UiPrefs
}

// Flat on-disk / wire shape. Byte-for-byte the legacy store.ts PersistedConfig — no key is
// renamed (asrApiKey/asrBaseUrl/asrModel stay flat). All fields optional (a partial save writes
// only what changed).
export interface PersistedConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  visionModel?: string
  jobDescription?: string
  resume?: string
  answerLang?: string
  asrApiKey?: string
  asrBaseUrl?: string
  asrModel?: string
  overlayX?: number
  overlayY?: number
  overlayOpacity?: number
  screenshotMode?: ScreenshotMode
  screenshotPrompt?: string
}

// Secret-free subset the overlay receives (never plaintext keys).
export interface PublicConfig {
  overlayOpacity: number
  screenshotMode: ScreenshotMode
}

// Encrypted-at-rest fields, on the FLAT form. Mirrors store.ts SECRET_FIELDS exactly.
export const SECRET_FIELDS = ['apiKey', 'asrApiKey'] as const satisfies readonly (keyof PersistedConfig)[]

// One source of defaults, = the union of the three legacy default constants.
export const DEFAULTS: AppConfig = {
  provider: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    visionModel: 'deepseek-chat'
  },
  asr: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1'
  },
  prompt: {
    jobDescription: '',
    resume: '',
    answerLang: 'zh',
    screenshotPrompt: ''
  },
  ui: {
    overlayOpacity: 0.94,
    screenshotMode: 'direct'
  }
}

// AppConfig → flat PersistedConfig (renderer-visible subset only; no overlayX/overlayY).
export function toPersisted(cfg: AppConfig): PersistedConfig {
  return {
    apiKey: cfg.provider.apiKey,
    baseUrl: cfg.provider.baseUrl,
    model: cfg.provider.model,
    visionModel: cfg.provider.visionModel,
    asrApiKey: cfg.asr.apiKey,
    asrBaseUrl: cfg.asr.baseUrl,
    asrModel: cfg.asr.model,
    jobDescription: cfg.prompt.jobDescription,
    resume: cfg.prompt.resume,
    answerLang: cfg.prompt.answerLang,
    screenshotPrompt: cfg.prompt.screenshotPrompt,
    overlayOpacity: cfg.ui.overlayOpacity,
    screenshotMode: cfg.ui.screenshotMode
  }
}

// Flat PersistedConfig → AppConfig, filling DEFAULTS for any absent field. Out-of-range
// answerLang is preserved verbatim (widened later at answerLangPhrase), never thrown on.
export function fromPersisted(raw: PersistedConfig): AppConfig {
  return {
    provider: {
      apiKey: raw.apiKey ?? DEFAULTS.provider.apiKey,
      baseUrl: raw.baseUrl ?? DEFAULTS.provider.baseUrl,
      model: raw.model ?? DEFAULTS.provider.model,
      visionModel: raw.visionModel ?? DEFAULTS.provider.visionModel
    },
    asr: {
      apiKey: raw.asrApiKey ?? DEFAULTS.asr.apiKey,
      baseUrl: raw.asrBaseUrl ?? DEFAULTS.asr.baseUrl,
      model: raw.asrModel ?? DEFAULTS.asr.model
    },
    prompt: {
      jobDescription: raw.jobDescription ?? DEFAULTS.prompt.jobDescription,
      resume: raw.resume ?? DEFAULTS.prompt.resume,
      answerLang: raw.answerLang ?? DEFAULTS.prompt.answerLang,
      screenshotPrompt: raw.screenshotPrompt ?? DEFAULTS.prompt.screenshotPrompt
    },
    ui: {
      overlayOpacity: raw.overlayOpacity ?? DEFAULTS.ui.overlayOpacity,
      screenshotMode: raw.screenshotMode ?? DEFAULTS.ui.screenshotMode
    }
  }
}

// Secret-free public view with defaults applied (matches the legacy config:get-public handler).
export function toPublicConfig(raw: PersistedConfig): PublicConfig {
  return {
    overlayOpacity: raw.overlayOpacity ?? DEFAULTS.ui.overlayOpacity,
    screenshotMode: raw.screenshotMode ?? DEFAULTS.ui.screenshotMode
  }
}
