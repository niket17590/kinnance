import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { circlesApi } from '../services/api'

const FilterContext = createContext(null)

export function FilterProvider({ children }) {
  // All circles for the dropdown
  const [circles, setCircles] = useState([])
  const [circlesLoading, setCirclesLoading] = useState(true)

  // Selected circle — single select
  const [selectedCircle, setSelectedCircle] = useState(null)

  // Options derived from selected circle's accounts
  const [memberOptions, setMemberOptions] = useState([])
  const [accountTypeOptions, setAccountTypeOptions] = useState([])
  const [brokerOptions, setBrokerOptions] = useState([])

  // Active filter selections — multi-select arrays
  // Empty array = All selected
  const [selectedMembers, setSelectedMembers] = useState([])
  const [selectedAccountTypes, setSelectedAccountTypes] = useState([])
  const [selectedBrokers, setSelectedBrokers] = useState([])

  // Load all circles on mount
const loadCircles = () => {
    setCirclesLoading(true)
    circlesApi.getAll()
      .then(res => {
        const data = res.data || []
        setCircles(data)
        if (data.length === 1 && !selectedCircle) {
          setSelectedCircle(data[0])
        }
      })
      .catch(() => {})
      .finally(() => setCirclesLoading(false))
  }

  const refreshFilterOptions = () => {
    if (!selectedCircle) return
    circlesApi.getAccounts(selectedCircle.id)
      .then(res => {
        const accounts = res.data || []

        const members = []
        const memberIds = new Set()
        accounts.forEach(acc => {
          if (!memberIds.has(acc.member_id)) {
            memberIds.add(acc.member_id)
            members.push({ id: acc.member_id, name: acc.member_name })
          }
        })

        const accountTypes = []
        const typeCodes = new Set()
        accounts.forEach(acc => {
          if (!typeCodes.has(acc.account_type_code)) {
            typeCodes.add(acc.account_type_code)
            accountTypes.push({ code: acc.account_type_code, name: acc.account_type_name || acc.account_type_code })
          }
        })

        const brokers = []
        const brokerCodes = new Set()
        accounts.forEach(acc => {
          if (!brokerCodes.has(acc.broker_code)) {
            brokerCodes.add(acc.broker_code)
            brokers.push({ code: acc.broker_code, name: acc.broker_name || acc.broker_code })
          }
        })

        setMemberOptions(members)
        setAccountTypeOptions(accountTypes)
        setBrokerOptions(brokers)
      })
      .catch(() => {})
  }

  // Load all circles on mount
  useEffect(() => {
    loadCircles()
  }, [])

  // When circle changes — load its accounts to populate filter options
  useEffect(() => {
    if (!selectedCircle) {
      setMemberOptions([])
      setAccountTypeOptions([])
      setBrokerOptions([])
      resetSelections()
      return
    }

    circlesApi.getAccounts(selectedCircle.id)
      .then(res => {
        const accounts = res.data || []

        // Derive unique members
        const members = []
        const memberIds = new Set()
        accounts.forEach(acc => {
          if (!memberIds.has(acc.member_id)) {
            memberIds.add(acc.member_id)
            members.push({
              id: acc.member_id,
              name: acc.member_name
            })
          }
        })

        // Derive unique account types
        const accountTypes = []
        const typeCodes = new Set()
        accounts.forEach(acc => {
          if (!typeCodes.has(acc.account_type_code)) {
            typeCodes.add(acc.account_type_code)
            accountTypes.push({
              code: acc.account_type_code,
              name: acc.account_type_name || acc.account_type_code
            })
          }
        })

        // Derive unique brokers
        const brokers = []
        const brokerCodes = new Set()
        accounts.forEach(acc => {
          if (!brokerCodes.has(acc.broker_code)) {
            brokerCodes.add(acc.broker_code)
            brokers.push({
              code: acc.broker_code,
              name: acc.broker_name || acc.broker_code
            })
          }
        })

        setMemberOptions(members)
        setAccountTypeOptions(accountTypes)
        setBrokerOptions(brokers)
        resetSelections()
      })
      .catch(() => {})
  }, [selectedCircle])

  const resetSelections = () => {
    setSelectedMembers([])
    setSelectedAccountTypes([])
    setSelectedBrokers([])
  }

  const handleCircleChange = (circle) => {
    setSelectedCircle(circle)
    // resetSelections is called via the useEffect above
  }

  // Toggle helpers for multi-select pills
  const toggleMember = (memberId) => {
    setSelectedMembers(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    )
  }

  const toggleAccountType = (code) => {
    setSelectedAccountTypes(prev =>
      prev.includes(code)
        ? prev.filter(c => c !== code)
        : [...prev, code]
    )
  }

  const toggleBroker = (code) => {
    setSelectedBrokers(prev =>
      prev.includes(code)
        ? prev.filter(c => c !== code)
        : [...prev, code]
    )
  }

  // Computed filter object — reflects current UI state immediately
  const activeFilters = {
    circleId: selectedCircle?.id || null,
    memberIds: selectedMembers,
    accountTypes: selectedAccountTypes,
    brokers: selectedBrokers,
  }

  // Debounced filters — used by pages for API calls.
  // Circle changes are applied immediately; multi-select toggles
  // are debounced 300ms so rapid clicks don't fire multiple requests.
  const [debouncedFilters, setDebouncedFilters] = useState(activeFilters)
  const debounceTimer = useRef(null)

  useEffect(() => {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      setDebouncedFilters({
        circleId: selectedCircle?.id || null,
        memberIds: selectedMembers,
        accountTypes: selectedAccountTypes,
        brokers: selectedBrokers,
      })
    }, 300)
    return () => clearTimeout(debounceTimer.current)
  }, [selectedMembers, selectedAccountTypes, selectedBrokers])

  // Circle changes bypass the debounce
  useEffect(() => {
    clearTimeout(debounceTimer.current)
    setDebouncedFilters(prev => ({ ...prev, circleId: selectedCircle?.id || null }))
  }, [selectedCircle])

  return (
    <FilterContext.Provider value={{
      // Circles
      circles,
      circlesLoading,
      selectedCircle,
      handleCircleChange,

      // Options
      memberOptions,
      accountTypeOptions,
      brokerOptions,

      // Selections
      selectedMembers,
      selectedAccountTypes,
      selectedBrokers,

      // Toggle handlers
      toggleMember,
      toggleAccountType,
      toggleBroker,
      resetSelections,
      setSelectedMembers,
      setSelectedAccountTypes,
      setSelectedBrokers,
      refreshCircles: loadCircles,
      refreshFilterOptions,

      // Computed
      activeFilters,
      debouncedFilters,
    }}>
      {children}
    </FilterContext.Provider>
  )
}

export function useFilters() {
  const context = useContext(FilterContext)
  if (!context) {
    throw new Error('useFilters must be used inside FilterProvider')
  }
  return context
}
