import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteDriver, getDrivers, updateDriverInline } from "../../../api/driverApi";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { DriverChatWidget } from "../DriverChatWidget";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function exportCsv(name, rows) {
  const csv = rows
    .map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function DriversListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [savingCell, setSavingCell] = useState("");

  function load() {
    setLoading(true);
    return getDrivers()
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load drivers. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(driver) {
    const label = driver.fullName || "this driver";
    if (!window.confirm(`Delete ${label}? Their assigned jobs will become unassigned.`)) return;

    setError("");
    setDeletingId(driver.id);
    try {
      await deleteDriver(driver.id);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Driver could not be deleted. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleChat(driver) {
    window.dispatchEvent(new CustomEvent("admin-driver-chat:select", { detail: { driverId: driver.id } }));
  }

  async function updateCell(driver, field, value) {
    const key = `${driver.id}-${field}`;
    setError("");
    setSavingCell(key);
    try {
      await updateDriverInline(driver.id, { [field]: value });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Driver could not be updated.");
    } finally {
      setSavingCell("");
    }
  }

  function updateCellOnBlur(driver, field, value, currentValue) {
    const next = String(value ?? "").trim();
    const current = String(currentValue ?? "").trim();
    if (next === current) return;
    updateCell(driver, field, next);
  }

  const drivers = useMemo(() => {
    return (data?.drivers || []).filter(d => {
      if (search) {
        const q = search.toLowerCase();
        return (
          d.fullName.toLowerCase().includes(q) ||
          (d.phone || "").includes(q) ||
          (d.email || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, search]);

  const hasFilters = Boolean(search);

  function clearFilters() {
    setSearch("");
  }

  function exportDrivers() {
    exportCsv("drivers-register.csv", [
      ["Driver", "Contact number", "Email"],
      ...drivers.map(d => [
        d.fullName,
        d.phone,
        d.email
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="Driver management"
      title="Drivers"
      description="Manage registered drivers and their login access."
      highlights={[]}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportDrivers}>Export CSV</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/drivers/new")}>+ Add Driver</button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="driver-control-strip">
        <div className="driver-filter-card">
          <input
            className="af-input"
            type="text"
            placeholder="Search By Name, Contact Number, Or Email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear Filters</button>
        </div>
      </section>

      <section className="driver-register-card">
        <div className="section-head">
          <div>
            <span className="card-label">Driver Register</span>
            <h2>Driver List</h2>
          </div>
          <StatusPill tone={drivers.length ? "success" : "neutral"}>{drivers.length} visible</StatusPill>
        </div>

        <div className="driver-table-shell">
          <table className="driver-edit-table drivers">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Contact number</th>
                <th>Email</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.id}>
                  <td>
                    <input
                      className="driver-table-input strong"
                      defaultValue={d.fullName}
                      disabled={savingCell === `${d.id}-fullName`}
                      onBlur={(e) => updateCellOnBlur(d, "fullName", e.target.value, d.fullName)}
                    />
                  </td>
                  <td>
                    <input
                      className="driver-table-input"
                      defaultValue={d.phone === "—" ? "" : d.phone}
                      disabled={savingCell === `${d.id}-phone`}
                      onBlur={(e) => updateCellOnBlur(d, "phone", e.target.value, d.phone === "—" ? "" : d.phone)}
                    />
                  </td>
                  <td><strong>{d.email}</strong></td>
                  <td>
                    <div className="driver-table-actions">
                      <button className="header-action-button" type="button" onClick={() => handleChat(d)}>Chat</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/drivers/${d.id}`)}>Open</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/drivers/${d.id}/edit`)}>Edit</button>
                      <button className="header-action-button danger" type="button" disabled={deletingId === d.id} onClick={() => handleDelete(d)}>
                        {deletingId === d.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && drivers.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <p className="finance-empty">{hasFilters ? "No drivers match your filters." : "No drivers yet. Add your first driver."}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <DriverChatWidget compact />
    </AdminWorkspaceLayout>
  );
}
