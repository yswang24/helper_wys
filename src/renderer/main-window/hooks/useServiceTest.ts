import { useState } from 'react'

export type TestState = { st: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }

interface TestCfg {
  apiKey: string
  baseUrl: string
  model: string
  visionModel: string
  asrApiKey: string
  asrBaseUrl: string
  asrModel: string
}

// The three settings connectivity tests (LLM / Vision / ASR). Collapses the three identical
// try/catch bodies into one `run` helper — same behavior, one place.
export function useServiceTest(cfg: TestCfg): {
  llmTest: TestState
  visionTest: TestState
  asrTest: TestState
  testLlm: () => Promise<void>
  testVision: () => Promise<void>
  testAsr: () => Promise<void>
} {
  const [llmTest, setLlmTest] = useState<TestState>({ st: 'idle', msg: '' })
  const [visionTest, setVisionTest] = useState<TestState>({ st: 'idle', msg: '' })
  const [asrTest, setAsrTest] = useState<TestState>({ st: 'idle', msg: '' })

  const run = async (
    setState: (s: TestState) => void,
    fn: () => Promise<{ ok: boolean; message: string }>
  ): Promise<void> => {
    setState({ st: 'testing', msg: '' })
    try {
      const r = await fn()
      setState({ st: r.ok ? 'ok' : 'fail', msg: r.message })
    } catch (e) {
      setState({ st: 'fail', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  const testLlm = () =>
    run(setLlmTest, () =>
      window.electronAPI.testLLM({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model })
    )
  const testVision = () =>
    run(setVisionTest, () =>
      window.electronAPI.testVision({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        visionModel: cfg.visionModel
      })
    )
  const testAsr = () =>
    run(setAsrTest, () =>
      window.electronAPI.testASR({
        apiKey: cfg.asrApiKey,
        baseUrl: cfg.asrBaseUrl,
        model: cfg.asrModel
      })
    )

  return { llmTest, visionTest, asrTest, testLlm, testVision, testAsr }
}
