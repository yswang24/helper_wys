import { describe, it, expect, vi } from 'vitest'

// Fake OpenAI so no real client/connection is created. `vi.mock('openai')` is the long-term
// mock seam reused by the Phase 4 provider-client tests.
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    opts: unknown
    constructor(opts: unknown) {
      this.opts = opts
    }
  }
}))

import { getOpenAIClient } from './openaiClient'

describe('getOpenAIClient caching', () => {
  it('returns the same instance for identical (baseURL, maxRetries, apiKey)', () => {
    const a = getOpenAIClient({ apiKey: 'k', baseURL: 'https://b' })
    const b = getOpenAIClient({ apiKey: 'k', baseURL: 'https://b' })
    expect(a).toBe(b)
  })

  it('defaults maxRetries to 2 (explicit 2 hits the same cache entry)', () => {
    const implicit = getOpenAIClient({ apiKey: 'k2', baseURL: 'https://b2' })
    const explicit2 = getOpenAIClient({ apiKey: 'k2', baseURL: 'https://b2', maxRetries: 2 })
    expect(implicit).toBe(explicit2)
  })

  it('keys separately on a different maxRetries', () => {
    const r2 = getOpenAIClient({ apiKey: 'k3', baseURL: 'https://b3', maxRetries: 2 })
    const r0 = getOpenAIClient({ apiKey: 'k3', baseURL: 'https://b3', maxRetries: 0 })
    expect(r2).not.toBe(r0)
  })

  it('keys separately on a different apiKey or baseURL', () => {
    const base = getOpenAIClient({ apiKey: 'k4', baseURL: 'https://b4' })
    expect(getOpenAIClient({ apiKey: 'other', baseURL: 'https://b4' })).not.toBe(base)
    expect(getOpenAIClient({ apiKey: 'k4', baseURL: 'https://other' })).not.toBe(base)
  })
})
