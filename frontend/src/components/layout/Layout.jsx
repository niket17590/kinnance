import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import FilterBar from './FilterBar'
import LoadingBar from './LoadingBar'

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--content-bg)' }}>
      <LoadingBar />
      {/* Mobile overlay — darkens background when sidebar is open */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 40,
            display: 'none'
          }}
          className="mobile-overlay"
        />
      )}

      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        
        {/* Top bar with hamburger + filter bar */}
        <div style={{
          background: 'var(--topbar-bg)',
          borderBottom: '1px solid var(--topbar-border)',
          position: 'sticky',
          top: 0,
          zIndex: 30
        }}>
          {/* Mobile hamburger button */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 16px',
            borderBottom: '1px solid var(--filter-row-border)'
          }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hamburger-btn"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                display: 'none'
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M2 5h16M2 10h16M2 15h16"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            
            {/* App name — visible on mobile */}
            <span className="mobile-app-name" style={{
              fontSize: '15px',
              fontWeight: '700',
              color: 'var(--accent)',
              display: 'none'
            }}>
              Kinnance
            </span>
          </div>

          {/* Filter bar */}
          <FilterBar />
        </div>

        {/* Page content — Outlet renders the current page here */}
        <main style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .hamburger-btn { display: flex !important; }
          .mobile-app-name { display: block !important; }
          .mobile-overlay { display: block !important; }
        }
      `}</style>
    </div>
  )
}

export default Layout