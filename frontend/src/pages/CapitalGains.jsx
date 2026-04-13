import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import { useFilters } from '../context/FilterContext'

// ── Formatters ────────────────────────────────────────────────

const fmtCurrency = (n, currency = 'CAD') => {
  if (n == null) return '—'
  const sym = currency === 'CAD' ? 'C$' : '$'
  return `${sym}${Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const fmtQty = (n) => {
  if (n == null) return '—'
  const num = Number(n)
  return num % 1 === 0 ? num.toLocaleString() : num.toFixed(4)
}

const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

const glColor = (n) => Number(n) >= 0 ? '#14532D' : '#991B1B'
const glPrefix = (n) => Number(n) >= 0 ? '+' : ''
const glPct = (proceeds, acb) => {
  if (!acb || acb === 0) return null
  return ((proceeds - acb) / acb * 100).toFixed(1)
}

// ── Summary bar ───────────────────────────────────────────────

function SummaryBar({ proceeds, acb, gl, currency, label }) {
  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
      {[
        { l: 'Proceeds', v: fmtCurrency(proceeds, currency) },
        { l: 'ACB', v: fmtCurrency(acb, currency) },
        { l: label || 'Net G/L', v: `${glPrefix(gl)}${fmtCurrency(gl, currency)}`, color: glColor(gl) },
      ].map(({ l, v, color }) => (
        <div key={l}>
          <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
            letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '2px' }}>
            {l}
          </div>
          <div style={{ fontSize: '15px', fontWeight: '700', color: color || 'var(--text-primary)' }}>
            {v}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Sell rows table ───────────────────────────────────────────

function SellsTable({ sells, currency }) {
  const thStyle = {
    padding: '7px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--text-secondary)', background: 'var(--content-bg)',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Symbol</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Qty Sold</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Proceeds</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>ACB/Share</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>ACB Total</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>G/L</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Return</th>
          </tr>
        </thead>
        <tbody>
          {sells.map((s, i) => {
            const pct = glPct(s.proceeds, s.acb_total)
            return (
              <tr key={s.id || i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {fmtDate(s.trade_date)}
                </td>
                <td style={{ padding: '8px 12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {s.symbol}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>
                  {fmtQty(s.quantity_sold)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>
                  {fmtCurrency(s.proceeds, currency)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {fmtCurrency(s.acb_per_share, currency)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {fmtCurrency(s.acb_total, currency)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right',
                  fontWeight: '700', color: glColor(s.realized_gl), whiteSpace: 'nowrap' }}>
                  {glPrefix(s.realized_gl)}{fmtCurrency(Math.abs(s.realized_gl), currency)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right',
                  color: pct ? glColor(Number(pct)) : 'var(--text-secondary)' }}>
                  {pct ? `${glPrefix(Number(pct))}${pct}%` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Consolidated table ────────────────────────────────────────

function ConsolidatedTable({ rows, currency }) {
  const thStyle = {
    padding: '7px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--text-secondary)', background: 'var(--accent-light)',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
            <th style={thStyle}>Symbol</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total Qty</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total Proceeds</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>True ACB</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Net G/L</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Return</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Sells</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pct = glPct(r.total_proceeds, r.total_acb)
            return (
              <tr key={r.symbol + i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                <td style={{ padding: '8px 12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {r.symbol}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>
                  {fmtQty(r.total_quantity_sold)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>
                  {fmtCurrency(r.total_proceeds, currency)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {fmtCurrency(r.total_acb, currency)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right',
                  fontWeight: '700', color: glColor(r.total_realized_gl), whiteSpace: 'nowrap' }}>
                  {glPrefix(r.total_realized_gl)}{fmtCurrency(Math.abs(r.total_realized_gl), currency)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right',
                  color: pct ? glColor(Number(pct)) : 'var(--text-secondary)' }}>
                  {pct ? `${glPrefix(Number(pct))}${pct}%` : '—'}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {r.sell_count}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Broker card ───────────────────────────────────────────────

function BrokerCard({ broker, currency }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{ border: '1px solid var(--card-border)', borderRadius: '10px',
      overflow: 'hidden', minWidth: '260px', flex: '1 1 260px', maxWidth: '420px' }}>

      {/* Broker header */}
      <div style={{ padding: '12px 14px', background: 'var(--content-bg)',
        borderBottom: expanded ? '1px solid var(--card-border)' : 'none' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
          {broker.broker_name}
        </div>
        <SummaryBar
          proceeds={broker.total_proceeds}
          acb={broker.total_acb}
          gl={broker.total_realized_gl}
          currency={currency}
        />
        <button onClick={() => setExpanded(e => !e)}
          style={{ fontSize: '11px', fontWeight: '600', color: 'var(--accent)',
            background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {expanded ? '▲ Hide detail' : '▼ Show detail'}
        </button>
      </div>

      {/* Account + sell detail */}
      {expanded && (
        <div>
          {broker.accounts.map(acct => (
            <div key={acct.account_id}>
              <div style={{ padding: '8px 14px', fontSize: '11px', fontWeight: '700',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: 'var(--text-secondary)', background: 'var(--card-bg)',
                borderBottom: '1px solid var(--card-border)' }}>
                {acct.account_nickname || acct.account_type_name || acct.account_type_code}
              </div>
              <SellsTable sells={acct.sells} currency={currency} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Consolidated card ─────────────────────────────────────────

function ConsolidatedCard({ rows, currency, totalProceeds, totalAcb, totalGl }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{ border: '1px solid var(--accent)', borderRadius: '10px',
      overflow: 'hidden', minWidth: '260px', flex: '1 1 260px', maxWidth: '420px',
      background: 'var(--accent-light)' }}>

      {/* Header */}
      <div style={{ padding: '12px 14px',
        borderBottom: expanded ? '1px solid var(--accent)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--accent-dark)' }}>
            Consolidated (CPA View)
          </span>
          <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '10px',
            background: 'var(--accent)', color: 'white', fontWeight: '600' }}>
            CRA
          </span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: '1.5' }}>
          Cross-broker weighted avg ACB — use this for Schedule 3
        </div>
        <SummaryBar
          proceeds={totalProceeds}
          acb={totalAcb}
          gl={totalGl}
          currency={currency}
          label="Net G/L (CPA)"
        />
        <button onClick={() => setExpanded(e => !e)}
          style={{ fontSize: '11px', fontWeight: '600', color: 'var(--accent)',
            background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {expanded ? '▲ Hide detail' : '▼ Show by symbol'}
        </button>
      </div>

      {expanded && (
        <ConsolidatedTable rows={rows} currency={currency} />
      )}
    </div>
  )
}

// ── Member section ────────────────────────────────────────────

function MemberSection({ member, taxYear }) {
  const currency = 'CAD'

  // Consolidated totals
  const consolidatedTotals = member.consolidated.reduce(
    (acc, r) => ({
      proceeds: acc.proceeds + r.total_proceeds,
      acb: acc.acb + r.total_acb,
      gl: acc.gl + r.total_realized_gl,
    }),
    { proceeds: 0, acb: 0, gl: 0 }
  )

  const hasData = member.brokers.length > 0

  return (
    <div style={{ marginBottom: '32px' }}>
      {/* Member header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
          background: 'var(--sidebar-bg)', color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '13px', fontWeight: '700' }}>
          {member.member_name.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)' }}>
          {member.member_name}
        </span>
        {member.member_type === 'CORPORATION' && (
          <span style={{ fontSize: '11px', fontWeight: '600', padding: '1px 7px',
            borderRadius: '4px', background: '#F3E8FF', color: '#6D28D9' }}>
            Corp
          </span>
        )}
        {hasData && (
          <span style={{ fontSize: '12px', color: glColor(member.total_realized_gl),
            fontWeight: '700', marginLeft: '8px' }}>
            {glPrefix(member.total_realized_gl)}
            {fmtCurrency(member.total_realized_gl, currency)} net
          </span>
        )}
      </div>

      {!hasData ? (
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)',
          padding: '16px', background: 'var(--card-bg)',
          border: '1px solid var(--card-border)', borderRadius: '10px' }}>
          No taxable account dispositions in {taxYear}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' }}>
          {/* Broker cards */}
          {member.brokers.map(broker => (
            <BrokerCard
              key={broker.broker_code}
              broker={broker}
              currency={currency}
            />
          ))}
          {/* Consolidated card */}
          {member.consolidated.length > 0 && (
            <ConsolidatedCard
              rows={member.consolidated}
              currency={currency}
              totalProceeds={consolidatedTotals.proceeds}
              totalAcb={consolidatedTotals.acb}
              totalGl={consolidatedTotals.gl}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

function CapitalGains() {
  const { activeFilters, selectedCircle } = useFilters()
  const [taxYears, setTaxYears] = useState([])
  const [selectedYear, setSelectedYear] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [yearsLoading, setYearsLoading] = useState(false)
  const [error, setError] = useState('')

  // Build common params from FilterBar
  const buildParams = useCallback(() => {
    const p = {}
    if (activeFilters.circleId)          p.circle_id    = activeFilters.circleId
    if (activeFilters.memberIds?.length)  p.member_ids   = activeFilters.memberIds.join(',')
    if (activeFilters.accountTypes?.length) p.account_types = activeFilters.accountTypes.join(',')
    if (activeFilters.brokers?.length)    p.brokers      = activeFilters.brokers.join(',')
    return p
  }, [activeFilters])

  // Load available tax years when circle changes
  const fetchTaxYears = useCallback(async () => {
    if (!selectedCircle) { setTaxYears([]); setSelectedYear(null); setData(null); return }
    try {
      setYearsLoading(true)
      const res = await api.get('/capital-gains/tax-years', { params: buildParams() })
      const years = res.data || []
      setTaxYears(years)
      // Default to most recent year
      if (years.length > 0) setSelectedYear(years[0])
      else { setSelectedYear(null); setData(null) }
    } catch {
      setError('Failed to load tax years')
    } finally {
      setYearsLoading(false)
    }
  }, [selectedCircle, buildParams])

  useEffect(() => { fetchTaxYears() }, [fetchTaxYears])

  // Load capital gains data when year or filters change
  const fetchData = useCallback(async () => {
    if (!selectedCircle || !selectedYear) { setData(null); return }
    try {
      setLoading(true); setError('')
      const res = await api.get('/capital-gains', {
        params: { ...buildParams(), tax_year: selectedYear }
      })
      setData(res.data)
    } catch {
      setError('Failed to load capital gains data')
    } finally {
      setLoading(false)
    }
  }, [selectedCircle, selectedYear, buildParams])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700',
            color: 'var(--text-primary)', marginBottom: '4px' }}>
            Capital Gains
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Taxable account dispositions only · per member · per tax year
          </p>
        </div>

        {/* Tax year tabs */}
        {taxYears.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {taxYears.map(yr => (
              <button key={yr} onClick={() => setSelectedYear(yr)}
                style={{
                  padding: '6px 16px', borderRadius: '8px', fontWeight: '600',
                  fontSize: '13px', cursor: 'pointer',
                  border: selectedYear === yr ? 'none' : '1.5px solid var(--card-border)',
                  background: selectedYear === yr ? 'var(--sidebar-bg)' : 'white',
                  color: selectedYear === yr ? 'white' : 'var(--text-primary)',
                }}>
                {yr}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* No circle */}
      {!selectedCircle && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Select a circle from the filter bar to view capital gains
          </p>
        </div>
      )}

      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '8px',
          padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#DC2626' }}>
          {error}
        </div>
      )}

      {/* No data for year */}
      {selectedCircle && !loading && !yearsLoading && taxYears.length === 0 && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📂</div>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            No realized gains found. Import transactions to see capital gains data.
          </p>
        </div>
      )}

      {(loading || yearsLoading) && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)', fontSize: '13px' }}>
          Loading...
        </div>
      )}

      {/* Member sections */}
      {!loading && !yearsLoading && data && (
        <div>
          {data.members.length === 0 ? (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              borderRadius: '12px', padding: '48px', textAlign: 'center' }}>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                No taxable dispositions in {selectedYear} for the selected filters.
              </p>
            </div>
          ) : (
            data.members.map(member => (
              <MemberSection
                key={member.member_id}
                member={member}
                taxYear={selectedYear}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default CapitalGains
