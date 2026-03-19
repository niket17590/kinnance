import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const navItems = [
  {
    group: "",
    items: [
      {
        path: "/dashboard",
        label: "Dashboard",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <rect
              x="1"
              y="1"
              width="7"
              height="7"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <rect
              x="10"
              y="1"
              width="7"
              height="7"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <rect
              x="1"
              y="10"
              width="7"
              height="7"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <rect
              x="10"
              y="10"
              width="7"
              height="7"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
        ),
      },
      {
        path: "/holdings",
        label: "Holdings",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <path
              d="M2 14L6 9l4 4 6-8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        path: "/transactions",
        label: "Transactions",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <path
              d="M2 6h14M2 9.5h9M2 13h6"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        ),
      },
      {
        path: "/performance",
        label: "Performance",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <circle
              cx="9"
              cy="9"
              r="6.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M9 6v3.5l2.5 1.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        ),
      },
    ],
  },
  {
    group: "Tax & Reports",
    items: [
      {
        path: "/capital-gains",
        label: "Capital gains",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <rect
              x="3"
              y="2"
              width="12"
              height="14"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M6 7h6M6 10h4M6 13h2"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        ),
      },
      {
        path: "/dividends",
        label: "Dividends",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <circle
              cx="9"
              cy="9"
              r="6.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M9 6v6M6.5 8.5L9 6l2.5 2.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        path: "/contribution-limits",
        label: "Contribution limits",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <rect
              x="2"
              y="2"
              width="14"
              height="14"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M9 6v6M6 9h6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        ),
      },
    ],
  },
  {
    group: "Admin",
    items: [
      {
        path: "/admin/members",
        label: "Members",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <circle
              cx="9"
              cy="6"
              r="3"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M3 16c0-3.3 2.7-5 6-5s6 1.7 6 5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        ),
      },
      {
        path: "/admin/accounts",
        label: "Accounts",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <rect
              x="2"
              y="4.5"
              width="14"
              height="10"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M6 4.5V3.5a1 1 0 011-1h4a1 1 0 011 1v1M2 9h14"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        ),
      },
      {
        path: "/admin/circles",
        label: "Circles",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <circle
              cx="9"
              cy="9"
              r="6.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <circle
              cx="9"
              cy="9"
              r="3"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        ),
      },
      {
        path: "/admin/import",
        label: "Upload Transactions",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <path
              d="M9 3v10M3 10l6 6 6-6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        path: "/admin/settings",
        label: "Settings",
        icon: (
          <svg viewBox="0 0 18 18" fill="none" width="18" height="18">
            <circle
              cx="9"
              cy="9"
              r="2.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M9 1v2M9 15v2M1 9h2M15 9h2M3.22 3.22l1.42 1.42M13.36 13.36l1.42 1.42M3.22 14.78l1.42-1.42M13.36 4.64l1.42-1.42"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        ),
      },
    ],
  },
];

