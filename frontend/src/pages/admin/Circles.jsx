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
      } catch  {
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

function ManageAccountsModal({ circle, onClose }) {
  const [circleAccounts, setCircleAccounts] = useState([])
  const [allAccounts, setAllAccounts] = useState([])
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
      // Only show accounts matching circle region that aren't already in circle
      const circleAccountIds = circleAccRes.data.map(a => a.id)
      const filtered = allAccRes.data.filter(
        a => a.region_code === circle.region_code && !circleAccountIds.includes(a.id)
      )
      setAllAccounts(filtered)
      setMembers(membersRes.data)
    } catch  {
      setError('Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }

useEffect(() => {
  fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])

  const getMemberName = (memberId) => {
    const member = members.find(m => m.id === memberId)
    return member?.display_name || 'Unknown'
  }

  const handleAdd = async (accountId) => {
    try {
      await circlesApi.addAccount(circle.id, accountId)
      fetchData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add account')
    }
  }

  const handleRemove = async (accountId) => {
    try {
      await circlesApi.removeAccount(circle.id, accountId)
      fetchData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to remove account')
    }
  }

  const accountLabel = (account) => {
    return account.nickname || `${account.account_type_code} @ ${account.broker_code}`
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
        width: '100%', maxWidth: '560px',
        maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: '20px'
        }}>
          <h2 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>
            Manage accounts — {circle.name}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)'
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
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            Loading...
          </div>
        ) : (
          <>
            {/* Accounts in circle */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{
                fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
                letterSpacing: '0.06em', color: 'var(--text-secondary)',
                marginBottom: '10px'
              }}>
                In this circle ({circleAccounts.length})
              </div>

              {circleAccounts.length === 0 ? (
                <div style={{
                  padding: '16px', borderRadius: '8px',
                  background: 'var(--content-bg)', textAlign: 'center',
                  fontSize: '13px', color: 'var(--text-secondary)'
                }}>
                  No accounts added yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {circleAccounts.map(account => (
                    <div key={account.id} style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: '8px',
                      background: 'var(--accent-light)',
                      border: '1px solid var(--card-border)'
                    }}>
                      <div>
                        <div style={{
                          fontSize: '13px', fontWeight: '600',
                          color: 'var(--accent-dark)'
                        }}>
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

            {/* Available accounts to add */}
            {allAccounts.length > 0 && (
              <div>
                <div style={{
                  fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: 'var(--text-secondary)',
                  marginBottom: '10px'
                }}>
                  Available to add ({allAccounts.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {allAccounts.map(account => (
                    <div key={account.id} style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: '8px',
                      background: 'var(--content-bg)',
                      border: '1px solid var(--card-border)'
                    }}>
                      <div>
                        <div style={{
                          fontSize: '13px', fontWeight: '600',
                          color: 'var(--text-primary)'
                        }}>
                          {accountLabel(account)}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {getMemberName(account.member_id)} · {account.account_type_code}
                        </div>
                      </div>
                      <button
                        onClick={() => handleAdd(account.id)}
                        style={{
                          padding: '4px 10px', borderRadius: '6px',
                          border: 'none', background: 'var(--sidebar-bg)',
                          color: 'white', fontSize: '12px',
                          fontWeight: '600', cursor: 'pointer'
                        }}
                      >
                        + Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {allAccounts.length === 0 && circleAccounts.length > 0 && (
              <div style={{
                padding: '12px', borderRadius: '8px',
                background: 'var(--content-bg)', textAlign: 'center',
                fontSize: '13px', color: 'var(--text-secondary)'
              }}>
                All available accounts are already in this circle
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Circles() {
  const [circles, setCircles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingCircle, setEditingCircle] = useState(null)
  const [managingCircle, setManagingCircle] = useState(null)

  const fetchCircles = async () => {
    try {
      setLoading(true)
      const res = await circlesApi.getAll()
      setCircles(res.data)
    } catch  {
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
    } catch  {
      alert('Failed to delete circle')
    }
  }

  const handleSave = () => {
    setShowModal(false)
    setEditingCircle(null)
    fetchCircles()
  }

  const regionLabel = (code) => {
    const map = { CA: 'Canada', US: 'United States', IN: 'India' }
    return map[code] || code
  }

  return (
    <div>
      {/* Header */}
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
            Group accounts together for consolidated views
          </p>
        </div>
        <button
          onClick={() => { setEditingCircle(null); setShowModal(true) }}
          style={{
            padding: '9px 18px', borderRadius: '8px',
            border: 'none', background: 'var(--sidebar-bg)',
            color: 'white', fontSize: '13px', fontWeight: '600',
            cursor: 'pointer'
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
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⭕</div>
          <h3 style={{
            fontSize: '15px', fontWeight: '600',
            color: 'var(--text-primary)', marginBottom: '6px'
          }}>
            No circles yet
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Create your first circle to group accounts for a consolidated view
          </p>
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: '9px 18px', borderRadius: '8px',
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
            <div
              key={circle.id}
              style={{
                background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                borderRadius: '12px', padding: '16px 20px',
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  background: 'var(--accent-light)',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '18px', flexShrink: 0
                }}>
                  ⭕
                </div>
                <div>
                  <div style={{
                    fontSize: '14px', fontWeight: '600',
                    color: 'var(--text-primary)', marginBottom: '4px'
                  }}>
                    {circle.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: '600',
                      padding: '2px 7px', borderRadius: '6px',
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

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setManagingCircle(circle)}
                  style={{
                    padding: '6px 14px', borderRadius: '7px',
                    border: '1.5px solid var(--card-border)',
                    background: 'var(--accent-light)', color: 'var(--accent-dark)',
                    fontSize: '12px', fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  Manage accounts
                </button>
                <button
                  onClick={() => { setEditingCircle(circle); setShowModal(true) }}
                  style={{
                    padding: '6px 14px', borderRadius: '7px',
                    border: '1.5px solid var(--card-border)',
                    background: 'white', color: 'var(--text-primary)',
                    fontSize: '12px', fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(circle)}
                  style={{
                    padding: '6px 14px', borderRadius: '7px',
                    border: '1.5px solid #FECACA',
                    background: 'white', color: '#DC2626',
                    fontSize: '12px', fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
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

      {managingCircle && (
        <ManageAccountsModal
          circle={managingCircle}
          onClose={() => setManagingCircle(null)}
        />
      )}
    </div>
  )
}

export default Circles