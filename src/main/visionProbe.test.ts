import { describe, expect, it } from 'vitest'
import { matchesVisionProbeResponse, VISION_PROBE_PROMPT } from './visionProbe'

describe('matchesVisionProbeResponse', () => {
  it.each([
    'seen | enumerate | Two Sum',
    '- `seen`\n- **enumerate**\n- ## Two   Sum',
    'ｓｅｅｎ／ｅｎｕｍｅｒａｔｅ／Ｔｗｏ　Ｓｕｍ',
    'seen、enumerate、两数之和',
    'Two Sum\n```python\nseen = {}\nfor i, n in enumerate(nums):\n```'
  ])('accepts the three image facts despite formatting: %s', (content) => {
    expect(matchesVisionProbeResponse(content)).toBe(true)
  })

  it.each([
    null,
    undefined,
    '',
    'I cannot view the image.',
    'unseen | enumerated | twosummer',
    'seen | enumerate',
    'seen | Two Sum',
    VISION_PROBE_PROMPT
  ])('rejects empty, generic, echoed, or incomplete output: %s', (content) => {
    expect(matchesVisionProbeResponse(content)).toBe(false)
  })
})
