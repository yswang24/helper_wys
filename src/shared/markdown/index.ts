// Streaming-aware markdown → HTML rendering for the answer overlay. Pure + dependency-free so it
// is unit-testable and reusable by both windows. Moved verbatim from overlay-window/App.tsx.

export interface Segment {
  type: 'text' | 'code'
  content: string
  lang?: string
}

export function parseSegments(text: string, streaming: boolean): Segment[] {
  const segs: Segment[] = []
  const re = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0,
    m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: 'text', content: text.slice(last, m.index) })
    segs.push({ type: 'code', lang: m[1] || undefined, content: m[2] })
    last = m.index + m[0].length
  }
  const rem = text.slice(last)
  if (rem) {
    // Only treat a trailing ``` as an OPEN code fence if it starts a line — otherwise a stray
    // inline ``` in prose ("use the ``` operator") would flip everything after it into a code
    // block mid-stream. The leading newline (if matched) stays with the preceding text.
    const open = streaming ? rem.match(/(?:^|\n)```(\w*)\n?([\s\S]*)$/) : null
    if (open) {
      const fenceStart = open.index! + (rem[open.index!] === '\n' ? 1 : 0)
      if (fenceStart > 0) segs.push({ type: 'text', content: rem.slice(0, fenceStart) })
      segs.push({ type: 'code', lang: open[1] || undefined, content: open[2] })
    } else {
      segs.push({ type: 'text', content: rem })
    }
  }
  return segs
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Inline formatting on an ALREADY-ESCAPED string: bold, inline code, links (rendered as
// non-navigating styled text so they can't hijack the overlay window).
export function renderInline(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#e2e8f0">$1</strong>')
    .replace(
      /`([^`]+)`/g,
      '<code style="background:rgba(30,30,60,0.6);padding:1px 4px;border-radius:3px;color:#7dd3fc;font-size:0.85em">$1</code>'
    )
    .replace(
      /\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g,
      '<span style="color:#7dd3fc;text-decoration:underline">$1</span>'
    )
}

// Block-level markdown → HTML for a text segment (code fences handled separately by
// parseSegments). Escapes first, then recognizes headings / lists / blockquotes per line.
export function renderMarkdownBlock(text: string): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) {
      out.push('<div style="height:2px"></div>')
      continue
    }

    const heading = t.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      const size =
        heading[1].length === 1 ? '1.05em' : heading[1].length === 2 ? '1em' : '0.95em'
      out.push(
        `<div style="font-weight:700;color:#e2e8f0;font-size:${size}">${renderInline(escapeHtml(heading[2]))}</div>`
      )
      continue
    }

    const ordered = t.match(/^(\d+)\.\s+(.*)$/)
    if (ordered) {
      out.push(
        `<div style="display:flex;gap:6px"><span style="color:#7dd3fc;flex-shrink:0">${ordered[1]}.</span><span>${renderInline(escapeHtml(ordered[2]))}</span></div>`
      )
      continue
    }

    const bullet = t.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      out.push(
        `<div style="display:flex;gap:6px"><span style="color:#7dd3fc;flex-shrink:0">•</span><span>${renderInline(escapeHtml(bullet[1]))}</span></div>`
      )
      continue
    }

    const quote = t.match(/^>\s?(.*)$/)
    if (quote) {
      out.push(
        `<div style="border-left:2px solid rgba(125,211,252,0.4);padding-left:8px;color:#94a3b8">${renderInline(escapeHtml(quote[1]))}</div>`
      )
      continue
    }

    out.push(`<div>${renderInline(escapeHtml(line))}</div>`)
  }
  return out.join('')
}
