import { useState, useCallback, useEffect } from 'react'
import api from '../services/api'
import { useFilters } from '../context/FilterContext'

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt = (n, decimals = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-CA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

const fmtCurrency = (n) => {
  if (n == null) return '—'
  return `$${fmt(Math.abs(n))}`
}

const fmtShares = (n) => {
  if (n == null) return '—'
  const num = Number(n)
  return num % 1 === 0 ? num.toLocaleString() : num.toFixed(4)
}

// ── Sort logic ─────────────────────────────────────────────────────────────

const SORT_KEYS = {
  symbol:           p => p.symbol,
  qty:              p => p.quantity_total ?? 0,
  acb_per_share:    p => p.acbPerShare ?? 0,
  current_price:    p => p.current_price ?? 0,
  market_value:     p => p.market_value ?? 0,
  current_pct:      p => p.current_weight_pct ?? 0,
  target_pct:       p => p.target_weight_pct ?? 0,
  weight_bar:       p => (p.target_weight_pct ?? 0) - (p.current_weight_pct ?? 0), // diff
  target_value:     p => p.target_value ?? 0,
  action_shares:    p => p.diff != null && p.current_price ? p.diff / p.current_price : 0,
}

function sortPositions(positions, key, dir) {
  if (!key) return positions
  const getter = SORT_KEYS[key]
  return [...positions].sort((a, b) => {
    const av = getter(a)
    const bv = getter(b)
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return dir === 'asc' ? av - bv : bv - av
  })
}

// ── Sortable column header ─────────────────────────────────────────────────

function SortTh({ label, sortKey, currentKey, currentDir, onSort, align = 'right', style: extraStyle = {} }) {
  const active = currentKey === sortKey
  const handleClick = () => onSort(sortKey)

  return (
    <th
      onClick={handleClick}
      style={{
        padding: '9px 12px', fontSize: '10px', fontWeight: '700',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        color: active ? 'var(--accent-dark)' : 'var(--text-secondary)',
        background: active ? 'var(--accent-light)' : 'var(--content-bg)',
        whiteSpace: 'nowrap', borderBottom: '2px solid var(--card-border)',
        textAlign: align, cursor: 'pointer', userSelect: 'none',
        transition: 'color 0.15s, background 0.15s',
        ...extraStyle,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: align === 'left' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end' }}>
        {label}
        <span style={{ fontSize: '9px', opacity: active ? 1 : 0.35, color: active ? 'var(--accent-dark)' : 'inherit' }}>
          {active ? (currentDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}

// ── Weight Input — optimistic, inline error, no page reset ─────────────────

function WeightInput({ symbol, circleId, value, totalOtherWeight, onChange }) {
  const [localVal, setLocalVal] = useState(value == null ? '' : String(value))
  const [inlineError, setInlineError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLocalVal(value == null ? '' : String(value))
  }, [value])

  const tryCommit = async (raw) => {
    const num = parseFloat(raw)
    if (raw === '' || isNaN(num)) {
      setLocalVal(String(value ?? 0))
      setInlineError('')
      return
    }
    if (num < 0 || num > 100) {
      setInlineError('Must be 0–100')
      return
    }
    const newTotal = totalOtherWeight + num
    if (newTotal > 100) {
      setInlineError(`Total ${newTotal.toFixed(1)}% — over 100%`)
      return
    }
    setInlineError('')
    onChange(symbol, num)
    setSaving(true)
    try {
      await api.put(`/rebalancer/${circleId}/${symbol}`, { target_weight_pct: num })
    } catch (err) {
      const msg = err.response?.data?.detail || 'Save failed'
      setInlineError(msg.length > 30 ? 'Save failed' : msg)
      onChange(symbol, value ?? 0)
    } finally {
      setSaving(false)
    }
  }

  const borderColor = inlineError ? '#FECACA' : saving ? 'var(--accent)' : 'var(--card-border)'
  const bgColor = inlineError ? '#FEF2F2' : saving ? 'var(--accent-light)' : 'white'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
        <input
          type="number" min="0" max="100" step="0.5"
          value={localVal}
          onChange={e => { setLocalVal(e.target.value); setInlineError('') }}
          onBlur={e => tryCommit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          style={{
            width: '54px', padding: '5px 7px', borderRadius: '6px',
            fontSize: '13px', fontWeight: '600',
            border: `1.5px solid ${borderColor}`,
            background: bgColor,
            color: 'var(--text-primary)', outline: 'none',
            textAlign: 'right', transition: 'border-color 0.15s',
          }}
        />
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>%</span>
      </div>
      {inlineError && (
        <div style={{
          fontSize: '10px', color: '#DC2626', whiteSpace: 'nowrap',
          maxWidth: '120px', textAlign: 'center', lineHeight: '1.3',
        }}>
          {inlineError}
        </div>
      )}
    </div>
  )
}

// ── Weight bar ─────────────────────────────────────────────────────────────

function WeightBar({ current, target }) {
  const max = Math.max(current || 0, target || 0, 5) * 1.25
  const curW = Math.min(((current || 0) / max) * 100, 100)
  const tgtW = Math.min(((target || 0) / max) * 100, 100)
  const diff = (target || 0) - (current || 0)
  const barColor = diff > 0.5 ? '#BBF7D0' : diff < -0.5 ? '#FECACA' : 'var(--accent)'

  return (
    <div style={{ position: 'relative', height: '20px', width: '100%', minWidth: '80px' }}>
      <div style={{
        position: 'absolute', top: '7px', left: 0, right: 0,
        height: '6px', borderRadius: '3px', background: 'var(--card-border)',
      }} />
      <div style={{
        position: 'absolute', top: '7px', left: 0,
        width: `${curW}%`, height: '6px', borderRadius: '3px',
        background: barColor, transition: 'width 0.25s ease',
      }} />
      {(target || 0) > 0 && (
        <div style={{
          position: 'absolute', top: '4px',
          left: `calc(${tgtW}% - 1px)`,
          width: '2px', height: '12px', borderRadius: '1px',
          background: 'var(--accent-dark)',
        }} />
      )}
    </div>
  )
}

// ── Action cell ────────────────────────────────────────────────────────────

function ActionCell({ diff, price }) {
  if (diff == null || price == null || price === 0 || Math.abs(diff) < 0.5) {
    return <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>—</span>
  }
  const shares = Math.abs(diff) / price
  const sharesDisplay = shares < 1 ? shares.toFixed(4) : Math.round(shares).toLocaleString()
  const isBuy = diff > 0

  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{
        display: 'inline-block', padding: '2px 10px', borderRadius: '5px',
        fontSize: '11px', fontWeight: '700', marginBottom: '3px',
        background: isBuy ? '#DCFCE7' : '#FEE2E2',
        color: isBuy ? '#14532D' : '#991B1B',
      }}>
        {isBuy ? '▲ BUY' : '▼ SELL'}
      </div>
      <div style={{ fontSize: '12px', fontWeight: '600', color: isBuy ? '#166534' : '#991B1B' }}>
        {sharesDisplay} shares
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function Rebalancer() {
  const { selectedCircle } = useFilters()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [targets, setTargets] = useState({})
  const [newInvestment, setNewInvestment] = useState('')
  const [sortKey, setSortKey] = useState('market_value')
  const [sortDir, setSortDir] = useState('desc')

  const fetchData = useCallback(async () => {
    if (!selectedCircle) { setData(null); return }
    setLoading(true); setFetchError('')
    try {
      const res = await api.get('/rebalancer', { params: { circle_id: selectedCircle.id } })
      setData(res.data)
      const t = {}
      res.data.positions.forEach(p => { t[p.symbol] = p.target_weight_pct ?? 0 })
      setTargets(t)
    } catch {
      setFetchError('Failed to load rebalancer data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [selectedCircle])

  useEffect(() => { fetchData() }, [fetchData])

  const handleTargetChange = (symbol, pct) => {
    setTargets(prev => ({ ...prev, [symbol]: pct }))
  }

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'symbol' ? 'asc' : 'desc')
    }
  }

  const extraCash = parseFloat(newInvestment) || 0
  const totalMv = data?.total_market_value || 0
  const grandTotal = totalMv + extraCash
  const totalTargetWeight = Object.values(targets).reduce((s, v) => s + (v || 0), 0)
  const isOverweight = totalTargetWeight > 100

  const rawPositions = (data?.positions || []).map(p => {
    const target = targets[p.symbol] ?? 0
    const targetValue = (target / 100) * grandTotal
    const diff = targetValue - (p.market_value ?? 0)
    const acbPerShare = p.quantity_total > 0 ? (p.total_acb / p.quantity_total) : null
    return { ...p, target_weight_pct: target, target_value: targetValue, diff, acbPerShare }
  })

  const positions = sortPositions(rawPositions, sortKey, sortDir)

  const thProps = { currentKey: sortKey, currentDir: sortDir, onSort: handleSort }

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
          Rebalancer
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Set target weights and see exactly how many shares to buy or sell
        </p>
      </div>

      {/* No circle selected */}
      {!selectedCircle && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚖️</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
            Select a circle to rebalance
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Use the circle filter above to get started
          </div>
        </div>
      )}

      {fetchError && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FECACA',
          borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
          fontSize: '13px', color: '#DC2626',
        }}>
          {fetchError}
        </div>
      )}

      {selectedCircle && loading && !data && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '40px', textAlign: 'center',
          color: 'var(--text-secondary)', fontSize: '13px',
        }}>
          Loading positions…
        </div>
      )}

      {/* Summary bar */}
      {data && positions.length > 0 && (
        <div style={{
          display: 'flex', background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: '12px', marginBottom: '16px', overflow: 'hidden',
        }}>
          {/* Portfolio value */}
          <div style={{ flex: 1, padding: '16px 20px', borderRight: '1px solid var(--card-border)' }}>
            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Portfolio Value
            </div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>
              ${fmt(totalMv)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {positions.length} open positions
            </div>
          </div>

          {/* New investment */}
          <div style={{ flex: 1.5, padding: '16px 24px', borderRight: '1px solid var(--card-border)', background: 'var(--accent-light)' }}>
            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-dark)', marginBottom: '6px' }}>
              New Investment
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: '700', color: 'var(--accent-dark)' }}>$</span>
              <input
                type="number" min="0" placeholder="0"
                value={newInvestment}
                onChange={e => setNewInvestment(e.target.value)}
                style={{
                  width: '140px', padding: '6px 10px', borderRadius: '8px',
                  border: '1.5px solid var(--accent)', background: 'white',
                  fontSize: '20px', fontWeight: '700', color: 'var(--accent-dark)',
                  outline: 'none', textAlign: 'right',
                }}
              />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--accent-dark)', opacity: 0.75, marginTop: '4px' }}>
              Fresh cash to deploy — factored into target value calculations
            </div>
          </div>

          {/* Target allocated */}
          <div style={{ flex: 1, padding: '16px 20px' }}>
            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Target Allocated
            </div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: isOverweight ? '#DC2626' : 'var(--text-primary)' }}>
              {fmt(totalTargetWeight, 1)}%
            </div>
            <div style={{ fontSize: '11px', marginTop: '2px', color: isOverweight ? '#DC2626' : 'var(--text-secondary)' }}>
              {isOverweight
                ? `⚠️ Over by ${fmt(totalTargetWeight - 100, 1)}% — reduce a target`
                : totalTargetWeight < 100
                  ? `${fmt(100 - totalTargetWeight, 1)}% unallocated — fine to leave`
                  : '✓ Fully allocated'}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {data && positions.length > 0 && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '130px' }} />
                <col style={{ width: '90px' }} />
                <col style={{ width: '105px' }} />
                <col style={{ width: '115px' }} />
                <col style={{ width: '115px' }} />
                <col style={{ width: '90px' }} />
                <col style={{ width: '105px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '115px' }} />
                <col style={{ width: '120px' }} />
              </colgroup>
              <thead>
                <tr>
                  <SortTh label="Symbol"        sortKey="symbol"        align="left"   {...thProps} />
                  <SortTh label="Qty"            sortKey="qty"           align="right"  {...thProps} />
                  <SortTh label="ACB / Share"    sortKey="acb_per_share" align="right"  {...thProps} />
                  <SortTh label="Current Price"  sortKey="current_price" align="right"  {...thProps} />
                  <SortTh label="Market Value"   sortKey="market_value"  align="right"  {...thProps} />
                  <SortTh label="Current %"      sortKey="current_pct"   align="right"  {...thProps} />
                  <SortTh label="Target %"       sortKey="target_pct"    align="center" {...thProps} style={{ color: 'var(--accent-dark)' }} />
                  <SortTh label="Weight"         sortKey="weight_bar"    align="left"   {...thProps} />
                  <SortTh label="Target Value"   sortKey="target_value"  align="right"  {...thProps} />
                  <SortTh label="Action"         sortKey="action_shares" align="right"  {...thProps} />
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => {
                  const totalOtherWeight = Object.entries(targets)
                    .filter(([sym]) => sym !== p.symbol)
                    .reduce((s, [, v]) => s + (v || 0), 0)
                  const isLast = i === positions.length - 1

                  return (
                    <tr
                      key={p.symbol}
                      style={{ borderBottom: isLast ? 'none' : '1px solid var(--filter-row-border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--content-bg)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Symbol */}
                      <td style={{ padding: '12px 12px' }}>
                        <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-dark)' }}>
                          {p.symbol}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                          {p.asset_type} · {p.currency}
                        </div>
                      </td>

                      {/* Qty */}
                      <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                        <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)' }}>
                          {fmtShares(p.quantity_total)}
                        </span>
                      </td>

                      {/* ACB / Share */}
                      <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {p.acbPerShare != null ? fmtCurrency(p.acbPerShare) : '—'}
                        </span>
                      </td>

                      {/* Current Price */}
                      <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {p.current_price != null ? fmtCurrency(p.current_price) : '—'}
                        </span>
                      </td>

                      {/* Market Value */}
                      <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {fmtCurrency(p.market_value)}
                        </span>
                      </td>

                      {/* Current % */}
                      <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {p.current_weight_pct != null ? `${fmt(p.current_weight_pct, 1)}%` : '—'}
                        </span>
                      </td>

                      {/* Target % */}
                      <td style={{ padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                        <WeightInput
                          symbol={p.symbol}
                          circleId={selectedCircle.id}
                          value={targets[p.symbol] ?? 0}
                          totalOtherWeight={totalOtherWeight}
                          onChange={handleTargetChange}
                        />
                      </td>

                      {/* Weight bar */}
                      <td style={{ padding: '12px 8px', verticalAlign: 'middle' }}>
                        <WeightBar current={p.current_weight_pct} target={targets[p.symbol] ?? 0} />
                      </td>

                      {/* Target Value */}
                      <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {(targets[p.symbol] ?? 0) > 0 ? fmtCurrency(p.target_value) : '—'}
                        </span>
                      </td>

                      {/* Action */}
                      <td style={{ padding: '12px 12px' }}>
                        <ActionCell diff={p.diff} price={p.current_price} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{
            padding: '8px 16px', borderTop: '1px solid var(--card-border)',
            fontSize: '11px', color: 'var(--text-secondary)',
          }}>
            Click any column header to sort · Target % saves on Enter or click away · Leaving positions at 0% excludes them from rebalance calculations
          </div>
        </div>
      )}

      {/* Empty state */}
      {data && positions.length === 0 && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📂</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
            No open positions
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Import transactions to get started
          </div>
        </div>
      )}
    </div>
  )
}
