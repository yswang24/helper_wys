// Whisper hallucinates these phrases on silence/noise (streaming-platform watermarks,
// common video endings absorbed from training data). Shared by the main-process ASR
// filter (asr.ts) and the renderer-side transcript filter (main-window VoiceTab).
export const HALLUCINATION_RE =
  /点赞|订阅|转发|打赏|谢谢大家|明镜|优优独播|YoYo Television|独播剧场|爱奇艺|腾讯视频|优酷|bilibili|哔哩哔哩|字幕组|制作字幕|版权所有|请勿盗录|请勿盗版|Thank you for watching|thanks for watching|please subscribe|don't forget to like|请关注|扫码|二维码|本视频|本期视频/i

export function isHallucinatedText(text: string): boolean {
  if (!text) return true
  if (HALLUCINATION_RE.test(text)) return true
  // Repeated-segment hallucination: "ABCABC" or "X X X X"
  const half = text.slice(0, Math.floor(text.length / 2))
  if (half.length > 4 && text.startsWith(half + half.slice(0, 2))) return true
  return false
}
