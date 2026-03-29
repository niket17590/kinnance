import { useState } from "react";
import { useFilters } from "../../context/FilterContext";

function FilterPill({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 11px",
        borderRadius: "20px",
        border: `1.5px solid ${active ? "var(--pill-active-border)" : "var(--pill-border)"}`,
        background: active ? "var(--pill-active-bg)" : "var(--pill-bg)",
        color: active ? "var(--pill-active-text)" : "var(--pill-text)",
        fontSize: "12px",
        fontWeight: "500",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "all 0.12s",
      }}
    >
      {label}
    </button>
  );
}

function FilterBar() {
  const {
    circles,
    circlesLoading,
    selectedCircle,
    handleCircleChange,
    memberOptions,
    accountTypeOptions,
    brokerOptions,
    selectedMembers,
    selectedAccountTypes,
    selectedBrokers,
    toggleMember,
    toggleAccountType,
    toggleBroker,
    resetSelections,
  } = useFilters();

  const [expanded, setExpanded] = useState(false);

  const filterRowStyle = {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    padding: "7px 16px",
    flexWrap: "wrap",
  };

  const labelStyle = {
    fontSize: "10px",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-secondary)",
    minWidth: "52px",
    flexShrink: 0,
  };

  const sepStyle = {
    width: "1px",
    height: "14px",
    background: "var(--card-border)",
    margin: "0 3px",
    flexShrink: 0,
  };

  // Summary for mobile collapsed view
  const filterSummary = [
    selectedCircle?.name || "No circle",
    selectedMembers.length > 0
      ? `${selectedMembers.length} members`
      : "All members",
    selectedAccountTypes.length > 0
      ? selectedAccountTypes.join(", ")
      : "All accounts",
    selectedBrokers.length > 0 ? selectedBrokers.join(", ") : "All brokers",
  ].join(" · ");

  return (
    <div>
      {/* Mobile collapsed toggle */}
      <div className="mobile-filter-toggle" style={{ display: "none" }}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: "100%",
            padding: "8px 16px",
            background: "none",
            border: "none",
            borderBottom: "1px solid var(--filter-row-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            color: "var(--text-primary)",
            fontSize: "12px",
            fontWeight: "600",
          }}
        >
          <span>{filterSummary}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            style={{
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }}
          >
            <path
              d="M2 4l5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Filter rows */}
      <div className={`filter-rows ${expanded ? "filter-rows-open" : ""}`}>
        {/* Row 0 — Circle (master filter) */}
        <div
          style={{
            ...filterRowStyle,
            borderBottom: "1px solid var(--filter-row-border)",
          }}
        >
          <span style={labelStyle}>Circle</span>

          {circlesLoading ? (
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Loading...
            </span>
          ) : circles.length === 0 ? (
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              No circles yet — create one in Admin → Circles
            </span>
          ) : (
            <select
              value={selectedCircle?.id || ""}
              onChange={(e) => {
                const circle = circles.find((c) => c.id === e.target.value);
                handleCircleChange(circle || null);
              }}
              style={{
                padding: "3px 8px",
                borderRadius: "20px",
                border: "1.5px solid var(--pill-active-border)",
                background: "var(--pill-active-bg)",
                color: "var(--pill-active-text)",
                fontSize: "12px",
                fontWeight: "600",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="">Select a circle</option>
              {circles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Only show other filters when a circle is selected */}
        {selectedCircle && (
          <>
            {/* All filters inline — wrap naturally on small screens */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "5px",
                padding: "7px 16px",
                rowGap: "8px",
              }}
            >
              {/* Member */}
              {memberOptions.length > 0 && (
                <>
                  <span style={labelStyle}>Member</span>
                  <FilterPill
                    label="All"
                    active={selectedMembers.length === 0}
                    onClick={() => setSelectedMembers([])}
                  />
                  {memberOptions.map((m) => (
                    <FilterPill
                      key={m.id}
                      label={m.name}
                      active={selectedMembers.includes(m.id)}
                      onClick={() => toggleMember(m.id)}
                    />
                  ))}
                  <div style={sepStyle} />
                </>
              )}

              {/* Account Type */}
              {accountTypeOptions.length > 0 && (
                <>
                  <span style={labelStyle}>Account</span>
                  <FilterPill
                    label="All"
                    active={selectedAccountTypes.length === 0}
                    onClick={() => setSelectedAccountTypes([])}
                  />
                  {accountTypeOptions.map((at) => (
                    <FilterPill
                      key={at.code}
                      label={at.code}
                      active={selectedAccountTypes.includes(at.code)}
                      onClick={() => toggleAccountType(at.code)}
                    />
                  ))}
                  <div style={sepStyle} />
                </>
              )}

              {/* Broker */}
              {brokerOptions.length > 0 && (
                <>
                  <span style={labelStyle}>Broker</span>
                  <FilterPill
                    label="All"
                    active={selectedBrokers.length === 0}
                    onClick={() => setSelectedBrokers([])}
                  />
                  {brokerOptions.map((b) => (
                    <FilterPill
                      key={b.code}
                      label={b.name}
                      active={selectedBrokers.includes(b.code)}
                      onClick={() => toggleBroker(b.code)}
                    />
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        @media (max-width: 768px) {
          .mobile-filter-toggle { display: block !important; }
          .filter-rows { display: none; }
          .filter-rows-open { display: block !important; }
        }
      `}</style>
    </div>
  );
}

export default FilterBar;
