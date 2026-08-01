const KNOWN_TEXT_ONLY_PATTERNS = [
  /^deepseek-(?:chat|reasoner)$/i,
  /^glm-4\.(?:5|6|7)(?:[-_]|$)/i,
  /^glm-5(?:\.\d+)*(?:[-_]|$)/i
]

/**
 * Returns a user-facing explanation for model names that are known to reject image input.
 *
 * This is deliberately conservative: unknown models still go through the real image probe.
 * Visual variants such as `glm-5v-turbo` do not match the GLM text-only patterns.
 */
export function getKnownTextOnlyVisionModelError(model: string): string | null {
  const normalized = model.trim()
  if (!normalized || !KNOWN_TEXT_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null
  }

  return `“${normalized}”仅支持文本输入，不能处理题目截图。请切换到支持图像输入的视觉模型，例如 qwen3.5-omni-plus。`
}
