import { useState, useEffect } from 'react'
import { transactionsApi } from '../services/api'
import { useFilters } from '../context/FilterContext'

// Transaction type badge colors
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
}

const typeColor = (type) => TYPE_COLORS[type] || { bg: '#F3F4F6', color: '#374151' }

const typeLabel = (type) => {
  const labels = {
    BUY: 'Buy',
    SELL: 'Sell',
    DIVIDEND: 'Dividend',
    INTEREST: 'Interest',
    DEPOSIT: 'Deposit',
    WITHDRAWAL: 'Withdrawal',
    FX_CONVERSION: 'FX',
    FEE: 'Fee',
    INTERNAL_TRANSFER: 'Transfer',
    NORBERT_GAMBIT: 'Norbert',
    CORPORATE_ACTION: 'Corp Action',
    STOCK_SPLIT: 'Split',
    OPTION_PREMIUM: 'Option',
    OPTION_BUY_BACK: 'Option',
    OPTION_ASSIGNED: 'Assigned',
    OPTION_EXPIRED: 'Expired',
  }
  return labels[type] || type
}

const formatAmount = (amount, currency) => {
  if (amount == null) return '—'
  const num = parseFloat(amount)
  const formatted = Math.abs(num).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
  const sign = num < 0 ? '-' : '+'
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
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

function Transactions() {
  const { activeFilters, selectedCircle } = useFilters()
  const [transactions, setTransactions] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1)
  }, [activeFilters])

  // Fetch transactions when filters or page change
  useEffect(() => {
    fetchTransactions()
  }, [activeFilters, page])

  const fetchTransactions = async () => {
    setLoading(true)
    setError('')
    try {
      const params = {
        page,
        page_size: 50
      }

      if (activeFilters.circleId) params.circle_id = activeFilters.circleId
      if (activeFilters.memberIds?.length) params.member_ids = activeFilters.memberIds.join(',')
      if (activeFilters.accountTypes?.length) params.account_types = activeFilters.accountTypes.join(',')
      if (activeFilters.brokers?.length) params.brokers = activeFilters.brokers.join(',')

      const res = await transactionsApi.getAll(params)
      setTransactions(res.data.transactions)
      setPagination(res.data.pagination)
    } catch {
      setError('Failed to load transactions')
    } finally {
      setLoading(false)
    }
  }

  const amountColor = (amount) => {
    if (amount == null) return 'var(--text-primary)'
    return parseFloat(amount) >= 0 ? '#14532D' : '#991B1B'
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{
          fontSize: '20px', fontWeight: '700',
          color: 'var(--text-primary)', marginBottom: '4px'
        }}>
          Transactions
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {pagination
            ? `${pagination.total.toLocaleString()} transactions${selectedCircle ? ` in ${selectedCircle.name}` : ''}`
            : 'All transaction history'}
        </p>
      </div>

      {/* No circle selected */}
      {!selectedCircle && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
            Select a circle to view transactions
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Use the Circle filter above to get started
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FECACA',
          borderRadius: '8px', padding: '10px 14px',
          marginBottom: '16px', fontSize: '13px', color: '#DC2626'
        }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {selectedCircle && loading && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '40px', textAlign: 'center',
          color: 'var(--text-secondary)', fontSize: '13px'
        }}>
          Loading transactions...
        </div>
      )}

      {/* Empty state */}
      {selectedCircle && !loading && transactions.length === 0 && !error && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📂</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
            No transactions found
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Upload transaction files under Admin → Upload Transactions
          </div>
        </div>
      )}

      {/* Transactions table */}
      {selectedCircle && !loading && transactions.length > 0 && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', overflow: 'hidden'
        }}>
          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                  {['Date', 'Member · Account', 'Type', 'Symbol', 'Qty', 'Price', 'Amount', 'CAD Amount'].map(col => (
                    <th key={col} style={{
                      padding: '10px 14px', textAlign: 'left',
                      fontSize: '11px', fontWeight: '700',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      background: 'var(--content-bg)'
                    }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn, i) => (
                  <tr
                    key={txn.id}
                    style={{
                      borderBottom: i < transactions.length - 1
                        ? '1px solid var(--filter-row-border)' : 'none',
                      transition: 'background 0.1s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--content-bg)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Date */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500' }}>
                        {formatDate(txn.trade_date)}
                      </div>
                    </td>

                    {/* Member · Account */}
                    <td style={{ padding: '10px 14px', minWidth: '160px' }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {txn.member_name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                        {txn.account_nickname || txn.account_type_code} · {txn.broker_name}
                      </div>
                    </td>

                    {/* Type */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        fontSize: '11px', fontWeight: '700',
                        padding: '2px 8px', borderRadius: '6px',
                        ...typeColor(txn.transaction_type)
                      }}>
                        {typeLabel(txn.transaction_type)}
                      </span>
                    </td>

                    {/* Symbol */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      {txn.symbol_normalized ? (
                        <span style={{
                          fontSize: '13px', fontWeight: '700',
                          color: 'var(--accent-dark)'
                        }}>
                          {txn.symbol_normalized}
                        </span>
                      ) : (
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>—</span>
                      )}
                    </td>

                    {/* Quantity */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                        {formatQty(txn.quantity)}
                      </span>
                    </td>

                    {/* Price */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                        {formatPrice(txn.price_per_unit)}
                      </span>
                    </td>

                    {/* Amount in trade currency */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{
                        fontSize: '13px', fontWeight: '600',
                        color: amountColor(txn.net_amount)
                      }}>
                        {formatAmount(txn.net_amount, txn.trade_currency)}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                        {txn.trade_currency}
                      </div>
                    </td>

                    {/* CAD Amount */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{
                        fontSize: '13px', fontWeight: '600',
                        color: amountColor(txn.net_amount_cad)
                      }}>
                        {formatAmount(txn.net_amount_cad, 'CAD')}
                      </div>
                      {txn.fx_rate_to_cad && txn.trade_currency !== 'CAD' && (
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                          @{parseFloat(txn.fx_rate_to_cad).toFixed(4)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.total_pages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderTop: '1px solid var(--card-border)',
              background: 'var(--content-bg)'
            }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, pagination.total)} of {pagination.total.toLocaleString()}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  onClick={() => setPage(p => p - 1)}
                  disabled={!pagination.has_prev}
                  style={{
                    padding: '5px 12px', borderRadius: '6px',
                    border: '1.5px solid var(--card-border)',
                    background: 'white', fontSize: '12px', fontWeight: '600',
                    cursor: pagination.has_prev ? 'pointer' : 'not-allowed',
                    opacity: pagination.has_prev ? 1 : 0.4,
                    color: 'var(--text-primary)'
                  }}
                >
                  ← Prev
                </button>

                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '0 8px' }}>
                  Page {page} of {pagination.total_pages}
                </span>

                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={!pagination.has_next}
                  style={{
                    padding: '5px 12px', borderRadius: '6px',
                    border: '1.5px solid var(--card-border)',
                    background: 'white', fontSize: '12px', fontWeight: '600',
                    cursor: pagination.has_next ? 'pointer' : 'not-allowed',
                    opacity: pagination.has_next ? 1 : 0.4,
                    color: 'var(--text-primary)'
                  }}
                >
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
