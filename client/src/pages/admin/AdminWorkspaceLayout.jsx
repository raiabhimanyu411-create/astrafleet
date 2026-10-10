import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getMySession, logout } from "../../api/authApi";
import { NotificationBell } from "../../components/NotificationBell";
import { PanelLayout } from "../../components/PanelLayout";
import { clearAuthSession, getAuthSession, saveAuthSession } from "../../utils/authSession";

export const adminMenu = [
  { to: "/admin",           label: "Overview",      end: true, icon: "overview" },
  { to: "/admin/jobs",      label: "Jobs",           icon: "jobs",          group: "Operations" },
  { to: "/admin/trips",     label: "Dispatch",       icon: "dispatch",      group: "Operations" },
  { to: "/admin/tracking",  label: "Live tracking",  icon: "tracking",      group: "Operations" },
  { to: "/admin/customers", label: "Customers",      icon: "customers",     group: "Operations" },
  { to: "/admin/vehicles",  label: "Vehicles",       icon: "vehicles",      group: "Fleet" },
  { to: "/admin/drivers",   label: "Drivers",        icon: "drivers",       group: "Fleet" },
  { to: "/admin/maintenance", label: "Maintenance",  icon: "maintenance",   group: "Fleet" },
  { to: "/admin/finance",   label: "Finance",        icon: "finance",       group: "Money" },
  { to: "/admin/billing",   label: "Billing",        icon: "billing",       group: "Money" },
  { to: "/admin/alerts",    label: "Alerts",         icon: "alerts",        group: "Team & system" },
  { to: "/admin/notifications", label: "Notifications", icon: "notifications", group: "Team & system" },
  { to: "/admin/employees", label: "Employees",      icon: "employees",     group: "Team & system" },
  { to: "/admin/activity",  label: "Activity report", icon: "activity",     group: "Team & system" }
];

const menuAccessKey = {
  "/admin/jobs": "jobs",
  "/admin/customers": "customers",
  "/admin/trips": "trips",
  "/admin/drivers": "drivers",
  "/admin/vehicles": "vehicles",
  "/admin/maintenance": "maintenance",
  "/admin/finance": "finance",
  "/admin/billing": "billing",
  "/admin/tracking": "tracking",
  "/admin/alerts": "alerts"
};

export function AdminWorkspaceLayout({ badge, title, description, highlights, hideHeaderIntro = false, className = "", children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState(() => getAuthSession());
  const isEmployee = session?.role === "employee";

  // Employee pages are assigned by admin at any time; refresh them instead of trusting the login-time copy.
  useEffect(() => {
    if (!isEmployee) return undefined;
    let cancelled = false;
    getMySession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.role !== "employee" || data.approvalStatus !== "active") {
          clearAuthSession();
          navigate("/", { replace: true });
          return;
        }
        const current = getAuthSession() || {};
        const next = { ...current, name: data.name, approvalStatus: data.approvalStatus, accessModules: data.accessModules };
        saveAuthSession(next);
        setSession(next);
        const routeKey = menuAccessKey[location.pathname.replace(/\/$/, "")];
        if (routeKey && !data.accessModules.includes(routeKey)) {
          navigate(data.accessModules[0] ? `/admin/${data.accessModules[0]}` : "/", { replace: true });
        }
      })
      .catch(() => {
        // Expired sessions are handled by the axios interceptor; keep the cached menu otherwise.
      });
    return () => { cancelled = true; };
  }, [isEmployee, location.pathname, navigate]);
  const visibleMenu = session?.role === "employee"
    ? adminMenu.filter((item) => session.accessModules?.includes(menuAccessKey[item.to]))
    : adminMenu;

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Local logout should still complete if the network request fails.
    }
    clearAuthSession();
    navigate("/", { replace: true });
  }

  return (
    <PanelLayout
      badge={badge}
      title={title}
      description={description}
      highlights={highlights}
      hideHeaderIntro={hideHeaderIntro}
      menu={visibleMenu}
      roleLabel={isEmployee ? "Employee workspace" : "Admin workspace"}
      scopeNote={null}
      account={{ name: session?.name, role: isEmployee ? "Employee" : "Administrator", onLogout: handleLogout }}
      headerContent={(
        <>
          {!isEmployee && <NotificationBell fetchUrl="/api/admin/notifications" viewAllTo="/admin/notifications" />}
          <button className="header-action-button danger" onClick={handleLogout} type="button">
            Logout
          </button>
        </>
      )}
      className={className}
    >
      {children}
    </PanelLayout>
  );
}
