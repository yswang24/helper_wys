// Turn an OpenAI-SDK / fetch error into a short, actionable Chinese message for the UI.
export function describeApiError(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & { status?: number; error?: { message?: string } }
    const status = e.status
    const detail = e.error?.message || e.message
    // HTTP-level errors first — these always carry a status.
    if (status === 401 || status === 403) return `鉴权失败（${status}）：API Key 不对或无权限`
    if (status === 404) return `找不到（404）：检查 Base URL 或模型名`
    if (status === 400) return `请求被拒（400）：${detail}`
    if (status === 429) return '限流（429）：请求太频繁或额度用尽'
    if (status) return `HTTP ${status}：${detail}`
    // No HTTP status → network-level failure. Detect timeout/abort by name OR message, since
    // the OpenAI SDK wraps AbortSignal.timeout in APIUserAbortError/APIConnectionTimeoutError
    // whose .name is the generic 'Error' (so a name-only check would never fire here).
    if (e.name === 'TimeoutError' || e.name === 'AbortError' || /aborted|timed?\s?out|timeout/i.test(e.message || '')) {
      return '超时：Base URL 不通或网络太慢'
    }
    return detail || '连接失败'
  }
  return String(err)
}
