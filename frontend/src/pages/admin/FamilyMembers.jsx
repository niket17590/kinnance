import { useState, useEffect } from 'react'
import { membersApi } from '../../services/api'

function MemberModal({ member, onSave, onClose }) {
  const [form, setForm] = useState({
    display_name: member?.display_name || '',
    member_type: member?.member_type || 'PERSON',
    email: member?.email || ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.display_name.trim()) {
      setError('Name is required')
      return
    }
    try {
      setLoading(true)
      setError('')
      if (member) {
        await membersApi.update(member.id, form)
      } else {
        await membersApi.create(form)
      }
      onSave()
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: '16px',
        padding: '28px',
        width: '100%',
        maxWidth: '440px'
      }}>
        <h2 style={{
          fontSize: '16px', fontWeight: '700',
          color: 'var(--text-primary)', marginBottom: '20px'
        }}>
          {member ? 'Edit member' : 'Add member'}
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
          {/* Member type toggle */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block', fontSize: '12px',
              fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px'
            }}>
              Member type
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['PERSON', 'CORPORATION'].map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm({ ...form, member_type: type })}
                  style={{
                    flex: 1, padding: '8px',
                    borderRadius: '8px',
                    border: `1.5px solid ${form.member_type === type ? 'var(--accent)' : 'var(--card-border)'}`,
                    background: form.member_type === type ? 'var(--accent-light)' : 'white',
                    color: form.member_type === type ? 'var(--accent-dark)' : 'var(--text-secondary)',
                    fontSize: '13px', fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  {type === 'PERSON' ? '👤 Person' : '🏢 Corporation'}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block', fontSize: '12px',
              fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px'
            }}>
              {form.member_type === 'PERSON' ? 'Full name' : 'Corporation name'}
            </label>
            <input
              type="text"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder={form.member_type === 'PERSON' ? 'e.g. Niket Agrawal' : 'e.g. 1234567 Ontario Inc.'}
              style={{
                width: '100%', padding: '10px 12px',
                borderRadius: '8px', border: '1.5px solid var(--card-border)',
                background: 'white', fontSize: '13px',
                color: 'var(--text-primary)', outline: 'none'
              }}
            />
          </div>

          {/* Email */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block', fontSize: '12px',
              fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px'
            }}>
              Email <span style={{ color: 'var(--text-secondary)', fontWeight: '400' }}>(optional)</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="e.g. niket@example.com"
              style={{
                width: '100%', padding: '10px 12px',
                borderRadius: '8px', border: '1.5px solid var(--card-border)',
                background: 'white', fontSize: '13px',
                color: 'var(--text-primary)', outline: 'none'
              }}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, padding: '10px',
                borderRadius: '8px', border: '1.5px solid var(--card-border)',
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
                flex: 1, padding: '10px',
                borderRadius: '8px', border: 'none',
                background: 'var(--sidebar-bg)', color: 'white',
                fontSize: '13px', fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1
              }}
            >
              {loading ? 'Saving...' : member ? 'Save changes' : 'Add member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FamilyMembers() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingMember, setEditingMember] = useState(null)

  const fetchMembers = async () => {
    try {
      setLoading(true)
      const res = await membersApi.getAll()
      setMembers(res.data)
    } catch {
      setError('Failed to load members')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMembers()
  }, [])

  const handleDelete = async (member) => {
    if (!confirm(`Are you sure you want to remove ${member.display_name}?`)) return
    try {
      await membersApi.delete(member.id)
      fetchMembers()
    } catch {
      alert('Failed to delete member')
    }
  }

  const handleSave = () => {
    setShowModal(false)
    setEditingMember(null)
    fetchMembers()
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
            Family & members
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Manage the people and corporations in your portfolio
          </p>
        </div>
        <button
          onClick={() => { setEditingMember(null); setShowModal(true) }}
          style={{
            padding: '9px 18px', borderRadius: '8px',
            border: 'none', background: 'var(--sidebar-bg)',
            color: 'white', fontSize: '13px', fontWeight: '600',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
          }}
        >
          + Add member
        </button>
      </div>

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
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
          Loading members...
        </div>
      )}

      {/* Empty state */}
      {!loading && members.length === 0 && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '48px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>👥</div>
          <h3 style={{
            fontSize: '15px', fontWeight: '600',
            color: 'var(--text-primary)', marginBottom: '6px'
          }}>
            No members yet
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Add family members or corporations to get started
          </p>
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: '9px 18px', borderRadius: '8px',
              border: 'none', background: 'var(--sidebar-bg)',
              color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
            }}
          >
            + Add your first member
          </button>
        </div>
      )}

      {/* Members list */}
      {!loading && members.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {members.map(member => (
            <div
              key={member.id}
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: '12px', padding: '16px 20px',
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {/* Avatar */}
                <div style={{
                  width: '40px', height: '40px',
                  borderRadius: '50%',
                  background: member.member_type === 'CORPORATION' ? '#DBEAFE' : 'var(--accent-light)',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '18px', flexShrink: 0
                }}>
                  {member.member_type === 'CORPORATION' ? '🏢' : '👤'}
                </div>

                <div>
                  <div style={{
                    fontSize: '14px', fontWeight: '600',
                    color: 'var(--text-primary)', marginBottom: '2px'
                  }}>
                    {member.display_name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: '600',
                      padding: '2px 7px', borderRadius: '6px',
                      background: member.member_type === 'CORPORATION' ? '#DBEAFE' : 'var(--accent-light)',
                      color: member.member_type === 'CORPORATION' ? '#1D4ED8' : 'var(--accent-dark)'
                    }}>
                      {member.member_type === 'CORPORATION' ? 'Corporation' : 'Person'}
                    </span>
                    {member.email && (
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {member.email}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => { setEditingMember(member); setShowModal(true) }}
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
                  onClick={() => handleDelete(member)}
                  style={{
                    padding: '6px 14px', borderRadius: '7px',
                    border: '1.5px solid #FECACA',
                    background: 'white', color: '#DC2626',
                    fontSize: '12px', fontWeight: '600', cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <MemberModal
          member={editingMember}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingMember(null) }}
        />
      )}
    </div>
  )
}

export default FamilyMembers