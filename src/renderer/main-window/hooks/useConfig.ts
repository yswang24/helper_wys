import { useState, useEffect } from 'react'

type ScreenshotMode = 'direct' | 'ocr'
type AnswerLang = 'zh' | 'en' | 'auto'

// Owns the settings form state: hydrate-once from getConfig, and save with light validation
// (non-empty key + well-formed URLs, never a live test so offline editing still works). Verbatim
// move from SettingsTab. Interactive writes (opacity slider / mode / answerLang / prompt / resume
// blur) stay inline in the view — only the full-save path lives here.
export function useConfig(onSaved?: () => void) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [model, setModel] = useState('deepseek-chat')
  const [visionModel, setVisionModel] = useState('deepseek-chat')
  const [asrApiKey, setAsrApiKey] = useState('')
  const [asrBaseUrl, setAsrBaseUrl] = useState('https://api.openai.com/v1')
  const [asrModel, setAsrModel] = useState('whisper-1')
  const [overlayOpacity, setOverlayOpacity] = useState(0.94)
  const [screenshotMode, setScreenshotMode] = useState<ScreenshotMode>('direct')
  const [screenshotPrompt, setScreenshotPrompt] = useState('')
  const [resume, setResume] = useState('')
  const [answerLang, setAnswerLang] = useState<AnswerLang>('zh')
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  useEffect(() => {
    window.electronAPI.getConfig().then((cfg) => {
      if (cfg.apiKey) setApiKey(cfg.apiKey)
      if (cfg.baseUrl) setBaseUrl(cfg.baseUrl)
      if (cfg.model) setModel(cfg.model)
      if (cfg.visionModel) setVisionModel(cfg.visionModel)
      if (cfg.asrApiKey) setAsrApiKey(cfg.asrApiKey)
      if (cfg.asrBaseUrl) setAsrBaseUrl(cfg.asrBaseUrl)
      if (cfg.asrModel) setAsrModel(cfg.asrModel)
      if (cfg.overlayOpacity !== undefined) setOverlayOpacity(cfg.overlayOpacity)
      if (cfg.screenshotMode) setScreenshotMode(cfg.screenshotMode)
      if (cfg.screenshotPrompt !== undefined) setScreenshotPrompt(cfg.screenshotPrompt)
      if (cfg.resume !== undefined) setResume(cfg.resume)
      if (cfg.answerLang === 'zh' || cfg.answerLang === 'en' || cfg.answerLang === 'auto')
        setAnswerLang(cfg.answerLang)
    })
  }, [])

  const save = () => {
    // Light validation so an obviously-broken config doesn't get a false '✓ 已保存'. Non-empty key
    // + well-formed URLs only — never gate on a live test (that would break editing offline).
    if (!apiKey.trim()) {
      setSaveErr('请填写 API Key')
      return
    }
    try {
      new URL(baseUrl)
    } catch {
      setSaveErr('Base URL 需形如 https://api.example.com')
      return
    }
    if (asrApiKey.trim()) {
      try {
        new URL(asrBaseUrl)
      } catch {
        setSaveErr('ASR Base URL 需形如 https://api.example.com')
        return
      }
    }
    setSaveErr('')
    window.electronAPI.setConfig({
      apiKey,
      baseUrl,
      model,
      visionModel,
      asrApiKey,
      asrBaseUrl,
      asrModel,
      overlayOpacity,
      screenshotMode,
      screenshotPrompt,
      resume,
      answerLang
    })
    setSaved(true)
    onSaved?.()
    setTimeout(() => setSaved(false), 2000)
  }

  return {
    apiKey, setApiKey,
    baseUrl, setBaseUrl,
    model, setModel,
    visionModel, setVisionModel,
    asrApiKey, setAsrApiKey,
    asrBaseUrl, setAsrBaseUrl,
    asrModel, setAsrModel,
    overlayOpacity, setOverlayOpacity,
    screenshotMode, setScreenshotMode,
    screenshotPrompt, setScreenshotPrompt,
    resume, setResume,
    answerLang, setAnswerLang,
    saved, saveErr, save
  }
}
