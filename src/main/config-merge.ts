// Pure helpers extracted verbatim from the config:set handler so the two-write-path behavior
// (in-memory split vs. persisted read-modify-write) is unit-testable in isolation. No behavior
// change — these are the exact inline expressions, wrapped. They move into the config/ domain
// in Step 2.3.

export interface AsrTriple {
  apiKey: string
  baseUrl: string
  model: string
}

// Split a config:set partial into the LLM-bound subset (asr* / overlayOpacity / screenshotMode
// removed) plus the pulled-out fields. screenshotMode is a main-process behavior flag, NOT an
// LLM param, so it must never reach setConfig.
export function splitConfigSet(p: Record<string, unknown>): {
  llmPartial: Record<string, unknown>
  overlayOpacity?: unknown
} {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { asrApiKey, asrBaseUrl, asrModel, overlayOpacity, screenshotMode, ...llmPartial } = p
  return { llmPartial, overlayOpacity }
}

// Whether a config:set partial touches any ASR field.
export function hasAsrField(p: Record<string, unknown>): boolean {
  return p.asrApiKey !== undefined || p.asrBaseUrl !== undefined || p.asrModel !== undefined
}

// New ASR config: overwrite only the fields the partial actually carries (per-field undefined
// guard), everything else stays as the current value.
export function asrPatch(cur: AsrTriple, p: Record<string, unknown>): AsrTriple {
  return {
    apiKey: p.asrApiKey !== undefined ? (p.asrApiKey as string) : cur.apiKey,
    baseUrl: p.asrBaseUrl !== undefined ? (p.asrBaseUrl as string) : cur.baseUrl,
    model: p.asrModel !== undefined ? (p.asrModel as string) : cur.model
  }
}

// Read-modify-write merge for persistence: overwrite only provided AND changed fields (so a
// partial update can never blank a saved secret). overlayOpacity is then UNCONDITIONALLY coerced
// to a number — this second write must NOT be folded into the compare loop, or a string '0.8'
// (which differs from the on-disk number) would land on disk before coercion.
export function mergeConfigForPersist(
  existing: Record<string, unknown>,
  p: Record<string, unknown>
): { merged: Record<string, unknown>; changed: boolean } {
  let changed = false
  const merged = { ...existing }
  for (const k of Object.keys(p)) {
    if (p[k] !== undefined && merged[k] !== p[k]) {
      merged[k] = p[k]
      changed = true
    }
  }
  if (p.overlayOpacity !== undefined) {
    merged.overlayOpacity = Number(p.overlayOpacity)
    changed = true
  }
  return { merged, changed }
}
