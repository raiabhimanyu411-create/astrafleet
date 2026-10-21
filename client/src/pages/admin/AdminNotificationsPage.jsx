import { NotificationCenter } from "../../components/NotificationCenter";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

export function AdminNotificationsPage() {
  return (
    <AdminWorkspaceLayout
      badge="Notifications"
      title="Operations notification centre"
      description="Review active employee approvals, failed deliveries, defects, overdue invoices, and stale GPS pings."
      highlights={[]}
      className="notifications-page-shell"
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
