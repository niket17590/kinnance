import { useState, useEffect, useCallback, useRef } from 'react'
import { transactionsApi } from '../services/api'
import { useFilters } from '../context/FilterContext'

// ── Constants ─────────────────────────────────────────────────

const ALL_TYPES = [
  { key: 'BUY',               label: 'Buy' },
  { key: 'SELL',              label: 'Sell' },
  { key: 'DIVIDEND',          label: 'Dividend' },
  { key: 'INTEREST',          label: 'Interest' },
  { key: 'DEPOSIT',           label: 'Deposit' },
  { key: 'WITHDRAWAL',        label: 'Withdrawal' },
  { key: 'FX_CONVERSION',     label: 'FX' },
  { key: 'FEE',               label: 'Fee' },
  { key: 'INTERNAL_TRANSFER', label: 'Transfer' },
  { key: 'NORBERT_GAMBIT',    label: 'Norbert' },
  { key: 'CORPORATE_ACTION',  label: 'Corp Action' },
  { key: 'STOCK_SPLIT',       label: 'Split' },
  { key: 'RETURN_OF_CAPITAL', label: 'ROC' },
]

const TYPE_COLORS = {
  BUY:               { bg: '#DCFCE7', color: '#14532D' },
  SELL:              { bg: '#FEE2E2', color: '#991B1B' },
  DIVIDEND:          { bg: '#DBEAFE', color: '#1D4ED8' },
  INTEREST:          { bg: '#DBEAFE', color: '#1D4ED8' },
  DEPOSIT:           { bg: '#F3E8FF', color: '#6D28D9' },
  WITHDRAWAL:        { bg: '#FEF3C7', color: '#92400E' },
  FX_CONVERSION:     { bg: '#FEF3C7', color: '#92400E' },
  FEE:               { bg: '#F3F4F6', color: '#374151' },
  INTERNAL_TRANSFER: { bg: '#F3F4F6', color: '#374151' },
  NORBERT_GAMBIT:    { bg: '#FEF3C7', color: '#92400E' },
  CORPORATE_ACTION:  { bg: '#F3E8FF', color: '#6D28D9' },
  STOCK_SPLIT:       { bg: '#F3E8FF', color: '#6D28D9' },
  RETURN_OF_CAPITAL: { bg: '#CCFBF1', color: '#0F766E' },
}

const TYPE_LABELS = Object.fromEntries(ALL_TYPES.map(t => [t.key, t.label]))

// ── Formatters ────────────────────────────────────────────────

const formatAmount = (amount, currency) => {
  if (amount == null) return '—'
  const num = parseFloat(amount)
  const formatted = Math.abs(num).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const sign = num < 0 ? '−' : '+'
  const sym = currency === 'CAD' ? 'C$' : '$'
  return `${sign}${sym}${formatted}`
}

const formatQty = (qty) => {
  if (qty == null) return '—'
  const num = parseFloat(qty)
  return num % 1 === 0 ? num.toLocaleString() : num.toFixed(4)
}

const formatPrice = (price) => {
  if (price == null) return '—'
  return `$${parseFloat(price).toFixed(2)}`
}

