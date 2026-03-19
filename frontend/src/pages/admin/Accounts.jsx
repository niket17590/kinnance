import { useState, useEffect } from "react";
import {
  memberAccountsApi,
  membersApi,
  referenceApi,
} from "../../services/api";

function AccountModal({ account, members, regions, onSave, onClose }) {
  const [brokers, setBrokers] = useState([]);
  const [accountTypes, setAccountTypes] = useState([]);
  const [form, setForm] = useState({
    member_id: account?.member_id || "",
    broker_code: account?.broker_code || "",
    account_type_code: account?.account_type_code || "",
    region_code: account?.region_code || "",
    nickname: account?.nickname || "",
    account_number: account?.account_number || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // When region changes — fetch brokers
  useEffect(() => {
    let active = true;
    const fetchBrokers = async () => {
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
          setForm((f) => ({ ...f, broker_code: "", account_type_code: "" }));
          setAccountTypes([]);
        }
      } catch {
        if (active) setError("Failed to load brokers");
      }
    };
    fetchBrokers();
    return () => {
      active = false;
    };
  }, [form.region_code]);

  // When member or region changes — fetch account types
  useEffect(() => {
    let active = true;
    const fetchAccountTypes = async () => {
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
          setForm((f) => ({ ...f, account_type_code: "" }));
        }
      } catch {
        if (active) setError("Failed to load account types");
      }
    };
    fetchAccountTypes();
    return () => {
      active = false;
    };
  }, [form.member_id, form.region_code, members]);

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
      if (account) {
        await memberAccountsApi.update(account.id, {
          nickname: form.nickname,
          account_number: form.account_number,
        });
      } else {
        await memberAccountsApi.create({ ...form });
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.detail || "Something went wrong");
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1.5px solid var(--card-border)",
    background: "white",
    fontSize: "13px",
    color: "var(--text-primary)",
    outline: "none",
  };

  const labelStyle = {
    display: "block",
    fontSize: "12px",
    fontWeight: "600",
    color: "var(--text-primary)",
    marginBottom: "6px",
  };

  const disabledStyle = {
    ...inputStyle,
    background: "#f5f5f5",
    cursor: "not-allowed",
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

        <form onSubmit={handleSubmit}>
          {/* Step 1 — Country */}
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>Country</label>
            <select
              value={form.region_code}
              onChange={(e) =>
                setForm({ ...form, region_code: e.target.value })
              }
              disabled={!!account}
              style={account ? disabledStyle : inputStyle}
            >
              <option value="">Select a country</option>
              {regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2 — Member */}
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>Member</label>
            <select
              value={form.member_id}
              onChange={(e) => setForm({ ...form, member_id: e.target.value })}
              disabled={!!account || !form.region_code}
              style={account || !form.region_code ? disabledStyle : inputStyle}
            >
              <option value="">
                {!form.region_code
                  ? "Select a country first"
                  : "Select a member"}
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name} (
                  {m.member_type === "CORPORATION" ? "Corporation" : "Person"})
                </option>
              ))}
            </select>
          </div>

          {/* Step 3 — Broker */}
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>Broker</label>
            <select
              value={form.broker_code}
              onChange={(e) =>
                setForm({ ...form, broker_code: e.target.value })
              }
              disabled={!!account || !form.region_code}
              style={account || !form.region_code ? disabledStyle : inputStyle}
            >
              <option value="">
                {!form.region_code
                  ? "Select a country first"
                  : "Select a broker"}
              </option>
              {brokers.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Step 4 — Account Type */}
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>Account type</label>
            <select
              value={form.account_type_code}
              onChange={(e) =>
                setForm({ ...form, account_type_code: e.target.value })
              }
              disabled={!!account || !form.member_id || !form.region_code}
              style={
                account || !form.member_id || !form.region_code
                  ? disabledStyle
                  : inputStyle
              }
            >
              <option value="">
                {!form.region_code
                  ? "Select a country first"
                  : !form.member_id
                    ? "Select a member first"
                    : "Select account type"}
              </option>
              {accountTypes.map((at) => (
                <option key={at.code} value={at.code}>
                  {at.name}
                </option>
              ))}
            </select>
          </div>

          {/* Nickname */}
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>
              Nickname{" "}
              <span
                style={{ color: "var(--text-secondary)", fontWeight: "400" }}
              >
                (optional)
              </span>
            </label>
            <input
              type="text"
              value={form.nickname}
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
              placeholder="e.g. My Main TFSA"
              style={inputStyle}
            />
          </div>

          {/* Account Number */}
          <div style={{ marginBottom: "24px" }}>
            <label style={labelStyle}>
              Account number{" "}
              <span
                style={{ color: "var(--text-secondary)", fontWeight: "400" }}
              >
                (optional)
              </span>
            </label>
            <input
              type="text"
              value={form.account_number}
              onChange={(e) =>
                setForm({ ...form, account_number: e.target.value })
              }
              placeholder="e.g. 12345678"
              style={inputStyle}
            />
          </div>

          {/* Buttons */}
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
              {loading ? "Saving..." : account ? "Save changes" : "Add account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [members, setMembers] = useState([]);
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [refDataLoaded, setRefDataLoaded] = useState(false);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await memberAccountsApi.getAll();
      setAccounts(res.data);
    } catch {
      setError("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleOpenModal = async (account = null) => {
    setEditingAccount(account);
    setShowModal(true);
    if (!refDataLoaded) {
      try {
        const [membersRes, regionsRes] = await Promise.all([
          membersApi.getAll(),
          referenceApi.getRegions(),
        ]);
        setMembers(membersRes.data);
        setRegions(regionsRes.data);
        setRefDataLoaded(true);
      } catch {
        setError("Failed to load reference data");
      }
    }
  };

  const handleDelete = async (account) => {
    const label =
      account.nickname ||
      `${account.account_type_code} @ ${account.broker_code}`;
    if (!confirm(`Remove ${label}?`)) return;
    try {
      await memberAccountsApi.delete(account.id);
      fetchAccounts();
    } catch {
      alert("Failed to delete account");
    }
  };

  const handleSave = () => {
    setShowModal(false);
    setEditingAccount(null);
    fetchAccounts();
  };

  const taxCategoryColor = (tax) => {
    const map = {
      TAX_FREE: { bg: "#DCFCE7", color: "#14532D" },
      TAX_DEFERRED: { bg: "#DBEAFE", color: "#1D4ED8" },
      TAXABLE: { bg: "#FEF3C7", color: "#92400E" },
      CORP_TAXABLE: { bg: "#F3E8FF", color: "#6D28D9" },
    };
    return map[tax] || { bg: "#F3F4F6", color: "#374151" };
  };

  const taxCategoryLabel = (tax) => {
    const map = {
      TAX_FREE: "Tax free",
      TAX_DEFERRED: "Tax deferred",
      TAXABLE: "Taxable",
      CORP_TAXABLE: "Corp taxable",
    };
    return map[tax] || tax;
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "24px",
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
          onClick={() => handleOpenModal(null)}
          style={{
            padding: "9px 18px",
            borderRadius: "8px",
            border: "none",
            background: "var(--sidebar-bg)",
            color: "white",
            fontSize: "13px",
            fontWeight: "600",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
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

      {!loading && accounts.length === 0 && (
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
            onClick={() => handleOpenModal(null)}
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

      {!loading && accounts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {accounts.map((account) => {
            const taxColor = taxCategoryColor(account.tax_category);
            return (
              <div
                key={account.id}
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "12px",
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "14px" }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "10px",
                      background: "var(--accent-light)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "18px",
                      flexShrink: 0,
                    }}
                  >
                    🏦
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: "600",
                        color: "var(--text-primary)",
                        marginBottom: "4px",
                      }}
                    >
                      {account.nickname || account.account_type_code}
                      {account.account_number && (
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: "400",
                            color: "var(--text-secondary)",
                            marginLeft: "8px",
                          }}
                        >
                          #{account.account_number}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: "600",
                          padding: "2px 7px",
                          borderRadius: "6px",
                          background: "var(--accent-light)",
                          color: "var(--accent-dark)",
                        }}
                      >
                        {account.account_type_code}
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          color: "var(--text-secondary)",
                        }}
                      >
                        @ {account.broker_code}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: "600",
                          padding: "2px 7px",
                          borderRadius: "6px",
                          background: taxColor.bg,
                          color: taxColor.color,
                        }}
                      >
                        {taxCategoryLabel(account.tax_category)}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => handleOpenModal(account)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "7px",
                      border: "1.5px solid var(--card-border)",
                      background: "white",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(account)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "7px",
                      border: "1.5px solid #FECACA",
                      background: "white",
                      color: "#DC2626",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <AccountModal
          account={editingAccount}
          members={members}
          regions={regions}
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
