import { describe, it, expect } from 'vitest'
import {
  DEFAULTS,
  toPersisted,
  fromPersisted,
  toPublicConfig,
  type AppConfig,
  type PersistedConfig
} from './config'

describe('config unification', () => {
  it('DEFAULTS flattens to the exact union of the three legacy default constants', () => {
    // Hardcoded so a drift in any default is caught. No overlayX/overlayY.
    expect(toPersisted(DEFAULTS)).toEqual({
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      visionModel: 'deepseek-chat',
      asrApiKey: '',
      asrBaseUrl: 'https://api.openai.com/v1',
      asrModel: 'whisper-1',
      jobDescription: '',
      resume: '',
      answerLang: 'zh',
      screenshotPrompt: '',
      overlayOpacity: 0.94,
      screenshotMode: 'direct'
    })
  })

  it('toPersisted/fromPersisted round-trips the renderer-visible subset', () => {
    const cfg: AppConfig = {
      provider: { apiKey: 'sk', baseUrl: 'https://api.x', model: 'm', visionModel: 'vm' },
      asr: { apiKey: 'ak', baseUrl: 'https://asr.x', model: 'whisper-large' },
      prompt: { jobDescription: 'JD', resume: 'CV', answerLang: 'en', screenshotPrompt: 'SP' },
      ui: { overlayOpacity: 0.5, screenshotMode: 'ocr' }
    }
    const flat = toPersisted(cfg)
    expect(fromPersisted(flat)).toEqual(cfg)
    // Coordinates never leak into the renderer-config surface.
    expect('overlayX' in flat).toBe(false)
    expect('overlayY' in flat).toBe(false)
    // Flat keys are byte-identical to the on-disk keys (no ASR prefix rename).
    expect(flat.asrApiKey).toBe('ak')
    expect(flat.asrBaseUrl).toBe('https://asr.x')
    expect(flat.asrModel).toBe('whisper-large')
  })

  it('fromPersisted preserves an out-of-range answerLang without throwing', () => {
    const cfg = fromPersisted({ answerLang: 'garbage' } as PersistedConfig)
    expect(cfg.prompt.answerLang).toBe('garbage')
    // Absent fields fall back to defaults.
    expect(cfg.provider.baseUrl).toBe('https://api.deepseek.com')
  })

  it('toPublicConfig exposes only overlayOpacity + screenshotMode (no secrets)', () => {
    const pub = toPublicConfig({ apiKey: 'sk', asrApiKey: 'ak', overlayOpacity: 0.7 })
    expect(Object.keys(pub).sort()).toEqual(['overlayOpacity', 'screenshotMode'])
    expect(pub.overlayOpacity).toBe(0.7)
    expect(pub.screenshotMode).toBe('direct') // default applied
  })
})
