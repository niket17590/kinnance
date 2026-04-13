import { useState, useEffect, useCallback } from "react";
import {
  memberAccountsApi,
  membersApi,
  referenceApi,
} from "../../services/api";
import { useFilters } from "../../context/FilterContext";

// ── Constants ─────────────────────────────────────────────────

const TAX_COLORS = {
  TAX_FREE: { bg: "#DCFCE7", color: "#14532D" },
  TAX_DEFERRED: { bg: "#DBEAFE", color: "#1D4ED8" },
  TAXABLE: { bg: "#FEF3C7", color: "#92400E" },
  CORP_TAXABLE: { bg: "#F3E8FF", color: "#6D28D9" },
};
const TAX_LABELS = {
  TAX_FREE: "Tax free",
  TAX_DEFERRED: "Tax deferred",
  TAXABLE: "Taxable",
  CORP_TAXABLE: "Corp taxable",
};

// Broker avatar colors — deterministic per broker code
const BROKER_COLORS = [
  { bg: "#DBEAFE", color: "#1D4ED8" },
  { bg: "#DCFCE7", color: "#14532D" },
  { bg: "#F3E8FF", color: "#6D28D9" },
  { bg: "#FEF3C7", color: "#92400E" },
  { bg: "#FFE4E6", color: "#BE123C" },
  { bg: "#CCFBF1", color: "#0F766E" },
];

const brokerColor = (brokerCode) => {
  let hash = 0;
  for (let i = 0; i < brokerCode.length; i++)
    hash = brokerCode.charCodeAt(i) + ((hash << 5) - hash);
  return BROKER_COLORS[Math.abs(hash) % BROKER_COLORS.length];
};

// ── Account modal ─────────────────────────────────────────────

function AccountModal({ account, onSave, onClose }) {
  const [members, setMembers] = useState([]);
  const [regions, setRegions] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [accountTypes, setAccountTypes] = useState([]);
  const [refLoading, setRefLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    member_id: account?.member_id || "",
    broker_code: account?.broker_code || "",
    account_type_code: account?.account_type_code || "",
    region_code: account?.region_code || "",
    nickname: account?.nickname || "",
    account_number: account?.account_number || "",
  });

  useEffect(() => {
    Promise.all([membersApi.getAll(), referenceApi.getRegions()])
      .then(([mRes, rRes]) => {
        setMembers(mRes.data);
        setRegions(rRes.data);
      })
      .catch(() => setError("Failed to load reference data"))
      .finally(() => setRefLoading(false));
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!form.region_code) {
        if (active) {
          setBrokers([]);
          setAccountTypes([]);
        }
        return;
      }
      try {
        const res = await referenceApi.getBrokers(form.region_code);
        if (active) {
          setBrokers(res.data);
          setForm((f) => ({
            ...f,
            broker_code: account?.broker_code || "",
            account_type_code: "",
          }));
          setAccountTypes([]);
        }
      } catch {
        if (active) setError("Failed to load brokers");
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [form.region_code, account?.broker_code]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!form.member_id || !form.region_code) {
        if (active) setAccountTypes([]);
        return;
      }
      const member = members.find((m) => m.id === form.member_id);
      if (!member) return;
      try {
        const res = await referenceApi.getAccountTypes(
          form.region_code,
          member.member_type,
        );
        if (active) {
          setAccountTypes(res.data);
          setForm((f) => ({
            ...f,
            account_type_code: account?.account_type_code || "",
          }));
        }
      } catch {
        if (active) setError("Failed to load account types");
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [form.member_id, form.region_code, members, account?.account_type_code]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (
      !form.region_code ||
      !form.member_id ||
      !form.broker_code ||
      !form.account_type_code
    ) {
      setError("Country, member, broker and account type are all required");
      return;
    }
    try {
      setLoading(true);
      setError("");
      account
        ? await memberAccountsApi.update(account.id, {
            nickname: form.nickname,
            account_number: form.account_number,
          })
        : await memberAccountsApi.create(form);
      onSave();
    } catch (err) {
      setError(err.response?.data?.detail || "Something went wrong");
      setLoading(false);
    }
  };

  const inp = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1.5px solid var(--card-border)",
    background: "white",
    fontSize: "13px",
    color: "var(--text-primary)",
    outline: "none",
    boxSizing: "border-box",
  };
  const lbl = {
    display: "block",
    fontSize: "12px",
    fontWeight: "600",
    color: "var(--text-primary)",
    marginBottom: "6px",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: "16px",
          padding: "28px",
          width: "100%",
          maxWidth: "480px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h2
          style={{
            fontSize: "16px",
            fontWeight: "700",
            color: "var(--text-primary)",
            marginBottom: "20px",
          }}
        >
          {account ? "Edit account" : "Add account"}
        </h2>
        {error && (
          <div
            style={{
              background: "#FEE2E2",
              border: "1px solid #FECACA",
              borderRadius: "8px",
              padding: "10px 14px",
              marginBottom: "16px",
              fontSize: "13px",
              color: "#DC2626",
            }}
          >
            {error}
          </div>
        )}
        {refLoading ? (
          <div
            style={{
              textAlign: "center",
              padding: "24px",
              color: "var(--text-secondary)",
              fontSize: "13px",
            }}
          >
            Loading...
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div>
              <label style={lbl}>Country</label>
              <select
                value={form.region_code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, region_code: e.target.value }))
                }
                disabled={!!account}
                style={inp}
              >
                <option value="">Select country</option>
                {regions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Member</label>
              <select
                value={form.member_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, member_id: e.target.value }))
                }
                disabled={!!account}
                style={inp}
              >
                <option value="">Select member</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Broker</label>
              <select
                value={form.broker_code}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    broker_code: e.target.value,
                    account_type_code: "",
                  }))
                }
                disabled={!!account || !form.region_code}
                style={inp}
              >
                <option value="">Select broker</option>
                {brokers.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Account type</label>
              <select
                value={form.account_type_code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, account_type_code: e.target.value }))
                }
                disabled={!!account || !form.member_id || !form.region_code}
                style={inp}
              >
                <option value="">Select account type</option>
                {accountTypes.map((at) => (
                  <option key={at.code} value={at.code}>
                    {at.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>
                Nickname{" "}
                <span
                  style={{ fontWeight: 400, color: "var(--text-secondary)" }}
                >
                  (optional)
                </span>
              </label>
              <input
                value={form.nickname}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nickname: e.target.value }))
                }
                placeholder="e.g. My Main TFSA"
                style={inp}
              />
            </div>
            <div>
              <label style={lbl}>
                Account number{" "}
                <span
                  style={{ fontWeight: 400, color: "var(--text-secondary)" }}
                >
                  (optional)
                </span>
              </label>
              <input
                value={form.account_number}
                onChange={(e) =>
                  setForm((f) => ({ ...f, account_number: e.target.value }))
                }
                placeholder="e.g. 12345678"
                style={inp}
              />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1.5px solid var(--card-border)",
                  background: "white",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--sidebar-bg)",
                  color: "white",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading
                  ? "Saving..."
                  : account
                    ? "Save changes"
                    : "Add account"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Account row — hover reveals actions ───────────────────────

