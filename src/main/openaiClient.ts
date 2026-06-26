import OpenAI from 'openai'

// Cache OpenAI clients keyed by (baseURL, maxRetries, apiKey) so repeated requests within a
// session reuse the same instance — and its keep-alive connection pool — instead of
// re-instantiating (and risking a fresh TCP/TLS handshake) on every question. This shaves
// time-to-first-token, which matters most for an interview helper.
const cache = new Map<string, OpenAI>()

export function getOpenAIClient(opts: { apiKey: string; baseURL: string; maxRetries?: number }): OpenAI {
  const maxRetries = opts.maxRetries ?? 2
  // Space separator: neither a URL nor an API key contains spaces, so the composite key is safe.
  const key = `${opts.baseURL} ${maxRetries} ${opts.apiKey}`
  let client = cache.get(key)
  if (!client) {
    client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, dangerouslyAllowBrowser: true, maxRetries })
    cache.set(key, client)
  }
  return client
}
