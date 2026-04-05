import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

// ── Config ────────────────────────────────────────────────────
// Default refresh interval in milliseconds.
// Change VITE_AUTO_REFRESH_INTERVAL_MS in .env to override.
const DEFAULT_INTERVAL_MS = parseInt(
  import.meta.env.VITE_AUTO_REFRESH_INTERVAL_MS || '300000', // 5 minutes
  10
)

const RefreshContext = createContext(null)

export function RefreshProvider({ children }) {
  const [lastRefreshed, setLastRefreshed] = useState(Date.now())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS)
  const timerRef = useRef(null)

  const triggerRefresh = useCallback(() => {
    setLastRefreshed(Date.now())
  }, [])

  const refreshNow = useCallback(() => {
    setIsRefreshing(true)
    triggerRefresh()
    // Reset the timer so next auto-refresh is N minutes from now
    if (timerRef.current) clearInterval(timerRef.current)
    if (enabled) {
      timerRef.current = setInterval(triggerRefresh, intervalMs)
    }
    // Clear refreshing indicator after short delay
    setTimeout(() => setIsRefreshing(false), 1000)
  }, [enabled, intervalMs, triggerRefresh])

  // Start / restart interval when enabled or intervalMs changes
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (enabled && intervalMs > 0) {
      timerRef.current = setInterval(triggerRefresh, intervalMs)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [enabled, intervalMs, triggerRefresh])

  return (
    <RefreshContext.Provider value={{
      lastRefreshed,    // timestamp — pages watch this to know when to refetch
      isRefreshing,     // true briefly when refresh fires
      enabled,          // whether auto-refresh is on
      intervalMs,       // current interval
      refreshNow,       // call to trigger immediate refresh + reset timer
      setEnabled,       // toggle auto-refresh on/off
      setIntervalMs,    // change interval at runtime
    }}>
      {children}
    </RefreshContext.Provider>
  )
}

export function useRefresh() {
  const context = useContext(RefreshContext)
  if (!context) throw new Error('useRefresh must be used inside RefreshProvider')
  return context
}

/**
 * Hook for pages to subscribe to auto-refresh.
 * Pass a callback that fetches data — it will be called:
 *   1. On mount
 *   2. Every time lastRefreshed changes (auto or manual refresh)
 *
 * Usage:
 *   useAutoRefresh(fetchHoldings)
 */
export function useAutoRefresh(callback) {
  const { lastRefreshed } = useRefresh()

  useEffect(() => {
    callback()
  }, [lastRefreshed])
}
