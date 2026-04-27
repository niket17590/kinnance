import { useState, useCallback, useEffect } from 'react'
import api from '../services/api'
import { useFilters } from '../context/FilterContext'
import { useRefresh } from '../context/RefreshContext'

// ── Helpers ───────────────────────────────────────────────────

const fmt = (n, decimals = 2) =>
  n == null ? null : Number(n).toLocaleString('en-CA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })

const fmtCurrency = (n, currency = 'USD') => {
  if (n == null) return '—'
  const sym = currency === 'CAD' ? 'C$' : '$'
  return `${sym}${fmt(Math.abs(n))}`
}

const fmtQty = (n) => {
  if (n == null) return '—'
  const num = Number(n)
  return num % 1 === 0 ? num.toLocaleString() : num.toFixed(4)
}

const fmtPct = (n) => n == null ? '—' : `${Number(n) >= 0 ? '+' : ''}${fmt(n)}%`

const gainColor = (n) => {
  if (n == null) return 'var(--text-primary)'
  return Number(n) >= 0 ? '#14532D' : '#991B1B'
}

const gainPrefix = (n) => n == null ? '' : Number(n) >= 0 ? '+' : ''

const TAX_COLORS = {
  TAX_FREE:     { bg: '#DCFCE7', color: '#14532D' },
  TAX_DEFERRED: { bg: '#DBEAFE', color: '#1D4ED8' },
  TAXABLE:      { bg: '#FEF3C7', color: '#92400E' },
  CORP_TAXABLE: { bg: '#F3E8FF', color: '#6D28D9' },
}

const TAX_LABELS = {
  TAX_FREE: 'Tax free',
  TAX_DEFERRED: 'Tax deferred',
  TAXABLE: 'Taxable',
  CORP_TAXABLE: 'Corp',
}

// ── Sort header ───────────────────────────────────────────────

function SortTh({ label, sortKey, current, dir, onSort, align = 'right', width }) {
  const active = current === sortKey
  return (
    <th onClick={() => onSort(sortKey)} style={{
      padding: '10px 16px',
      textAlign: align,
      fontSize: '10px',
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      color: active ? 'var(--accent-dark)' : 'var(--text-secondary)',
      whiteSpace: 'nowrap',
      background: 'var(--content-bg)',
      cursor: 'pointer',
      userSelect: 'none',
      width: width || 'auto'
    }}>
      {label}{' '}
      <span style={{ opacity: active ? 1 : 0.3 }}>
        {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </th>
  )
}

// ── Account breakdown row ─────────────────────────────────────

function BreakdownRow({ bd, currency, isLast }) {
  const tc = TAX_COLORS[bd.tax_category] || { bg: '#F3F4F6', color: '#374151' }

  return (
    <tr style={{
      borderBottom: isLast ? '1px solid var(--filter-row-border)' : '1px solid var(--accent-light)',
      background: 'var(--accent-light)'
    }}>
      {/* Account info */}
      <td style={{ padding: '8px 16px 8px 36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
            {bd.member_name}
          </span>
          <span style={{
            fontSize: '10px', fontWeight: '600',
            padding: '1px 6px', borderRadius: '4px', ...tc
          }}>
            {TAX_LABELS[bd.tax_category] || bd.tax_category}
          </span>
          {!bd.is_position_open && (
            <span style={{
              fontSize: '10px', color: 'var(--text-secondary)',
              padding: '1px 5px', borderRadius: '4px',
              background: 'var(--filter-row-border)'
            }}>
              closed
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>
          {bd.account_nickname || bd.account_type_name} · {bd.broker_name}
        </div>
      </td>

      {/* Qty */}
      <td style={{ padding: '8px 16px', textAlign: 'right' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
          {bd.is_position_open ? fmtQty(bd.quantity_total) : '0'}
        </span>
      </td>

      {/* ACB */}
      <td style={{ padding: '8px 16px', textAlign: 'right' }}>
        {bd.is_position_open ? (
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
              {fmtCurrency(bd.acb_per_share, currency)}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
              Total: {fmtCurrency(bd.total_acb, currency)}
            </div>
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>—</span>
        )}
      </td>

      {/* Price */}
      <td style={{ padding: '8px 16px', textAlign: 'right' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>—</span>
      </td>

      {/* Invested — not shown at breakdown level */}
      <td style={{ padding: '8px 16px' }} />

      {/* Market value */}
      <td style={{ padding: '8px 16px', textAlign: 'right' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
          {bd.market_value != null ? fmtCurrency(bd.market_value, currency) : '—'}
        </span>
      </td>

      {/* Unrealized G/L */}
      <td style={{ padding: '8px 16px', textAlign: 'right' }}>
        {bd.unrealized_gl != null ? (
          <div style={{ fontSize: '12px', color: gainColor(bd.unrealized_gl) }}>
            {gainPrefix(bd.unrealized_gl)}{fmtCurrency(bd.unrealized_gl, currency)}
            <span style={{ marginLeft: '4px', opacity: 0.8 }}>
              ({fmtPct(bd.unrealized_gl_pct)})
            </span>
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>—</span>
        )}
      </td>

      {/* Realized G/L */}
      <td style={{ padding: '8px 16px', textAlign: 'right' }}>
        {bd.realized_gl !== 0 ? (
          <span style={{ fontSize: '12px', color: gainColor(bd.realized_gl) }}>
            {gainPrefix(bd.realized_gl)}{fmtCurrency(bd.realized_gl, currency)}
          </span>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>—</span>
        )}
      </td>

      {/* Holding % — not shown at account level */}
      <td style={{ padding: '8px 16px' }} />
    </tr>
  )
}

// ── Open position row ─────────────────────────────────────────

function OpenRow({ position }) {
  const [expanded, setExpanded] = useState(false)
  const multi = position.breakdowns.length > 1
  const hasPrice = position.current_price != null
  const { currency } = position

  return (
    <>
      <tr
        onClick={() => multi && setExpanded(!expanded)}
        style={{
          borderBottom: expanded ? 'none' : '1px solid var(--filter-row-border)',
          cursor: multi ? 'pointer' : 'default',
          background: expanded ? 'var(--accent-light)' : 'transparent',
          transition: 'background 0.1s'
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = 'var(--content-bg)' }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'transparent' }}
      >
        {/* Symbol */}
        <td style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '12px', flexShrink: 0 }}>
              {multi && (
                <svg viewBox="0 0 14 14" fill="none" width="12" height="12"
                  style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>
                  <path d="M2 4l5 5 5-5" stroke="var(--text-secondary)" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-dark)' }}>
                {position.symbol}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                {position.asset_type} · {currency}
                {multi && (
                  <span style={{ marginLeft: '6px', color: 'var(--accent)' }}>
                    {position.breakdowns.length} accounts
                  </span>
                )}
              </div>
            </div>
          </div>
        </td>

        {/* Qty */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)' }}>
            {fmtQty(position.quantity_total)}
          </span>
        </td>

        {/* ACB per share */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            {fmtCurrency(position.acb_per_share, currency)}
          </div>
        </td>

        {/* Current price */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          {hasPrice ? (
            <>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                {fmtCurrency(position.current_price, currency)}
              </div>
              {position.day_change_pct != null && (
                <div style={{ fontSize: '10px', marginTop: '1px', color: gainColor(position.day_change_pct) }}>
                  {gainPrefix(position.day_change_pct)}{fmt(position.day_change_pct)}% today
                </div>
              )}
            </>
          ) : (
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>—</span>
          )}
        </td>

        {/* Invested (Total ACB) */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {fmtCurrency(position.total_acb, currency)}
          </span>
        </td>

        {/* Market value */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
            {hasPrice ? fmtCurrency(position.market_value, currency) : '—'}
          </span>
        </td>

        {/* Unrealized G/L */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          {hasPrice ? (
            <>
              <div style={{ fontSize: '13px', fontWeight: '600', color: gainColor(position.unrealized_gl) }}>
                {gainPrefix(position.unrealized_gl)}{fmtCurrency(position.unrealized_gl, currency)}
              </div>
              <div style={{ fontSize: '10px', marginTop: '1px', color: gainColor(position.unrealized_gl_pct) }}>
                {fmtPct(position.unrealized_gl_pct)}
              </div>
            </>
          ) : (
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>—</span>
          )}
        </td>

        {/* Realized G/L */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          {position.realized_gl !== 0 ? (
            <>
              <div style={{ fontSize: '13px', fontWeight: '600', color: gainColor(position.realized_gl) }}>
                {gainPrefix(position.realized_gl)}{fmtCurrency(position.realized_gl, currency)}
              </div>
              {position.realized_gl_pct != null && (
                <div style={{ fontSize: '10px', marginTop: '1px', color: gainColor(position.realized_gl_pct) }}>
                  {fmtPct(position.realized_gl_pct)}
                </div>
              )}
            </>
          ) : (
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>—</span>
          )}
        </td>

        {/* Holding % */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {position.holding_pct != null ? `${fmt(position.holding_pct)}%` : '—'}
          </span>
        </td>
      </tr>

      {/* Account breakdowns */}
      {expanded && position.breakdowns.map((bd, i) => (
        <BreakdownRow
          key={bd.account_id}
          bd={bd}
          currency={currency}
          isLast={i === position.breakdowns.length - 1}
        />
      ))}
    </>
  )
}

// ── Closed position row ───────────────────────────────────────

function ClosedRow({ position }) {
  const [expanded, setExpanded] = useState(false)
  const multi = position.breakdowns.length > 1
  const { currency } = position

  return (
    <>
      <tr
        onClick={() => multi && setExpanded(!expanded)}
        style={{
          borderBottom: expanded ? 'none' : '1px solid var(--filter-row-border)',
          cursor: multi ? 'pointer' : 'default',
          opacity: 0.8
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--content-bg)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Symbol */}
        <td style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '12px', flexShrink: 0 }}>
              {multi && (
                <svg viewBox="0 0 14 14" fill="none" width="12" height="12"
                  style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>
                  <path d="M2 4l5 5 5-5" stroke="var(--text-secondary)" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                {position.symbol}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                {position.asset_type} · closed
              </div>
            </div>
          </div>
        </td>
        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>0</span>
        </td>
        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Proceeds: {fmtCurrency(position.total_cost_sold, currency)}
          </span>
        </td>
        <td colSpan={4} />
        {/* Realized G/L */}
        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: gainColor(position.realized_gl) }}>
            {gainPrefix(position.realized_gl)}{fmtCurrency(position.realized_gl, currency)}
          </div>
          {position.realized_gl_pct != null && (
            <div style={{ fontSize: '10px', marginTop: '1px', color: gainColor(position.realized_gl_pct) }}>
              {fmtPct(position.realized_gl_pct)}
            </div>
          )}
        </td>
        <td />
      </tr>

      {expanded && position.breakdowns.map((bd, i) => (
        <BreakdownRow
          key={bd.account_id}
          bd={bd}
          currency={currency}
          isLast={i === position.breakdowns.length - 1}
        />
      ))}
    </>
  )
}

// ── Table wrapper ─────────────────────────────────────────────

function HoldingsTable({ positions, isOpen, sortKey, sortDir, onSort }) {
  const cols = [
    { label: 'Symbol',       key: 'symbol',       align: 'left' },
    { label: 'Quantity',     key: 'quantity_total', align: 'right' },
    { label: 'ACB / Share',  key: 'acb_per_share', align: 'right' },
    { label: 'Current Price',key: 'current_price', align: 'right' },
    { label: 'Invested',     key: 'total_acb',     align: 'right' },
    { label: 'Market Value', key: 'market_value',  align: 'right' },
    { label: 'Unrealized G/L', key: 'unrealized_gl', align: 'right' },
    { label: 'Realized G/L',   key: 'realized_gl',   align: 'right' },
    { label: 'Weight',         key: 'holding_pct',   align: 'right' },
  ]

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
            {cols.map(col => (
              <SortTh
                key={col.key}
                label={col.label}
                sortKey={col.key}
                current={sortKey}
                dir={sortDir}
                onSort={onSort}
                align={col.align}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map(p => isOpen
            ? <OpenRow key={p.symbol} position={p} />
            : <ClosedRow key={p.symbol} position={p} />
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Holdings page ────────────────────────────────────────

function sortPositions(positions, key, dir) {
  return [...positions].sort((a, b) => {
    const aVal = a[key] ?? (typeof a[key] === 'string' ? '' : -Infinity)
    const bVal = b[key] ?? (typeof b[key] === 'string' ? '' : -Infinity)
    if (typeof aVal === 'string') {
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    return dir === 'asc' ? aVal - bVal : bVal - aVal
  })
}

function Holdings() {
  const { debouncedFilters, selectedCircle } = useFilters()
  const { refreshNow, isRefreshing } = useRefresh()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [sortKey, setSortKey] = useState('market_value')
  const [sortDir, setSortDir] = useState('desc')

  const fetchHoldings = useCallback(async () => {
    if (!selectedCircle) { setData(null); return }
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (debouncedFilters.circleId) params.circle_id = debouncedFilters.circleId
      if (debouncedFilters.memberIds?.length) params.member_ids = debouncedFilters.memberIds.join(',')
      if (debouncedFilters.accountTypes?.length) params.account_types = debouncedFilters.accountTypes.join(',')
      if (debouncedFilters.brokers?.length) params.brokers = debouncedFilters.brokers.join(',')
      const res = await api.get('/holdings', { params })
      setData(res.data)
    } catch {
      setError('Failed to load holdings')
    } finally {
      setLoading(false)
    }
  }, [debouncedFilters, selectedCircle])

  // Stable string key — only changes when debounced filter values actually change
  const filterKey = JSON.stringify(debouncedFilters)

  // Fetch when filters change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchHoldings() }, [filterKey])

  // Fetch when auto-refresh timer fires (every 5 min)
  const { lastRefreshed } = useRefresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchHoldings() }, [lastRefreshed])

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const openPositions = sortPositions(data?.open_positions || [], sortKey, sortDir)
  const closedPositions = sortPositions(data?.closed_positions || [], sortKey, sortDir)
  const summary = data?.summary || {}

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
            Holdings
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {data
              ? `${openPositions.length} open · ${closedPositions.length} closed${selectedCircle ? ` · ${selectedCircle.name}` : ''}`
              : 'Current portfolio positions'}
          </p>
        </div>

        {/* Manual refresh button */}
        {selectedCircle && (
          <button
            onClick={refreshNow}
            disabled={isRefreshing || loading}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 14px', borderRadius: '8px',
              border: '1px solid var(--card-border)',
              background: 'var(--card-bg)', cursor: 'pointer',
              fontSize: '12px', color: 'var(--text-secondary)',
              opacity: (isRefreshing || loading) ? 0.5 : 1
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" width="13" height="13"
              style={{ animation: (isRefreshing || loading) ? 'spin 1s linear infinite' : 'none' }}>
              <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" />
              <path d="M8 1v3l2-1.5L8 1Z" fill="currentColor" />
            </svg>
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </button>
        )}
      </div>

      {/* No circle */}
      {!selectedCircle && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📊</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>Select a circle to view holdings</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Use the Circle filter above to get started</div>
        </div>
      )}

      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#DC2626' }}>
          {error}
        </div>
      )}

      {selectedCircle && loading && !data && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
          Loading holdings...
        </div>
      )}

      {/* Summary bar */}
      {selectedCircle && data && openPositions.length > 0 && (
        <div style={{ display: 'flex', gap: '0', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', marginBottom: '16px', overflow: 'hidden' }}>
          {[
            {
              label: 'Positions',
              value: openPositions.length,
              isCount: true,
            },
            {
              label: 'Total Invested',
              value: summary.total_invested != null ? `$${fmt(summary.total_invested)}` : '—',
              sub: null,
            },
            {
              label: summary.total_market_value != null ? 'Market Value' : 'Invested (ACB)',
              value: `$${fmt(summary.total_market_value ?? summary.total_invested)}`,
              sub: null,
            },
            ...(summary.total_unrealized_gl != null ? [{
              label: 'Unrealized G/L',
              value: `${gainPrefix(summary.total_unrealized_gl)}$${fmt(Math.abs(summary.total_unrealized_gl))}`,
              sub: summary.total_unrealized_gl_pct != null ? `${gainPrefix(summary.total_unrealized_gl_pct)}${fmt(summary.total_unrealized_gl_pct)}%` : null,
              gain: summary.total_unrealized_gl,
            }] : []),
            ...(summary.total_daily_gl != null ? [{
              label: "Today's G/L",
              value: `${gainPrefix(summary.total_daily_gl)}$${fmt(Math.abs(summary.total_daily_gl))}`,
              sub: summary.total_daily_gl_pct != null ? `${gainPrefix(summary.total_daily_gl_pct)}${fmt(summary.total_daily_gl_pct)}%` : null,
              gain: summary.total_daily_gl,
            }] : []),
          ].map((tile, i) => (
            <div key={i} style={{
              flex: 1,
              padding: '14px 20px',
              borderRight: '1px solid var(--card-border)',
              borderRightWidth: i === 4 ? '0' : '1px',
            }}>
              <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: '4px' }}>
                {tile.label}
              </div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: tile.gain != null ? gainColor(tile.gain) : 'var(--text-primary)', lineHeight: 1.2 }}>
                {tile.isCount ? tile.value : tile.value}
              </div>
              {tile.sub && (
                <div style={{ fontSize: '11px', fontWeight: '600', color: gainColor(tile.gain), marginTop: '2px' }}>
                  {tile.sub}
                </div>
              )}
            </div>
          ))}
          {!summary.has_prices && (
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              💡 Prices updating
            </div>
          )}
        </div>
      )}

      {/* Empty */}
      {selectedCircle && !loading && openPositions.length === 0 && closedPositions.length === 0 && !error && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📂</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>No holdings found</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Upload transaction files under Admin → Upload Transactions</div>
        </div>
      )}

      {/* Open positions */}
      {selectedCircle && openPositions.length > 0 && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', overflow: 'hidden', marginBottom: '12px' }}>
          <div style={{ padding: '12px 16px', background: 'var(--content-bg)', borderBottom: '1px solid var(--card-border)', fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Open Positions ({openPositions.length})
          </div>
          <HoldingsTable
            positions={openPositions}
            isOpen={true}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
          />
        </div>
      )}

      {/* Closed positions */}
      {selectedCircle && closedPositions.length > 0 && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', overflow: 'hidden' }}>
          <div
            onClick={() => setShowClosed(!showClosed)}
            style={{ padding: '12px 16px', background: 'var(--content-bg)', borderBottom: showClosed ? '1px solid var(--card-border)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Closed Positions ({closedPositions.length})
            </span>
            <svg viewBox="0 0 14 14" fill="none" width="13" height="13"
              style={{ transform: showClosed ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>
              <path d="M2 4l5 5 5-5" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {showClosed && (
            <HoldingsTable
              positions={closedPositions}
              isOpen={false}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default Holdings