function AccountRow({ account, onEdit, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const tc = TAX_COLORS[account.tax_category] || {
    bg: "#F3F4F6",
    color: "#374151",
  };
  const taxLabel = TAX_LABELS[account.tax_category] || account.tax_category;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        borderRadius: "8px",
        background: hovered ? "var(--content-bg)" : "transparent",
        transition: "background 0.12s",
        gap: "8px",
      }}
    >
      {/* Account info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: "600",
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {account.nickname ||
            account.account_type_name ||
            account.account_type_code}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            marginTop: "3px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "10px",
              fontWeight: "600",
              padding: "1px 6px",
              borderRadius: "4px",
              ...tc,
            }}
          >
            {taxLabel}
          </span>
          {account.account_number && (
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
              ···{account.account_number.slice(-4)}
            </span>
          )}
        </div>
      </div>

      {/* Actions — visible on hover */}
      <div
        style={{
          display: "flex",
          gap: "5px",
          flexShrink: 0,
          opacity: hovered ? 1 : 0,
          transition: "opacity 0.12s",
        }}
      >
        <button
          onClick={() => onEdit(account)}
          style={{
            padding: "4px 10px",
            borderRadius: "6px",
            border: "1.5px solid var(--card-border)",
            background: "white",
            color: "var(--text-primary)",
            fontSize: "11px",
            fontWeight: "600",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(account)}
          style={{
            padding: "4px 10px",
            borderRadius: "6px",
            border: "1.5px solid #FECACA",
            background: "white",
            color: "#DC2626",
            fontSize: "11px",
            fontWeight: "600",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ── Broker card ───────────────────────────────────────────────

function BrokerCard({ brokerCode, brokerName, accounts, onEdit, onDelete }) {
  const bc = brokerColor(brokerCode);
  const initial = (brokerName || brokerCode).charAt(0).toUpperCase();

  return (
    <div
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: "12px",
        overflow: "hidden",
        minWidth: "200px",
        flex: "1 1 200px",
        maxWidth: "340px",
      }}
    >
      {/* Broker header */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--card-border)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: "var(--content-bg)",
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "8px",
            flexShrink: 0,
            background: bc.bg,
            color: bc.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            fontWeight: "700",
          }}
        >
          {initial}
        </div>
        <div>
          <div
            style={{
              fontSize: "13px",
              fontWeight: "700",
              color: "var(--text-primary)",
            }}
          >
            {brokerName || brokerCode}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
            {accounts.length} account{accounts.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Account rows */}
      <div style={{ padding: "6px 2px" }}>
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

// ── Member section ────────────────────────────────────────────

function MemberSection({ memberName, memberType, accounts, onEdit, onDelete }) {
  // Group this member's accounts by broker
  const byBroker = accounts.reduce((acc, a) => {
    const key = a.broker_code;
    if (!acc[key])
      acc[key] = {
        brokerCode: key,
        brokerName: a.broker_name || key,
        accounts: [],
      };
    acc[key].accounts.push(a);
    return acc;
  }, {});

  return (
    <div style={{ marginBottom: "28px" }}>
      {/* Member header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "12px",
        }}
      >
        {/* Member avatar */}
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            flexShrink: 0,
            background: "var(--sidebar-bg)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "13px",
            fontWeight: "700",
          }}
        >
          {memberName.charAt(0).toUpperCase()}
        </div>
        <div>
          <span
            style={{
              fontSize: "15px",
              fontWeight: "700",
              color: "var(--text-primary)",
            }}
          >
            {memberName}
          </span>
          {memberType === "CORPORATION" && (
            <span
              style={{
                marginLeft: "8px",
                fontSize: "11px",
                fontWeight: "600",
                padding: "1px 7px",
                borderRadius: "4px",
                background: "#F3E8FF",
                color: "#6D28D9",
              }}
            >
              Corp
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            marginLeft: "4px",
          }}
        >
          {accounts.length} account{accounts.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Broker cards — wrap naturally on smaller screens */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
        {Object.values(byBroker).map(
          ({ brokerCode, brokerName, accounts: brokerAccounts }) => (
            <BrokerCard
              key={brokerCode}
              brokerCode={brokerCode}
              brokerName={brokerName}
              accounts={brokerAccounts}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ),
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const { refreshCircles, refreshFilterOptions } = useFilters();

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await memberAccountsApi.getAll();
      setAccounts(res.data);
    } catch {
      setError("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleDelete = async (account) => {
    const label =
      account.nickname ||
      `${account.account_type_code} @ ${account.broker_code}`;
    if (!confirm(`Remove "${label}"?`)) return;
    try {
      await memberAccountsApi.delete(account.id);
      fetchAccounts();
      refreshCircles();
      refreshFilterOptions();
    } catch {
      alert("Failed to delete account");
    }
  };

  const handleSave = () => {
    setShowModal(false);
    setEditingAccount(null);
    fetchAccounts();
    refreshCircles();
    refreshFilterOptions();
  };

  // Group accounts by member
  const grouped = accounts.reduce((acc, a) => {
    if (!acc[a.member_id]) {
      acc[a.member_id] = {
        member_name: a.member_name || "Unknown",
        member_type: a.member_type,
        accounts: [],
      };
    }
    acc[a.member_id].accounts.push(a);
    return acc;
  }, {});

  return (
    <div>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "28px",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: "700",
              color: "var(--text-primary)",
              marginBottom: "4px",
            }}
          >
            Accounts
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Manage brokerage accounts for your members
          </p>
        </div>
        <button
          onClick={() => {
            setEditingAccount(null);
            setShowModal(true);
          }}
          style={{
            padding: "9px 18px",
            borderRadius: "8px",
            border: "none",
            background: "var(--sidebar-bg)",
            color: "white",
            fontSize: "13px",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          + Add account
        </button>
      </div>

      {error && (
        <div
          style={{
            background: "#FEE2E2",
            border: "1px solid #FECACA",
            borderRadius: "8px",
            padding: "10px 14px",
            marginBottom: "16px",
            fontSize: "13px",
            color: "#DC2626",
          }}
        >
          {error}
        </div>
      )}

      {loading && (
        <div
          style={{
            textAlign: "center",
            padding: "40px",
            color: "var(--text-secondary)",
          }}
        >
          Loading...
        </div>
      )}

      {!loading && accounts.length === 0 && !error && (
        <div
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: "12px",
            padding: "48px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>🏦</div>
          <h3
            style={{
              fontSize: "15px",
              fontWeight: "600",
              color: "var(--text-primary)",
              marginBottom: "6px",
            }}
          >
            No accounts yet
          </h3>
          <p
            style={{
              fontSize: "13px",
              color: "var(--text-secondary)",
              marginBottom: "20px",
            }}
          >
            Add brokerage accounts for your members
          </p>
          <button
            onClick={() => {
              setEditingAccount(null);
              setShowModal(true);
            }}
            style={{
              padding: "9px 18px",
              borderRadius: "8px",
              border: "none",
              background: "var(--sidebar-bg)",
              color: "white",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            + Add your first account
          </button>
        </div>
      )}

      {/* Member sections */}
      {!loading && accounts.length > 0 && (
        <div>
          {Object.values(grouped).map(
            ({ member_name, member_type, accounts: memberAccounts }) => (
              <MemberSection
                key={member_name}
                memberName={member_name}
                memberType={member_type}
                accounts={memberAccounts}
                onEdit={(a) => {
                  setEditingAccount(a);
                  setShowModal(true);
                }}
                onDelete={handleDelete}
              />
            ),
          )}
        </div>
      )}

      {showModal && (
        <AccountModal
          account={editingAccount}
          onSave={handleSave}
          onClose={() => {
            setShowModal(false);
            setEditingAccount(null);
          }}
        />
      )}
    </div>
  );
}

export default Accounts;
