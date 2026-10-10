import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import "./PanelLayout.css";

const defaultScopeNote = {
  eyebrow: "Current Scope",
  title: "Admin + Driver Only",
  description: "Two-panel setup for fleet operations and driver execution."
};

function AstraLogo() {
  return (
    <span className="astra-brand-mark" aria-hidden="true">
      <img src="/favicon.png" alt="" />
    </span>
  );
}

// 20px stroke icons for the sidebar; menu items reference them by key.
const NAV_ICONS = {
  overview: "M3.5 3.5h5.5v6H3.5zM11 3.5h5.5v3.5H11zM11 9h5.5v7.5H11zM3.5 11.5h5.5v5H3.5z",
  jobs: "M3.5 6.5h13v10h-13zM7.5 6.5v-2h5v2M3.5 11h13",
  dispatch: "M4 15.5h3l2-11h2l2 11h3M6.5 10h7",
  tracking: "M10 2.5a5 5 0 0 1 5 5c0 3.6-5 10-5 10s-5-6.4-5-10a5 5 0 0 1 5-5zM10 5.8a1.7 1.7 0 1 0 0 3.4a1.7 1.7 0 1 0 0-3.4",
  customers: "M3.5 16.5V5.5l6.5-3 6.5 3v11M7 16.5v-4h6v4M7 8h1M12 8h1",
  vehicles: "M2 6h9.5v7.5H2zM11.5 8.5h3.2l2.8 2.8v2.2h-6M5 16a1.5 1.5 0 1 0 0-.01M14.5 16a1.5 1.5 0 1 0 0-.01",
  drivers: "M10 3.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6M4.5 16.5c.8-3 2.9-4.5 5.5-4.5s4.7 1.5 5.5 4.5",
  maintenance: "M13.8 3.2a3.6 3.6 0 0 0-4.6 4.4L3.6 13.2a1.6 1.6 0 0 0 2.2 2.2l5.6-5.6a3.6 3.6 0 0 0 4.4-4.6l-2.3 2.3-1.7-.5-.5-1.7z",
  finance: "M3.5 16.5h13M5.5 13.5v-4M10 13.5v-8M14.5 13.5v-6",
  billing: "M5.5 2.5h7l3 3v12h-10zM12.5 2.5v3h3M8 9.5h5M8 12.5h5",
  employees: "M7 4a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M2.5 15.5c.6-2.6 2.3-4 4.5-4s3.9 1.4 4.5 4M13.5 5a2 2 0 1 1 0 4M14 11.5c1.7.2 3 1.5 3.5 4",
  activity: "M2.5 10.5h3l2-5 3.5 9 2-4h4.5",
  alerts: "M10 3l7.5 13h-15zM10 8v3.5M10 13.8v.2",
  notifications: "M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 2h-13zM8.3 17a1.8 1.8 0 0 0 3.4 0"
};

function NavIcon({ name }) {
  if (!NAV_ICONS[name]) return null;
  return (
    <svg className="nav-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d={NAV_ICONS[name]} />
    </svg>
  );
}

function initialsOf(name = "") {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("") || "A";
}

function HamburgerIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <rect width="18" height="2" rx="1" fill="currentColor" />
      <rect y="6" width="14" height="2" rx="1" fill="currentColor" />
      <rect y="12" width="18" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

export function PanelLayout({
  badge,
  title,
  description,
  highlights,
  menu,
  roleLabel,
  headerContent,
  hideHeaderIntro = false,
  scopeNote = defaultScopeNote,
  account = null,
  className = "",
  children
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    function handleKey(e) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  return (
    <div className={["panel-shell", className].filter(Boolean).join(" ")}>
      {/* Mobile top bar */}
      <div className="mobile-topbar">
        <div className="mobile-topbar-brand">
          <AstraLogo />
          <span>AstraFleet</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {headerContent}
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            type="button"
          >
            <HamburgerIcon />
          </button>
        </div>
      </div>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`panel-sidebar${sidebarOpen ? " open" : ""}`}
      >
        <div className="brand-stack">
          <div className="sidebar-brand">
            <AstraLogo />
            <span className="sidebar-brand-text">
              <span>AstraFleet</span>
              {roleLabel && <small>{roleLabel}</small>}
            </span>
          </div>
        </div>

        <nav className={`sidebar-nav${menu.some(item => item.icon) ? " with-icons" : ""}`}>
          {menu.map((item, index) => (
            item.to ? (
              <div className="sidebar-nav-item" key={item.to}>
                {item.group && item.group !== menu[index - 1]?.group && (
                  <span className="sidebar-group-label">{item.group}</span>
                )}
                <NavLink
                  end={item.end}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                >
                  <NavIcon name={item.icon} />
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              </div>
            ) : (
              <a
                key={item.href}
                href={item.href}
                onClick={(event) => {
                  item.onClick?.(event);
                  setSidebarOpen(false);
                }}
              >
                {item.label}
              </a>
            )
          ))}
        </nav>

        {scopeNote && (
          <div className="sidebar-note">
            <span className="card-label">{scopeNote.eyebrow}</span>
            <strong>{scopeNote.title}</strong>
            <p>{scopeNote.description}</p>
          </div>
        )}

        {account && (
          <div className="sidebar-account">
            <span className="sidebar-avatar" aria-hidden="true">{initialsOf(account.name)}</span>
            <span className="sidebar-account-text">
              <strong>{account.name || "Signed in"}</strong>
              <small>{account.role}</small>
            </span>
            {account.onLogout && (
              <button className="sidebar-logout" type="button" onClick={account.onLogout} aria-label="Log out" title="Log out">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 3.5H4.5v13H8M12.5 6.5 16 10l-3.5 3.5M16 10H7.5" /></svg>
              </button>
            )}
          </div>
        )}

        <footer className="sidebar-footer">
          <p>© AstraFleet 2026 · All rights reserved</p>
          <small>Designed &amp; developed by <strong>Devmora Technology</strong></small>
        </footer>
      </aside>

      {/* Main content */}
      <main className="panel-main">
        {(!hideHeaderIntro || badge || headerContent) && (
          <header
            className={[
              "panel-header",
              hideHeaderIntro ? "panel-header-compact" : "",
              hideHeaderIntro && !badge ? "panel-header-actions-only" : ""
            ].filter(Boolean).join(" ")}
            id="overview"
          >
            {(!hideHeaderIntro || badge) && (
              <div>
                {badge && <span className="section-chip">{badge}</span>}
                {!hideHeaderIntro && (
                  <>
                    <h1>{title}</h1>
                    {description && <p>{description}</p>}
                  </>
                )}
              </div>
            )}

            {headerContent && (
              <div className="header-actions">{headerContent}</div>
            )}
          </header>
        )}

        {highlights && highlights.length > 0 && (
          <section className="highlight-row">
            {highlights.map((item) => (
              <article className="highlight-card" key={item}>
                <span className="mini-dot" />
                <p>{item}</p>
              </article>
            ))}
          </section>
        )}

        {children}
      </main>
    </div>
  );
}
