import { useEffect, useState } from 'react'
import { DEFAULTS, type ProviderProfile } from '../../../shared/config'
import { getKnownTextOnlyVisionModelError } from '../../../shared/vision-model'

type ScreenshotMode = 'direct' | 'ocr'
type AnswerLang = 'zh' | 'en' | 'auto'

export interface ProviderSelection {
  baseUrl: string
  model: string
}

function endpointKey(value: string): string {
  try {
    const url = new URL(value.trim())
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return value.trim().replace(/\/+$/, '').toLowerCase()
  }
}

function upsertProfile(profiles: ProviderProfile[], current: ProviderProfile): ProviderProfile[] {
  if (!current.baseUrl.trim() || !current.model.trim()) return profiles
  const key = endpointKey(current.baseUrl)
  return [
    { ...current, baseUrl: current.baseUrl.trim(), model: current.model.trim() },
    ...profiles.filter((profile) => endpointKey(profile.baseUrl) !== key)
  ].slice(0, 16)
}

function validUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost'
  } catch {
    return false
  }
}

export function useConfig(onSaved?: () => void) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [model, setModel] = useState('deepseek-chat')
  const [llmProviderProfiles, setLlmProviderProfiles] = useState<ProviderProfile[]>([])

  const [visionApiKey, setVisionApiKey] = useState('')
  const [visionBaseUrl, setVisionBaseUrl] = useState(DEFAULTS.vision.baseUrl)
  const [visionModel, setVisionModel] = useState(DEFAULTS.vision.model)
  const [visionProviderProfiles, setVisionProviderProfiles] = useState<ProviderProfile[]>([])

  const [asrApiKey, setAsrApiKey] = useState('')
  const [asrBaseUrl, setAsrBaseUrl] = useState('https://api.openai.com/v1')
  const [asrModel, setAsrModel] = useState('whisper-1')
  const [asrProviderProfiles, setAsrProviderProfiles] = useState<ProviderProfile[]>([])

  const [overlayOpacity, setOverlayOpacity] = useState(0.94)
  const [screenshotMode, setScreenshotMode] = useState<ScreenshotMode>('direct')
  const [screenshotPrompt, setScreenshotPrompt] = useState('')
  const [resume, setResume] = useState('')
  const [answerLang, setAnswerLang] = useState<AnswerLang>('zh')
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  useEffect(() => {
    window.electronAPI.getConfig().then((cfg) => {
      setApiKey(cfg.apiKey ?? '')
      setBaseUrl(cfg.baseUrl || 'https://api.deepseek.com')
      setModel(cfg.model || 'deepseek-chat')
      setLlmProviderProfiles(cfg.llmProviderProfiles ?? [])

      // Compatibility with old config files where screenshots shared text credentials.
      setVisionApiKey(cfg.visionApiKey ?? cfg.apiKey ?? '')
      setVisionBaseUrl(cfg.visionBaseUrl || cfg.baseUrl || DEFAULTS.vision.baseUrl)
      setVisionModel(cfg.visionModel || cfg.model || DEFAULTS.vision.model)
      setVisionProviderProfiles(cfg.visionProviderProfiles ?? [])

      setAsrApiKey(cfg.asrApiKey ?? '')
      setAsrBaseUrl(cfg.asrBaseUrl || 'https://api.openai.com/v1')
      setAsrModel(cfg.asrModel || 'whisper-1')
      setAsrProviderProfiles(cfg.asrProviderProfiles ?? [])
      if (cfg.overlayOpacity !== undefined) setOverlayOpacity(cfg.overlayOpacity)
      if (cfg.screenshotMode) setScreenshotMode(cfg.screenshotMode)
      if (cfg.screenshotPrompt !== undefined) setScreenshotPrompt(cfg.screenshotPrompt)
      if (cfg.resume !== undefined) setResume(cfg.resume)
      if (cfg.answerLang === 'zh' || cfg.answerLang === 'en' || cfg.answerLang === 'auto') {
        setAnswerLang(cfg.answerLang)
      }
    })
  }, [])

  const switchLlmProvider = (selection: ProviderSelection): void => {
    const profiles = upsertProfile(llmProviderProfiles, { apiKey, baseUrl, model })
    const target = profiles.find(
      (profile) => endpointKey(profile.baseUrl) === endpointKey(selection.baseUrl)
    )
    const next = {
      apiKey: target?.apiKey ?? '',
      baseUrl: selection.baseUrl,
      model: target?.model || selection.model
    }
    setLlmProviderProfiles(profiles)
    setApiKey(next.apiKey)
    setBaseUrl(next.baseUrl)
    setModel(next.model)
    window.electronAPI.setConfig({ ...next, llmProviderProfiles: profiles })
  }

  const switchVisionProvider = (selection: ProviderSelection): void => {
    const profiles = upsertProfile(visionProviderProfiles, {
      apiKey: visionApiKey,
      baseUrl: visionBaseUrl,
      model: visionModel
    })
    const target = profiles.find(
      (profile) => endpointKey(profile.baseUrl) === endpointKey(selection.baseUrl)
    )
    const next = {
      visionApiKey: target?.apiKey ?? '',
      visionBaseUrl: selection.baseUrl,
      visionModel: target?.model || selection.model
    }
    setVisionProviderProfiles(profiles)
    setVisionApiKey(next.visionApiKey)
    setVisionBaseUrl(next.visionBaseUrl)
    setVisionModel(next.visionModel)
    window.electronAPI.setConfig({ ...next, visionProviderProfiles: profiles })
  }

  const switchAsrProvider = (selection: ProviderSelection): void => {
    const profiles = upsertProfile(asrProviderProfiles, {
      apiKey: asrApiKey,
      baseUrl: asrBaseUrl,
      model: asrModel
    })
    const target = profiles.find(
      (profile) => endpointKey(profile.baseUrl) === endpointKey(selection.baseUrl)
    )
    const next = {
      asrApiKey: target?.apiKey ?? '',
      asrBaseUrl: selection.baseUrl,
      asrModel: target?.model || selection.model
    }
    setAsrProviderProfiles(profiles)
    setAsrApiKey(next.asrApiKey)
    setAsrBaseUrl(next.asrBaseUrl)
    setAsrModel(next.asrModel)
    window.electronAPI.setConfig({ ...next, asrProviderProfiles: profiles })
  }

  const save = (): void => {
    if (!apiKey.trim()) {
      setSaveErr('请填写文本 API Key')
      return
    }
    if (!validUrl(baseUrl)) {
      setSaveErr('文本 Base URL 需为 HTTPS 地址')
      return
    }
    if (!validUrl(visionBaseUrl)) {
      setSaveErr('视觉 Base URL 需为 HTTPS 地址')
      return
    }
    const visionModelError = getKnownTextOnlyVisionModelError(visionModel)
    if (visionModelError) {
      setSaveErr(visionModelError)
      return
    }
    if (!validUrl(asrBaseUrl)) {
      setSaveErr('音频 Base URL 需为 HTTPS 地址')
      return
    }

    const nextLlmProfiles = upsertProfile(llmProviderProfiles, { apiKey, baseUrl, model })
    const nextVisionProfiles = upsertProfile(visionProviderProfiles, {
      apiKey: visionApiKey,
      baseUrl: visionBaseUrl,
      model: visionModel
    })
    const nextAsrProfiles = upsertProfile(asrProviderProfiles, {
      apiKey: asrApiKey,
      baseUrl: asrBaseUrl,
      model: asrModel
    })
    setLlmProviderProfiles(nextLlmProfiles)
    setVisionProviderProfiles(nextVisionProfiles)
    setAsrProviderProfiles(nextAsrProfiles)
    setSaveErr('')
    window.electronAPI.setConfig({
      apiKey,
      baseUrl,
      model,
      llmProviderProfiles: nextLlmProfiles,
      visionApiKey,
      visionBaseUrl,
      visionModel,
      visionProviderProfiles: nextVisionProfiles,
      asrApiKey,
      asrBaseUrl,
      asrModel,
      asrProviderProfiles: nextAsrProfiles,
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
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    llmProviderProfiles,
    switchLlmProvider,
    visionApiKey,
    setVisionApiKey,
    visionBaseUrl,
    setVisionBaseUrl,
    visionModel,
    visionModelError: getKnownTextOnlyVisionModelError(visionModel),
    setVisionModel,
    visionProviderProfiles,
    switchVisionProvider,
    asrApiKey,
    setAsrApiKey,
    asrBaseUrl,
    setAsrBaseUrl,
    asrModel,
    setAsrModel,
    asrProviderProfiles,
    switchAsrProvider,
    overlayOpacity,
    setOverlayOpacity,
    screenshotMode,
    setScreenshotMode,
    screenshotPrompt,
    setScreenshotPrompt,
    resume,
    setResume,
    answerLang,
    setAnswerLang,
    saved,
    saveErr,
    save
  }
}
