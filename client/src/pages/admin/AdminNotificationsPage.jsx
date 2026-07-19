import { NotificationCenter } from "../../components/NotificationCenter";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

export function AdminNotificationsPage() {
  return (
    <AdminWorkspaceLayout
      badge="Admin Notifications"
      title="Operations Notification Centre"
      description="Review active employee approvals, failed deliveries, defects, overdue invoices, and stale GPS pings."
      highlights={[]}
      className="notifications-page-shell"
    >
      <NotificationCenter
        fetchUrl="/api/admin/notifications"
        title="Admin Notification Inbox"
        eyebrow="Admin Alerts"
        emptyBody="No active admin alerts are pending right now."
      />
    </AdminWorkspaceLayout>
  );
}
