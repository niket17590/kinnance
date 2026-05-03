import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine,
} from 'recharts'
import api from '../services/api'
import { useFilters } from '../context/FilterContext'

// ── Helpers ───────────────────────────────────────────────────

const fmt = (n, d = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d })

const fmtC = (n) => n == null ? '—' : `$${fmt(Math.abs(n))}`

const glColor = (n) => Number(n) >= 0 ? '#059669' : '#DC2626'
const glPrefix = (n) => Number(n) >= 0 ? '+' : '-'

const TAX_META = {
  TAX_FREE:     { label: 'Tax Free',      color: '#059669', bg: '#DCFCE7' },
  TAX_DEFERRED: { label: 'Tax Deferred',  color: '#2563EB', bg: '#DBEAFE' },
  TAXABLE:      { label: 'Taxable',       color: '#D97706', bg: '#FEF3C7' },
  CORP_TAXABLE: { label: 'Corp Taxable',  color: '#7C3AED', bg: '#F3E8FF' },
  OTHER:        { label: 'Other',         color: '#6B7280', bg: '#F3F4F6' },
}

const SORT_OPTIONS = [
  { key: 'market_value',     label: 'Market Value' },
  { key: 'unrealized_gl',    label: 'Unrealized G/L' },
  { key: 'unrealized_gl_pct',label: 'G/L %' },
  { key: 'total_acb',        label: 'Cost Basis' },
  { key: 'weight_pct',       label: 'Weight' },
]

// ── Sort + filter helper ──────────────────────────────────────

function sortPositions(positions, key, dir) {
  return [...positions].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return dir === 'asc' ? av - bv : bv - av
  })
}

// ── Summary tile ──────────────────────────────────────────────