function Sidebar({ isOpen, onClose }) {
  const [expanded, setExpanded] = useState(false);
  const { user, signOut } = useAuth();

  const sidebarWidth = expanded ? "200px" : "58px";

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        background: "var(--sidebar-bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: expanded ? "flex-start" : "center",
        padding: "14px 0",
        position: "sticky",
        top: 0,
        height: "100vh",
        overflowY: "auto",
        overflowX: "hidden",
        zIndex: 50,
        transition: "width 0.2s ease, min-width 0.2s ease",
        flexShrink: 0,
      }}
      className={`kinnance-sidebar ${isOpen ? "sidebar-mobile-open" : ""}`}
    >
      {/* Logo */}
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "10px",
          background: "var(--sidebar-logo)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "12px",
          marginLeft: expanded ? "11px" : "auto",
          marginRight: expanded ? "0" : "auto",
          flexShrink: 0,
          transition: "margin 0.2s ease",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="1" y="1" width="7" height="7" rx="1.5" fill="white" />
          <rect
            x="10"
            y="1"
            width="7"
            height="7"
            rx="1.5"
            fill="white"
            opacity="0.55"
          />
          <rect
            x="1"
            y="10"
            width="7"
            height="7"
            rx="1.5"
            fill="white"
            opacity="0.45"
          />
          <rect
            x="10"
            y="10"
            width="7"
            height="7"
            rx="1.5"
            fill="white"
            opacity="0.25"
          />
        </svg>
      </div>

      {/* Brand name — only when expanded */}
      {expanded && (
        <div
          style={{
            fontSize: "14px",
            fontWeight: "700",
            color: "#FFFFFF",
            paddingLeft: "11px",
            marginBottom: "8px",
            opacity: 1,
            transition: "opacity 0.15s ease",
          }}
        >
          Kinnance
        </div>
      )}

      {/* Nav groups */}
      {navItems.map((group, gi) => (
        <div
          key={gi}
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: expanded ? "flex-start" : "center",
          }}
        >
          {/* Divider between groups */}
          {gi > 0 && (
            <div
              style={{
                width: expanded ? "calc(100% - 22px)" : "26px",
                height: "1px",
                background: "var(--sidebar-divider)",
                margin: "6px auto",
              }}
            />
          )}

          {/* Group label — only when expanded and label exists */}
          {expanded && group.group && (
            <div
              style={{
                fontSize: "10px",
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "rgba(255,255,255,0.3)",
                padding: "4px 11px 2px",
              }}
            >
              {group.group}
            </div>
          )}

          {/* Nav items */}
          {group.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
              title={!expanded ? item.label : undefined}
              style={({ isActive }) => ({
                width: expanded ? "calc(100% - 16px)" : "38px",
                height: "36px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                paddingLeft: expanded ? "10px" : "0",
                justifyContent: expanded ? "flex-start" : "center",
                color: isActive
                  ? "var(--sidebar-icon-active)"
                  : "var(--sidebar-icon)",
                background: isActive
                  ? "var(--sidebar-icon-active-bg)"
                  : "transparent",
                textDecoration: "none",
                transition: "all 0.12s",
                marginBottom: "2px",
                marginLeft: expanded ? "8px" : "auto",
                marginRight: expanded ? "8px" : "auto",
                flexShrink: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
              })}
            >
              <span style={{ flexShrink: 0 }}>{item.icon}</span>
              {expanded && (
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: "500",
                    opacity: 1,
                    transition: "opacity 0.15s ease",
                  }}
                >
                  {item.label}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      ))}

      {/* Profile + sign out */}
      <div
        style={{
          marginTop: "auto",
          width: "100%",
          borderTop: "1px solid var(--sidebar-divider)",
          padding: "8px 0",
        }}
      >
        <div
          onClick={signOut}
          title="Sign out"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: expanded ? "6px 10px" : "6px 0",
            margin: expanded ? "0 8px" : "0 auto",
            width: expanded ? "calc(100% - 16px)" : "38px",
            borderRadius: "8px",
            cursor: "pointer",
            transition: "all 0.12s",
          }}
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: "var(--sidebar-logo)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "11px",
              fontWeight: "700",
              color: "white",
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            {user?.user_metadata?.avatar_url ? (
              <img
                src={user.user_metadata.avatar_url}
                alt="avatar"
                referrerPolicy="no-referrer"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              user?.email?.[0]?.toUpperCase()
            )}
          </div>

          {expanded && (
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: "600",
                  color: "#FFFFFF",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {user?.user_metadata?.full_name || user?.email}
              </div>
              <div
                style={{
                  fontSize: "10px",
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                Sign out
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .kinnance-sidebar {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            height: 100vh !important;
            width: 200px !important;
            min-width: 200px !important;
            transform: translateX(-100%);
            transition: transform 0.25s ease !important;
          }
          .kinnance-sidebar.sidebar-mobile-open {
            transform: translateX(0) !important;
          }
        }
      `}</style>
    </aside>
  );
}

export default Sidebar;
