import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./App.css";
import { AdminAlertsPage } from "./pages/admin/AdminAlertsPage";
import { AdminBillingPage } from "./pages/admin/AdminBillingPage";
import { AdminDriversPage } from "./pages/admin/AdminDriversPage";
import { AdminFinancePage } from "./pages/admin/AdminFinancePage";
import { AdminEmployeesPage } from "./pages/admin/AdminEmployeesPage";
import { AdminPanel } from "./pages/admin/AdminPanel";
import { AdminTrackingPage } from "./pages/admin/AdminTrackingPage";
import { AdminTripAssignPage } from "./pages/admin/AdminTripAssignPage";
import { AdminTripDetailPage } from "./pages/admin/AdminTripDetailPage";
import { AdminTripsPage } from "./pages/admin/AdminTripsPage";
import { InvoiceDetailPage } from "./pages/admin/billing/InvoiceDetailPage";
import { InvoiceFormPage } from "./pages/admin/billing/InvoiceFormPage";
import { CustomerDetailPage } from "./pages/admin/customers/CustomerDetailPage";
import { CustomerFormPage } from "./pages/admin/customers/CustomerFormPage";
import { CustomersListPage } from "./pages/admin/customers/CustomersListPage";
import { JobDetailPage } from "./pages/admin/jobs/JobDetailPage";
import { JobFormPage } from "./pages/admin/jobs/JobFormPage";
import { JobsListPage } from "./pages/admin/jobs/JobsListPage";
import { DriverDetailPage } from "./pages/admin/drivers/DriverDetailPage";
import { DriverFormPage } from "./pages/admin/drivers/DriverFormPage";
import { DriversListPage } from "./pages/admin/drivers/DriversListPage";
import { VehicleDetailPage } from "./pages/admin/vehicles/VehicleDetailPage";
import { VehicleFormPage } from "./pages/admin/vehicles/VehicleFormPage";
import { VehiclesListPage } from "./pages/admin/vehicles/VehiclesListPage";
import { TrackingVehicleDetailPage } from "./pages/admin/tracking/TrackingVehicleDetailPage";
import { DriverPanel } from "./pages/driver/DriverPanel";
import { HomePage } from "./pages/HomePage";
import { getAuthSession } from "./utils/authSession";

const routeAccess = {
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

function firstEmployeePath(session) {
  const firstModule = session?.accessModules?.[0];
  return firstModule ? `/admin/${firstModule}` : "/";
}

function ProtectedRoute({ role, moduleKey, children }) {
  const session = getAuthSession();

  if (!session) {
    return <Navigate replace to="/" />;
  }

  if (session.role === "admin") {
    return children;
  }

  if (role && session.role !== role) {
    if (session.role === "employee") {
      return <Navigate replace to={firstEmployeePath(session)} />;
    }
    return <Navigate replace to={session.role === "driver" ? "/driver" : "/"} />;
  }

  if (session.role === "employee") {
    const allowed = moduleKey && session.accessModules?.includes(moduleKey);
    if (!allowed) {
      return <Navigate replace to={firstEmployeePath(session)} />;
    }
  }

  return children;
}

function AdminOrEmployeeRoute({ children }) {
  const location = useLocation();
  const path = location.pathname;
  const matched = Object.entries(routeAccess).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return <ProtectedRoute role={matched ? undefined : "admin"} moduleKey={matched?.[1]}>{children}</ProtectedRoute>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="/admin"
        element={(
          <ProtectedRoute role="admin">
            <AdminPanel />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/employees"
        element={(
          <ProtectedRoute role="admin">
            <AdminEmployeesPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/drivers"
        element={(
          <AdminOrEmployeeRoute>
            <DriversListPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/drivers/new"
        element={(
          <AdminOrEmployeeRoute>
            <DriverFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/drivers/:id"
        element={(
          <AdminOrEmployeeRoute>
            <DriverDetailPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/drivers/:id/edit"
        element={(
          <AdminOrEmployeeRoute>
            <DriverFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/vehicles"
        element={(
          <AdminOrEmployeeRoute>
            <VehiclesListPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/vehicles/new"
        element={(
          <AdminOrEmployeeRoute>
            <VehicleFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/vehicles/:id"
        element={(
          <AdminOrEmployeeRoute>
            <VehicleDetailPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/vehicles/:id/edit"
        element={(
          <AdminOrEmployeeRoute>
            <VehicleFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/finance"
        element={(
          <AdminOrEmployeeRoute>
            <AdminFinancePage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/trips"
        element={(
          <AdminOrEmployeeRoute>
            <AdminTripsPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/trips/assign"
        element={(
          <AdminOrEmployeeRoute>
            <AdminTripAssignPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/trips/:id"
        element={(
          <AdminOrEmployeeRoute>
            <AdminTripDetailPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/trips/:id/edit"
        element={(
          <AdminOrEmployeeRoute>
            <AdminTripAssignPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/billing"
        element={(
          <AdminOrEmployeeRoute>
            <AdminBillingPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/billing/new"
        element={(
          <AdminOrEmployeeRoute>
            <InvoiceFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/billing/:id"
        element={(
          <AdminOrEmployeeRoute>
            <InvoiceDetailPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/billing/:id/edit"
        element={(
          <AdminOrEmployeeRoute>
            <InvoiceFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/tracking"
        element={(
          <AdminOrEmployeeRoute>
            <AdminTrackingPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/tracking/vehicles/:id"
        element={(
          <AdminOrEmployeeRoute>
            <TrackingVehicleDetailPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/alerts"
        element={(
          <AdminOrEmployeeRoute>
            <AdminAlertsPage />
          </AdminOrEmployeeRoute>
        )}
      />
      {/* Jobs */}
      <Route
        path="/admin/jobs"
        element={(
          <AdminOrEmployeeRoute>
            <JobsListPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/jobs/new"
        element={(
          <AdminOrEmployeeRoute>
            <JobFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/jobs/:id"
        element={(
          <AdminOrEmployeeRoute>
            <JobDetailPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/jobs/:id/edit"
        element={(
          <AdminOrEmployeeRoute>
            <JobFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      {/* Customers */}
      <Route
        path="/admin/customers"
        element={(
          <AdminOrEmployeeRoute>
            <CustomersListPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/customers/new"
        element={(
          <AdminOrEmployeeRoute>
            <CustomerFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/customers/:id"
        element={(
          <AdminOrEmployeeRoute>
            <CustomerDetailPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/admin/customers/:id/edit"
        element={(
          <AdminOrEmployeeRoute>
            <CustomerFormPage />
          </AdminOrEmployeeRoute>
        )}
      />
      <Route
        path="/driver"
        element={(
          <ProtectedRoute role="driver">
            <DriverPanel />
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}

export default App;
