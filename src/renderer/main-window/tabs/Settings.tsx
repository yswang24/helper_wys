import { Field } from '../components/Field'
import { TestRow } from '../components/TestRow'
import { useServiceTest } from '../hooks/useServiceTest'
import { useConfig } from '../hooks/useConfig'

const TEXT_PRESETS = [
  {
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct'
  },
  {
    label: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.5-omni-plus'
  },
  {
    label: '小米 MiMo Token Plan',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro'
  }
] as const

const VISION_PRESETS = [
  {
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2-VL-7B-Instruct'
  },
  {
    label: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.5-omni-plus'
  },
  {
    label: '小米 MiMo Token Plan',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    model: 'mimo-v2.5'
  }
] as const

const AUDIO_PRESETS = [
  {
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall'
  },
  {
    label: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-asr-flash'
  },
  {
    label: '小米 MiMo Token Plan',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    model: 'mimo-v2.5-asr'
  }
] as const

export function SettingsTab({ onSaved }: { onSaved?: () => void }) {
  const {
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    switchLlmProvider,
    visionApiKey,
    setVisionApiKey,
    visionBaseUrl,
    setVisionBaseUrl,
    visionModel,
    setVisionModel,
    switchVisionProvider,
    asrApiKey,
    setAsrApiKey,
    asrBaseUrl,
    setAsrBaseUrl,
    asrModel,
    setAsrModel,
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
  } = useConfig(onSaved)
  const { llmTest, visionTest, asrTest, testLlm, testVision, testAsr } = useServiceTest({
    apiKey,
    baseUrl,
    model,
    visionApiKey,
    visionBaseUrl,
    visionModel,
    asrApiKey,
    asrBaseUrl,
    asrModel
  })

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
          {(
            [
              ['direct', '直接解答（快）'],
              ['ocr', '先识别可编辑']
            ] as ['direct' | 'ocr', string][]
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => {
                setScreenshotMode(m)
                window.electronAPI.setConfig({ screenshotMode: m })
              }}
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
              onBlur={(e) => {
                e.target.style.borderColor = '#1e1e3a'
                window.electronAPI.setConfig({ screenshotPrompt })
              }}
              placeholder="例如：分析并解答图片中的题目，先给出思路，再给出实现，优先 LeetCode 风格"
              rows={3}
              spellCheck={false}
              className="w-full rounded-lg px-3 py-2 text-xs resize-none outline-none transition-colors"
              style={{
                background: '#0f0f1a',
                border: '1px solid #1e1e3a',
                color: '#e2e8f0',
                lineHeight: '1.6',
                fontFamily: 'inherit'
              }}
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
          {(
            [
              ['zh', '中文'],
              ['en', 'English'],
              ['auto', '跟随提问']
            ] as ['zh' | 'en' | 'auto', string][]
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => {
                setAnswerLang(m)
                window.electronAPI.setConfig({ answerLang: m })
              }}
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
          粘贴技术栈、项目经历、目标级别等。AI
          回答"做过什么项目"这类个人问题时会以第一人称贴合这份背景，而不是编标准答案。
        </div>
        <textarea
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          onBlur={(e) => {
            e.target.style.borderColor = '#1e1e3a'
            window.electronAPI.setConfig({ resume })
          }}
          placeholder="例如：5 年后端，主做 Go/K8s；负责过日均 10 亿请求的网关系统，主导过一次跨机房容灾演练…"
          rows={5}
          spellCheck={false}
          className="w-full rounded-lg px-3 py-2 text-xs resize-y outline-none transition-colors"
          style={{
            background: '#0f0f1a',
            border: '1px solid #1e1e3a',
            color: '#e2e8f0',
            lineHeight: '1.6',
            fontFamily: 'inherit'
          }}
          onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
        />
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1e1e2e' }} />

      {/* Text model */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#3b82f6' }}>
        文本模型
      </div>
      <Field
        label="文本 API Key"
        hint="仅用于文字和语音提问后的文本回答"
        type="password"
        value={apiKey}
        onChange={setApiKey}
        placeholder="sk-..."
      />
      <Field
        label="文本 Base URL"
        hint="文本模型的 OpenAI 兼容 API 地址"
        value={baseUrl}
        onChange={setBaseUrl}
        placeholder="https://api.deepseek.com"
      />
      <Field
        label="文本模型"
        hint="语音/文字问答使用的模型"
        value={model}
        onChange={setModel}
        placeholder="deepseek-chat"
      />
      <div>
        <div className="text-xs mb-2" style={{ color: '#475569' }}>
          文本快速切换
        </div>
        <div className="flex gap-2 flex-wrap">
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => switchLlmProvider(preset)}
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{
                background: '#1e1e2e',
                color: '#64748b',
                border: '1px solid #2d2d44',
                cursor: 'pointer'
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <TestRow label="测试文本模型" onTest={testLlm} state={llmTest} />

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1e1e2e' }} />

      {/* Vision model */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#ec4899' }}>
        视频 / 视觉模型
      </div>
      <Field
        label="视觉 API Key"
        hint="仅用于截图识别和图片解题，不与文本模型共用"
        type="password"
        value={visionApiKey}
        onChange={setVisionApiKey}
        placeholder="输入视觉供应商的 API Key"
      />
      <Field
        label="视觉 Base URL"
        hint="视觉模型的 OpenAI 兼容 API 地址"
        value={visionBaseUrl}
        onChange={setVisionBaseUrl}
        placeholder="https://api.siliconflow.cn/v1"
      />
      <Field
        label="视觉模型"
        hint="支持图像输入，用于 ⌘⌥S 框选和 fn⇧ 全屏直发"
        value={visionModel}
        onChange={setVisionModel}
        placeholder="Qwen/Qwen2-VL-7B-Instruct"
      />
      <div>
        <div className="text-xs mb-2" style={{ color: '#475569' }}>
          视觉快速切换
        </div>
        <div className="flex gap-2 flex-wrap">
          {VISION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => switchVisionProvider(preset)}
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{
                background: '#1e1e2e',
                color: '#64748b',
                border: '1px solid #2d2d44',
                cursor: 'pointer'
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <TestRow label="测试视觉模型" onTest={testVision} state={visionTest} />

      <div style={{ borderTop: '1px solid #1e1e2e' }} />

      {/* Audio model */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#7c3aed' }}>
        音频模型（语音识别 ASR）
      </div>
      <Field
        label="音频 API Key"
        hint="当前语音供应商的密钥；切换供应商时会分别保存"
        type="password"
        value={asrApiKey}
        onChange={setAsrApiKey}
        placeholder="输入当前语音供应商的 API Key"
      />
      <Field
        label="音频 Base URL"
        hint="语音服务的 OpenAI 兼容 API 地址"
        value={asrBaseUrl}
        onChange={setAsrBaseUrl}
        placeholder="https://api.siliconflow.cn/v1"
      />
      <Field
        label="音频模型"
        hint="语音转文字模型名称"
        value={asrModel}
        onChange={setAsrModel}
        placeholder="FunAudioLLM/SenseVoiceSmall"
      />
      <div>
        <div className="text-xs mb-2" style={{ color: '#475569' }}>
          音频快速切换
        </div>
        <div className="flex gap-2 flex-wrap">
          {AUDIO_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => switchAsrProvider(preset)}
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{
                background: '#1e1e2e',
                color: '#64748b',
                border: '1px solid #2d2d44',
                cursor: 'pointer'
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <TestRow label="测试音频模型" onTest={testAsr} state={asrTest} />

      <button
        onClick={save}
        className="px-4 py-2 text-sm rounded-lg font-medium mt-2 transition-colors"
        style={{
          background: saved ? '#16a34a' : '#3b82f6',
          color: '#fff',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        {saved ? '✓ 已保存' : '保存设置'}
      </button>
      {saveErr && (
        <div className="text-xs" style={{ color: '#f87171' }}>
          ✗ {saveErr}
        </div>
      )}
    </div>
  )
}
