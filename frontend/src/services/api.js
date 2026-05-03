import axios from 'axios'
import { supabase } from '../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' }
})

// Loading callbacks — set by LoadingProvider
let onRequestStart = null
let onRequestEnd = null

export function setLoadingCallbacks(start, end) {
  onRequestStart = start
  onRequestEnd = end
}

// Attach JWT token + trigger loading start
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  onRequestStart?.()
  return config
})

// Trigger loading end on response or error
api.interceptors.response.use(
  (response) => {
    onRequestEnd?.()
    return response
  },
  async (error) => {
    onRequestEnd?.()
    if (error.response?.status === 401) {
      await supabase.auth.signOut()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ── Members ──────────────────────────────────────────────────
export const membersApi = {
  getAll: () => api.get('/members'),
  getById: (id) => api.get(`/members/${id}`),
  create: (data) => api.post('/members', data),
  update: (id, data) => api.put(`/members/${id}`, data),
  delete: (id) => api.delete(`/members/${id}`)
}

// ── Member Accounts ───────────────────────────────────────────
export const memberAccountsApi = {
  getAll: (memberId = null) => api.get('/member-accounts', {
    params: memberId ? { member_id: memberId } : {}
  }),
  getById: (id) => api.get(`/member-accounts/${id}`),
  create: (data) => api.post('/member-accounts', data),
  update: (id, data) => api.put(`/member-accounts/${id}`, data),
  delete: (id) => api.delete(`/member-accounts/${id}`)
}

// ── Circles ───────────────────────────────────────────────────
export const circlesApi = {
  getAll: () => api.get('/circles'),
  getWithAccounts: () => api.get('/circles/with-accounts'),
  getById: (id) => api.get(`/circles/${id}`),
  create: (data) => api.post('/circles', data),
  update: (id, data) => api.put(`/circles/${id}`, data),
  delete: (id) => api.delete(`/circles/${id}`),
  getAccounts: (circleId) => api.get(`/circles/${circleId}/accounts`),
  bulkUpdateAccounts: (circleId, data) => api.post(`/circles/${circleId}/accounts/bulk`, data),
  resync: (circleId) => api.post(`/circles/${circleId}/resync`)
}

// ── Reference Data ────────────────────────────────────────────
export const referenceApi = {
  getRegions: () => api.get('/reference/regions'),
  getBrokers: (regionCode = null) => api.get('/reference/brokers', {
    params: regionCode ? { region_code: regionCode } : {}
  }),
  getAccountTypes: (regionCode = null, appliesTo = null) => api.get('/reference/account-types', {
    params: {
      ...(regionCode ? { region_code: regionCode } : {}),
      ...(appliesTo ? { applies_to: appliesTo } : {})
    }
  }),
  getCurrencies: () => api.get('/reference/currencies')
}

// ── Transactions ──────────────────────────────────────────────
export const transactionsApi = {
  getAll: (params = {}) => api.get('/transactions', { params })
}

// ── Capital Gains ─────────────────────────────────────────────
export const capitalGainsApi = {
  getTaxYears: (params = {}) => api.get('/capital-gains/tax-years', { params }),
  get: (params = {}) => api.get('/capital-gains', { params }),
}

export default api
