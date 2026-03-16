import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../context/AuthContext'

function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email) {
      setError('Please enter your email address')
      return
    }
    try {
      setError('')
      setLoading(true)
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      })
      if (error) throw error
      setSuccess(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--content-bg)',
      display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '20px'
    }}>
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: '16px', padding: '40px',
        width: '100%', maxWidth: '400px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{
            fontSize: '22px', fontWeight: '700',
            color: 'var(--text-primary)', marginBottom: '6px'
          }}>
            Reset your password
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Enter your email and we'll send you a reset link
          </p>
        </div>

        {success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              background: '#DCFCE7', borderRadius: '8px',
              padding: '16px', marginBottom: '20px',
              fontSize: '13px', color: '#16A34A'
            }}>
              Reset link sent to <strong>{email}</strong>
            </div>
            <Link to="/login" style={{
              color: 'var(--accent)', fontWeight: '600',
              fontSize: '13px', textDecoration: 'none'
            }}>
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                background: '#FEE2E2', border: '1px solid #FECACA',
                borderRadius: '8px', padding: '10px 14px',
                marginBottom: '16px', fontSize: '13px', color: '#DC2626'
              }}>
                {error}
              </div>
            )}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block', fontSize: '12px',
                fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px'
              }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: '8px',
                  border: '1.5px solid var(--card-border)', background: 'white',
                  fontSize: '13px', color: 'var(--text-primary)', outline: 'none'
                }}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '11px', borderRadius: '10px',
                border: 'none', background: 'var(--sidebar-bg)', color: 'white',
                fontSize: '14px', fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1
              }}
            >
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <p style={{
              textAlign: 'center', marginTop: '16px',
              fontSize: '13px', color: 'var(--text-secondary)'
            }}>
              <Link to="/login" style={{
                color: 'var(--accent)', fontWeight: '600', textDecoration: 'none'
              }}>
                Back to login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

export default ForgotPassword