const formatDate = (dateStr) => {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Filter pill ───────────────────────────────────────────────

function TypePill({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', borderRadius: '20px', cursor: 'pointer',
      fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap',
      border: `1.5px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
      background: active ? 'var(--accent)' : 'white',
      color: active ? 'white' : 'var(--text-secondary)',
      transition: 'all 0.1s',
    }}>
      {label}
    </button>
  )
}

// ── Local filter bar ──────────────────────────────────────────

function TransactionFilters({ filters, onChange, onReset, hasActiveFilters }) {
  const symbolRef = useRef(null)
  const debounceRef = useRef(null)

  const handleSymbolChange = (val) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange({ symbol: val })
    }, 300)
  }

  const toggleType = (key) => {
    const current = filters.transaction_types
    const next = current.includes(key)
      ? current.filter(t => t !== key)
      : [...current, key]
    onChange({ transaction_types: next })
  }

  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: '12px', padding: '14px 16px', marginBottom: '16px',
      display: 'flex', flexDirection: 'column', gap: '12px',
    }}>
      {/* Row 1 — date range + symbol */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
          letterSpacing: '0.05em', color: 'var(--text-secondary)', flexShrink: 0 }}>
          Date
        </span>
        <input
          type="date"
          value={filters.date_from}
          onChange={e => onChange({ date_from: e.target.value })}
          style={dateInputStyle}
        />
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>to</span>
        <input
          type="date"
          value={filters.date_to}
          onChange={e => onChange({ date_to: e.target.value })}
          style={dateInputStyle}
        />

        <div style={{ width: '1px', height: '18px', background: 'var(--card-border)', margin: '0 4px' }} />

        <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
          letterSpacing: '0.05em', color: 'var(--text-secondary)', flexShrink: 0 }}>
          Symbol
        </span>
        <input
          ref={symbolRef}
          type="text"
          placeholder="e.g. AAPL"
          defaultValue={filters.symbol}
          onChange={e => handleSymbolChange(e.target.value)}
          style={{
            padding: '5px 10px', borderRadius: '7px', fontSize: '12px',
            border: '1.5px solid var(--card-border)', outline: 'none',
            color: 'var(--text-primary)', background: 'white', width: '100px',
          }}
        />

        {/* Reset — only shown when filters active */}
        {hasActiveFilters && (
          <button onClick={onReset} style={{
            marginLeft: 'auto', padding: '5px 12px', borderRadius: '7px',
            border: '1.5px solid var(--card-border)', background: 'white',
            fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            ✕ Reset filters
          </button>
        )}
      </div>

      {/* Row 2 — type pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
          letterSpacing: '0.05em', color: 'var(--text-secondary)', flexShrink: 0, marginRight: '2px' }}>
          Type
        </span>
        <TypePill
          label="All"
          active={filters.transaction_types.length === 0}
          onClick={() => onChange({ transaction_types: [] })}
        />
        {ALL_TYPES.map(t => (
          <TypePill
            key={t.key}
            label={t.label}
            active={filters.transaction_types.includes(t.key)}
            onClick={() => toggleType(t.key)}
          />
        ))}
      </div>
    </div>
  )
}

const dateInputStyle = {
  padding: '5px 10px', borderRadius: '7px', fontSize: '12px',
  border: '1.5px solid var(--card-border)', outline: 'none',
  color: 'var(--text-primary)', background: 'white',
}

// ── Sort header ───────────────────────────────────────────────

function SortHeader({ sortDir, onToggle }) {
  return (
    <th onClick={onToggle} style={{
      padding: '10px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-dark)',
      background: 'var(--content-bg)', cursor: 'pointer', userSelect: 'none',
      whiteSpace: 'nowrap',
    }}>
      Date {sortDir === 'desc' ? '↓' : '↑'}
    </th>
  )
}

// ── Transaction row ───────────────────────────────────────────

function TxnRow({ txn }) {
  const tc = TYPE_COLORS[txn.transaction_type] || { bg: '#F3F4F6', color: '#374151' }
  const label = TYPE_LABELS[txn.transaction_type] || txn.transaction_type
  const amountColor = parseFloat(txn.net_amount) >= 0 ? '#14532D' : '#991B1B'

  return (
    <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
      <td style={{ padding: '10px 16px', fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {formatDate(txn.trade_date)}
      </td>
      <td style={{ padding: '10px 16px' }}>
        <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px',
          borderRadius: '5px', ...tc, whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </td>
      <td style={{ padding: '10px 16px', fontSize: '13px', fontWeight: '600',
        color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        {txn.symbol_normalized || '—'}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', fontSize: '12px',
        color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        {formatQty(txn.quantity)}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', fontSize: '12px',
        color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {formatPrice(txn.price_per_unit)}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', fontSize: '12px',
        fontWeight: '600', color: amountColor, whiteSpace: 'nowrap' }}>
        {formatAmount(txn.net_amount, txn.trade_currency)}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', fontSize: '12px',
        color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {formatAmount(txn.net_amount_cad, 'CAD')}
      </td>
      <td style={{ padding: '10px 16px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
          {txn.member_name}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>
          {txn.account_nickname || txn.account_type_name} · {txn.broker_name}
        </div>
      </td>
      <td style={{ padding: '10px 16px', fontSize: '11px', color: 'var(--text-secondary)',
        maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {txn.description || '—'}
      </td>
    </tr>
  )
}

// ── Default filter state ──────────────────────────────────────

const DEFAULT_FILTERS = {
  date_from: '',
  date_to: '',
  transaction_types: [],
  symbol: '',
}

// ── Main page ─────────────────────────────────────────────────

function Transactions() {
  const { activeFilters, selectedCircle } = useFilters()
  const [transactions, setTransactions] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [sortDir, setSortDir] = useState('desc')
  const [localFilters, setLocalFilters] = useState(DEFAULT_FILTERS)

  const hasActiveFilters =
    localFilters.date_from ||
    localFilters.date_to ||
    localFilters.transaction_types.length > 0 ||
    localFilters.symbol

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = { page, page_size: 50, sort_dir: sortDir }

      // Global filters
      if (activeFilters.circleId)         params.circle_id      = activeFilters.circleId
      if (activeFilters.memberIds?.length) params.member_ids     = activeFilters.memberIds.join(',')
      if (activeFilters.accountTypes?.length) params.account_types = activeFilters.accountTypes.join(',')
      if (activeFilters.brokers?.length)   params.brokers        = activeFilters.brokers.join(',')

      // Local filters
      if (localFilters.date_from)                    params.date_from         = localFilters.date_from
      if (localFilters.date_to)                      params.date_to           = localFilters.date_to
      if (localFilters.transaction_types.length > 0) params.transaction_types = localFilters.transaction_types.join(',')
      if (localFilters.symbol)                       params.symbol            = localFilters.symbol

      const res = await transactionsApi.getAll(params)
      setTransactions(res.data.transactions)
      setPagination(res.data.pagination)
    } catch {
      setError('Failed to load transactions')
    } finally {
      setLoading(false)
    }
  }, [activeFilters, localFilters, page, sortDir])

  // Reset to page 1 when any filter or sort changes
  useEffect(() => { setPage(1) }, [activeFilters, localFilters, sortDir])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  const handleFilterChange = (patch) => {
    setLocalFilters(prev => ({ ...prev, ...patch }))
  }

  const handleReset = () => {
    setLocalFilters(DEFAULT_FILTERS)
  }

  const thStyle = {
    padding: '10px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)',
    background: 'var(--content-bg)', whiteSpace: 'nowrap',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
          Transactions
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {pagination
            ? `${pagination.total.toLocaleString()} transaction${pagination.total !== 1 ? 's' : ''}${selectedCircle ? ` · ${selectedCircle.name}` : ''}`
            : 'All financial events across your accounts'}
        </p>
      </div>

      {/* Local filter bar */}
      <TransactionFilters
        filters={localFilters}
        onChange={handleFilterChange}
        onReset={handleReset}
        hasActiveFilters={hasActiveFilters}
      />

      {/* No circle selected */}
      {!selectedCircle && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</div>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Select a circle from the filter bar to view transactions
          </p>
        </div>
      )}

      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '8px',
          padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#DC2626' }}>
          {error}
        </div>
      )}

      {selectedCircle && !error && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', overflow: 'hidden' }}>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)', fontSize: '13px' }}>
              Loading...
            </div>
          ) : transactions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)', fontSize: '13px' }}>
              No transactions found{hasActiveFilters ? ' — try adjusting your filters' : ''}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <SortHeader sortDir={sortDir} onToggle={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} />
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Symbol</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Qty</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>CAD</th>
                    <th style={thStyle}>Account</th>
                    <th style={thStyle}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(txn => <TxnRow key={txn.id} txn={txn} />)}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.total_pages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderTop: '1px solid var(--card-border)' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {((page - 1) * 50) + 1}–{Math.min(page * 50, pagination.total)} of {pagination.total.toLocaleString()}
              </span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button onClick={() => setPage(p => p - 1)} disabled={!pagination.has_prev}
                  style={{ padding: '5px 12px', borderRadius: '6px', border: '1.5px solid var(--card-border)',
                    background: 'white', fontSize: '12px', fontWeight: '600',
                    cursor: pagination.has_prev ? 'pointer' : 'not-allowed',
                    opacity: pagination.has_prev ? 1 : 0.4, color: 'var(--text-primary)' }}>
                  ← Prev
                </button>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '0 8px' }}>
                  Page {page} of {pagination.total_pages}
                </span>
                <button onClick={() => setPage(p => p + 1)} disabled={!pagination.has_next}
                  style={{ padding: '5px 12px', borderRadius: '6px', border: '1.5px solid var(--card-border)',
                    background: 'white', fontSize: '12px', fontWeight: '600',
                    cursor: pagination.has_next ? 'pointer' : 'not-allowed',
                    opacity: pagination.has_next ? 1 : 0.4, color: 'var(--text-primary)' }}>
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Transactions
