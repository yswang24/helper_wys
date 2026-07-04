import { describe, it, expect } from 'vitest'
import { parseSegments, escapeHtml, renderInline, renderMarkdownBlock } from './index'

describe('escapeHtml', () => {
  it('escapes & < > in order (no double-escaping)', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;')
  })
})

describe('renderInline', () => {
  it('renders bold and inline code', () => {
    expect(renderInline('**x**')).toContain('<strong')
    expect(renderInline('**x**')).toContain('>x</strong>')
    expect(renderInline('`code`')).toContain('<code')
  })
  it('neutralizes links to non-navigating spans (no href)', () => {
    const out = renderInline('[t](https://x.com)')
    expect(out).toContain('<span')
    expect(out).toContain('>t</span>')
    expect(out).not.toContain('href')
  })
})

describe('renderMarkdownBlock', () => {
  it('renders headings at three sizes, spacer for blank, list + quote', () => {
    expect(renderMarkdownBlock('# H1')).toContain('font-size:1.05em')
    expect(renderMarkdownBlock('## H2')).toContain('font-size:1em')
    expect(renderMarkdownBlock('### H3')).toContain('font-size:0.95em')
    expect(renderMarkdownBlock('')).toContain('height:2px')
    expect(renderMarkdownBlock('- item')).toContain('•')
    expect(renderMarkdownBlock('1. item')).toContain('1.')
    expect(renderMarkdownBlock('> quote')).toContain('border-left')
  })
  it('escapes HTML inside a heading', () => {
    expect(renderMarkdownBlock('# <b>')).toContain('&lt;b&gt;')
  })
  it('#### (4 hashes) falls through to a plain div, not a heading', () => {
    expect(renderMarkdownBlock('#### x')).not.toContain('font-weight:700')
  })
})

describe('parseSegments', () => {
  it('splits a closed code fence from surrounding text', () => {
    const segs = parseSegments('before\n```js\ncode\n```\nafter', false)
    expect(segs.map((s) => s.type)).toEqual(['text', 'code', 'text'])
    expect(segs[1].lang).toBe('js')
    expect(segs[1].content).toBe('code\n')
  })
  it('treats a trailing open fence as code ONLY when streaming', () => {
    const streaming = parseSegments('intro\n```py\nhalf', true)
    expect(streaming.some((s) => s.type === 'code')).toBe(true)
    const notStreaming = parseSegments('intro\n```py\nhalf', false)
    expect(notStreaming.every((s) => s.type === 'text')).toBe(true)
  })
  it('does NOT flip an inline ``` in prose into a code block', () => {
    const segs = parseSegments('use the ``` operator here', true)
    expect(segs.every((s) => s.type === 'text')).toBe(true)
  })
})