function SummaryTile({ label, value, sub, subColor, accent }) {
  return (
    <div style={{
      background: accent ? 'var(--sidebar-bg)' : 'var(--card-bg)',
      border: `1px solid ${accent ? 'transparent' : 'var(--card-border)'}`,
      borderRadius: '14px', padding: '18px 20px',
      flex: '1 1 150px',
    }}>
      <div style={{
        fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
        letterSpacing: '0.07em',
        color: accent ? 'rgba(255,255,255,0.55)' : 'var(--text-secondary)',
        marginBottom: '6px',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '24px', fontWeight: '700', letterSpacing: '-0.5px',
        color: accent ? '#fff' : 'var(--text-primary)',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '11px', fontWeight: '600', marginTop: '4px',
          color: accent ? 'rgba(255,255,255,0.65)' : (subColor || 'var(--text-secondary)') }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Position row ──────────────────────────────────────────────

function PositionRow({ p, totalMv, isLast }) {
  const tm = TAX_META[p.tax_category] || TAX_META.OTHER

  return (
    <tr style={{ borderBottom: isLast ? 'none' : '1px solid var(--filter-row-border)' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--content-bg)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

      {/* Symbol */}
      <td style={{ padding: '10px 14px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--accent-dark)' }}>
          {p.symbol}
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px', display: 'flex', gap: '5px' }}>
          <span style={{
            background: tm.bg, color: tm.color, padding: '1px 5px',
            borderRadius: '3px', fontWeight: '600',
          }}>
            {tm.label}
          </span>
          <span>{p.currency} · {p.asset_type}</span>
        </div>
      </td>

      {/* Cost */}
      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{fmtC(p.total_acb)}</div>
      </td>

      {/* Market value */}
      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
          {fmtC(p.market_value)}
        </div>
        {/* mini bar */}
        <div style={{ height: '3px', background: 'var(--card-border)', borderRadius: '2px', marginTop: '4px', width: '60px', marginLeft: 'auto' }}>
          <div style={{
            height: '100%', width: `${Math.min(p.weight_pct, 100)}%`,
            background: 'var(--accent)', borderRadius: '2px',
          }} />
        </div>
      </td>

      {/* Unrealized G/L */}
      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: glColor(p.unrealized_gl) }}>
          {glPrefix(p.unrealized_gl)}{fmtC(p.unrealized_gl)}
        </div>
        <div style={{ fontSize: '10px', color: glColor(p.unrealized_gl_pct) }}>
          {glPrefix(p.unrealized_gl_pct)}{fmt(Math.abs(p.unrealized_gl_pct))}%
        </div>
      </td>

      {/* Weight */}
      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {fmt(p.weight_pct)}%
        </div>
      </td>

      {/* Realized G/L */}
      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
        {p.realized_gl !== 0 ? (
          <div style={{ fontSize: '12px', fontWeight: '600', color: glColor(p.realized_gl) }}>
            {glPrefix(p.realized_gl)}{fmtC(p.realized_gl)}
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>—</span>
        )}
      </td>
    </tr>
  )
}

// ── Custom bar chart tooltip ──────────────────────────────────

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: '8px', padding: '10px 14px', fontSize: '12px',
    }}>
      <div style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>{label}</div>
      <div style={{ color: glColor(d.value) }}>
        {glPrefix(d.value)}${fmt(Math.abs(d.value))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function Performance() {
  const { selectedCircle, debouncedFilters } = useFilters()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState('market_value')
  const [sortDir, setSortDir] = useState('desc')
  const [taxFilter, setTaxFilter] = useState(null)

  const fetchPerformance = useCallback(async () => {
    if (!selectedCircle) { setData(null); return }
    setLoading(true); setError('')
    try {
      const params = {}
      const circleId = debouncedFilters.circleId || selectedCircle.id
      if (circleId) params.circle_id = circleId
      if (debouncedFilters.memberIds?.length) params.member_ids = debouncedFilters.memberIds.join(',')
      if (debouncedFilters.accountTypes?.length) params.account_types = debouncedFilters.accountTypes.join(',')
      if (debouncedFilters.brokers?.length) params.brokers = debouncedFilters.brokers.join(',')
      const res = await api.get('/performance', { params })
      setData(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load performance data')
    } finally {
      setLoading(false)
    }
  }, [selectedCircle, debouncedFilters])

  const filterKey = JSON.stringify(debouncedFilters)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPerformance() }, [filterKey])

  if (!selectedCircle) {
    return (
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: '16px', padding: '72px', textAlign: 'center',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📈</div>
        <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
          Select a circle to view performance
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Use the circle filter above to get started
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return <div style={{ textAlign: 'center', padding: '72px', color: 'var(--text-secondary)' }}>
      Loading performance data…
    </div>
  }

  if (error) {
    return (
      <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '12px',
        padding: '16px', color: '#DC2626', fontSize: '13px' }}>
        {error}
      </div>
    )
  }

  if (!data) return null

  const { summary, positions, by_tax_category, by_asset_type,
          realized_summary, has_price_history } = data

  // Filter + sort positions
  const filteredPositions = taxFilter
    ? positions.filter(p => p.tax_category === taxFilter)
    : positions
  const sortedPositions = sortPositions(filteredPositions, sortKey, sortDir)

  // Bar chart data — unrealized by symbol, top 15
  const barData = [...positions]
    .filter(p => p.unrealized_gl !== 0)
    .sort((a, b) => b.unrealized_gl - a.unrealized_gl)
    .slice(0, 15)
    .map(p => ({ symbol: p.symbol, gl: p.unrealized_gl }))

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortTh = ({ label, sKey, align = 'right' }) => (
    <th onClick={() => handleSort(sKey)} style={{
      padding: '10px 14px', textAlign: align, fontSize: '10px', fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      color: sortKey === sKey ? 'var(--accent-dark)' : 'var(--text-secondary)',
      background: sortKey === sKey ? 'var(--accent-light)' : 'var(--content-bg)',
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      borderBottom: '2px solid var(--card-border)',
    }}>
      {label} {sortKey === sKey ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </th>
  )

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
          Performance
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {data.circle_name} · {summary.open_positions} open positions
        </p>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <SummaryTile label="Portfolio Value" value={`$${fmt(summary.total_market_value)}`}
          sub={`Cost $${fmt(summary.total_acb)}`} accent />
        <SummaryTile
          label="Unrealized G/L"
          value={`${glPrefix(summary.total_unrealized_gl)}$${fmt(Math.abs(summary.total_unrealized_gl))}`}
          sub={`${glPrefix(summary.total_unrealized_gl_pct)}${fmt(Math.abs(summary.total_unrealized_gl_pct))}% on cost`}
          subColor={glColor(summary.total_unrealized_gl)}
        />
        <SummaryTile
          label="Realized G/L (All Time)"
          value={`${glPrefix(summary.total_realized_gl)}$${fmt(Math.abs(summary.total_realized_gl))}`}
          subColor={glColor(summary.total_realized_gl)}
        />
        <SummaryTile label="Open Positions" value={summary.open_positions} />
      </div>

      {/* Time-series placeholder — no price history yet */}
      {!has_price_history && (
        <div style={{
          background: 'var(--card-bg)', border: '1px dashed var(--card-border)',
          borderRadius: '14px', padding: '28px 24px', marginBottom: '16px',
          display: 'flex', alignItems: 'center', gap: '16px',
        }}>
          <div style={{ fontSize: '32px' }}>📅</div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
              Portfolio Growth Chart — Coming Soon
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              Daily price snapshots are stored each evening. Once a few days of history accumulate,
              you'll see a full portfolio value over time chart here. The nightly job runs at 9pm ET on weekdays.
            </div>
          </div>
        </div>
      )}

      {/* ── Main grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px', marginBottom: '14px' }}>

        {/* Unrealized G/L bar chart */}
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '14px', padding: '18px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
            Unrealized G/L by Position
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Top 15 open positions
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 4, right: 4, bottom: 30, left: 10 }}>
              <XAxis dataKey="symbol" tick={{ fontSize: 10, fill: '#6B7280' }}
                angle={-40} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10, fill: '#6B7280' }}
                tickFormatter={v => `$${Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="var(--card-border)" />
              <Bar dataKey="gl" radius={[3, 3, 0, 0]}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={d.gl >= 0 ? '#10B981' : '#EF4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Allocation breakdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* By tax */}
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--card-border)',
            borderRadius: '14px', padding: '18px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '12px' }}>
              By Account Type
            </div>
            {by_tax_category.map(t => {
              const tm = TAX_META[t.tax_category] || TAX_META.OTHER
              return (
                <div key={t.tax_category} style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '600', color: tm.color }}>{tm.label}</span>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      ${fmt(t.market_value, 0)} · {fmt(t.weight_pct)}%
                    </span>
                  </div>
                  <div style={{ height: '5px', background: 'var(--card-border)', borderRadius: '3px' }}>
                    <div style={{ height: '100%', width: `${t.weight_pct}%`, background: tm.color, borderRadius: '3px' }} />
                  </div>
                  <div style={{ fontSize: '10px', color: glColor(t.unrealized_gl), marginTop: '2px' }}>
                    {glPrefix(t.unrealized_gl)}${fmt(Math.abs(t.unrealized_gl), 0)} unrealized ·{' '}
                    {t.positions} position{t.positions !== 1 ? 's' : ''}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Realized summary */}
          {realized_summary.length > 0 && (
            <div style={{
              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              borderRadius: '14px', padding: '18px',
            }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '12px' }}>
                Realized G/L (All Time)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {realized_summary.slice(0, 6).map(r => (
                  <div key={r.symbol} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 10px', borderRadius: '7px',
                    background: r.realized_gl >= 0 ? '#F0FDF4' : '#FFF1F2',
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {r.symbol}
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', fontWeight: '700', color: glColor(r.realized_gl) }}>
                        {glPrefix(r.realized_gl)}{fmtC(r.realized_gl)}
                      </div>
                      <div style={{ fontSize: '10px', color: glColor(r.realized_gl_pct) }}>
                        {glPrefix(r.realized_gl_pct)}{fmt(Math.abs(r.realized_gl_pct))}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Position table ── */}
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: '14px', overflow: 'hidden',
      }}>
        {/* Table controls */}
        <div style={{
          padding: '14px 18px', display: 'flex', alignItems: 'center',
          gap: '8px', flexWrap: 'wrap',
          borderBottom: '1px solid var(--card-border)',
        }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginRight: '8px' }}>
            All Positions
          </div>

          {/* Tax filter pills */}
          <button onClick={() => setTaxFilter(null)} style={{
            padding: '3px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
            background: !taxFilter ? 'var(--sidebar-bg)' : 'var(--content-bg)',
            color: !taxFilter ? 'white' : 'var(--text-secondary)',
          }}>All</button>
          {by_tax_category.map(t => {
            const tm = TAX_META[t.tax_category] || TAX_META.OTHER
            const active = taxFilter === t.tax_category
            return (
              <button key={t.tax_category} onClick={() => setTaxFilter(active ? null : t.tax_category)} style={{
                padding: '3px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                background: active ? tm.color : 'var(--content-bg)',
                color: active ? 'white' : tm.color,
              }}>
                {tm.label}
              </button>
            )
          })}

          <div style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-secondary)' }}>
            {sortedPositions.length} positions
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortTh label="Symbol"        sKey="symbol"            align="left" />
                <SortTh label="Cost Basis"    sKey="total_acb" />
                <SortTh label="Market Value"  sKey="market_value" />
                <SortTh label="Unrealized G/L" sKey="unrealized_gl" />
                <SortTh label="Weight"        sKey="weight_pct" />
                <SortTh label="Realized G/L"  sKey="realized_gl" />
              </tr>
            </thead>
            <tbody>
              {sortedPositions.map((p, i) => (
                <PositionRow key={p.symbol + p.tax_category} p={p}
                  totalMv={summary.total_market_value}
                  isLast={i === sortedPositions.length - 1} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer totals */}
        <div style={{
          padding: '12px 18px', borderTop: '1px solid var(--card-border)',
          display: 'flex', gap: '24px', flexWrap: 'wrap',
          background: 'var(--content-bg)',
        }}>
          {[
            ['Total Cost', `$${fmt(filteredPositions.reduce((s, p) => s + p.total_acb, 0))}`],
            ['Market Value', `$${fmt(filteredPositions.reduce((s, p) => s + p.market_value, 0))}`],
            ['Unrealized G/L', (() => {
              const v = filteredPositions.reduce((s, p) => s + p.unrealized_gl, 0)
              return `${glPrefix(v)}$${fmt(Math.abs(v))}`
            })()],
          ].map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                {label}
              </div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
