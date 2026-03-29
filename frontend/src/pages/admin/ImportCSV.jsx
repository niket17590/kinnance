import { useState, useEffect, useRef } from 'react'
import { membersApi, memberAccountsApi } from '../../services/api'
import api from '../../services/api'

const SUPPORTED_BROKERS = [
  { code: 'WEALTHSIMPLE', name: 'WealthSimple', ext: '.csv' },
  { code: 'QUESTRADE',    name: 'Questrade',    ext: '.xlsx' },
  { code: 'IBKR',         name: 'Interactive Brokers', ext: '.csv' },
]

function StepIndicator({ step }) {
  const steps = ['Select broker', 'Upload file', 'Review & confirm']
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '28px' }}>
      {steps.map((label, i) => {
        const num = i + 1
        const active = step === num
        const done = step > num
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: '700',
                background: done ? 'var(--accent)' : active ? 'var(--sidebar-bg)' : 'var(--card-border)',
                color: done || active ? 'white' : 'var(--text-secondary)',
                flexShrink: 0
              }}>
                {done ? '✓' : num}
              </div>
              <span style={{
                fontSize: '13px', fontWeight: active ? '600' : '400',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)'
              }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                width: '40px', height: '1px',
                background: done ? 'var(--accent)' : 'var(--card-border)',
                margin: '0 12px'
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ImportCSV() {
  const [step, setStep] = useState(1)
  const [members, setMembers] = useState([])
  const [memberAccounts, setMemberAccounts] = useState([])
  const [selectedMember, setSelectedMember] = useState('')
  const [selectedBroker, setSelectedBroker] = useState('')
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [parseResult, setParseResult] = useState(null)
  const [unmatchedAccounts, setUnmatchedAccounts] = useState([])
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [mappings, setMappings] = useState({})
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)
  const broker = SUPPORTED_BROKERS.find(b => b.code === selectedBroker)

  useEffect(() => {
    membersApi.getAll().then(res => setMembers(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedMember || !selectedBroker) { setMemberAccounts([]); return }
    memberAccountsApi.getAll(selectedMember)
      .then(res => setMemberAccounts(res.data.filter(a => a.broker_code === selectedBroker)))
      .catch(() => {})
  }, [selectedMember, selectedBroker])

  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return
    const ext = '.' + selectedFile.name.split('.').pop().toLowerCase()
    if (broker && ext !== broker.ext) { setError(`${broker.name} requires a ${broker.ext} file`); return }
    setError('')
    setFile(selectedFile)
  }

  const handleDrop = (e) => { e.preventDefault(); setDragging(false); handleFileSelect(e.dataTransfer.files[0]) }

  const handleParse = async () => {
    if (!file || !selectedBroker || !selectedMember) { setError('Please select a member, broker and file'); return }
    setLoading(true); setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('broker_code', selectedBroker)
      formData.append('member_id', selectedMember)
      const res = await api.post('/imports/parse', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      const result = res.data
      if (result.status === 'FAILED') { setError(result.errors?.join(', ') || 'Parse failed'); return }
      setParseResult(result)
      setStep(3)
      if (result.status === 'NEEDS_MAPPING') {
        const suggestions = result.account_number_suggestions || {}
        const initMappings = {}
        result.unmatched_accounts.forEach(id => {
          // Pre-fill with account number match if found
          initMappings[id] = suggestions[id] || ''
        })
        setMappings(initMappings)
        setUnmatchedAccounts(result.unmatched_accounts)
        setAvailableAccounts(result.available_accounts)
      } else if (result.status === 'READY') {
        setUnmatchedAccounts([])
        setMappings({})
        await runImport({}, [])
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to parse file')
    } finally { setLoading(false) }
  }

  const handleConfirmAndImport = async () => {
    const unmapped = unmatchedAccounts.filter(id => !mappings[id])
    if (unmapped.length > 0) { setError('Please map or skip all accounts before importing'); return }
    const confirmedMappings = {}
    const skippedAccounts = []
    Object.entries(mappings).forEach(([identifier, value]) => {
      if (value === 'SKIP') skippedAccounts.push(identifier)
      else if (value) confirmedMappings[identifier] = value
    })
    await runImport(confirmedMappings, skippedAccounts)
  }

  const runImport = async (confirmedMappings, skippedAccounts) => {
    setLoading(true); setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('broker_code', selectedBroker)
      formData.append('member_id', selectedMember)
      formData.append('confirmed_mappings', JSON.stringify(confirmedMappings))
      formData.append('skipped_accounts', JSON.stringify(skippedAccounts))
      const res = await api.post('/imports/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      if (res.data.status === 'COMPLETE') { setImportResult(res.data); setUnmatchedAccounts([]) }
      else setError(res.data.errors?.join(', ') || 'Import failed')
    } catch (err) {
      setError(err.response?.data?.detail || 'Import failed')
    } finally { setLoading(false) }
  }

  const handleReset = () => {
    setStep(1); setSelectedMember(''); setSelectedBroker(''); setFile(null)
    setError(''); setParseResult(null); setUnmatchedAccounts([])
    setAvailableAccounts([]); setMappings({}); setImportResult(null)
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '8px',
    border: '1.5px solid var(--card-border)', background: 'white',
    fontSize: '13px', color: 'var(--text-primary)', outline: 'none'
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
          Upload transactions
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Import your transaction history from WealthSimple, Questrade or IBKR
        </p>
      </div>

      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: '16px', padding: '28px', maxWidth: '640px'
      }}>
        <StepIndicator step={step} />

        {error && (
          <div style={{
            background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '8px',
            padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#DC2626'
          }}>
            {error}
          </div>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
                Member
              </label>
              <select value={selectedMember} onChange={e => setSelectedMember(e.target.value)} style={inputStyle}>
                <option value="">Select a member</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>
                Broker
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {SUPPORTED_BROKERS.map(b => (
                  <div key={b.code} onClick={() => setSelectedBroker(b.code)} style={{
                    padding: '12px 16px', borderRadius: '10px', cursor: 'pointer',
                    border: `1.5px solid ${selectedBroker === b.code ? 'var(--accent)' : 'var(--card-border)'}`,
                    background: selectedBroker === b.code ? 'var(--accent-light)' : 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: selectedBroker === b.code ? 'var(--accent-dark)' : 'var(--text-primary)' }}>
                        {b.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Export as {b.ext} file</div>
                    </div>
                    {selectedBroker === b.code && (
                      <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: '700' }}>✓</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button onClick={() => {
              if (!selectedMember || !selectedBroker) { setError('Please select both a member and a broker'); return }
              setError(''); setStep(2)
            }} style={{ width: '100%', padding: '11px', borderRadius: '8px', border: 'none', background: 'var(--sidebar-bg)', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              Continue →
            </button>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div>
            <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
              {[broker?.name, members.find(m => m.id === selectedMember)?.display_name].map(label => (
                <span key={label} style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '6px', background: 'var(--accent-light)', color: 'var(--accent-dark)', fontWeight: '600' }}>
                  {label}
                </span>
              ))}
            </div>

            {memberAccounts.length > 0 ? (
              <div style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '10px' }}>📋 Accounts we'll import into</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {memberAccounts.map(acc => (
                    <div key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px' }}>🏦</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500' }}>{acc.nickname || acc.account_type_code}</span>
                      {acc.account_number && <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>#{acc.account_number}</span>}
                      <span style={{ fontSize: '11px', fontWeight: '600', padding: '1px 6px', borderRadius: '4px', background: 'var(--accent-light)', color: 'var(--accent-dark)', marginLeft: 'auto' }}>{acc.account_type_code}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#92400E', marginBottom: '4px' }}>⚠️ No accounts found</div>
                <div style={{ fontSize: '12px', color: '#92400E' }}>Add accounts under <strong>Admin → Accounts</strong> before uploading.</div>
              </div>
            )}

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragging || file ? 'var(--accent)' : 'var(--card-border)'}`,
                borderRadius: '12px', padding: '40px 20px', textAlign: 'center',
                cursor: 'pointer', background: dragging ? 'var(--accent-light)' : 'var(--content-bg)',
                marginBottom: '16px', transition: 'all 0.15s'
              }}
            >
              <input ref={fileInputRef} type="file" accept={broker?.ext} style={{ display: 'none' }} onChange={e => handleFileSelect(e.target.files[0])} />
              {file ? (
                <>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>📄</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-dark)', marginBottom: '4px' }}>{file.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{(file.size / 1024).toFixed(1)} KB — click to change</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>☁️</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>Drop your {broker?.ext} file here</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>or click to browse</div>
                </>
              )}
            </div>

            <div style={{ background: 'var(--content-bg)', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', border: '1px solid var(--card-border)' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>How to export from {broker?.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                {selectedBroker === 'WEALTHSIMPLE' && 'Log in → Activity → scroll to bottom → Export CSV. WealthSimple may show multiple sub-accounts (CAD/USD) for the same account type — map both to the same Kinnance account.'}
                {selectedBroker === 'QUESTRADE' && 'Log in → Accounts → History → select date range → Download'}
                {selectedBroker === 'IBKR' && 'Log in → Reports → Activity → Custom Date Range → select Trades + Cash Transactions → Export CSV'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setStep(1); setFile(null); setError('') }} style={{ flex: 1, padding: '11px', borderRadius: '8px', border: '1.5px solid var(--card-border)', background: 'white', color: 'var(--text-primary)', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>← Back</button>
              <button onClick={handleParse} disabled={!file || loading} style={{ flex: 2, padding: '11px', borderRadius: '8px', border: 'none', background: 'var(--sidebar-bg)', color: 'white', fontSize: '13px', fontWeight: '600', cursor: (!file || loading) ? 'not-allowed' : 'pointer', opacity: (!file || loading) ? 0.7 : 1 }}>
                {loading ? 'Parsing file...' : 'Parse & continue →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div>
            {/* Import complete */}
            {importResult && (
              <>
                <div style={{ background: '#DCFCE7', border: '1px solid #BBF7D0', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px' }}>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#14532D', marginBottom: '12px' }}>✅ Import complete</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                    {[
                      ['Total', importResult.total_transactions ?? 0, '#1D4ED8'],
                      ['Imported', importResult.imported ?? 0, '#14532D'],
                      ['Duplicates skipped', importResult.duplicates_skipped ?? 0, '#92400E'],
                      ['Accounts skipped', importResult.accounts_skipped ?? 0, '#6B7280'],
                      ['Date range', importResult.date_from ? `${importResult.date_from} → ${importResult.date_to}` : '—', '#14532D'],
                    ].map(([label, value, color]) => (
                      <div key={label}>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{label}</div>
                        <div style={{ fontSize: '16px', fontWeight: '700', color }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {importResult.parse_errors?.length > 0 && (
                  <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#92400E', marginBottom: '6px' }}>Parse warnings ({importResult.parse_errors.length})</div>
                    {importResult.parse_errors.map((e, i) => <div key={i} style={{ fontSize: '11px', color: '#92400E', lineHeight: '1.6' }}>{e}</div>)}
                  </div>
                )}
                <button onClick={handleReset} style={{ width: '100%', padding: '11px', borderRadius: '8px', border: 'none', background: 'var(--sidebar-bg)', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  Import another file
                </button>
              </>
            )}

            {/* Account mapping */}
            {unmatchedAccounts.length > 0 && !importResult && (
              <>
                {parseResult && (
                  <div style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', display: 'flex', gap: '24px' }}>
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Total transactions</div>
                      <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{parseResult.total_transactions}</div>
                    </div>
                    {parseResult.date_from && (
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Date range</div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{parseResult.date_from} → {parseResult.date_to}</div>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px 16px', marginBottom: '20px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#92400E' }}>⚠️ Some accounts need to be matched</div>
                  <div style={{ fontSize: '12px', color: '#92400E', marginTop: '4px' }}>
                    This only happens once — we'll remember your choice next time. For WealthSimple, map both CAD and USD sub-accounts to the same Kinnance account.
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  {unmatchedAccounts.map(identifier => (
                    <div key={identifier} style={{ marginBottom: '14px' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
                        "{identifier}" in your file →
                      </label>
                      <select value={mappings[identifier] || ''} onChange={e => setMappings({ ...mappings, [identifier]: e.target.value })} style={inputStyle}>
                        <option value="">Select matching account</option>
                        <option value="SKIP">⏭ Skip — don't import transactions for this account</option>
                        {availableAccounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.member_name} — {acc.account_type_name}{acc.nickname ? ` (${acc.nickname})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => { setStep(2); setUnmatchedAccounts([]); setImportResult(null) }} style={{ flex: 1, padding: '11px', borderRadius: '8px', border: '1.5px solid var(--card-border)', background: 'white', color: 'var(--text-primary)', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>← Back</button>
                  <button onClick={handleConfirmAndImport} disabled={loading} style={{ flex: 2, padding: '11px', borderRadius: '8px', border: 'none', background: 'var(--sidebar-bg)', color: 'white', fontSize: '13px', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                    {loading ? 'Importing...' : 'Confirm & import →'}
                  </button>
                </div>
              </>
            )}

            {loading && !importResult && unmatchedAccounts.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
                Importing transactions...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ImportCSV