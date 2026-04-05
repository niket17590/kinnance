import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { setLoadingCallbacks } from '../services/api'

const LoadingContext = createContext(null)

export function LoadingProvider({ children }) {
  const [requestCount, setRequestCount] = useState(0)

  const increment = useCallback(() => setRequestCount(c => c + 1), [])
  const decrement = useCallback(() => setRequestCount(c => Math.max(0, c - 1)), [])

  // Wire axios interceptors to this context
  useEffect(() => {
    setLoadingCallbacks(increment, decrement)
  }, [increment, decrement])

  return (
    <LoadingContext.Provider value={{
      isLoading: requestCount > 0,
      increment,
      decrement
    }}>
      {children}
    </LoadingContext.Provider>
  )
}

export function useLoading() {
  const context = useContext(LoadingContext)
  if (!context) throw new Error('useLoading must be used inside LoadingProvider')
  return context
}