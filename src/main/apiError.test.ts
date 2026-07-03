import { describe, it, expect } from 'vitest'
import { describeApiError } from './apiError'

const withStatus = (status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('generic'), { status, ...extra })

describe('describeApiError', () => {
  it('maps HTTP status codes to actionable Chinese messages', () => {
    expect(describeApiError(withStatus(401))).toBe('鉴权失败（401）：API Key 不对或无权限')
    expect(describeApiError(withStatus(403))).toBe('鉴权失败（403）：API Key 不对或无权限')
    expect(describeApiError(withStatus(404))).toBe('找不到（404）：检查 Base URL 或模型名')
    expect(describeApiError(withStatus(400, { error: { message: 'bad request' } }))).toBe(
      '请求被拒（400）：bad request'
    )
    expect(describeApiError(withStatus(429))).toBe('限流（429）：请求太频繁或额度用尽')
    expect(describeApiError(withStatus(503))).toBe('HTTP 503：generic')
  })

  it('detects timeout/abort by message even when name is generic Error', () => {
    expect(describeApiError(Object.assign(new Error('Request was aborted')))).toBe(
      '超时：Base URL 不通或网络太慢'
    )
    expect(describeApiError(Object.assign(new Error('operation timed out')))).toBe(
      '超时：Base URL 不通或网络太慢'
    )
  })

  it('falls back to message, then a generic string, for statusless errors', () => {
    expect(describeApiError(new Error('something broke'))).toBe('something broke')
    expect(describeApiError('boom')).toBe('boom')
  })
})
