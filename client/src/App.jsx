import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { AdminAlertsPage } from "./pages/admin/AdminAlertsPage";
import { AdminBillingPage } from "./pages/admin/AdminBillingPage";
import { AdminDriversPage } from "./pages/admin/AdminDriversPage";
import { AdminFinancePage } from "./pages/admin/AdminFinancePage";
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

function ProtectedRoute({ role, children }) {
  const session = getAuthSession();

  if (!session) {
    return <Navigate replace to="/" />;
  }

  if (role && session.role !== role) {
    return <Navigate replace to={session.role === "admin" ? "/admin" : "/driver"} />;
  }

  return children;
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
        path="/admin/drivers"
        element={(
          <ProtectedRoute role="admin">
            <DriversListPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/drivers/new"
        element={(
          <ProtectedRoute role="admin">
            <DriverFormPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/drivers/:id"
        element={(
          <ProtectedRoute role="admin">
            <DriverDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/drivers/:id/edit"
        element={(
          <ProtectedRoute role="admin">
            <DriverFormPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/vehicles"
        element={(
          <ProtectedRoute role="admin">
            <VehiclesListPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/vehicles/new"
        element={(
          <ProtectedRoute role="admin">
            <VehicleFormPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/vehicles/:id"
        element={(
          <ProtectedRoute role="admin">
            <VehicleDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/vehicles/:id/edit"
        element={(
          <ProtectedRoute role="admin">
            <VehicleFormPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/finance"
        element={(
          <ProtectedRoute role="admin">
            <AdminFinancePage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/trips"
        element={(
          <ProtectedRoute role="admin">
            <AdminTripsPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/trips/assign"
        element={(
          <ProtectedRoute role="admin">
            <AdminTripAssignPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/trips/:id"
        element={(
          <ProtectedRoute role="admin">
            <AdminTripDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/trips/:id/edit"
        element={(
          <ProtectedRoute role="admin">
            <AdminTripAssignPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/billing"
        element={(
          <ProtectedRoute role="admin">
            <AdminBillingPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/billing/new"
        element={(
          <ProtectedRoute role="admin">
            <InvoiceFormPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/billing/:id"
        element={(
          <ProtectedRoute role="admin">
            <InvoiceDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/billing/:id/edit"
        element={(
          <ProtectedRoute role="admin">
            <InvoiceFormPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/tracking"
        element={(
          <ProtectedRoute role="admin">
            <AdminTrackingPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/tracking/vehicles/:id"
        element={(
          <ProtectedRoute role="admin">
            <TrackingVehicleDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/alerts"
        element={(
          <ProtectedRoute role="admin">
            <AdminAlertsPage />
          </ProtectedRoute>
        )}
      />
      {/* Jobs */}
      <Route
        path="/admin/jobs"
        element={(
          <ProtectedRoute role="admin">
            <JobsListPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/jobs/new"
        element={(
          <ProtectedRoute role="admin">
            <JobFormPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/jobs/:id"
        element={(
          <ProtectedRoute role="admin">
            <JobDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/jobs/:id/edit"
        element={(
          <ProtectedRoute role="admin">
            <JobFormPage />
          </ProtectedRoute>
        )}
      />
      {/* Customers */}
      <Route
        path="/admin/customers"
        element={(
          <ProtectedRoute role="admin">
            <CustomersListPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/customers/new"
        element={(
          <ProtectedRoute role="admin">
            <CustomerFormPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/customers/:id"
        element={(
          <ProtectedRoute role="admin">
            <CustomerDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/customers/:id/edit"
        element={(
          <ProtectedRoute role="admin">
            <CustomerFormPage />
          </ProtectedRoute>
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
