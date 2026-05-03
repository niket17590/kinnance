import { useState, useEffect, useCallback } from "react";
import { circlesApi, memberAccountsApi, membersApi, referenceApi } from "../../services/api";
import { useFilters } from "../../context/FilterContext";

// ── Constants ─────────────────────────────────────────────────

const TAX_COLORS = {
  TAX_FREE:     { bg: "#DCFCE7", color: "#14532D" },
  TAX_DEFERRED: { bg: "#DBEAFE", color: "#1D4ED8" },
  TAXABLE:      { bg: "#FEF3C7", color: "#92400E" },
  CORP_TAXABLE: { bg: "#F3E8FF", color: "#6D28D9" },
};
const TAX_LABELS = {
  TAX_FREE: "Tax free", TAX_DEFERRED: "Tax deferred",
  TAXABLE: "Taxable", CORP_TAXABLE: "Corp",
};
const REGION_LABELS = { CA: "Canada", US: "United States", IN: "India" };

const accountLabel = (a) => a.nickname || `${a.account_type_code} · ${a.broker_code}`;
const taxBadge = (tax_category) => {
  const tc = TAX_COLORS[tax_category] || { bg: "#F3F4F6", color: "#374151" };
  return { style: tc, label: TAX_LABELS[tax_category] || tax_category };
};

// Group an array of accounts by member_id
const groupByMember = (accounts) =>
  accounts.reduce((acc, a) => {
    if (!acc[a.member_id]) acc[a.member_id] = { member_name: a.member_name, accounts: [] };
    acc[a.member_id].accounts.push(a);
    return acc;
  }, {});

function ResyncBadge({ status }) {
  if (status === "PROCESSING") {
    return (
      <span style={{
        fontSize: "11px",
        fontWeight: "700",
        padding: "2px 8px",
        borderRadius: "999px",
        background: "#DBEAFE",
        color: "#1D4ED8",
      }}>
        Re-sync in progress
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span style={{
        fontSize: "11px",
        fontWeight: "700",
        padding: "2px 8px",
        borderRadius: "999px",
        background: "#FEE2E2",
        color: "#DC2626",
      }}>
        Re-sync failed
      </span>
    );
  }
  return null;
}

// ── Circle create / edit modal ────────────────────────────────

