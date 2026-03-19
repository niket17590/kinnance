import axios from 'axios'
import { supabase } from '../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Create axios instance
const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Auto-attach JWT token to every request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

// Handle 401 — redirect to login
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await supabase.auth.signOut()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ============================================================
// Members
// ============================================================

export const membersApi = {
  getAll: () => api.get('/members'),
  getById: (id) => api.get(`/members/${id}`),
  create: (data) => api.post('/members', data),
  update: (id, data) => api.put(`/members/${id}`, data),
  delete: (id) => api.delete(`/members/${id}`)
}

// ============================================================
// Member Accounts
// ============================================================

export const memberAccountsApi = {
  getAll: (memberId = null) => api.get('/member-accounts', {
    params: memberId ? { member_id: memberId } : {}
  }),
  getById: (id) => api.get(`/member-accounts/${id}`),
  create: (data) => api.post('/member-accounts', data),
  update: (id, data) => api.put(`/member-accounts/${id}`, data),
  delete: (id) => api.delete(`/member-accounts/${id}`)
}

// ============================================================
// Circles
// ============================================================

export const circlesApi = {
  getAll: () => api.get('/circles'),
  getById: (id) => api.get(`/circles/${id}`),
  create: (data) => api.post('/circles', data),
  update: (id, data) => api.put(`/circles/${id}`, data),
  delete: (id) => api.delete(`/circles/${id}`),
  getAccounts: (circleId) => api.get(`/circles/${circleId}/accounts`),
  addAccount: (circleId, accountId) => api.post(`/circles/${circleId}/accounts`, { account_id: accountId }),
  removeAccount: (circleId, accountId) => api.delete(`/circles/${circleId}/accounts/${accountId}`)
}

// ============================================================
// Reference Data
// ============================================================

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

export default api