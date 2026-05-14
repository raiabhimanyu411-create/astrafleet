import { useNavigate } from "react-router-dom";
import { NotificationBell } from "../../components/NotificationBell";
import { PanelLayout } from "../../components/PanelLayout";
import { clearAuthSession } from "../../utils/authSession";

export const adminMenu = [
  { to: "/admin",           label: "Overview",      end: true },
  { to: "/admin/jobs",      label: "Jobs" },
  { to: "/admin/customers", label: "Customers" },
  { to: "/admin/trips",     label: "Dispatch" },
  { to: "/admin/drivers",   label: "Drivers" },
  { to: "/admin/vehicles",  label: "Vehicles" },
  { to: "/admin/finance",   label: "Finance" },
  { to: "/admin/billing",   label: "Billing" },
  { to: "/admin/tracking",  label: "Live Tracking" },
  { to: "/admin/alerts",    label: "Alerts" }
];

export function AdminWorkspaceLayout({ badge, title, description, highlights, children }) {
  const navigate = useNavigate();

  function handleLogout() {
    clearAuthSession();
    navigate("/", { replace: true });
  }

  return (
    <PanelLayout
      badge={badge}
      title={title}
      description={description}
      highlights={highlights}
      menu={adminMenu}
      roleLabel="Admin workspace"
      scopeNote={{
        eyebrow: "Admin scope",
        title: "Transport control tower",
        description: "Monitor driver operations, route planning, billing, and GPS movement from one workspace."
      }}
      headerContent={(
        <>
          <NotificationBell fetchUrl="/api/admin/notifications" />
          <button className="header-action-button danger" onClick={handleLogout} type="button">
            Logout
          </button>
        </>
      )}
    >
      {children}
    </PanelLayout>
  );
}
