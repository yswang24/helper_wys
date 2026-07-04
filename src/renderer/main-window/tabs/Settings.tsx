import { useState, useEffect } from 'react'
import { Field } from '../components/Field'
import { TestRow } from '../components/TestRow'
import { useServiceTest } from '../hooks/useServiceTest'

export function SettingsTab({ onSaved }: { onSaved?: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [model, setModel] = useState('deepseek-chat')
  const [visionModel, setVisionModel] = useState('deepseek-chat')
  const [asrApiKey, setAsrApiKey] = useState('')
  const [asrBaseUrl, setAsrBaseUrl] = useState('https://api.openai.com/v1')
  const [asrModel, setAsrModel] = useState('whisper-1')
  const [overlayOpacity, setOverlayOpacity] = useState(0.94)
  const [screenshotMode, setScreenshotMode] = useState<'direct' | 'ocr'>('direct')
  const [screenshotPrompt, setScreenshotPrompt] = useState('')
  const [resume, setResume] = useState('')
  const [answerLang, setAnswerLang] = useState<'zh' | 'en' | 'auto'>('zh')
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const { llmTest, visionTest, asrTest, testLlm, testVision, testAsr } = useServiceTest({
    apiKey,
    baseUrl,
    model,
    visionModel,
    asrApiKey,
    asrBaseUrl,
    asrModel
  })

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
      if (cfg.answerLang === 'zh' || cfg.answerLang === 'en' || cfg.answerLang === 'auto') setAnswerLang(cfg.answerLang)
    })
  }, [])

  const save = () => {
    // Light validation so an obviously-broken config doesn't get a false '✓ 已保存'. Non-empty key
    // + well-formed URLs only — never gate on a live test (that would break editing offline).
    if (!apiKey.trim()) { setSaveErr('请填写 API Key'); return }
    try { new URL(baseUrl) } catch { setSaveErr('Base URL 需形如 https://api.example.com'); return }
    if (asrApiKey.trim()) { try { new URL(asrBaseUrl) } catch { setSaveErr('ASR Base URL 需形如 https://api.example.com'); return } }
    setSaveErr('')
    window.electronAPI.setConfig({ apiKey, baseUrl, model, visionModel, asrApiKey, asrBaseUrl, asrModel, overlayOpacity, screenshotMode, screenshotPrompt, resume, answerLang })
    setSaved(true)
    onSaved?.()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
      {/* Overlay appearance */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#3b82f6' }}>
        悬浮窗外观
      </div>
      <div>
        <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
          背景透明度
        </label>
        <div className="text-xs mb-1.5" style={{ color: '#334155' }}>
          调节覆盖层背景透明度（{Math.round(overlayOpacity * 100)}%）
        </div>
        <input
          type="range"
          min={0.3}
          max={0.99}
          step={0.01}
          value={overlayOpacity}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setOverlayOpacity(v)
            window.electronAPI.setConfig({ overlayOpacity: v })
          }}
          className="w-full"
          style={{ accentColor: '#3b82f6' }}
        />
      </div>

      {/* Screenshot mode */}
      <div>
        <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
          截图解题模式（⌘⌥S）
        </label>
        <div className="text-xs mb-1.5" style={{ color: '#334155' }}>
          {screenshotMode === 'direct'
            ? '直接解答：视觉模型一次调用直接流式给出答案，最快'
            : '先识别：先 OCR 出可编辑文字，确认/纠错后再发给 AI'}
        </div>
        <div className="flex gap-2">
          {([['direct', '直接解答（快）'], ['ocr', '先识别可编辑']] as ['direct' | 'ocr', string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => { setScreenshotMode(m); window.electronAPI.setConfig({ screenshotMode: m }) }}
              className="px-3 py-1 text-xs rounded transition-colors"
              style={{
                background: screenshotMode === m ? '#1d4ed8' : '#1e1e2e',
                color: screenshotMode === m ? '#bfdbfe' : '#475569',
                border: `1px solid ${screenshotMode === m ? '#3b82f6' : '#2d2d44'}`,
                cursor: 'pointer'
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom prompt for direct-solve mode — sent with the image to the vision model */}
        {screenshotMode === 'direct' && (
          <div className="mt-2">
            <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
              截图解答 Prompt（随图片发给视觉模型）
            </label>
            <div className="text-xs mb-1.5" style={{ color: '#334155' }}>
              留空则用默认指令。可自定义解题风格。
            </div>
            <textarea
              value={screenshotPrompt}
              onChange={(e) => setScreenshotPrompt(e.target.value)}
              onBlur={(e) => { e.target.style.borderColor = '#1e1e3a'; window.electronAPI.setConfig({ screenshotPrompt }) }}
              placeholder="例如：分析并解答图片中的题目，先给出思路，再给出实现，优先 LeetCode 风格"
              rows={3}
              spellCheck={false}
              className="w-full rounded-lg px-3 py-2 text-xs resize-none outline-none transition-colors"
              style={{ background: '#0f0f1a', border: '1px solid #1e1e3a', color: '#e2e8f0', lineHeight: '1.6', fontFamily: 'inherit' }}
              onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
            />
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1e1e2e' }} />

      {/* Answer personalization: language + candidate background */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#34d399' }}>
        回答个性化
      </div>
      <div>
        <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
          回答语言
        </label>
        <div className="text-xs mb-1.5" style={{ color: '#334155' }}>
          {answerLang === 'zh'
            ? '固定用中文回答（默认）'
            : answerLang === 'en'
              ? '固定用英文回答 — 英文面试选这个'
              : '跟随提问语言：中文题中文答、英文题英文答'}
        </div>
        <div className="flex gap-2">
          {([['zh', '中文'], ['en', 'English'], ['auto', '跟随提问']] as ['zh' | 'en' | 'auto', string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => { setAnswerLang(m); window.electronAPI.setConfig({ answerLang: m }) }}
              className="px-3 py-1 text-xs rounded transition-colors"
              style={{
                background: answerLang === m ? '#1d4ed8' : '#1e1e2e',
                color: answerLang === m ? '#bfdbfe' : '#475569',
                border: `1px solid ${answerLang === m ? '#3b82f6' : '#2d2d44'}`,
                cursor: 'pointer'
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
          个人背景 / 简历要点（可选）
        </label>
        <div className="text-xs mb-1.5" style={{ color: '#334155' }}>
          粘贴技术栈、项目经历、目标级别等。AI 回答"做过什么项目"这类个人问题时会以第一人称贴合这份背景，而不是编标准答案。
        </div>
        <textarea
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          onBlur={(e) => { e.target.style.borderColor = '#1e1e3a'; window.electronAPI.setConfig({ resume }) }}
          placeholder="例如：5 年后端，主做 Go/K8s；负责过日均 10 亿请求的网关系统，主导过一次跨机房容灾演练…"
          rows={5}
          spellCheck={false}
          className="w-full rounded-lg px-3 py-2 text-xs resize-y outline-none transition-colors"
          style={{ background: '#0f0f1a', border: '1px solid #1e1e3a', color: '#e2e8f0', lineHeight: '1.6', fontFamily: 'inherit' }}
          onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
        />
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1e1e2e' }} />

      {/* LLM section */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#3b82f6' }}>
        AI 问答（LLM）
      </div>
      <Field
        label="API Key"
        hint="DeepSeek / OpenAI 兼容服务的密钥"
        type="password"
        value={apiKey}
        onChange={setApiKey}
        placeholder="sk-..."
      />
      <Field
        label="Base URL"
        hint="API 地址，默认 DeepSeek"
        value={baseUrl}
        onChange={setBaseUrl}
        placeholder="https://api.deepseek.com"
      />
      <Field
        label="问答模型"
        hint="语音/文字问答使用的模型"
        value={model}
        onChange={setModel}
        placeholder="deepseek-chat"
      />
      <Field
        label="视觉模型（截图解题）"
        hint="支持图像输入的模型，用于 ⌘⌥S 截图模式"
        value={visionModel}
        onChange={setVisionModel}
        placeholder="gpt-4o / deepseek-vl2"
      />

      {/* LLM preset shortcuts */}
      <div>
        <div className="text-xs mb-2" style={{ color: '#475569' }}>LLM 快速切换</div>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'DeepSeek Chat', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', visionModel: 'deepseek-chat' },
            { label: 'DeepSeek Coder', baseUrl: 'https://api.deepseek.com', model: 'deepseek-coder', visionModel: 'deepseek-chat' },
            { label: 'Qwen Plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-plus' },
            { label: 'GPT-4o', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', visionModel: 'gpt-4o' },
            { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', visionModel: 'Qwen/Qwen2-VL-7B-Instruct' }
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => { setBaseUrl(p.baseUrl); setModel(p.model); setVisionModel(p.visionModel) }}
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{ background: '#1e1e2e', color: '#64748b', border: '1px solid #2d2d44', cursor: 'pointer' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <TestRow label="测试问答模型" onTest={testLlm} state={llmTest} />
      <TestRow label="测试视觉模型" onTest={testVision} state={visionTest} />

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1e1e2e' }} />

      {/* ASR section */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#7c3aed' }}>
        语音识别（系统音频 ASR）
      </div>
      <Field
        label="ASR API Key"
        hint="Whisper 兼容服务密钥。推荐 Groq（免费额度大）"
        type="password"
        value={asrApiKey}
        onChange={setAsrApiKey}
        placeholder="gsk_... 或 sk-..."
      />
      <Field
        label="ASR Base URL"
        hint="Whisper API 地址"
        value={asrBaseUrl}
        onChange={setAsrBaseUrl}
        placeholder="https://api.groq.com/openai/v1"
      />
      <Field
        label="ASR 模型"
        hint="Whisper 模型名称"
        value={asrModel}
        onChange={setAsrModel}
        placeholder="whisper-large-v3"
      />

      {/* ASR preset shortcuts */}
      <div>
        <div className="text-xs mb-2" style={{ color: '#475569' }}>ASR 快速切换</div>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'Groq (免费)', asrBaseUrl: 'https://api.groq.com/openai/v1', asrModel: 'whisper-large-v3' },
            { label: 'OpenAI Whisper', asrBaseUrl: 'https://api.openai.com/v1', asrModel: 'whisper-1' },
            { label: '硅基流动', asrBaseUrl: 'https://api.siliconflow.cn/v1', asrModel: 'FunAudioLLM/SenseVoiceSmall' },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => { setAsrBaseUrl(p.asrBaseUrl); setAsrModel(p.asrModel) }}
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{ background: '#1e1e2e', color: '#64748b', border: '1px solid #2d2d44', cursor: 'pointer' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <TestRow label="测试 ASR 连接" onTest={testAsr} state={asrTest} />

      <button
        onClick={save}
        className="px-4 py-2 text-sm rounded-lg font-medium mt-2 transition-colors"
        style={{ background: saved ? '#16a34a' : '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer' }}
      >
        {saved ? '✓ 已保存' : '保存设置'}
      </button>
      {saveErr && (
        <div className="text-xs" style={{ color: '#f87171' }}>✗ {saveErr}</div>
      )}
    </div>
  )
}
