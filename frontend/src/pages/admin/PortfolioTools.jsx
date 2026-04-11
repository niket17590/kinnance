import { useState } from 'react'
import api from '../../services/api'

const TOOLS = [
  {
    id: 'rename-stock',
    label: 'Rename Stock',
    description: 'Change a stock ticker symbol across all transactions and holdings',
    icon: (
      <svg viewBox="0 0 18 18" fill="none" width="16" height="16">
        <path d="M2 9h10M8 5l4 4-4 4" stroke="currentColor" strokeWidth="1.4"
          strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 4v10" stroke="currentColor" strokeWidth="1.4"
          strokeLinecap="round" />
      </svg>
    ),
  },
]


// ============================================================
// RENAME STOCK TOOL
// Three states: form → verifying → confirmed → done
// ============================================================
function RenameStockTool() {
  const [securities, setSecurities] = useState([])
  const [securitiesLoaded, setSecuritiesLoaded] = useState(false)

  const [oldSymbol, setOldSymbol] = useState('')
  const [newSymbolInput, setNewSymbolInput] = useState('')

  // verify result
  const [verification, setVerification] = useState(null)  // null | data
  const [verifying, setVerifying] = useState(false)

  // rename result
  const [renameResult, setRenameResult] = useState(null)
  const [renaming, setRenaming] = useState(false)

  const [error, setError] = useState('')

  const loadSecurities = async () => {
    if (securitiesLoaded) return
    try {
      const res = await api.get('/admin/securities')
      setSecurities(res.data.filter(s => s.is_active))
      setSecuritiesLoaded(true)
    } catch {
      setError('Failed to load securities')
    }
  }

  const handleVerify = async () => {
    if (!oldSymbol || !newSymbolInput.trim()) {
      setError('Please select a current symbol and enter a new symbol')
      return
    }
    setVerifying(true)
    setError('')
    setVerification(null)
    try {
      const res = await api.post('/admin/securities/verify-rename', {
        old_symbol: oldSymbol,
        new_symbol_input: newSymbolInput.trim()
      })
      setVerification(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not verify symbol — check the ticker')
    } finally {
      setVerifying(false)
    }
  }

  const handleConfirmRename = async () => {
    if (!verification) return
    setRenaming(true)
    setError('')
    try {
      const res = await api.post('/admin/securities/rename', {
        old_symbol: verification.old_symbol,
        new_symbol: verification.new_symbol.symbol
      })
      setRenameResult(res.data)
      setVerification(null)
    } catch (err) {
      setError(err.response?.data?.detail || 'Rename failed')
    } finally {
      setRenaming(false)
    }
  }

  const handleReset = () => {
    setOldSymbol('')
    setNewSymbolInput('')
    setVerification(null)
    setRenameResult(null)
    setError('')
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px',
    borderRadius: '8px', border: '1.5px solid var(--card-border)',
    background: 'white', fontSize: '13px',
    color: 'var(--text-primary)', outline: 'none',
    boxSizing: 'border-box',
  }

  const formatCurrency = (amount, currency) => {
    if (!amount) return '—'
    const sym = currency === 'CAD' ? 'C$' : '$'
    return `${sym}${parseFloat(amount).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatQty = (qty) => {
    if (!qty) return '0'
    const n = parseFloat(qty)
    return n % 1 === 0 ? n.toLocaleString() : n.toFixed(4)
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '6px' }}>
          Rename Stock
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          Use this when a company changes its ticker symbol after a merger or rebranding.
          Enter the new symbol and we'll verify it before making any changes.
        </p>
      </div>

      {/* ── Success state ── */}
      {renameResult && (
        <div>
          <div style={{
            background: '#DCFCE7', border: '1px solid #BBF7D0',
            borderRadius: '12px', padding: '20px 24px', marginBottom: '20px'
          }}>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#14532D', marginBottom: '12px' }}>
              ✅ Rename complete
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                ['Renamed', `${renameResult.old_symbol} → ${renameResult.new_symbol}`],
                ['Transactions updated', renameResult.transactions_updated],
                ['Accounts recalculated', renameResult.accounts_recalculated],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontWeight: '600', color: '#14532D' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={handleReset}
            style={{
              padding: '10px 20px', borderRadius: '8px',
              border: '1.5px solid var(--card-border)',
              background: 'white', color: 'var(--text-primary)',
              fontSize: '13px', fontWeight: '600', cursor: 'pointer'
            }}
          >
            Rename another stock
          </button>
        </div>
      )}

      {/* ── Form + verification ── */}
      {!renameResult && (
        <div style={{ maxWidth: '500px' }}>

          {/* Input form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>

            {/* Old symbol dropdown */}
            <div>
              <label style={{
                display: 'block', fontSize: '12px', fontWeight: '600',
                color: 'var(--text-primary)', marginBottom: '6px'
              }}>
                Current symbol
              </label>
              <select
                value={oldSymbol}
                onChange={e => { setOldSymbol(e.target.value); setVerification(null); setError('') }}
                onFocus={loadSecurities}
                disabled={!!verification}
                style={{ ...inputStyle, opacity: verification ? 0.6 : 1 }}
              >
                <option value="">Select current symbol</option>
                {securities.map(s => (
                  <option key={s.symbol} value={s.symbol}>
                    {s.symbol}{s.name ? ` — ${s.name}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* New symbol input */}
            <div>
              <label style={{
                display: 'block', fontSize: '12px', fontWeight: '600',
                color: 'var(--text-primary)', marginBottom: '6px'
              }}>
                New symbol
              </label>
              <input
                type="text"
                value={newSymbolInput}
                onChange={e => { setNewSymbolInput(e.target.value.toUpperCase()); setVerification(null); setError('') }}
                placeholder="e.g. QESS or QESS.CN"
                disabled={!!verification}
                style={{ ...inputStyle, opacity: verification ? 0.6 : 1 }}
              />
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                You can enter a bare ticker (e.g. QESS) — we'll resolve the exchange automatically
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: '#FEE2E2', border: '1px solid #FECACA',
                borderRadius: '8px', padding: '10px 14px',
                fontSize: '13px', color: '#DC2626'
              }}>
                {error}
              </div>
            )}

            {/* Verify button */}
            {!verification && (
              <button
                onClick={handleVerify}
                disabled={verifying || !oldSymbol || !newSymbolInput.trim()}
                style={{
                  padding: '11px', borderRadius: '8px',
                  border: 'none', background: 'var(--sidebar-bg)',
                  color: 'white', fontSize: '13px', fontWeight: '600',
                  cursor: (verifying || !oldSymbol || !newSymbolInput.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (verifying || !oldSymbol || !newSymbolInput.trim()) ? 0.6 : 1,
                }}
              >
                {verifying ? 'Verifying...' : 'Verify →'}
              </button>
            )}
          </div>

          {/* ── Verification result + confirm ── */}
          {verification && (
            <div>
              {/* Stock found card */}
              <div style={{
                background: 'var(--content-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: '12px', padding: '20px',
                marginBottom: '16px'
              }}>
                {/* New stock info */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  paddingBottom: '16px', marginBottom: '16px',
                  borderBottom: '1px solid var(--card-border)'
                }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px',
                    background: 'var(--accent-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '18px', flexShrink: 0
                  }}>
                    📈
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {verification.new_symbol.symbol}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {verification.new_symbol.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {[
                        verification.new_symbol.exchange,
                        verification.new_symbol.country,
                        verification.new_symbol.currency
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{
                    marginLeft: 'auto',
                    background: '#DCFCE7', color: '#14532D',
                    fontSize: '11px', fontWeight: '700',
                    padding: '3px 10px', borderRadius: '20px'
                  }}>
                    ✓ Found
                  </div>
                </div>

                {/* Impact summary */}
                <div style={{
                  fontSize: '12px', fontWeight: '700',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: 'var(--text-secondary)', marginBottom: '12px'
                }}>
                  What will change
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Rename arrow */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 12px', borderRadius: '8px',
                    background: 'var(--card-bg)', border: '1px solid var(--card-border)'
                  }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                      {verification.old_symbol}
                    </span>
                    <svg viewBox="0 0 18 10" fill="none" width="24" height="14">
                      <path d="M1 5h14M11 1l4 4-4 4" stroke="var(--text-secondary)" strokeWidth="1.4"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--accent-dark)' }}>
                      {verification.new_symbol.symbol}
                    </span>
                  </div>

                  {/* Impact numbers */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr',
                    gap: '8px', marginTop: '4px'
                  }}>
                    {[
                      ['Transactions', verification.impact.transaction_count],
                      ['Accounts affected', verification.impact.account_count],
                      verification.impact.total_quantity > 0
                        ? ['Shares held', formatQty(verification.impact.total_quantity)]
                        : null,
                      verification.impact.total_market_value > 0
                        ? ['Current value', formatCurrency(verification.impact.total_market_value, verification.impact.currency)]
                        : null,
                    ].filter(Boolean).map(([label, value]) => (
                      <div key={label} style={{
                        padding: '10px 12px', borderRadius: '8px',
                        background: 'var(--card-bg)', border: '1px solid var(--card-border)'
                      }}>
                        <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                          {label}
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleReset}
                  style={{
                    flex: 1, padding: '11px', borderRadius: '8px',
                    border: '1.5px solid var(--card-border)',
                    background: 'white', color: 'var(--text-primary)',
                    fontSize: '13px', fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  ← Cancel
                </button>
                <button
                  onClick={handleConfirmRename}
                  disabled={renaming}
                  style={{
                    flex: 2, padding: '11px', borderRadius: '8px',
                    border: 'none', background: 'var(--sidebar-bg)',
                    color: 'white', fontSize: '13px', fontWeight: '600',
                    cursor: renaming ? 'not-allowed' : 'pointer',
                    opacity: renaming ? 0.7 : 1,
                  }}
                >
                  {renaming ? 'Renaming...' : `Confirm — Rename to ${verification.new_symbol.symbol} →`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ============================================================
// TOOL RENDERER
// ============================================================
function ToolPanel({ toolId }) {
  switch (toolId) {
    case 'rename-stock': return <RenameStockTool />
    default: return (
      <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>
        Select a tool from the left panel
      </div>
    )
  }
}


// ============================================================
// MAIN PAGE
// ============================================================
function PortfolioTools() {
  const [activeTool, setActiveTool] = useState(TOOLS[0].id)

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
          Portfolio Tools
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Administrative tools for managing your portfolio data
        </p>
      </div>

      <div style={{
        display: 'flex', gap: '0',
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: '16px', overflow: 'hidden',
        minHeight: '500px'
      }}>
        {/* Left panel */}
        <div style={{
          width: '220px', flexShrink: 0,
          borderRight: '1px solid var(--card-border)',
          padding: '16px 0',
          background: 'var(--content-bg)'
        }}>
          <div style={{
            fontSize: '10px', fontWeight: '700',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--text-secondary)',
            padding: '0 16px', marginBottom: '8px'
          }}>
            Available Tools
          </div>

          {TOOLS.map(tool => {
            const active = activeTool === tool.id
            return (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool.id)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '10px 16px',
                  border: 'none', background: active ? 'var(--card-bg)' : 'transparent',
                  borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  transition: 'all 0.1s'
                }}
              >
                <span style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)', flexShrink: 0, marginTop: '1px' }}>
                  {tool.icon}
                </span>
                <div>
                  <div style={{
                    fontSize: '13px', fontWeight: active ? '600' : '400',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)'
                  }}>
                    {tool.label}
                  </div>
                  <div style={{
                    fontSize: '11px', color: 'var(--text-secondary)',
                    lineHeight: '1.4', marginTop: '2px'
                  }}>
                    {tool.description}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Right panel */}
        <div style={{ flex: 1, padding: '28px', overflowY: 'auto' }}>
          <ToolPanel toolId={activeTool} />
        </div>
      </div>
    </div>
  )
}

export default PortfolioTools
