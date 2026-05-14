import { NavLink } from "react-router-dom";

const defaultHeaderLinks = [
  { to: "/", label: "Home" },
  { to: "/admin", label: "Admin" },
  { to: "/driver", label: "Driver" }
];

const defaultScopeNote = {
  eyebrow: "Current scope",
  title: "Admin + Driver only",
  description: "Two-panel setup for fleet operations and driver execution."
};

function AstraLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
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

export function PanelLayout({
  badge,
  title,
  description,
  highlights,
  menu,
  roleLabel,
  headerLinks = defaultHeaderLinks,
  headerContent,
  scopeNote = defaultScopeNote,
  children
}) {
  return (
    <div className="panel-shell">
      <aside className="panel-sidebar">
        <div className="brand-stack">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <AstraLogo />
            <span style={{ fontWeight: 800, fontSize: "1rem", letterSpacing: "-0.01em" }}>AstraFleet</span>
          </div>
          <h2>{roleLabel}</h2>
          <p>Role-specific workspace for focused fleet operations.</p>
        </div>

        <nav className="sidebar-nav">
          {menu.map((item) => (
            item.to ? (
              <NavLink end={item.end} key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ) : (
              <a key={item.href} href={item.href}>
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

      <main className="panel-main">
        <header className="panel-header" id="overview">
          <div>
            <span className="section-chip">{badge}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>

          {headerContent ? (
            <div className="header-actions">{headerContent}</div>
          ) : headerLinks.length > 0 ? (
            <div className="header-actions">
              {headerLinks.map((link) => (
                <NavLink className="header-link" key={link.to} to={link.to}>
                  {link.label}
                </NavLink>
              ))}
            </div>
          ) : null}
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
