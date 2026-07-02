// Whisper hallucinates these phrases on silence/noise (streaming-platform watermarks,
// common video endings absorbed from training data). Shared by the main-process ASR
// filter (asr.ts) and the renderer-side transcript filter (main-window VoiceTab).
//
// IMPORTANT: many of these tokens (订阅/点赞/请关注/扫码/二维码…) are also everyday words.
// A bare substring match would nuke legitimate multi-sentence answers ("数据库的订阅发布
// 模式…"). So a watermark hit only counts as a hallucination when it DOMINATES the clip —
// see isHallucinatedText below.
export const HALLUCINATION_RE =
  /点赞|订阅|转发|打赏|谢谢大家|谢谢观看|明镜|优优独播|YoYo Television|独播剧场|爱奇艺|腾讯视频|优酷|bilibili|哔哩哔哩|字幕组|制作字幕|版权所有|请勿盗录|请勿盗版|Thank you for watching|thanks for watching|please subscribe|don'?t forget to (?:like|subscribe)|请关注|扫码|二维码|本视频|本期视频/i

// A global-flag clone for stripping (kept separate so .test() above never advances lastIndex).
const HALLUCINATION_RE_G = new RegExp(HALLUCINATION_RE.source, 'gi')

export function isHallucinatedText(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (isRepetitive(t)) return true
  // A watermark only means "hallucination" when stripping every watermark hit (plus
  // punctuation/whitespace) leaves almost nothing real behind — i.e. the whole clip is
  // boilerplate. A single brand word inside a genuine answer leaves plenty of residue and
  // passes through untouched.
  if (HALLUCINATION_RE.test(t)) {
    const residue = t.replace(HALLUCINATION_RE_G, '').replace(/[\s\p{P}\p{S}]+/gu, '')
    if (residue.length < 6) return true
  }
  return false
}

// Repeated-segment hallucination: "ABCABC" (single exact doubling) or one token repeated many
// times ("好 好 好 好 好 好", "the the the the the the", "hahahaha").
function isRepetitive(t: string): boolean {
  const half = t.slice(0, Math.floor(t.length / 2))
  if (half.length > 4 && t.startsWith(half + half.slice(0, 2))) return true
  // Whisper loop = a short vocabulary repeated MANY times. Require both a high token count and
  // heavy single-token dominance, so genuine emphatic phrases ("yes yes no no", "very very very
  // good" — 4 tokens / 2 distinct) are NOT discarded.
  const tokens = t.split(/\s+/).filter(Boolean)
  if (tokens.length >= 6) {
    const counts = new Map<string, number>()
    for (const tok of tokens) counts.set(tok, (counts.get(tok) ?? 0) + 1)
    const maxFreq = Math.max(...counts.values())
    if (maxFreq / tokens.length > 0.6) return true
  }
  return false
}
