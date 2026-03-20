import { useState, useEffect } from 'react'
import { circlesApi, memberAccountsApi, membersApi, referenceApi } from '../../services/api'

function CircleModal({ circle, onSave, onClose }) {
  const [regions, setRegions] = useState([])
  const [form, setForm] = useState({
    name: circle?.name || '',
    region_code: circle?.region_code || '',
    description: circle?.description || ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchRegions = async () => {
      try {
        const res = await referenceApi.getRegions()
        setRegions(res.data)
      } catch {
        setError('Failed to load countries')
      }
    }
    fetchRegions()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Circle name is required')
      return
    }
    if (!form.region_code) {
      setError('Country is required')
      return
    }
    try {
      setLoading(true)
      setError('')
      if (circle) {
        await circlesApi.update(circle.id, {
          name: form.name,
          description: form.description
        })
      } else {
        await circlesApi.create(form)
      }
      onSave()
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong')
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px',
    borderRadius: '8px', border: '1.5px solid var(--card-border)',
    background: 'white', fontSize: '13px',
    color: 'var(--text-primary)', outline: 'none'
  }

  const labelStyle = {
    display: 'block', fontSize: '12px',
    fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px'
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: '16px', padding: '28px',
        width: '100%', maxWidth: '440px'
      }}>
        <h2 style={{
          fontSize: '16px', fontWeight: '700',
          color: 'var(--text-primary)', marginBottom: '20px'
        }}>
          {circle ? 'Edit circle' : 'Create circle'}
        </h2>

        {error && (
          <div style={{
            background: '#FEE2E2', border: '1px solid #FECACA',
            borderRadius: '8px', padding: '10px 14px',
            marginBottom: '16px', fontSize: '13px', color: '#DC2626'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Circle name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Sharma Family"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Country</label>
            <select
              value={form.region_code}
              onChange={(e) => setForm({ ...form, region_code: e.target.value })}
              disabled={!!circle}
              style={{
                ...inputStyle,
                background: circle ? '#f5f5f5' : 'white',
                cursor: circle ? 'not-allowed' : 'pointer'
              }}
            >
              <option value="">Select a country</option>
              {regions.map(r => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
            {circle && (
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Country cannot be changed after creation
              </p>
            )}
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>
              Description{' '}
              <span style={{ color: 'var(--text-secondary)', fontWeight: '400' }}>(optional)</span>
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="e.g. Our family investment portfolio"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, padding: '10px', borderRadius: '8px',
                border: '1.5px solid var(--card-border)',
                background: 'white', color: 'var(--text-primary)',
                fontSize: '13px', fontWeight: '600', cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1, padding: '10px', borderRadius: '8px',
                border: 'none', background: 'var(--sidebar-bg)',
                color: 'white', fontSize: '13px', fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1
              }}
            >
              {loading ? 'Saving...' : circle ? 'Save changes' : 'Create circle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddAccountsModal({ circle, onClose, onUpdate }) {
  const [circleAccounts, setCircleAccounts] = useState([])
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = async () => {
    try {
      setLoading(true)
      const [circleAccRes, allAccRes, membersRes] = await Promise.all([
        circlesApi.getAccounts(circle.id),
        memberAccountsApi.getAll(),
        membersApi.getAll()
      ])
      setCircleAccounts(circleAccRes.data)
      setMembers(membersRes.data)
      const circleAccountIds = circleAccRes.data.map(a => a.id)
      setAvailableAccounts(
        allAccRes.data.filter(
          a => a.region_code === circle.region_code &&
               !circleAccountIds.includes(a.id)
        )
      )
    } catch {
      setError('Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getMemberName = (memberId) =>
    members.find(m => m.id === memberId)?.display_name || ''

  const handleAdd = async (accountId) => {
    try {
      await circlesApi.addAccount(circle.id, accountId)
      await fetchData()
      onUpdate()
    } catch {
      setError('Failed to add account')
    }
  }

  const handleRemove = async (accountId) => {
    try {
      await circlesApi.removeAccount(circle.id, accountId)
      await fetchData()
      onUpdate()
    } catch {
      setError('Failed to remove account')
    }
  }

  const accountLabel = (account) =>
    account.nickname || `${account.account_type_code} @ ${account.broker_code}`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: '16px', padding: '28px',
        width: '100%', maxWidth: '520px',
        maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: '20px'
        }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>
              {circle.name}
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Tag accounts to include in this circle
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              fontSize: '22px', cursor: 'pointer',
              color: 'var(--text-secondary)', lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {error && (
          <div style={{
            background: '#FEE2E2', border: '1px solid #FECACA',
            borderRadius: '8px', padding: '10px 14px',
            marginBottom: '16px', fontSize: '13px', color: '#DC2626'
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
            Loading...
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '20px' }}>
              <div style={{
                fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
                letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: '8px'
              }}>
                Tagged accounts ({circleAccounts.length})
              </div>
              {circleAccounts.length === 0 ? (
                <div style={{
                  padding: '14px', borderRadius: '8px',
                  background: 'var(--content-bg)', textAlign: 'center',
                  fontSize: '13px', color: 'var(--text-secondary)',
                  border: '1px dashed var(--card-border)'
                }}>
                  No accounts tagged yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {circleAccounts.map(account => (
                    <div key={account.id} style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: '8px',
                      background: 'var(--accent-light)',
                      border: '1px solid var(--card-border)'
                    }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent-dark)' }}>
                          {accountLabel(account)}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {getMemberName(account.member_id)} · {account.account_type_code}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemove(account.id)}
                        style={{
                          padding: '4px 10px', borderRadius: '6px',
                          border: '1.5px solid #FECACA',
                          background: 'white', color: '#DC2626',
                          fontSize: '12px', fontWeight: '600', cursor: 'pointer'
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {availableAccounts.length > 0 && (
              <div>
                <div style={{
                  fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: '8px'
                }}>
                  Available to add ({availableAccounts.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {availableAccounts.map(account => (
                    <div key={account.id} style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: '8px',
                      background: 'var(--content-bg)',
                      border: '1px solid var(--card-border)'
                    }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {accountLabel(account)}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {getMemberName(account.member_id)} · {account.account_type_code}
                        </div>
                      </div>
                      <button
                        onClick={() => handleAdd(account.id)}
                        style={{
                          padding: '4px 12px', borderRadius: '6px',
                          border: 'none', background: 'var(--sidebar-bg)',
                          color: 'white', fontSize: '12px',
                          fontWeight: '600', cursor: 'pointer'
                        }}
                      >
                        + Tag
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {availableAccounts.length === 0 && circleAccounts.length > 0 && (
              <div style={{
                padding: '12px', borderRadius: '8px',
                background: 'var(--content-bg)', textAlign: 'center',
                fontSize: '13px', color: 'var(--text-secondary)',
                border: '1px dashed var(--card-border)'
              }}>
                All available accounts are already tagged
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CircleCard({ circle, onEdit, onDelete, onUpdate }) {
  const [expanded, setExpanded] = useState(true)
  const [accounts, setAccounts] = useState([])
  const [members, setMembers] = useState([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [fetched, setFetched] = useState(false)

  const taxLabel = (tax) => {
    const map = {
      TAX_FREE: 'Tax free', TAX_DEFERRED: 'Tax deferred',
      TAXABLE: 'Taxable', CORP_TAXABLE: 'Corp'
    }
    return map[tax] || tax
  }

  const taxColor = (tax) => {
    const map = {
      TAX_FREE: { bg: '#DCFCE7', color: '#14532D' },
      TAX_DEFERRED: { bg: '#DBEAFE', color: '#1D4ED8' },
      TAXABLE: { bg: '#FEF3C7', color: '#92400E' },
      CORP_TAXABLE: { bg: '#F3E8FF', color: '#6D28D9' }
    }
    return map[tax] || { bg: '#F3F4F6', color: '#374151' }
  }

  const regionLabel = (code) => {
    const map = { CA: 'Canada', US: 'United States', IN: 'India' }
    return map[code] || code
  }

  const fetchAccounts = async () => {
    try {
      setLoadingAccounts(true)
      const [accRes, memRes] = await Promise.all([
        circlesApi.getAccounts(circle.id),
        membersApi.getAll()
      ])
      setAccounts(accRes.data)
      setMembers(memRes.data)
      setFetched(true)
    } catch {
      // silently fail
    } finally {
      setLoadingAccounts(false)
    }
  }

  useEffect(() => {
  fetchAccounts()
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])

  const handleExpand = () => {
    if (!expanded && !fetched) {
      fetchAccounts()
    }
    setExpanded(!expanded)
  }

  const getMemberName = (memberId) =>
    members.find(m => m.id === memberId)?.display_name || ''

  const accountLabel = (account) =>
    account.nickname || `${account.account_type_code} @ ${account.broker_code}`

  return (
    <>
      <div style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: '12px',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div
          onClick={handleExpand}
          style={{
            padding: '16px 20px',
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer', userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '42px', height: '42px', borderRadius: '50%',
              background: 'var(--accent-light)',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0
            }}>
              <svg viewBox="0 0 18 18" fill="none" width="20" height="20">
                <circle cx="9" cy="9" r="6.5" stroke="var(--accent)" strokeWidth="1.5"/>
                <circle cx="9" cy="9" r="3" stroke="var(--accent)" strokeWidth="1.3"/>
              </svg>
            </div>
            <div>
              <div style={{
                fontSize: '15px', fontWeight: '700',
                color: 'var(--text-primary)', marginBottom: '4px'
              }}>
                {circle.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  fontSize: '11px', fontWeight: '600',
                  padding: '2px 8px', borderRadius: '6px',
                  background: 'var(--accent-light)', color: 'var(--accent-dark)'
                }}>
                  {regionLabel(circle.region_code)}
                </span>
                {circle.description && (
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {circle.description}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(circle) }}
              style={{
                padding: '5px 12px', borderRadius: '7px',
                border: '1.5px solid var(--card-border)',
                background: 'white', color: 'var(--text-primary)',
                fontSize: '12px', fontWeight: '600', cursor: 'pointer'
              }}
            >
              Edit
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(circle) }}
              style={{
                padding: '5px 12px', borderRadius: '7px',
                border: '1.5px solid #FECACA',
                background: 'white', color: '#DC2626',
                fontSize: '12px', fontWeight: '600', cursor: 'pointer'
              }}
            >
              Delete
            </button>
            <div style={{
              width: '28px', height: '28px', borderRadius: '6px',
              background: 'var(--content-bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)'
            }}>
              <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
                <path d="M2 4l5 5 5-5" stroke="var(--text-secondary)"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div style={{
            borderTop: '1px solid var(--filter-row-border)',
            padding: '16px 20px'
          }}>
            {loadingAccounts ? (
              <div style={{
                textAlign: 'center', padding: '16px',
                fontSize: '13px', color: 'var(--text-secondary)'
              }}>
                Loading accounts...
              </div>
            ) : accounts.length === 0 ? (
              <div style={{
                padding: '24px', borderRadius: '10px',
                border: '1.5px dashed var(--card-border)',
                textAlign: 'center', background: 'var(--content-bg)'
              }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>🏦</div>
                <div style={{
                  fontSize: '13px', fontWeight: '600',
                  color: 'var(--text-primary)', marginBottom: '4px'
                }}>
                  No accounts tagged yet
                </div>
                <div style={{
                  fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px'
                }}>
                  Tag brokerage accounts to start tracking this circle's portfolio
                </div>
                <button
                  onClick={() => setShowAddModal(true)}
                  style={{
                    padding: '8px 20px', borderRadius: '8px',
                    border: 'none', background: 'var(--sidebar-bg)',
                    color: 'white', fontSize: '13px',
                    fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  + Tag accounts
                </button>
              </div>
            ) : (
              <>
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '6px',
                  marginBottom: '14px'
                }}>
                  {accounts.map(account => {
                    const tc = taxColor(account.tax_category)
                    return (
                      <div key={account.id} style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px', borderRadius: '8px',
                        background: 'var(--content-bg)',
                        border: '1px solid var(--filter-row-border)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '16px' }}>🏦</span>
                          <div>
                            <div style={{
                              fontSize: '13px', fontWeight: '600',
                              color: 'var(--text-primary)'
                            }}>
                              {accountLabel(account)}
                            </div>
                            <div style={{
                              fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px'
                            }}>
                              {getMemberName(account.member_id)}
                            </div>
                          </div>
                        </div>
                        <span style={{
                          fontSize: '11px', fontWeight: '600',
                          padding: '2px 8px', borderRadius: '6px',
                          background: tc.bg, color: tc.color
                        }}>
                          {taxLabel(account.tax_category)}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <button
                  onClick={() => setShowAddModal(true)}
                  style={{
                    width: '100%', padding: '9px', borderRadius: '8px',
                    border: '1.5px dashed var(--card-border)',
                    background: 'transparent', color: 'var(--accent)',
                    fontSize: '13px', fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  + Tag more accounts
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddAccountsModal
          circle={circle}
          onClose={() => setShowAddModal(false)}
          onUpdate={() => {
            fetchAccounts()
            onUpdate()
          }}
        />
      )}
    </>
  )
}

function Circles() {
  const [circles, setCircles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingCircle, setEditingCircle] = useState(null)

  const fetchCircles = async () => {
    try {
      setLoading(true)
      const res = await circlesApi.getAll()
      setCircles(res.data)
    } catch {
      setError('Failed to load circles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCircles()
  }, [])

  const handleDelete = async (circle) => {
    if (!confirm(`Delete "${circle.name}"? This will remove all account associations.`)) return
    try {
      await circlesApi.delete(circle.id)
      fetchCircles()
    } catch {
      alert('Failed to delete circle')
    }
  }

  const handleSave = () => {
    setShowModal(false)
    setEditingCircle(null)
    fetchCircles()
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '24px'
      }}>
        <div>
          <h1 style={{
            fontSize: '20px', fontWeight: '700',
            color: 'var(--text-primary)', marginBottom: '4px'
          }}>
            Circles
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Group accounts together for a consolidated portfolio view
          </p>
        </div>
        <button
          onClick={() => { setEditingCircle(null); setShowModal(true) }}
          style={{
            padding: '9px 18px', borderRadius: '8px',
            border: 'none', background: 'var(--sidebar-bg)',
            color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
          }}
        >
          + Create circle
        </button>
      </div>

      {error && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FECACA',
          borderRadius: '8px', padding: '10px 14px',
          marginBottom: '16px', fontSize: '13px', color: '#DC2626'
        }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
          Loading...
        </div>
      )}

      {!loading && circles.length === 0 && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>⭕</div>
          <h3 style={{
            fontSize: '15px', fontWeight: '600',
            color: 'var(--text-primary)', marginBottom: '6px'
          }}>
            No circles yet
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            A circle groups your accounts together for a consolidated view.
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Example: "Sharma Family" circle containing everyone's TFSA and RRSP accounts.
          </p>
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: '9px 20px', borderRadius: '8px',
              border: 'none', background: 'var(--sidebar-bg)',
              color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
            }}
          >
            + Create your first circle
          </button>
        </div>
      )}

      {!loading && circles.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {circles.map(circle => (
            <CircleCard
              key={circle.id}
              circle={circle}
              onEdit={(c) => { setEditingCircle(c); setShowModal(true) }}
              onDelete={handleDelete}
              onUpdate={fetchCircles}
            />
          ))}
        </div>
      )}

      {showModal && (
        <CircleModal
          circle={editingCircle}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingCircle(null) }}
        />
      )}
    </div>
  )
}

export default Circles