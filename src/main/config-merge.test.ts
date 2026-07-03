import { describe, it, expect } from 'vitest'
import { splitConfigSet, hasAsrField, asrPatch, mergeConfigForPersist } from './config-merge'

// Characterization tests locking the config:set two-write-path behavior BEFORE Step 2.3 moves
// these helpers into the config/ domain.
describe('config:set merge helpers', () => {
  it('splitConfigSet pulls asr*/overlayOpacity/screenshotMode out of the LLM subset', () => {
    const { llmPartial, overlayOpacity } = splitConfigSet({
      model: 'm',
      screenshotMode: 'ocr',
      asrModel: 'whisper',
      overlayOpacity: 0.8
    })
    expect(llmPartial).toEqual({ model: 'm' }) // screenshotMode NEVER leaks to setConfig
    expect(overlayOpacity).toBe(0.8)
  })

  it('hasAsrField detects any ASR key', () => {
    expect(hasAsrField({ model: 'm' })).toBe(false)
    expect(hasAsrField({ asrModel: 'w' })).toBe(true)
    expect(hasAsrField({ asrApiKey: 'k' })).toBe(true)
  })

  it('asrPatch overwrites only the fields the partial carries', () => {
    const cur = { apiKey: 'k', baseUrl: 'b', model: 'm' }
    expect(asrPatch(cur, { asrModel: 'm2' })).toEqual({ apiKey: 'k', baseUrl: 'b', model: 'm2' })
    expect(asrPatch(cur, {})).toEqual(cur)
  })

  it('mergeConfigForPersist skips a no-op update (same value)', () => {
    const { changed } = mergeConfigForPersist({ jobDescription: 'A' }, { jobDescription: 'A' })
    expect(changed).toBe(false)
  })

  it('mergeConfigForPersist preserves an untouched secret on a partial update', () => {
    const { merged, changed } = mergeConfigForPersist({ apiKey: 'sk-x' }, { overlayOpacity: 0.5 })
    expect(merged.apiKey).toBe('sk-x') // secret survives
    expect(changed).toBe(true)
  })

  it('mergeConfigForPersist coerces overlayOpacity to a NUMBER (string never lands on disk)', () => {
    const { merged } = mergeConfigForPersist({ overlayOpacity: 0.94 }, { overlayOpacity: '0.8' })
    expect(merged.overlayOpacity).toBe(0.8)
    expect(typeof merged.overlayOpacity).toBe('number')
  })

  it('mergeConfigForPersist persists screenshotMode (routed around setConfig but still saved)', () => {
    const { merged } = mergeConfigForPersist({}, { screenshotMode: 'ocr', model: 'm' })
    expect(merged.screenshotMode).toBe('ocr')
    expect(merged.model).toBe('m')
  })
})