function CircleModal({ circle, onSave, onClose }) {
  const [regions, setRegions] = useState([]);
  const [form, setForm] = useState({
    name: circle?.name || "",
    region_code: circle?.region_code || "",
    description: circle?.description || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    referenceApi.getRegions().then(r => setRegions(r.data)).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Circle name is required"); return; }
    if (!form.region_code) { setError("Country is required"); return; }
    try {
      setLoading(true); setError("");
      circle
        ? await circlesApi.update(circle.id, { name: form.name, description: form.description })
        : await circlesApi.create(form);
      onSave();
    } catch (err) {
      setError(err.response?.data?.detail || "Something went wrong");
      setLoading(false);
    }
  };

  const inp = {
    width: "100%", padding: "10px 12px", borderRadius: "8px",
    border: "1.5px solid var(--card-border)", background: "white",
    fontSize: "13px", color: "var(--text-primary)", outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)",
        borderRadius: "16px", padding: "28px", width: "100%", maxWidth: "440px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "20px" }}>
          {circle ? "Edit circle" : "Create circle"}
        </h2>
        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: "8px",
            padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#DC2626" }}>
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "600",
              color: "var(--text-primary)", marginBottom: "6px" }}>Country</label>
            <select value={form.region_code}
              onChange={e => setForm(f => ({ ...f, region_code: e.target.value }))}
              disabled={!!circle} style={inp}>
              <option value="">Select country</option>
              {regions.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "600",
              color: "var(--text-primary)", marginBottom: "6px" }}>Circle name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sharma Family" style={inp} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "600",
              color: "var(--text-primary)", marginBottom: "6px" }}>
              Description <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>(optional)</span>
            </label>
            <input value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Our family investment portfolio" style={inp} />
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: "10px", borderRadius: "8px",
                border: "1.5px solid var(--card-border)", background: "white",
                color: "var(--text-primary)", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={loading}
              style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "none",
                background: "var(--sidebar-bg)", color: "white", fontSize: "13px", fontWeight: "600",
                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
              {loading ? "Saving..." : circle ? "Save changes" : "Create circle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Manage accounts modal ─────────────────────────────────────
// Loads all accounts for the circle's region once on open.
// Pre-checks already-tagged accounts. Sends one bulk request on Save.

function ManageAccountsModal({ circle, onClose, onSaved }) {
  const [allAccounts, setAllAccounts] = useState([]);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [initialIds, setInitialIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        // Parallel fetch — all region accounts + already-tagged accounts + members for names
        const [allAccRes, circleAccRes, membersRes] = await Promise.all([
          memberAccountsApi.getAll(),
          circlesApi.getAccounts(circle.id),
          membersApi.getAll(),
        ]);

        const memberMap = Object.fromEntries(membersRes.data.map(m => [m.id, m.display_name]));

        const regionAccounts = allAccRes.data
          .filter(a => a.region_code === circle.region_code && a.is_active)
          .map(a => ({ ...a, member_name: memberMap[a.member_id] || "Unknown" }))
          .sort((a, b) =>
            a.member_name.localeCompare(b.member_name) ||
            a.account_type_code.localeCompare(b.account_type_code)
          );

        const tagged = new Set(circleAccRes.data.map(a => a.id));
        setAllAccounts(regionAccounts);
        setCheckedIds(new Set(tagged));
        setInitialIds(new Set(tagged));
      } catch {
        setError("Failed to load accounts");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [circle.id, circle.region_code]);

  const toggle = (id) =>
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleMember = (memberAccounts) => {
    const ids = memberAccounts.map(a => a.id);
    const allChecked = ids.every(id => checkedIds.has(id));
    setCheckedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => allChecked ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const handleSave = async () => {
    const add = [...checkedIds].filter(id => !initialIds.has(id));
    const remove = [...initialIds].filter(id => !checkedIds.has(id));
    if (!add.length && !remove.length) { onClose(); return; }
    try {
      setSaving(true); setError("");
      await circlesApi.bulkUpdateAccounts(circle.id, { add, remove });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to save changes");
      setSaving(false);
    }
  };

  const grouped = groupByMember(allAccounts);
  const addCount = [...checkedIds].filter(id => !initialIds.has(id)).length;
  const removeCount = [...initialIds].filter(id => !checkedIds.has(id)).length;
  const hasChanges = addCount > 0 || removeCount > 0;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)",
        borderRadius: "16px", width: "100%", maxWidth: "540px",
        maxHeight: "90vh", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--card-border)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "2px" }}>
              Manage accounts
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {circle.name} · {REGION_LABELS[circle.region_code] || circle.region_code}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none",
            fontSize: "22px", cursor: "pointer", color: "var(--text-secondary)", lineHeight: 1 }}>
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {error && (
            <div style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: "8px",
              padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#DC2626" }}>
              {error}
            </div>
          )}
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)", fontSize: "13px" }}>
              Loading accounts...
            </div>
          ) : allAccounts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)", fontSize: "13px" }}>
              No accounts found for this region. Add accounts under Manage → Accounts.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {Object.values(grouped).map(({ member_name, accounts }) => {
                const allChecked = accounts.every(a => checkedIds.has(a.id));
                const someChecked = accounts.some(a => checkedIds.has(a.id));
                return (
                  <div key={member_name} style={{ border: "1px solid var(--card-border)",
                    borderRadius: "10px", overflow: "hidden" }}>

                    {/* Member header — click to toggle all accounts for this member */}
                    <div onClick={() => toggleMember(accounts)}
                      style={{ display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 14px", background: "var(--content-bg)",
                        cursor: "pointer", userSelect: "none",
                        borderBottom: "1px solid var(--card-border)" }}>
                      <Checkbox checked={allChecked} indeterminate={!allChecked && someChecked} />
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
                        {member_name}
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "auto" }}>
                        {accounts.filter(a => checkedIds.has(a.id)).length}/{accounts.length} selected
                      </span>
                    </div>

                    {/* Account rows */}
                    {accounts.map((account, idx) => {
                      const checked = checkedIds.has(account.id);
                      const { style: tc, label: taxLabel } = taxBadge(account.tax_category);
                      return (
                        <div key={account.id} onClick={() => toggle(account.id)}
                          style={{ display: "flex", alignItems: "center", gap: "12px",
                            padding: "10px 14px", cursor: "pointer", userSelect: "none",
                            background: checked ? "var(--accent-light)" : "var(--card-bg)",
                            borderBottom: idx < accounts.length - 1 ? "1px solid var(--card-border)" : "none",
                            transition: "background 0.1s" }}>
                          <Checkbox checked={checked} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--text-primary)" }}>
                              {accountLabel(account)}
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "1px" }}>
                              {account.broker_code}
                            </div>
                          </div>
                          {account.tax_category && (
                            <span style={{ fontSize: "10px", fontWeight: "600",
                              padding: "2px 7px", borderRadius: "4px", ...tc }}>
                              {taxLabel}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid var(--card-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            {hasChanges ? (
              <>
                {addCount > 0 && <span style={{ color: "#14532D" }}>+{addCount} to add</span>}
                {addCount > 0 && removeCount > 0 && <span style={{ margin: "0 6px" }}>·</span>}
                {removeCount > 0 && <span style={{ color: "#991B1B" }}>−{removeCount} to remove</span>}
              </>
            ) : "No changes"}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={onClose}
              style={{ padding: "9px 18px", borderRadius: "8px",
                border: "1.5px solid var(--card-border)", background: "white",
                color: "var(--text-primary)", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || !hasChanges}
              style={{ padding: "9px 18px", borderRadius: "8px", border: "none",
                background: "var(--sidebar-bg)", color: "white", fontSize: "13px", fontWeight: "600",
                cursor: (saving || !hasChanges) ? "not-allowed" : "pointer",
                opacity: (saving || !hasChanges) ? 0.5 : 1 }}>
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reusable checkbox ─────────────────────────────────────────

function Checkbox({ checked, indeterminate = false }) {
  return (
    <div style={{
      width: "16px", height: "16px", borderRadius: "4px", flexShrink: 0,
      border: `2px solid ${checked || indeterminate ? "var(--accent)" : "var(--card-border)"}`,
      background: checked ? "var(--accent)" : "white",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {!checked && indeterminate && (
        <div style={{ width: "8px", height: "2px", background: "var(--accent)", borderRadius: "1px" }} />
      )}
    </div>
  );
}

// ── Circle card — pure display, accounts passed as props ──────

function CircleCard({ circle, onEdit, onDelete, onManaged, onResync }) {
  const [showManageModal, setShowManageModal] = useState(false);
  const grouped = groupByMember(circle.accounts || []);
  const isResyncing = circle.resync_status === "PROCESSING";
  const hasResyncError = circle.resync_status === "FAILED";

  return (
    <>
      <div style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)",
        borderRadius: "12px", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center",
          justifyContent: "space-between",
          borderBottom: circle.accounts?.length > 0 ? "1px solid var(--card-border)" : "none" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)" }}>
                {circle.name}
              </span>
              <span style={{ fontSize: "11px", color: "var(--text-secondary)",
                background: "var(--content-bg)", border: "1px solid var(--card-border)",
                borderRadius: "4px", padding: "1px 7px" }}>
                {REGION_LABELS[circle.region_code] || circle.region_code}
              </span>
              <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                {circle.accounts?.length || 0} account{circle.accounts?.length !== 1 ? "s" : ""}
              </span>
              <ResyncBadge status={circle.resync_status} />
            </div>
            {circle.description && (
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "3px" }}>
                {circle.description}
              </p>
            )}
            {hasResyncError && circle.resync_error && (
              <p style={{ fontSize: "11px", color: "#DC2626", marginTop: "4px" }}>
                {circle.resync_error}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            <button onClick={() => onResync(circle)} disabled={isResyncing}
              style={{ padding: "6px 12px", borderRadius: "7px",
                border: "1.5px solid #1D4ED8",
                background: isResyncing ? "#DBEAFE" : "transparent",
                color: "#1D4ED8", fontSize: "12px", fontWeight: "600",
                cursor: isResyncing ? "not-allowed" : "pointer",
                opacity: isResyncing ? 0.7 : 1 }}>
              {isResyncing ? "Re-syncing..." : "Re-sync holdings"}
            </button>
            <button onClick={() => setShowManageModal(true)}
              style={{ padding: "6px 14px", borderRadius: "7px",
                border: "1.5px solid var(--accent)", background: "transparent",
                color: "var(--accent)", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>
              Manage accounts
            </button>
            <button onClick={() => onEdit(circle)}
              style={{ padding: "6px 12px", borderRadius: "7px",
                border: "1.5px solid var(--card-border)", background: "white",
                color: "var(--text-primary)", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>
              Edit
            </button>
            <button onClick={() => onDelete(circle)}
              style={{ padding: "6px 12px", borderRadius: "7px",
                border: "1.5px solid #FECACA", background: "white",
                color: "#DC2626", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>
              Delete
            </button>
          </div>
        </div>

        {/* Tagged accounts grouped by member */}
        {circle.accounts?.length > 0 && (
          <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {Object.values(grouped).map(({ member_name, accounts }) => (
              <div key={member_name}>
                <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase",
                  letterSpacing: "0.05em", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  {member_name}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {accounts.map(a => {
                    const { style: tc, label: taxLabel } = taxBadge(a.tax_category);
                    return (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "6px",
                        padding: "5px 10px", borderRadius: "7px",
                        border: "1px solid var(--card-border)", background: "var(--content-bg)" }}>
                        <span style={{ fontSize: "12px", fontWeight: "500", color: "var(--text-primary)" }}>
                          {accountLabel(a)}
                        </span>
                        {a.tax_category && (
                          <span style={{ fontSize: "10px", fontWeight: "600",
                            padding: "1px 6px", borderRadius: "3px", ...tc }}>
                            {taxLabel}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {(!circle.accounts || circle.accounts.length === 0) && (
          <div style={{ padding: "14px 20px", fontSize: "13px", color: "var(--text-secondary)" }}>
            No accounts tagged yet — click <strong>Manage accounts</strong> to add some.
          </div>
        )}
      </div>

      {showManageModal && (
        <ManageAccountsModal
          circle={circle}
          onClose={() => setShowManageModal(false)}
          onSaved={onManaged}
        />
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────
// Single API call on load. All state lives here and flows down as props.

function Circles() {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingCircle, setEditingCircle] = useState(null);
  const { refreshCircles, refreshFilterOptions } = useFilters();

  const fetchCircles = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await circlesApi.getWithAccounts();
      setCircles(res.data);
    } catch {
      setError("Failed to load circles");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCircles(); }, [fetchCircles]);

  const handleDelete = async (circle) => {
    if (!confirm(`Delete "${circle.name}"?\n\nThis will remove all account associations.`)) return;
    try {
      await circlesApi.delete(circle.id);
      fetchCircles();
      refreshCircles();
    } catch {
      alert("Failed to delete circle");
    }
  };

  const handleSaved = () => {
    fetchCircles();       // re-fetch all circles+accounts in one call
    refreshCircles();     // update FilterContext circle list
    refreshFilterOptions(); // update member/account/broker pills
  };

  const handleResync = async (circle) => {
    try {
      await circlesApi.resync(circle.id);
      fetchCircles(true);
    } catch {
      alert("Failed to start re-sync");
    }
  };

  useEffect(() => {
    const hasProcessing = circles.some((circle) => circle.resync_status === "PROCESSING");
    if (!hasProcessing) return;
    const intervalId = setInterval(() => {
      fetchCircles(true);
    }, 3000);
    return () => clearInterval(intervalId);
  }, [circles, fetchCircles]);

  const handleModalSave = () => {
    setShowModal(false);
    setEditingCircle(null);
    fetchCircles();
    refreshCircles();
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "4px" }}>
            Circles
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Group accounts together for a consolidated portfolio view
          </p>
        </div>
        <button onClick={() => { setEditingCircle(null); setShowModal(true); }}
          style={{ padding: "9px 18px", borderRadius: "8px", border: "none",
            background: "var(--sidebar-bg)", color: "white",
            fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
          + Create circle
        </button>
      </div>

      {error && (
        <div style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: "8px",
          padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#DC2626" }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Loading...
        </div>
      )}

      {!loading && circles.length === 0 && !error && (
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)",
          borderRadius: "12px", padding: "48px", textAlign: "center" }}>
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>⭕</div>
          <h3 style={{ fontSize: "15px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "6px" }}>
            No circles yet
          </h3>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "20px" }}>
            A circle groups your accounts for a consolidated view.<br />
            Example: "Sharma Family" with everyone's TFSA and RRSP accounts.
          </p>
          <button onClick={() => setShowModal(true)}
            style={{ padding: "9px 20px", borderRadius: "8px", border: "none",
              background: "var(--sidebar-bg)", color: "white",
              fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
            + Create your first circle
          </button>
        </div>
      )}

      {!loading && circles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {circles.map(circle => (
            <CircleCard
              key={circle.id}
              circle={circle}
              onEdit={c => { setEditingCircle(c); setShowModal(true); }}
              onDelete={handleDelete}
              onManaged={handleSaved}
              onResync={handleResync}
            />
          ))}
        </div>
      )}

      {showModal && (
        <CircleModal
          circle={editingCircle}
          onSave={handleModalSave}
          onClose={() => { setShowModal(false); setEditingCircle(null); }}
        />
      )}
    </div>
  );
}

export default Circles;
