import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getMySession, logout } from "../../api/authApi";
import { NotificationBell } from "../../components/NotificationBell";
import { PanelLayout } from "../../components/PanelLayout";
import { clearAuthSession, getAuthSession, saveAuthSession } from "../../utils/authSession";

export const adminMenu = [
  { to: "/admin",           label: "Overview",      end: true },
  { to: "/admin/activity",  label: "Activity Report" },
  { to: "/admin/employees", label: "Employees" },
  { to: "/admin/jobs",      label: "Jobs" },
  { to: "/admin/customers", label: "Customers" },
  { to: "/admin/trips",     label: "Dispatch" },
  { to: "/admin/drivers",   label: "Drivers" },
  { to: "/admin/vehicles",  label: "Vehicles" },
  { to: "/admin/maintenance", label: "Maintenance" },
  { to: "/admin/finance",   label: "Finance" },
  { to: "/admin/billing",   label: "Billing" },
  { to: "/admin/tracking",  label: "Live Tracking" },
  { to: "/admin/alerts",    label: "Alerts" },
  { to: "/admin/notifications", label: "Notifications" }
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
      roleLabel={isEmployee ? "Employee Workspace" : "Admin Workspace"}
      scopeNote={null}
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
