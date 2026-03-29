import { useState, useEffect } from 'react'
import api from '../services/api'
import { useFilters } from '../context/FilterContext'

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

const fmt = (n, decimals = 2) =>
  n == null ? null : Number(n).toLocaleString('en-CA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })

const fmtCurrency = (n) => n == null ? '—' : `$${fmt(Math.abs(n))}`
const fmtQty = (n) => {
  if (n == null) return '—'
  const num = Number(n)
  return num % 1 === 0 ? num.toLocaleString() : num.toFixed(4)
}
const gainColor = (n) => {
  if (n == null) return 'var(--text-primary)'
  return Number(n) >= 0 ? '#14532D' : '#991B1B'
}
const gainPrefix = (n) => n == null ? '' : Number(n) >= 0 ? '+' : ''


// Aggregate account holdings into symbol-level rows
function aggregateBySymbol(accounts) {
  const symbolMap = {}

  for (const account of accounts) {
    for (const h of account.holdings) {
      const sym = h.symbol
      if (!symbolMap[sym]) {
        symbolMap[sym] = {
          symbol: sym,
          asset_type: h.asset_type,
          currency: h.currency,
          current_price: h.current_price,
          day_change_pct: h.day_change_pct,
          quantity_total: 0,
          total_acb: 0,
          market_value: null,
          unrealized_gain_loss: null,
          unrealized_gain_loss_pct: null,
          acb_per_share: 0,
          breakdowns: []
        }
      }

      const entry = symbolMap[sym]
      entry.quantity_total += Number(h.quantity_total || 0)
      entry.total_acb += Number(h.total_acb || 0)
      if (h.market_value != null) {
        entry.market_value = (entry.market_value || 0) + Number(h.market_value)
      }
      if (h.unrealized_gain_loss != null) {
        entry.unrealized_gain_loss = (entry.unrealized_gain_loss || 0) + Number(h.unrealized_gain_loss)
      }

      entry.breakdowns.push({
        account_id: account.account_id,
        member_name: account.member_name,
        account_nickname: account.account_nickname,
        account_type_code: account.account_type_code,
        account_type_name: account.account_type_name,
        broker_name: account.broker_name,
        tax_category: account.tax_category,
        quantity_total: h.quantity_total,
        total_acb: h.total_acb,
        acb_per_share: h.acb_per_share,
        market_value: h.market_value,
        unrealized_gain_loss: h.unrealized_gain_loss,
        unrealized_gain_loss_pct: h.unrealized_gain_loss_pct,
      })
    }
  }

  return Object.values(symbolMap).map(s => {
    s.acb_per_share = s.quantity_total > 0 ? s.total_acb / s.quantity_total : 0
    if (s.market_value != null && s.total_acb > 0) {
      s.unrealized_gain_loss_pct = ((s.market_value - s.total_acb) / s.total_acb) * 100
    }
    s.breakdowns.sort((a, b) => Number(b.total_acb || 0) - Number(a.total_acb || 0))
    return s
  })
}

// Sort holdings array by column key
function sortHoldings(holdings, sortKey, sortDir) {
  const getValue = (h) => {
    switch (sortKey) {
      case 'symbol':               return h.symbol
      case 'quantity_total':       return Number(h.quantity_total || 0)
      case 'acb_per_share':        return Number(h.acb_per_share || 0)
      case 'current_price':        return Number(h.current_price || 0)
      case 'market_value':         return Number(h.market_value || h.total_acb || 0)
      case 'unrealized_gain_loss': return Number(h.unrealized_gain_loss || 0)
      default:                     return Number(h.market_value || h.total_acb || 0)
    }
  }

  return [...holdings].sort((a, b) => {
    const aVal = getValue(a)
    const bVal = getValue(b)
    if (typeof aVal === 'string') {
      return sortDir === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal)
    }
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal
  })
}

// Column sort header
function SortableTh({ label, sortKey, currentSort, currentDir, onSort, align = 'right' }) {
  const active = currentSort === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        padding: '10px 16px', textAlign: align,
        fontSize: '10px', fontWeight: '700',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        color: active ? 'var(--accent-dark)' : 'var(--text-secondary)',
        whiteSpace: 'nowrap', background: 'var(--content-bg)',
        cursor: 'pointer', userSelect: 'none'
      }}
    >
      {label}{' '}
      <span style={{ opacity: active ? 1 : 0.3 }}>
        {active ? (currentDir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </th>
  )
}

