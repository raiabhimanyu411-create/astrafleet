import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

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
            <span>AstraFleet</span>
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

        <footer className="sidebar-footer">
          <p>© AstraFleet 2026</p>
          <span>All rights reserved</span>
          <small>
            Designed &amp; Developed by
            <strong>Devmora Technology</strong>
          </small>
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
