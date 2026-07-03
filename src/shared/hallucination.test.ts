import { describe, it, expect } from 'vitest'
import { isHallucinatedText, HALLUCINATION_RE } from './hallucination'

// Characterization tests: lock the CURRENT behavior of the Whisper-hallucination filter so
// the ASR-pipeline extractions in later phases can't silently change it.
describe('isHallucinatedText', () => {
  it('treats empty / whitespace-only as hallucination', () => {
    expect(isHallucinatedText('')).toBe(true)
    expect(isHallucinatedText('   ')).toBe(true)
    expect(isHallucinatedText('\n\t ')).toBe(true)
  })

  it('discards a clip that is ENTIRELY watermark boilerplate (residue < 6)', () => {
    expect(isHallucinatedText('点赞')).toBe(true)
    expect(isHallucinatedText('请点赞订阅转发，谢谢观看')).toBe(true)
    expect(isHallucinatedText('Thank you for watching')).toBe(true)
  })

  it('passes through a genuine answer that merely CONTAINS a brand/watermark word', () => {
    // '订阅' appears but the sentence has plenty of real residue → not a hallucination.
    expect(isHallucinatedText('数据库的订阅发布模式是一种常见的消息传递机制')).toBe(false)
    expect(isHallucinatedText('这个问题可以用二分查找来解决，时间复杂度是 O(log n)')).toBe(false)
    expect(isHallucinatedText('Let me explain how the quicksort algorithm works')).toBe(false)
  })

  it('discards exact-doubling repetition (half > 4 chars, doubled)', () => {
    expect(isHallucinatedText('abcdefabcdef')).toBe(true)
  })

  it('discards a short vocabulary repeated MANY times (>=6 tokens, one dominates >60%)', () => {
    expect(isHallucinatedText('好 好 好 好 好 好')).toBe(true)
    expect(isHallucinatedText('the the the the the the')).toBe(true)
  })

  it('keeps genuine emphatic phrases (few tokens / multiple distinct)', () => {
    expect(isHallucinatedText('yes yes no no')).toBe(false)
    expect(isHallucinatedText('very very good')).toBe(false)
  })

  it('keeps a single ordinary character/word', () => {
    expect(isHallucinatedText('a')).toBe(false)
    expect(isHallucinatedText('对')).toBe(false)
  })

  it('HALLUCINATION_RE matches known watermark tokens (case-insensitive)', () => {
    expect(HALLUCINATION_RE.test('please subscribe')).toBe(true)
    expect(HALLUCINATION_RE.test('哔哩哔哩')).toBe(true)
    expect(HALLUCINATION_RE.test('a normal sentence')).toBe(false)
  })
})
