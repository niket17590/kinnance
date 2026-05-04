import { useState, useEffect, useCallback } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../services/api'
import { useFilters } from '../context/FilterContext'

// ── Helpers ───────────────────────────────────────────────────

const fmt = (n, d = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d })

const fmtC = (n, abs = false) => {
  if (n == null) return '—'
  const v = abs ? Math.abs(n) : n
  return `$${fmt(Math.abs(v))}`
}

const fmtMoney = (n, currency = 'CAD') => {
  if (n == null) return '—'
  return `$${fmt(Math.abs(n))} ${currency}`
}

const fmtCompactMoney = (n) => {
  if (n == null) return 'â€”'
  const abs = Math.abs(Number(n))
  if (abs >= 1000000000) return `$${fmt(abs / 1000000000, 2)}B`
  if (abs >= 1000000) return `$${fmt(abs / 1000000, 2)}M`
  if (abs >= 1000) return `$${fmt(abs / 1000, 1)}K`
  return `$${fmt(abs, 0)}`
}

const fmtDate = (d) => {
  if (!d) return 'TBD'
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

const glColor = (n) => Number(n) >= 0 ? '#059669' : '#DC2626'
const glPrefix = (n) => Number(n) >= 0 ? '+' : '-'
const glBg = (n) => Number(n) >= 0 ? '#DCFCE7' : '#FEE2E2'

const TYPE_COLORS = {
  BUY:               { bg: '#DCFCE7', color: '#059669', label: 'Buy' },
  SELL:              { bg: '#FEE2E2', color: '#DC2626', label: 'Sell' },
  DIVIDEND:          { bg: '#DBEAFE', color: '#1D4ED8', label: 'Dividend' },
  INTEREST:          { bg: '#DBEAFE', color: '#1D4ED8', label: 'Interest' },
  DEPOSIT:           { bg: '#F3E8FF', color: '#7C3AED', label: 'Deposit' },
  WITHDRAWAL:        { bg: '#FEF3C7', color: '#92400E', label: 'Withdraw' },
  FX_CONVERSION:     { bg: '#FEF3C7', color: '#92400E', label: 'FX' },
  INTERNAL_TRANSFER: { bg: '#F3F4F6', color: '#374151', label: 'Transfer' },
  FEE:               { bg: '#F3F4F6', color: '#374151', label: 'Fee' },
  CORPORATE_ACTION:  { bg: '#F3E8FF', color: '#7C3AED', label: 'Corp Action' },
}

const TAX_COLORS_MAP = {
  TAX_FREE:     { color: '#059669', label: 'Tax Free (TFSA/FHSA)', dot: '#059669' },
  TAX_DEFERRED: { color: '#2563EB', label: 'Tax Deferred (RRSP)',   dot: '#2563EB' },
  TAXABLE:      { color: '#D97706', label: 'Taxable',               dot: '#D97706' },
  CORP_TAXABLE: { color: '#7C3AED', label: 'Corp Taxable',          dot: '#7C3AED' },
  OTHER:        { color: '#6B7280', label: 'Other',                  dot: '#6B7280' },
}

// Color palette for donut charts
const DONUT_COLORS = [
  '#2A8C8C', '#0EA5E9', '#8B5CF6', '#F59E0B',
  '#10B981', '#EF4444', '#EC4899', '#6366F1',
  '#14B8A6', '#F97316',
]

// ── Stat tile ─────────────────────────────────────────────────

function StatTile({ label, value, sub, subColor, accent = false, icon }) {
  return (
    <div style={{
      background: accent ? 'var(--sidebar-bg)' : 'var(--card-bg)',
      border: `1px solid ${accent ? 'transparent' : 'var(--card-border)'}`,
      borderRadius: '14px',
      padding: '20px 22px',
      flex: '1 1 160px',
      minWidth: '150px',
    }}>
      <div style={{
        fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
        letterSpacing: '0.07em',
        color: accent ? 'rgba(255,255,255,0.55)' : 'var(--text-secondary)',
        marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px',
      }}>
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div style={{
        fontSize: '26px', fontWeight: '700', lineHeight: 1.1,
        color: accent ? '#FFFFFF' : 'var(--text-primary)',
        letterSpacing: '-0.5px',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: '12px', fontWeight: '600', marginTop: '5px',
          color: accent ? 'rgba(255,255,255,0.7)' : (subColor || 'var(--text-secondary)'),
        }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────

function SectionHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>{title}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>{sub}</div>}
    </div>
  )
}

// ── Mini donut chart ──────────────────────────────────────────

function MiniDonut({ data, valueKey = 'market_value', nameKey = 'symbol', colorKey }) {
  const RADIAN = Math.PI / 180
  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.06) return null
    const r = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: '10px', fontWeight: '700' }}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          dataKey={valueKey}
          labelLine={false}
          label={renderCustomLabel}
        >
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={colorKey ? (TAX_COLORS_MAP[entry[colorKey]]?.dot || DONUT_COLORS[i % DONUT_COLORS.length])
                             : DONUT_COLORS[i % DONUT_COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(val, name) => [`$${fmt(val)}`, name]}
          contentStyle={{
            background: 'var(--card-bg)', border: '1px solid var(--card-border)',
            borderRadius: '8px', fontSize: '12px',
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

// ── Holdings bar row ──────────────────────────────────────────

function HoldingBar({ h, totalMv, rank }) {
  const barW = totalMv > 0 ? (h.market_value / totalMv * 100) : 0
  const isGain = h.unrealized_gl >= 0

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '9px 0',
      borderBottom: '1px solid var(--filter-row-border)',
    }}>
      {/* Rank */}
      <div style={{
        width: '20px', fontSize: '10px', fontWeight: '700',
        color: 'var(--text-secondary)', textAlign: 'center', flexShrink: 0,
      }}>
        {rank}
      </div>

      {/* Symbol + bar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--accent-dark)' }}>
            {h.symbol}
          </span>
          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
            ${fmt(h.market_value)}
          </span>
        </div>
        <div style={{ height: '5px', background: 'var(--card-border)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${barW}%`,
            background: 'var(--accent)', borderRadius: '3px',
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* G/L */}
      <div style={{
        textAlign: 'right', flexShrink: 0, minWidth: '70px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: '700', color: glColor(h.unrealized_gl) }}>
          {glPrefix(h.unrealized_gl)}{fmtC(h.unrealized_gl, true)}
        </div>
        <div style={{ fontSize: '10px', color: glColor(h.unrealized_gl) }}>
          {h.unrealized_gl_pct != null ? `${glPrefix(h.unrealized_gl_pct)}${fmt(Math.abs(h.unrealized_gl_pct))}%` : '—'}
        </div>
      </div>
    </div>
  )
}

// ── Recent transaction row ────────────────────────────────────

function TxnRow({ t }) {
  const tc = TYPE_COLORS[t.transaction_type] || { bg: '#F3F4F6', color: '#374151', label: t.transaction_type }
  const amountValue = t.amount_value ?? t.net_amount_cad ?? t.net_amount
  const amountCurrency = t.amount_currency || 'CAD'
  const isCredit = Number(amountValue || 0) >= 0
  const date = new Date(t.trade_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  const showCadSub = amountCurrency !== 'CAD' && Math.abs(Number(t.net_amount_cad || 0)) >= 0.005

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '9px 0',
      borderBottom: '1px solid var(--filter-row-border)',
    }}>
      {/* Type badge */}
      <div style={{
        fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '5px',
        background: tc.bg, color: tc.color, flexShrink: 0, whiteSpace: 'nowrap',
      }}>
        {tc.label}
      </div>

      {/* Symbol + account */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', gap: '6px' }}>
          {t.symbol || t.account_label}
          {t.quantity && (
            <span style={{ fontWeight: '400', color: 'var(--text-secondary)' }}>
              × {fmt(t.quantity, t.quantity % 1 === 0 ? 0 : 4)}
            </span>
          )}
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
          {t.member_name} · {t.account_label} · {date}
        </div>
      </div>

      {/* Amount */}
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{
          fontSize: '12px', fontWeight: '700',
          color: isCredit ? '#059669' : '#DC2626',
        }}>
          {isCredit ? '+' : '-'}{fmtMoney(amountValue, amountCurrency)}
        </div>
        {showCadSub && (
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
            CAD {Number(t.net_amount_cad) >= 0 ? '+' : '-'}${fmt(Math.abs(t.net_amount_cad))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Winner/Loser pill ─────────────────────────────────────────

function GainPill({ p, isWinner }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 12px', borderRadius: '9px',
      background: isWinner ? '#F0FDF4' : '#FFF1F2',
      border: `1px solid ${isWinner ? '#BBF7D0' : '#FECDD3'}`,
      marginBottom: '6px',
    }}>
      <div>
        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
          {p.symbol}
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
          {fmtC(p.market_value)}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: glColor(p.unrealized_gl) }}>
          {glPrefix(p.unrealized_gl)}{fmtC(p.unrealized_gl, true)}
        </div>
        <div style={{ fontSize: '10px', color: glColor(p.unrealized_gl_pct) }}>
          {p.unrealized_gl_pct != null ? `${glPrefix(p.unrealized_gl_pct)}${fmt(Math.abs(p.unrealized_gl_pct))}%` : '—'}
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────

function EarningsWatch({ rows }) {
  const statusStyle = {
    TODAY: { bg: '#FEF3C7', color: '#92400E', label: 'Today' },
    UPCOMING: { bg: '#DBEAFE', color: '#1D4ED8', label: 'Upcoming' },
    REPORTED: { bg: '#DCFCE7', color: '#059669', label: 'Reported' },
    UNKNOWN: { bg: '#F3F4F6', color: '#374151', label: 'Unknown' },
  }

  if (!rows?.length) {
    return <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No earnings data cached yet</div>
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
      {rows.map(row => {
        const st = statusStyle[row.status] || statusStyle.UNKNOWN
        const bullish = row.bullish_points?.[0]
        const bearish = row.bearish_points?.[0]
        const lastEpsActual = row.previous_eps_actual ?? row.eps_actual
        const lastEpsEstimate = row.previous_eps_estimate ?? row.eps_estimate
        const lastRevenueActual = row.previous_revenue_actual ?? row.revenue_actual
        const lastRevenueEstimate = row.previous_revenue_estimate ?? row.revenue_estimate
        return (
          <div key={row.symbol} style={{
            border: '1px solid var(--filter-row-border)',
            borderRadius: '10px',
            padding: '12px',
            background: 'var(--content-bg)',
            minWidth: 0,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-dark)' }}>{row.symbol}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{fmt(row.weight_pct, 1)}% weight</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  display: 'inline-block',
                  fontSize: '10px',
                  fontWeight: '700',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  background: st.bg,
                  color: st.color,
                  marginBottom: '3px',
                }}>
                  {st.label}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{fmtDate(row.earnings_date)}</div>
                {row.previous_earnings_date && (
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                    Last {fmtDate(row.previous_earnings_date)}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '9px' }}>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>Last EPS</div>
                <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: '700' }}>
                  {lastEpsActual != null ? fmt(lastEpsActual, 2) : 'Actual -'} / {lastEpsEstimate != null ? fmt(lastEpsEstimate, 2) : 'Est -'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>Last Revenue</div>
                <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: '700' }}>
                  {lastRevenueActual != null ? fmtCompactMoney(lastRevenueActual) : 'Actual -'} / {lastRevenueEstimate != null ? fmtCompactMoney(lastRevenueEstimate) : 'Est -'}
                </div>
              </div>
            </div>

            {(bullish || bearish) && (
              <div style={{ borderTop: '1px solid var(--filter-row-border)', paddingTop: '8px' }}>
                {bullish && <div style={{ fontSize: '11px', color: '#059669', marginBottom: '3px' }}>+ {bullish}</div>}
                {bearish && <div style={{ fontSize: '11px', color: '#DC2626' }}>- {bearish}</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function Dashboard() {
  const { selectedCircle, debouncedFilters } = useFilters()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [earningsRefreshing, setEarningsRefreshing] = useState(false)
  const [earningsMessage, setEarningsMessage] = useState('')

  const fetchDashboard = useCallback(async () => {
    if (!selectedCircle) { setData(null); return }
    setLoading(true); setError('')
    try {
      const params = {}
      if (debouncedFilters.circleId) params.circle_id = debouncedFilters.circleId
      if (debouncedFilters.memberIds?.length) params.member_ids = debouncedFilters.memberIds.join(',')
      if (debouncedFilters.accountTypes?.length) params.account_types = debouncedFilters.accountTypes.join(',')
      if (debouncedFilters.brokers?.length) params.brokers = debouncedFilters.brokers.join(',')
      const res = await api.get('/dashboard', { params })
      setData(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [selectedCircle, debouncedFilters])

  const filterKey = JSON.stringify(debouncedFilters)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchDashboard() }, [filterKey])

  const handleRefreshEarnings = async () => {
    setEarningsRefreshing(true)
    setEarningsMessage('')
    try {
      const res = await api.post('/dashboard/earnings/refresh')
      const refreshed = res.data?.refreshed ?? 0
      const failed = res.data?.failed ?? 0
      setEarningsMessage(failed ? `Refreshed ${refreshed}, failed ${failed}` : `Refreshed ${refreshed}`)
      await fetchDashboard()
    } catch (err) {
      setEarningsMessage(err.response?.data?.detail || 'Refresh failed')
    } finally {
      setEarningsRefreshing(false)
    }
  }

  if (!selectedCircle) {
    return (
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: '16px', padding: '72px', textAlign: 'center',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
        <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
          Select a circle to view your dashboard
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Use the circle filter above to get started
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div style={{ textAlign: 'center', padding: '72px', color: 'var(--text-secondary)' }}>
        Loading dashboard…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '12px',
        padding: '16px', color: '#DC2626', fontSize: '13px',
      }}>
        {error}
      </div>
    )
  }

  if (!data) return null

  const { summary, top_holdings, all_holdings, allocation_by_tax,
          allocation_by_currency, recent_transactions, winners, losers, member_breakdown, earnings_watch } = data

  const totalMv = summary.total_market_value

  // Donut data — top 8 + "Others"
  const donutData = (() => {
    const top8 = all_holdings.slice(0, 8)
    const othersVal = all_holdings.slice(8).reduce((s, h) => s + h.market_value, 0)
    if (othersVal > 0) top8.push({ symbol: 'Others', market_value: othersVal })
    return top8
  })()

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
            Dashboard
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {data.circle_name} · {summary.open_positions} positions
            {!summary.has_prices && ' · prices updating'}
          </p>
        </div>
      </div>

      {/* ── Summary tiles ── */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <StatTile
          label="Portfolio Value"
          value={`$${fmt(totalMv)}`}
          sub={`Invested $${fmt(summary.total_acb)}`}
          accent
        />
        <StatTile
          label="Unrealized G/L"
          value={`${glPrefix(summary.total_unrealized_gl)}$${fmt(Math.abs(summary.total_unrealized_gl))}`}
          sub={summary.total_unrealized_gl_pct != null
            ? `${glPrefix(summary.total_unrealized_gl_pct)}${fmt(Math.abs(summary.total_unrealized_gl_pct))}% on cost`
            : undefined}
          subColor={glColor(summary.total_unrealized_gl)}
        />
        {summary.total_daily_gl != null && (
          <StatTile
            label="Today's G/L"
            value={`${glPrefix(summary.total_daily_gl)}$${fmt(Math.abs(summary.total_daily_gl))}`}
            sub={summary.total_daily_gl_pct != null
              ? `${glPrefix(summary.total_daily_gl_pct)}${fmt(Math.abs(summary.total_daily_gl_pct))}% today`
              : undefined}
            subColor={glColor(summary.total_daily_gl)}
          />
        )}
        <StatTile
          label="Realized G/L"
          value={`${glPrefix(summary.total_realized_gl)}$${fmt(Math.abs(summary.total_realized_gl))}`}
          sub="All time"
          subColor={glColor(summary.total_realized_gl)}
        />
      </div>

      {/* ── Main grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>

        {/* Holdings breakdown + donut */}
        <div style={{
          gridColumn: '1 / 2',
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '14px', padding: '18px',
        }}>
          <SectionHeader title="Holdings" sub="By market value" />
          <MiniDonut data={donutData} />
          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px' }}>
            {donutData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                {d.symbol}
              </div>
            ))}
          </div>
        </div>

        {/* Top holdings list */}
        <div style={{
          gridColumn: '2 / 3',
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '14px', padding: '18px',
        }}>
          <SectionHeader title="Top Holdings" sub="Ranked by value" />
          <div>
            {top_holdings.map((h, i) => (
              <HoldingBar key={h.symbol} h={h} totalMv={totalMv} rank={i + 1} />
            ))}
          </div>
        </div>

        {/* Allocation by tax + currency */}
        <div style={{
          gridColumn: '3 / 4',
          display: 'flex', flexDirection: 'column', gap: '14px',
        }}>
          {/* Tax allocation */}
          <div style={{
            flex: 1,
            background: 'var(--card-bg)', border: '1px solid var(--card-border)',
            borderRadius: '14px', padding: '18px',
          }}>
            <SectionHeader title="By Account Type" sub="Tax treatment" />
            {allocation_by_tax.map(t => {
              const tc = TAX_COLORS_MAP[t.tax_category] || { dot: '#6B7280', label: t.tax_category }
              return (
                <div key={t.tax_category} style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: tc.dot }} />
                      <span style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: '500' }}>
                        {tc.label}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {fmt(t.weight_pct)}%
                    </span>
                  </div>
                  <div style={{ height: '5px', background: 'var(--card-border)', borderRadius: '3px' }}>
                    <div style={{
                      height: '100%', width: `${t.weight_pct}%`,
                      background: tc.dot, borderRadius: '3px',
                    }} />
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    ${fmt(t.market_value)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Currency allocation */}
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--card-border)',
            borderRadius: '14px', padding: '18px',
          }}>
            <SectionHeader title="By Currency" />
            <div style={{ display: 'flex', gap: '8px' }}>
              {allocation_by_currency.map((c, i) => (
                <div key={c.currency} style={{
                  flex: 1, textAlign: 'center', padding: '10px 8px',
                  background: i === 0 ? 'var(--accent-light)' : 'var(--content-bg)',
                  borderRadius: '10px',
                  border: `1px solid ${i === 0 ? 'var(--accent)' : 'var(--card-border)'}`,
                }}>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: i === 0 ? 'var(--accent-dark)' : 'var(--text-primary)' }}>
                    {fmt(c.weight_pct, 1)}%
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: i === 0 ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    {c.currency}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    ${fmt(c.market_value, 0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>

        {/* Recent transactions */}
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '14px', padding: '18px',
        }}>
          <SectionHeader title="Recent Transactions" />
          {recent_transactions.map(t => <TxnRow key={t.id} t={t} />)}
        </div>

        {/* Winners & Losers */}
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '14px', padding: '18px',
        }}>
          <SectionHeader title="Best Performers" />
          {winners.length === 0
            ? <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No unrealized gains</div>
            : winners.map(p => <GainPill key={p.symbol} p={p} isWinner />)
          }
          <div style={{ height: '1px', background: 'var(--card-border)', margin: '12px 0' }} />
          <SectionHeader title="Laggards" />
          {losers.length === 0
            ? <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No unrealized losses</div>
            : losers.map(p => <GainPill key={p.symbol} p={p} />)
          }
        </div>

        {/* Member breakdown */}
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '14px', padding: '18px',
        }}>
          <SectionHeader title="By Member" sub="Portfolio ownership" />
          {member_breakdown.map(m => (
            <div key={m.member_id} style={{
              padding: '10px 0', borderBottom: '1px solid var(--filter-row-border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: m.member_type === 'CORPORATION' ? '#DBEAFE' : 'var(--accent-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: '700',
                    color: m.member_type === 'CORPORATION' ? '#1D4ED8' : 'var(--accent-dark)',
                    flexShrink: 0,
                  }}>
                    {m.member_type === 'CORPORATION' ? '🏢' : m.member_name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                      {m.member_name}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                      {m.positions} positions
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                    ${fmt(m.market_value, 0)}
                  </div>
                  <div style={{ fontSize: '10px', color: glColor(m.unrealized_gl) }}>
                    {glPrefix(m.unrealized_gl)}${fmt(Math.abs(m.unrealized_gl), 0)} G/L
                  </div>
                </div>
              </div>
              {/* Weight bar */}
              <div style={{ height: '4px', background: 'var(--card-border)', borderRadius: '2px' }}>
                <div style={{
                  height: '100%', width: `${m.weight_pct}%`,
                  background: m.member_type === 'CORPORATION' ? '#2563EB' : 'var(--accent)',
                  borderRadius: '2px',
                }} />
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {fmt(m.weight_pct)}% of circle
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: '14px', padding: '18px', marginTop: '14px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', marginBottom: '12px' }}>
          <SectionHeader title="Earnings Watch" sub={earningsMessage || 'Active holdings in selected circle'} />
          <button
            onClick={handleRefreshEarnings}
            disabled={earningsRefreshing || loading}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 12px', borderRadius: '8px',
              border: '1px solid var(--card-border)',
              background: 'var(--card-bg)', cursor: earningsRefreshing ? 'default' : 'pointer',
              fontSize: '12px', color: 'var(--text-secondary)',
              opacity: (earningsRefreshing || loading) ? 0.55 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" width="13" height="13"
              style={{ animation: earningsRefreshing ? 'spin 1s linear infinite' : 'none' }}>
              <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" />
              <path d="M8 1v3l2-1.5L8 1Z" fill="currentColor" />
            </svg>
            {earningsRefreshing ? 'Refreshing...' : 'Refresh'}
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </button>
        </div>
        <EarningsWatch rows={earnings_watch} />
      </div>
    </div>
  )
}
