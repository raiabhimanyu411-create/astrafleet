import { NotificationCenter } from "../../components/NotificationCenter";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

export function AdminNotificationsPage() {
  return (
    <AdminWorkspaceLayout
      badge="Admin notifications"
      title="Operations notification centre"
      description="Review active employee approvals, failed deliveries, defects, overdue invoices, and stale GPS pings."
      highlights={[
        "Admin-only notification inbox",
        "Live refresh every 30 seconds",
        "Open linked records directly from each alert"
      ]}
    >
      <NotificationCenter
        fetchUrl="/api/admin/notifications"
        title="Admin notification inbox"
        eyebrow="Admin alerts"
        emptyBody="No active admin alerts are pending right now."
      />
    </AdminWorkspaceLayout>
  );
}
