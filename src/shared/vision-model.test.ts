import { describe, expect, it } from 'vitest'
import { getKnownTextOnlyVisionModelError } from './vision-model'

describe('getKnownTextOnlyVisionModelError', () => {
  it.each(['glm-5', 'glm-5.2', 'glm-5.2-fast-preview', 'glm-4.7', 'deepseek-chat'])(
    'rejects known text-only model %s',
    (model) => {
      expect(getKnownTextOnlyVisionModelError(model)).toContain('仅支持文本输入')
    }
  )

  it.each(['qwen3.5-omni-plus', 'Qwen/Qwen2-VL-7B-Instruct', 'glm-5v-turbo', 'unknown-vlm'])(
    'allows image-capable or unknown model %s to reach the real probe',
    (model) => {
      expect(getKnownTextOnlyVisionModelError(model)).toBeNull()
    }
  )
})
