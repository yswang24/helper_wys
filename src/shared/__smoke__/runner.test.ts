import { describe, it, expect } from 'vitest'

// Smoke test: proves the Vitest runner + node environment are wired. Real tests land
// alongside their source (src/**/x.test.ts) starting in Step 0.5.
describe('vitest runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
