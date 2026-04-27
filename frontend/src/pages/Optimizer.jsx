import { useState, useCallback, useEffect } from 'react'
import api from '../services/api'
import { useFilters } from '../context/FilterContext'

const fmt  = (n, d=2) => n == null ? '—' : Number(n).toLocaleString('en-CA', {minimumFractionDigits:d,maximumFractionDigits:d})
const fmtC = (n) => n == null ? '—' : `$${fmt(Math.abs(n))}`
const glColor  = (n) => Number(n) >= 0 ? '#14532D' : '#991B1B'
const glPrefix = (n) => Number(n) >= 0 ? '+' : '-'

// ── Stock breakdown card ───────────────────────────────────────

function StockCard({ stock }) {
  const [open, setOpen] = useState(stock.has_change)

  return (
    <div style={{ border:`1px solid ${stock.has_change ? 'var(--accent)':'var(--card-border)'}`,
      borderRadius:'10px', overflow:'hidden', background:'var(--card-bg)' }}>

      <div onClick={() => setOpen(o=>!o)} style={{
        display:'flex', alignItems:'center', gap:'12px', padding:'12px 16px',
        cursor:'pointer', background: open ? 'var(--accent-light)':'var(--content-bg)',
      }}>
        <div style={{flex:'0 0 90px'}}>
          <div style={{fontSize:'14px',fontWeight:'700',color:'var(--accent-dark)'}}>{stock.symbol}</div>
          <div style={{fontSize:'11px',color:'var(--text-secondary)'}}>@ {fmtC(stock.current_price)}</div>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:'11px',color:'var(--text-secondary)'}}>Home account</div>
          <div style={{fontSize:'12px',fontWeight:'600',color:'var(--text-primary)'}}>{stock.home_account_label}</div>
        </div>
        <div style={{textAlign:'right',flex:'0 0 80px'}}>
          <div style={{fontSize:'11px',color:'var(--text-secondary)'}}>Total qty</div>
          <div style={{fontSize:'15px',fontWeight:'700',color:'var(--text-primary)'}}>{fmt(stock.total_quantity,0)}</div>
        </div>
        <div style={{textAlign:'right',flex:'0 0 100px'}}>
          <div style={{fontSize:'11px',color:'var(--text-secondary)'}}>Value</div>
          <div style={{fontSize:'13px',fontWeight:'600',color:'var(--text-primary)'}}>{fmtC(stock.total_value)}</div>
        </div>
        {stock.has_change
          ? <div style={{fontSize:'11px',fontWeight:'700',padding:'3px 10px',borderRadius:'20px',
              background:'#DCFCE7',color:'#14532D',whiteSpace:'nowrap'}}>✓ Move proposed</div>
          : <div style={{fontSize:'11px',padding:'3px 10px',borderRadius:'20px',
              background:'var(--filter-row-border)',color:'var(--text-secondary)',whiteSpace:'nowrap'}}>No change</div>
        }
        <svg viewBox="0 0 14 14" fill="none" width="12" height="12"
          style={{transform:open?'rotate(0)':'rotate(-90deg)',transition:'transform 0.2s',flexShrink:0}}>
          <path d="M2 4l5 5 5-5" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {open && (
        <div style={{padding:'16px',borderTop:'1px solid var(--card-border)'}}>
          <div style={{display:'flex',gap:'16px'}}>

            {/* Before */}
            <div style={{flex:1}}>
              <div style={{fontSize:'11px',fontWeight:'700',textTransform:'uppercase',
                letterSpacing:'0.05em',color:'var(--text-secondary)',marginBottom:'8px'}}>
                Current Distribution
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'5px'}}>
                {stock.before.map((b,i) => (
                  <div key={i} style={{
                    display:'flex',alignItems:'center',justifyContent:'space-between',
                    padding:'8px 10px',borderRadius:'7px',
                    background: b.is_home ? 'var(--accent-light)' : 'var(--content-bg)',
                    border:`1px solid ${b.is_home ? 'var(--accent)':'var(--card-border)'}`,
                  }}>
                    <div>
                      <div style={{fontSize:'12px',fontWeight:b.is_home?'700':'500',
                        color:b.is_home?'var(--accent-dark)':'var(--text-primary)',display:'flex',
                        alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                        {b.account_label}
                        {b.is_home && <span style={{fontSize:'10px',color:'var(--accent)'}}>HOME</span>}
                        {b.is_odd_lot && <span style={{fontSize:'10px',padding:'1px 5px',borderRadius:'3px',
                          background:'#FEF3C7',color:'#92400E'}}>odd lot</span>}
                      </div>
                      <div style={{fontSize:'10px',marginTop:'2px',color:glColor(b.unrealized_gl)}}>
                        G/L: {glPrefix(b.unrealized_gl)}{fmtC(Math.abs(b.unrealized_gl))}
                        {!b.is_sellable && <span style={{marginLeft:'6px',color:'#92400E'}}>⚠ locked</span>}
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'14px',fontWeight:'700',color:'var(--text-primary)'}}>{fmt(b.quantity,0)}</div>
                      <div style={{fontSize:'10px',color:'var(--text-secondary)'}}>{fmtC(b.market_value)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Arrow */}
            <div style={{display:'flex',alignItems:'center',paddingTop:'24px'}}>
              <svg viewBox="0 0 24 12" fill="none" width="32">
                <path d="M1 6h20M15 1l6 5-6 5" stroke="var(--accent)" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>

            {/* After */}
            <div style={{flex:1}}>
              <div style={{fontSize:'11px',fontWeight:'700',textTransform:'uppercase',
                letterSpacing:'0.05em',color:'var(--text-secondary)',marginBottom:'8px'}}>
                After Moves
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'5px'}}>
                {stock.after.map((a,i) => (
                  <div key={i} style={{
                    display:'flex',alignItems:'center',justifyContent:'space-between',
                    padding:'8px 10px',borderRadius:'7px',
                    background: a.is_home ? '#DCFCE7':'var(--content-bg)',
                    border:`1px solid ${a.is_home ? '#86EFAC':'var(--card-border)'}`,
                  }}>
                    <div style={{fontSize:'12px',fontWeight:a.is_home?'700':'500',
                      color:a.is_home?'#14532D':'var(--text-primary)',display:'flex',
                      alignItems:'center',gap:'6px'}}>
                      {a.account_label}
                      {a.is_home && <span style={{fontSize:'10px'}}>HOME</span>}
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'14px',fontWeight:'700',
                        color:a.is_home?'#14532D':'var(--text-primary)'}}>{fmt(a.quantity,0)}</div>
                      <div style={{fontSize:'10px',color:'var(--text-secondary)'}}>{fmtC(a.market_value)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Account plan card ──────────────────────────────────────────

function AccountPlanCard({ plan }) {
  const sells = plan.instructions.filter(i => i.action === 'SELL')
  const buys  = plan.instructions.filter(i => i.action === 'BUY')

  return (
    <div style={{border:'1px solid var(--card-border)',borderRadius:'12px',
      overflow:'hidden',background:'var(--card-bg)'}}>

      {/* Header */}
      <div style={{padding:'12px 16px',background:'var(--content-bg)',
        borderBottom:'1px solid var(--card-border)',
        display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'8px'}}>
        <div>
          <div style={{fontSize:'13px',fontWeight:'700',color:'var(--text-primary)'}}>
            {plan.account_label}
          </div>
          <div style={{fontSize:'11px',color:'var(--text-secondary)',marginTop:'2px',display:'flex',gap:'12px'}}>
            {plan.cash_generated > 0 && (
              <span>Sell proceeds: <strong style={{color:'var(--text-primary)'}}>{fmtC(plan.cash_generated)}</strong></span>
            )}
            {plan.existing_cash > 0 && (
              <span>Existing cash: <strong style={{color:'var(--text-primary)'}}>{fmtC(plan.existing_cash)}</strong></span>
            )}
            {plan.cash_residual !== 0 && (
              <span>Residual: <strong style={{color:'var(--text-primary)'}}>{fmtC(plan.cash_residual)}</strong></span>
            )}
          </div>
        </div>
        {plan.total_loss_harvested > 0 && (
          <div style={{fontSize:'11px',fontWeight:'700',padding:'3px 10px',borderRadius:'20px',
            background:'#DCFCE7',color:'#14532D'}}>
            🌿 Harvests {fmtC(plan.total_loss_harvested)}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:'6px'}}>
        {/* Sells first */}
        {sells.map((instr,i) => (
          <InstrRow key={i} instr={instr} />
        ))}
        {sells.length > 0 && buys.length > 0 && (
          <div style={{height:'1px',background:'var(--card-border)',margin:'4px 0'}} />
        )}
        {/* Then buys */}
        {buys.map((instr,i) => (
          <InstrRow key={i} instr={instr} />
        ))}
      </div>
    </div>
  )
}

function InstrRow({ instr }) {
  const isSell = instr.action === 'SELL'
  return (
    <div style={{
      display:'flex',alignItems:'center',justifyContent:'space-between',
      padding:'8px 10px',borderRadius:'7px',
      background: isSell ? '#FEF2F2':'#F0FDF4',
      border:`1px solid ${isSell ? '#FECACA':'#BBF7D0'}`,
    }}>
      <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
        <div style={{fontSize:'10px',fontWeight:'700',padding:'2px 7px',borderRadius:'4px',
          background: isSell?'#FEE2E2':'#DCFCE7',
          color: isSell?'#991B1B':'#14532D'}}>
          {isSell ? '▼ SELL' : '▲ BUY'}
        </div>
        <span style={{fontSize:'13px',fontWeight:'700',color:'var(--text-primary)'}}>
          {fmt(instr.quantity,0)} {instr.symbol}
        </span>
        <span style={{fontSize:'11px',color:'var(--text-secondary)'}}>@ {fmtC(instr.price)}</span>
        {isSell && instr.unrealized_gl < 0 && (
          <span style={{fontSize:'10px',color:glColor(instr.unrealized_gl)}}>
            G/L: {glPrefix(instr.unrealized_gl)}{fmtC(Math.abs(instr.unrealized_gl))}
          </span>
        )}
      </div>
      <div style={{textAlign:'right'}}>
        <div style={{fontSize:'13px',fontWeight:'700',
          color: isSell?'#991B1B':'#14532D'}}>
          {isSell?'-':'+'}{fmtC(instr.value)}
        </div>
        {isSell && instr.loss_harvested > 0 && (
          <div style={{fontSize:'10px',color:'#14532D'}}>harvests {fmtC(instr.loss_harvested)}</div>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────

export default function Optimizer() {
  const { selectedCircle } = useFilters()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const [tab, setTab]       = useState('plan') // plan | stocks | stuck

  const fetchPlan = useCallback(async () => {
    if (!selectedCircle) { setData(null); return }
    setLoading(true); setError('')
    try {
      const res = await api.get('/optimizer', { params:{ circle_id: selectedCircle.id } })
      setData(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to run optimizer')
    } finally {
      setLoading(false)
    }
  }, [selectedCircle])

  useEffect(() => { fetchPlan() }, [fetchPlan])

  const summary  = data?.summary || {}
  const plans    = data?.account_plans || []
  const stocks   = data?.stocks_analyzed || []
  const stuck    = data?.stuck_positions || []

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{
      padding:'7px 18px', borderRadius:'8px', cursor:'pointer',
      fontSize:'13px', fontWeight:'600', border:'none',
      background: tab===id ? 'var(--sidebar-bg)' : 'transparent',
      color: tab===id ? 'white' : 'var(--text-secondary)',
      transition:'all 0.15s',
    }}>{label}</button>
  )

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'var(--text-primary)',marginBottom:'4px'}}>
          Consolidation Optimizer
        </h1>
        <p style={{fontSize:'13px',color:'var(--text-secondary)'}}>
          Proposes moves to concentrate scattered positions — odd lots first, full blocks only,
          never sells a winner, never over-contributes registered accounts
        </p>
      </div>

      {!selectedCircle && (
        <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',
          borderRadius:'12px',padding:'48px',textAlign:'center'}}>
          <div style={{fontSize:'32px',marginBottom:'12px'}}>🔀</div>
          <div style={{fontSize:'15px',fontWeight:'600',color:'var(--text-primary)',marginBottom:'6px'}}>
            Select a circle to analyze
          </div>
          <div style={{fontSize:'13px',color:'var(--text-secondary)'}}>
            Use the circle filter above to get started
          </div>
        </div>
      )}

      {error && (
        <div style={{background:'#FEE2E2',border:'1px solid #FECACA',borderRadius:'8px',
          padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#DC2626'}}>
          {error}
        </div>
      )}

      {selectedCircle && loading && (
        <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',
          borderRadius:'12px',padding:'48px',textAlign:'center',
          color:'var(--text-secondary)',fontSize:'13px'}}>
          <div style={{marginBottom:'12px',fontSize:'24px'}}>⚙️</div>
          Analyzing {selectedCircle.name}…
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary */}
          <div style={{display:'flex',background:'var(--card-bg)',
            border:'1px solid var(--card-border)',borderRadius:'12px',
            marginBottom:'16px',overflow:'hidden'}}>
            {[
              {label:'Stocks analyzed',    value: summary.stocks_analyzed},
              {label:'Stocks with moves',  value: summary.stocks_with_changes,  highlight: summary.stocks_with_changes > 0},
              {label:'Accounts involved',  value: summary.accounts_with_moves},
              {label:'Loss to harvest',    value: fmtC(summary.total_loss_harvested),
               green: summary.total_loss_harvested > 0},
              {label:'Shares to move',     value: fmt(summary.total_qty_moved, 0)},
            ].map((t,i,arr) => (
              <div key={i} style={{flex:1,padding:'16px 20px',
                borderRight: i<arr.length-1 ? '1px solid var(--card-border)':'none',
                background: t.green ? '#F0FDF4':'transparent'}}>
                <div style={{fontSize:'10px',fontWeight:'700',textTransform:'uppercase',
                  letterSpacing:'0.05em',color:'var(--text-secondary)',marginBottom:'4px'}}>
                  {t.label}
                </div>
                <div style={{fontSize:'22px',fontWeight:'700',
                  color: t.green ? '#14532D' : t.highlight ? 'var(--accent-dark)':'var(--text-primary)'}}>
                  {t.value}
                </div>
              </div>
            ))}
          </div>

          {plans.length === 0 && (
            <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',
              borderRadius:'12px',padding:'40px',textAlign:'center'}}>
              <div style={{fontSize:'28px',marginBottom:'12px'}}>✅</div>
              <div style={{fontSize:'15px',fontWeight:'600',color:'var(--text-primary)',marginBottom:'6px'}}>
                No beneficial moves found
              </div>
              <div style={{fontSize:'13px',color:'var(--text-secondary)'}}>
                Positions are already well consolidated, all non-home positions are locked gains,
                or registered accounts have no available cash.
                {stuck.length > 0 && ` ${stuck.length} positions are locked.`}
              </div>
            </div>
          )}

          {plans.length > 0 && (
            <>
              {/* Tabs */}
              <div style={{display:'flex',gap:'4px',marginBottom:'16px',
                background:'var(--card-bg)',border:'1px solid var(--card-border)',
                borderRadius:'10px',padding:'4px',width:'fit-content'}}>
                {tabBtn('plan',   `Action Plan (${plans.length} accounts)`)}
                {tabBtn('stocks', `Stock Breakdown (${stocks.length})`)}
                {stuck.length > 0 && tabBtn('stuck', `Locked (${stuck.length})`)}
              </div>

              {/* Action plan tab — per account instructions */}
              {tab === 'plan' && (
                <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
                  <div style={{fontSize:'13px',color:'var(--text-secondary)',
                    padding:'10px 14px',background:'var(--card-bg)',
                    border:'1px solid var(--card-border)',borderRadius:'8px'}}>
                    For each cash/margin account: sell non-home loss positions first,
                    then buy home stocks with the proceeds. Registered accounts only
                    show buys if they had existing cash.
                  </div>
                  {plans.map(plan => (
                    <AccountPlanCard key={plan.account_id} plan={plan} />
                  ))}
                </div>
              )}

              {/* Stock breakdown tab */}
              {tab === 'stocks' && (
                <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                  {stocks.map(stock => (
                    <StockCard key={stock.symbol} stock={stock} />
                  ))}
                </div>
              )}

              {/* Locked tab */}
              {tab === 'stuck' && stuck.length > 0 && (
                <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',
                  borderRadius:'12px',overflow:'hidden'}}>
                  <div style={{padding:'12px 16px',borderBottom:'1px solid var(--card-border)',
                    fontSize:'13px',color:'#92400E',background:'#FEF3C7'}}>
                    ⚠️ These positions cannot be moved — selling would trigger a gain or the account
                    has no available cash.
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{borderBottom:'1px solid var(--card-border)'}}>
                        {['Symbol','Account','Qty','Value','G/L','Reason'].map(h=>(
                          <th key={h} style={{padding:'9px 16px',textAlign:'left',
                            fontSize:'10px',fontWeight:'700',textTransform:'uppercase',
                            letterSpacing:'0.05em',color:'var(--text-secondary)',
                            background:'var(--content-bg)'}}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stuck.map((s,i)=>(
                        <tr key={i} style={{borderBottom:'1px solid var(--filter-row-border)'}}>
                          <td style={{padding:'9px 16px',fontWeight:'700',
                            color:'var(--accent-dark)',fontSize:'13px'}}>{s.symbol}</td>
                          <td style={{padding:'9px 16px',fontSize:'12px',
                            color:'var(--text-primary)'}}>{s.account_label}</td>
                          <td style={{padding:'9px 16px',fontSize:'13px',
                            color:'var(--text-primary)'}}>{fmt(s.quantity,0)}</td>
                          <td style={{padding:'9px 16px',fontSize:'13px',
                            color:'var(--text-primary)'}}>{fmtC(s.market_value)}</td>
                          <td style={{padding:'9px 16px',fontSize:'13px',fontWeight:'700',
                            color:glColor(s.unrealized_gl)}}>
                            {glPrefix(s.unrealized_gl)}{fmtC(Math.abs(s.unrealized_gl))}
                          </td>
                          <td style={{padding:'9px 16px',fontSize:'11px',
                            color:'#92400E'}}>{s.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