function SymbolRow({ holding }) {
  const [expanded, setExpanded] = useState(false)
  const hasPrice = holding.current_price != null
  const hasMultipleAccounts = holding.breakdowns.length > 1

  return (
    <>
      <tr
        onClick={() => hasMultipleAccounts && setExpanded(!expanded)}
        style={{
          borderBottom: expanded ? 'none' : '1px solid var(--filter-row-border)',
          cursor: hasMultipleAccounts ? 'pointer' : 'default',
          background: expanded ? 'var(--accent-light)' : 'transparent',
          transition: 'background 0.1s'
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = 'var(--content-bg)' }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'transparent' }}
      >
        {/* Symbol — chevron always takes same space for alignment */}
        <td style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Fixed-width chevron container — always present, invisible when not expandable */}
            <div style={{ width: '12px', flexShrink: 0 }}>
              {hasMultipleAccounts && (
                <svg viewBox="0 0 14 14" fill="none" width="12" height="12"
                  style={{
                    transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.2s'
                  }}>
                  <path d="M2 4l5 5 5-5" stroke="var(--text-secondary)" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-dark)' }}>
                {holding.symbol}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                {holding.asset_type}
                {hasMultipleAccounts && (
                  <span style={{ marginLeft: '6px', color: 'var(--accent)' }}>
                    {holding.breakdowns.length} accounts
                  </span>
                )}
              </div>
            </div>
          </div>
        </td>

        {/* Quantity */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)' }}>
            {fmtQty(holding.quantity_total)}
          </span>
        </td>

        {/* ACB per share */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            {fmtCurrency(holding.acb_per_share)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
            Total: {fmtCurrency(holding.total_acb)}
          </div>
        </td>

        {/* Current price */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          {hasPrice ? (
            <>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                {fmtCurrency(holding.current_price)}
              </div>
              {holding.day_change_pct != null && (
                <div style={{ fontSize: '10px', marginTop: '1px', color: gainColor(holding.day_change_pct) }}>
                  {gainPrefix(holding.day_change_pct)}{fmt(holding.day_change_pct)}%
                </div>
              )}
            </>
          ) : (
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>—</span>
          )}
        </td>

        {/* Market value */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
            {hasPrice ? fmtCurrency(holding.market_value) : '—'}
          </span>
        </td>

        {/* Unrealized G/L */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          {hasPrice ? (
            <>
              <div style={{ fontSize: '13px', fontWeight: '600', color: gainColor(holding.unrealized_gain_loss) }}>
                {gainPrefix(holding.unrealized_gain_loss)}{fmtCurrency(holding.unrealized_gain_loss)}
              </div>
              <div style={{ fontSize: '10px', marginTop: '1px', color: gainColor(holding.unrealized_gain_loss_pct) }}>
                {gainPrefix(holding.unrealized_gain_loss_pct)}{fmt(holding.unrealized_gain_loss_pct)}%
              </div>
            </>
          ) : (
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>—</span>
          )}
        </td>
      </tr>

      {/* Account breakdowns */}
      {expanded && holding.breakdowns.map((bd, i) => {
        const tc = TAX_COLORS[bd.tax_category] || { bg: '#F3F4F6', color: '#374151' }
        const isLast = i === holding.breakdowns.length - 1
        return (
          <tr key={bd.account_id} style={{
            borderBottom: isLast
              ? '1px solid var(--filter-row-border)'
              : '1px solid var(--accent-light)',
            background: 'var(--accent-light)'
          }}>
            {/* Account — indented to align with symbol text */}
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
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                {bd.account_nickname || bd.account_type_name} · {bd.broker_name}
              </div>
            </td>

            <td style={{ padding: '8px 16px', textAlign: 'right' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                {fmtQty(bd.quantity_total)}
              </span>
            </td>

            <td style={{ padding: '8px 16px', textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                {fmtCurrency(bd.acb_per_share)}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                Total: {fmtCurrency(bd.total_acb)}
              </div>
            </td>

            <td colSpan={3} style={{ padding: '8px 16px', textAlign: 'right' }}>
              {bd.market_value != null ? (
                <span style={{ fontSize: '12px', color: gainColor(bd.unrealized_gain_loss) }}>
                  {gainPrefix(bd.unrealized_gain_loss)}{fmtCurrency(bd.unrealized_gain_loss)}
                  {' '}({gainPrefix(bd.unrealized_gain_loss_pct)}{fmt(bd.unrealized_gain_loss_pct)}%)
                </span>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>—</span>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

function Holdings() {
  const { activeFilters, selectedCircle } = useFilters()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState('market_value')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    if (!selectedCircle) { setData(null); return }
    fetchHoldings()
  }, [activeFilters])

  const fetchHoldings = async () => {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (activeFilters.circleId) params.circle_id = activeFilters.circleId
      if (activeFilters.memberIds?.length) params.member_ids = activeFilters.memberIds.join(',')
      if (activeFilters.accountTypes?.length) params.account_types = activeFilters.accountTypes.join(',')
      if (activeFilters.brokers?.length) params.brokers = activeFilters.brokers.join(',')
      const res = await api.get('/holdings', { params })
      setData(res.data)
    } catch {
      setError('Failed to load holdings')
    } finally {
      setLoading(false)
    }
  }

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const rawSymbols = data ? aggregateBySymbol(data.accounts) : []
  const symbolHoldings = sortHoldings(rawSymbols, sortKey, sortDir)

  const totalSymbols = symbolHoldings.length
  const totalValue = symbolHoldings.reduce((sum, h) => sum + (h.market_value ?? h.total_acb ?? 0), 0)
  const totalGain = symbolHoldings.reduce((sum, h) => sum + (h.unrealized_gain_loss ?? 0), 0)
  const hasAnyGain = symbolHoldings.some(h => h.unrealized_gain_loss != null)

  const columns = [
    { label: 'Symbol',          key: 'symbol',               align: 'left' },
    { label: 'Quantity',        key: 'quantity_total',        align: 'right' },
    { label: 'Avg Cost (ACB)',  key: 'acb_per_share',         align: 'right' },
    { label: 'Current Price',   key: 'current_price',         align: 'right' },
    { label: 'Market Value',    key: 'market_value',          align: 'right' },
    { label: 'Unrealized G/L',  key: 'unrealized_gain_loss',  align: 'right' },
  ]

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
          Holdings
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {data
            ? `${totalSymbols} position${totalSymbols !== 1 ? 's' : ''}${selectedCircle ? ` in ${selectedCircle.name}` : ''}`
            : 'Current portfolio positions'}
        </p>
      </div>

      {/* No circle */}
      {!selectedCircle && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📊</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
            Select a circle to view holdings
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Use the Circle filter above to get started
          </div>
        </div>
      )}

      {error && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '8px',
          padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#DC2626'
        }}>
          {error}
        </div>
      )}

      {selectedCircle && loading && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '40px', textAlign: 'center',
          color: 'var(--text-secondary)', fontSize: '13px'
        }}>
          Loading holdings...
        </div>
      )}

      {/* Summary bar */}
      {selectedCircle && !loading && symbolHoldings.length > 0 && (
        <div style={{
          display: 'flex', gap: '24px', flexWrap: 'wrap',
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '16px 20px', marginBottom: '16px',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
              Positions
            </div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>
              {totalSymbols}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
              {hasAnyGain ? 'Market Value' : 'Total ACB'}
            </div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>
              {fmtCurrency(totalValue)}
            </div>
          </div>
          {hasAnyGain && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
                Unrealized G/L
              </div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: gainColor(totalGain) }}>
                {gainPrefix(totalGain)}{fmtCurrency(totalGain)}
              </div>
            </div>
          )}
          {!hasAnyGain && (
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-secondary)' }}>
              💡 Set up the price scheduler to see market value & unrealized G/L
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {selectedCircle && !loading && symbolHoldings.length === 0 && !error && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📂</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
            No holdings found
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Upload transaction files under Admin → Upload Transactions
          </div>
        </div>
      )}

      {/* Table */}
      {selectedCircle && !loading && symbolHoldings.length > 0 && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', overflow: 'hidden'
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                  {columns.map(col => (
                    <SortableTh
                      key={col.key}
                      label={col.label}
                      sortKey={col.key}
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align={col.align}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {symbolHoldings.map(h => (
                  <SymbolRow key={h.symbol} holding={h} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default Holdings