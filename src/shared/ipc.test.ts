import { describe, it, expect } from 'vitest'
import { INVOKE, SEND, EVENT } from './ipc'

// Locks the channel inventory so a dropped/duplicated channel is caught. 8 invoke + 16 send +
// 14 event = 38 (name, direction) tuples across 34 distinct channel names (4 names are reused
// across the send/event directions).
describe('IPC channel inventory', () => {
  it('has the expected count per direction', () => {
    expect(Object.keys(INVOKE)).toHaveLength(8)
    expect(Object.keys(SEND)).toHaveLength(16)
    expect(Object.keys(EVENT)).toHaveLength(14)
  })

  it('has no duplicate channel names WITHIN a direction', () => {
    for (const map of [INVOKE, SEND, EVENT]) {
      const values = Object.values(map)
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('covers 34 distinct channel names across all directions', () => {
    const all = [...Object.values(INVOKE), ...Object.values(SEND), ...Object.values(EVENT)]
    expect(new Set(all).size).toBe(34)
  })

  it('only reuses names across directions for the known bidirectional channels', () => {
    const reused = [...Object.values(SEND)].filter((c) =>
      (Object.values(EVENT) as string[]).includes(c)
    )
    expect(reused.sort()).toEqual(['asr:start', 'asr:stop', 'asr:transcript', 'llm:clear'])
  })
})
