import { useState } from 'react'

const memberFilters = ['All family', 'Myself', 'Priya', 'Father', 'Mother', 'My Corp']
const accountFilters = ['All', 'TFSA', 'FHSA', 'RRSP', 'Cash', 'Margin', 'Corp Cash']
const brokerFilters = ['All', 'WealthSimple', 'Questrade', 'IBKR']

function FilterPill({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 11px',
        borderRadius: '20px',
        border: `1.5px solid ${active ? 'var(--pill-active-border)' : 'var(--pill-border)'}`,
        background: active ? 'var(--pill-active-bg)' : 'var(--pill-bg)',
        color: active ? 'var(--pill-active-text)' : 'var(--pill-text)',
        fontSize: '12px',
        fontWeight: '500',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.12s'
      }}
    >
      {label}
    </button>
  )
}

function FilterBar() {
  const [activeMember, setActiveMember] = useState('All family')
  const [activeAccounts, setActiveAccounts] = useState(['All'])
  const [activeBroker, setActiveBroker] = useState('All')
  const [expanded, setExpanded] = useState(false)

  const toggleAccount = (acc) => {
    if (acc === 'All') {
      setActiveAccounts(['All'])
      return
    }
    const without = activeAccounts.filter(a => a !== 'All')
    if (without.includes(acc)) {
      const next = without.filter(a => a !== acc)
      setActiveAccounts(next.length === 0 ? ['All'] : next)
    } else {
      setActiveAccounts([...without, acc])
    }
  }

  const filterRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '7px 16px',
    flexWrap: 'wrap'
  }

  const labelStyle = {
    fontSize: '10px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-secondary)',
    minWidth: '48px',
    flexShrink: 0
  }

  const sepStyle = {
    width: '1px',
    height: '14px',
    background: 'var(--card-border)',
    margin: '0 3px',
    flexShrink: 0
  }

  return (
    <div>
      {/* Mobile collapsed toggle */}
      <div className="mobile-filter-toggle" style={{ display: 'none' }}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: '100%',
            padding: '8px 16px',
            background: 'none',
            border: 'none',
            borderBottom: '1px solid var(--filter-row-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            color: 'var(--text-primary)',
            fontSize: '12px',
            fontWeight: '600'
          }}
        >
          <span>
            Filters — {activeMember} · {activeAccounts.join(', ')} · {activeBroker}
          </span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s'
            }}>
            <path d="M2 4l5 5 5-5" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Filter rows */}
      <div className={`filter-rows ${expanded ? 'filter-rows-open' : ''}`}>

        {/* Row 1 — Member */}
        <div style={{
          ...filterRowStyle,
          borderBottom: '1px solid var(--filter-row-border)'
        }}>
          <span style={labelStyle}>Member</span>
          {memberFilters.map(f => (
            <FilterPill
              key={f}
              label={f}
              active={activeMember === f}
              onClick={() => setActiveMember(f)}
            />
          ))}
        </div>

        {/* Row 2 — Account + Broker */}
        <div style={filterRowStyle}>
          <span style={labelStyle}>Account</span>
          {accountFilters.map(f => (
            <FilterPill
              key={f}
              label={f}
              active={activeAccounts.includes(f)}
              onClick={() => toggleAccount(f)}
            />
          ))}
          <div style={sepStyle}/>
          <span style={labelStyle}>Broker</span>
          {brokerFilters.map(f => (
            <FilterPill
              key={f}
              label={f}
              active={activeBroker === f}
              onClick={() => setActiveBroker(f)}
            />
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .mobile-filter-toggle { display: block !important; }
          .filter-rows { display: none; }
          .filter-rows-open { display: block !important; }
        }
      `}</style>
    </div>
  )
}

export default FilterBar