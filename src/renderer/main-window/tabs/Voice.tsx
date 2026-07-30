import { useRef } from 'react'
import { useAsrCapture } from '../hooks/useAsrCapture'

export function VoiceTab({ active, onGoSettings }: { active: boolean; onGoSettings: () => void }) {
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const {
    listening,
    transcribing,
    asrConfigured,
    lang,
    setLang,
    draftText,
    setDraftText,
    error,
    devices,
    deviceId,
    setDeviceId,
    grantAndRefresh,
    sendToAI,
    looksLikeBtMic
  } = useAsrCapture(active)

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* ASR-not-configured pre-flight hint — clickable, jumps to Settings */}
      {!asrConfigured && (
        <div
          onClick={onGoSettings}
          className="rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.35)', color: '#fbbf24', cursor: 'pointer' }}
        >
          ⚠ 还没配置语音识别（ASR）Key，录音将无法转写。<strong>点此前往设置 → 语音识别</strong>。
        </div>
      )}

      {/* System-audio guidance */}
      <div className="rounded-lg px-3 py-2 text-xs leading-relaxed" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#7dd3fc' }}>
        💡 想让 AI 听到<strong>对方的声音</strong>：装 BlackHole 虚拟声卡 → 在「音频 MIDI 设置」建一个含 BlackHole 的「多输出设备」并设为系统输出 → 下面选 BlackHole。仅选麦克风只会录到你自己。按 fn⌃ 开始/停止。
        <br />🎧 <strong>用蓝牙耳机</strong>：把耳机也加进上面的「多输出设备」（照常从耳机听），并设非蓝牙设备为主、给蓝牙开「漂移校正」。采集仍选 <strong>BlackHole</strong>，<strong>别选蓝牙耳机的麦克风</strong>。
      </div>

      {/* Audio input device picker */}
      <div className="flex gap-2 items-center">
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="flex-1 rounded px-2 py-1.5 text-xs outline-none"
          style={{ background: '#0f0f1a', border: '1px solid #1e1e3a', color: '#94a3b8' }}
        >
          <option value="">默认输入设备（麦克风）</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `输入设备 ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
        <button
          onClick={grantAndRefresh}
          className="px-2 py-1.5 text-xs rounded flex-shrink-0"
          style={{ background: '#1e1e2e', color: '#64748b', border: '1px solid #2d2d44', cursor: 'pointer' }}
        >
          授权/刷新
        </button>
      </div>

      {/* Bluetooth-mic warning: selecting a BT headset mic forces HFP mode */}
      {looksLikeBtMic && (
        <div className="rounded-lg px-3 py-2 text-xs leading-relaxed" style={{ background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.35)', color: '#fbbf24' }}>
          ⚠ 这看起来是蓝牙耳机的麦克风。选它会让系统切到 HFP 模式——音质骤降、对方可能察觉。捕获对方声音请改选 <strong>BlackHole</strong>；只想录你自己建议用<strong>内建麦克风</strong>。
        </div>
      )}

      {/* Language selector */}
      <div className="flex gap-2">
        {(['zh-CN', 'en-US'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className="px-3 py-1 text-xs rounded transition-colors"
            style={{
              background: lang === l ? '#1d4ed8' : '#1e1e2e',
              color: lang === l ? '#bfdbfe' : '#475569',
              border: `1px solid ${lang === l ? '#3b82f6' : '#2d2d44'}`,
              cursor: 'pointer'
            }}
          >
            {l === 'zh-CN' ? '中文' : 'English'}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(120,20,20,0.4)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)' }}>
          ⚠ {error}
        </div>
      )}

      {/* Listening indicator */}
      <div
        className="w-full py-3 rounded-lg text-sm font-semibold text-center transition-all"
        style={{
          background: listening ? 'rgba(220,38,38,0.15)' : 'rgba(59,130,246,0.08)',
          color: listening ? '#f87171' : '#475569',
          border: `1px solid ${listening ? 'rgba(220,38,38,0.4)' : '#1e1e2e'}`,
        }}
      >
        {transcribing ? '⏳ 转写中…' : listening ? '● 录音中... 按 fn⌃ 停止' : '按 fn⌃ 开始录音'}
      </div>

      {/* Editable draft area */}
      <div className="flex flex-col flex-1 gap-2" style={{ minHeight: 0 }}>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: '#334155' }}>
            {listening ? '录音中…(停止后转写)' : draftText ? '转写完成 — 可编辑后发送' : '转写结果'}
          </span>
          <div className="flex gap-2">
            {draftText && (
              <button
                onClick={() => setDraftText('')}
                className="px-2 py-0.5 text-xs rounded"
                style={{ background: '#1e1e2e', color: '#475569', border: '1px solid #2d2d44', cursor: 'pointer' }}
              >
                清空
              </button>
            )}
          </div>
        </div>
        <textarea
          ref={draftRef}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          readOnly={listening}
          placeholder={transcribing ? '转写中…' : listening ? '录音中…停止后转写结果将出现在这里' : '按 fn⌃ 录音，转写结果将出现在这里...'}
          className="flex-1 rounded-lg p-3 text-xs leading-relaxed resize-none outline-none"
          style={{
            background: '#0a0a12',
            border: `1px solid ${listening ? 'rgba(220,38,38,0.3)' : '#1a1a2e'}`,
            color: '#e2e8f0',
            minHeight: 80,
          }}
        />
      </div>

      {/* Send button */}
      <button
        onClick={sendToAI}
        disabled={!draftText.trim()}
        className="w-full py-3 rounded-lg text-sm font-semibold transition-all"
        style={{
          background: draftText.trim() ? 'rgba(124,58,237,0.2)' : 'rgba(30,30,46,0.6)',
          color: draftText.trim() ? '#a78bfa' : '#334155',
          border: `1px solid ${draftText.trim() ? 'rgba(124,58,237,0.4)' : '#1e1e2e'}`,
          cursor: draftText.trim() ? 'pointer' : 'default',
        }}
      >
        发送到 AI
      </button>
    </div>
  )
}
