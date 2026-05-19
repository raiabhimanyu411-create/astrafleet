import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

const defaultScopeNote = {
  eyebrow: "Current scope",
  title: "Admin + Driver only",
  description: "Two-panel setup for fleet operations and driver execution."
};

function AstraLogo() {
  return (
    <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="13" fill="#2563eb" />
      <path
        d="M24 11L37 33H11L24 11Z"
        stroke="white"
        strokeWidth="2.4"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M17 27H31" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
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
  scopeNote = defaultScopeNote,
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
    <div className="panel-shell">
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <AstraLogo />
            <span style={{ fontWeight: 800, fontSize: "1rem", letterSpacing: "-0.015em" }}>AstraFleet</span>
          </div>
          <h2>{roleLabel}</h2>
          <p>Role-specific workspace for focused fleet operations.</p>
        </div>

        <nav className="sidebar-nav">
          {menu.map((item) => (
            item.to ? (
              <NavLink
                end={item.end}
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
              >
                {item.label}
              </NavLink>
            ) : (
              <a key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}>
                {item.label}
              </a>
            )
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="card-label">{scopeNote.eyebrow}</span>
          <strong>{scopeNote.title}</strong>
          <p>{scopeNote.description}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="panel-main">
        <header className="panel-header" id="overview">
          <div>
            <span className="section-chip">{badge}</span>
            <h1>{title}</h1>
            {description && <p>{description}</p>}
          </div>

          {headerContent && (
            <div className="header-actions">{headerContent}</div>
          )}
        </header>

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
