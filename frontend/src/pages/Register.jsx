import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function Register() {
  const { signUpWithEmail, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleGoogle = async () => {
    try {
      setError('')
      setLoading(true)
      await signInWithGoogle()
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    if (!displayName || !email || !password || !confirmPassword) {
      setError('Please fill in all fields')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    try {
      setError('')
      setLoading(true)
      await signUpWithEmail(email, password, displayName)
      setSuccess(true)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--content-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: '16px',
          padding: '40px',
          width: '100%',
          maxWidth: '400px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: '#DCFCE7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#16A34A"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '700',
            color: 'var(--text-primary)',
            marginBottom: '8px'
          }}>
            Check your email
          </h2>
          <p style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            lineHeight: '1.6',
            marginBottom: '24px'
          }}>
            We sent a verification link to <strong>{email}</strong>.
            Click the link to activate your account.
          </p>
          <Link
            to="/login"
            style={{
              display: 'inline-block',
              padding: '10px 24px',
              borderRadius: '8px',
              background: 'var(--sidebar-bg)',
              color: 'white',
              fontSize: '13px',
              fontWeight: '600',
              textDecoration: 'none'
            }}
          >
            Back to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--content-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: '16px',
        padding: '40px',
        width: '100%',
        maxWidth: '400px'
      }}>
        {/* Logo + Title */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'var(--sidebar-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <svg width="24" height="24" viewBox="0 0 18 18" fill="none">
              <rect x="1" y="1" width="7" height="7" rx="1.5" fill="white"/>
              <rect x="10" y="1" width="7" height="7" rx="1.5" fill="white" opacity="0.55"/>
              <rect x="1" y="10" width="7" height="7" rx="1.5" fill="white" opacity="0.45"/>
              <rect x="10" y="10" width="7" height="7" rx="1.5" fill="white" opacity="0.25"/>
            </svg>
          </div>
          <h1 style={{
            fontSize: '22px',
            fontWeight: '700',
            color: 'var(--text-primary)',
            marginBottom: '6px'
          }}>
            Create your account
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Start managing your family portfolio
          </p>
        </div>

        {error && (
          <div style={{
            background: '#FEE2E2',
            border: '1px solid #FECACA',
            borderRadius: '8px',
            padding: '10px 14px',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#DC2626'
          }}>
            {error}
          </div>
        )}

        {/* Google signup */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{
            width: '100%',
            padding: '11px',
            borderRadius: '10px',
            border: '1.5px solid var(--card-border)',
            background: 'white',
            color: 'var(--text-primary)',
            fontSize: '14px',
            fontWeight: '500',
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            marginBottom: '20px',
            opacity: loading ? 0.7 : 1
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
            <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.962L3.964 6.294C4.672 4.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '20px'
        }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--card-border)' }}/>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--card-border)' }}/>
        </div>

        <form onSubmit={handleRegister}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block', fontSize: '12px',
              fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px'
            }}>
              Full name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Niket Agrawal"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1.5px solid var(--card-border)', background: 'white',
                fontSize: '13px', color: 'var(--text-primary)', outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
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

          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block', fontSize: '12px',
              fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px'
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1.5px solid var(--card-border)', background: 'white',
                fontSize: '13px', color: 'var(--text-primary)', outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block', fontSize: '12px',
              fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px'
            }}>
              Confirm password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
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
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p style={{
          textAlign: 'center', marginTop: '20px',
          fontSize: '13px', color: 'var(--text-secondary)'
        }}>
          Already have an account?{' '}
          <Link to="/login" style={{
            color: 'var(--accent)', fontWeight: '600', textDecoration: 'none'
          }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default Register