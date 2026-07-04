

export function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text'
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: string
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
        {label}
      </label>
      <div className="text-xs mb-1.5" style={{ color: '#334155' }}>{hint}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-xs outline-none transition-colors"
        style={{
          background: '#0f0f1a',
          border: '1px solid #1e1e3a',
          color: '#e2e8f0',
          fontFamily: type === 'text' ? 'inherit' : 'monospace'
        }}
        onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
        onBlur={(e) => (e.target.style.borderColor = '#1e1e3a')}
      />
    </div>
  )
}
