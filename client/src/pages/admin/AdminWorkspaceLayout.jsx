import { useNavigate } from "react-router-dom";
import { NotificationBell } from "../../components/NotificationBell";
import { PanelLayout } from "../../components/PanelLayout";
import { clearAuthSession, getAuthSession } from "../../utils/authSession";

export const adminMenu = [
  { to: "/admin",           label: "Overview",      end: true },
  { to: "/admin/employees", label: "Employees" },
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

const menuAccessKey = {
  "/admin/jobs": "jobs",
  "/admin/customers": "customers",
  "/admin/trips": "trips",
  "/admin/drivers": "drivers",
  "/admin/vehicles": "vehicles",
  "/admin/finance": "finance",
  "/admin/billing": "billing",
  "/admin/tracking": "tracking",
  "/admin/alerts": "alerts"
};

export function AdminWorkspaceLayout({ badge, title, description, highlights, children }) {
  const navigate = useNavigate();
  const session = getAuthSession();
  const visibleMenu = session?.role === "employee"
    ? adminMenu.filter((item) => session.accessModules?.includes(menuAccessKey[item.to]))
    : adminMenu;

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
      menu={visibleMenu}
      roleLabel={session?.role === "employee" ? "Employee workspace" : "Admin workspace"}
      scopeNote={{
        eyebrow: session?.role === "employee" ? "Granted scope" : "Admin scope",
        title: session?.role === "employee" ? "Assigned TMS access" : "Transport control tower",
        description: session?.role === "employee"
          ? "Only admin-approved modules are visible in this workspace."
          : "Monitor driver operations, route planning, billing, and GPS movement from one workspace."
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
