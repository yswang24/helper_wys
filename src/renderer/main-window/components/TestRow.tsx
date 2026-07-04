

export function TestRow({
  label,
  onTest,
  state
}: {
  label: string
  onTest: () => void
  state: { st: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }
}) {
  const color = state.st === 'ok' ? '#4ade80' : state.st === 'fail' ? '#f87171' : '#94a3b8'
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={onTest}
        disabled={state.st === 'testing'}
        className="px-3 py-1.5 text-xs rounded transition-colors flex-shrink-0"
        style={{
          background: '#13213a',
          color: '#7dd3fc',
          border: '1px solid #1e3a5f',
          cursor: state.st === 'testing' ? 'default' : 'pointer',
          opacity: state.st === 'testing' ? 0.6 : 1
        }}
      >
        {state.st === 'testing' ? '测试中…' : label}
      </button>
      {(state.st === 'ok' || state.st === 'fail') && state.msg && (
        <span className="text-xs" style={{ color }}>
          {state.st === 'ok' ? '✓ ' : '✗ '}
          {state.msg}
        </span>
      )}
    </div>
  )
}
