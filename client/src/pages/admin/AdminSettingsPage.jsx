import { useEffect, useMemo, useState } from "react";
import { getSettingsSchema, updateSettings } from "../../api/settingsApi";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";
import "./AdminSettingsPage.css";

// Same checks as the server, so mistakes show next to the field before saving.
function fieldError(def, raw) {
  if (raw === "" || raw === null || raw === undefined) return "Enter a value.";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a number.";
  if (def.options) return def.options.includes(value) ? "" : `Choose ${def.options.join(", ")}.`;
  if (def.integer && !Number.isInteger(value)) return "Use a whole number.";
  if (value < def.min || value > def.max || (def.positive && value <= 0)) {
    return `Use ${def.positive ? "more than" : "from"} ${def.min} up to ${def.max}.`;
  }
  return "";
}

function formatValue(def, value) {
  const number = Number(value);
  if (def.unit?.startsWith("£")) return `£${number.toFixed(2)}`;
  if (def.unit === "%") return `${number}%`;
  return `${number.toLocaleString("en-GB")} ${def.unit}`;
}

function SettingRow({ def, value, onChange }) {
  const error = fieldError(def, value);
  const isDefault = Number(value) === Number(def.default);
  const id = `setting-${def.key}`;
  return (
    <div className={`st-row${error ? " has-error" : ""}`}>
      <div className="st-row-text">
        <label htmlFor={id}>{def.label}</label>
        <p>{def.help}</p>
      </div>
      <div className="st-row-control">
        <div className="st-input">
          {def.options ? (
            <select id={id} value={value} onChange={(e) => onChange(def.key, e.target.value)}>
              {def.options.map((option) => <option key={option} value={String(option)}>{option}</option>)}
            </select>
          ) : (
            <input
              id={id}
              type="number"
              inputMode="decimal"
              step={def.integer ? 1 : "any"}
              min={def.min}
              max={def.max}
              value={value}
              onChange={(e) => onChange(def.key, e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={`${id}-meta`}
            />
          )}
          <span className="st-unit">{def.unit}</span>
        </div>
        <div className="st-row-meta" id={`${id}-meta`}>
          {error ? (
            <span className="st-error">{error}</span>
          ) : (
            <span>Default: {formatValue(def, def.default)}</span>
          )}
          {!isDefault && (
            <button type="button" className="st-link" onClick={() => onChange(def.key, String(def.default))}>
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminSettingsPage() {
  const [groups, setGroups] = useState([]);
  const [defs, setDefs] = useState([]);
  const [saved, setSaved] = useState({});
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(false);

  function applySchema(data) {
    const values = Object.fromEntries(data.settings.map((s) => [s.key, String(s.value)]));
    setGroups(data.groups);
    setDefs(data.settings);
    setSaved(values);
    setDraft(values);
  }

  useEffect(() => {
    getSettingsSchema()
      .then((res) => applySchema(res.data))
      .catch((err) => setLoadError(err.response?.data?.message || "Settings could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  const changedKeys = useMemo(
    () => defs.filter((d) => Number(draft[d.key]) !== Number(saved[d.key]) || draft[d.key] === "").map((d) => d.key),
    [defs, draft, saved]
  );
  const hasErrors = defs.some((d) => fieldError(d, draft[d.key]));
  const allDefault = defs.every((d) => Number(draft[d.key]) === Number(d.default));
  const maintenanceChanges = defs.filter((d) => d.group === "maintenance" && d.key !== "new_vehicle_inspection_weeks" && changedKeys.includes(d.key));

  const costPerMile = useMemo(() => {
    const mpg = Number(draft.mpg);
    const fuel = Number(draft.fuel_price_per_litre);
    return mpg > 0 && fuel > 0 ? (4.546 / mpg) * fuel : null;
  }, [draft.mpg, draft.fuel_price_per_litre]);

  function setValue(key, value) {
    setNotice(null);
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function resetAll() {
    setNotice(null);
    setDraft(Object.fromEntries(defs.map((d) => [d.key, String(d.default)])));
  }

  function requestSave() {
    if (!changedKeys.length || hasErrors || saving) return;
    if (maintenanceChanges.length) setConfirming(true);
    else save();
  }

  async function save() {
    setConfirming(false);
    setSaving(true);
    setNotice(null);
    try {
      const payload = Object.fromEntries(changedKeys.map((key) => [key, Number(draft[key])]));
      const res = await updateSettings(payload);
      const fresh = await getSettingsSchema();
      applySchema(fresh.data);
      setNotice({
        tone: "success",
        text: res.data.maintenanceRecalculated
          ? "Settings saved. Maintenance due dates are being recalculated — open Maintenance in a minute to see them."
          : "Settings saved."
      });
    } catch (err) {
      setNotice({ tone: "error", text: err.response?.data?.message || "Settings could not be saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      title="Settings"
      description="Company-wide values the app uses."
      highlights={[]}
      hideHeaderIntro
      className="settings-page-shell"
    >
      <div className="st-page">
        <header className="st-head">
          <div>
            <h1>Settings</h1>
            <p>Company-wide values used for pricing, invoices, reminders and maintenance. Every change is recorded in the Activity report.</p>
          </div>
          <button type="button" className="st-btn" onClick={resetAll} disabled={loading || allDefault || saving}>
            Reset all to default
          </button>
        </header>

        {loading && <p className="st-muted">Loading settings…</p>}
        {loadError && <div className="st-banner error" role="alert">{loadError}</div>}
        {notice && <div className={`st-banner ${notice.tone}`} role="status">{notice.text}</div>}

        {groups.map((group) => {
          const rows = defs.filter((d) => d.group === group.key);
          if (!rows.length) return null;
          return (
            <section className={`st-card${group.caution ? " caution" : ""}`} key={group.key} aria-labelledby={`group-${group.key}`}>
              <header className="st-card-head">
                <div>
                  <h2 id={`group-${group.key}`}>{group.title}</h2>
                  <p>{group.description}</p>
                </div>
                {group.key === "costing" && costPerMile !== null && (
                  <div className="st-stat">
                    <span>Fuel cost per mile</span>
                    <strong>£{costPerMile.toFixed(2)}</strong>
                  </div>
                )}
              </header>
              {rows.map((def) => (
                <SettingRow key={def.key} def={def} value={draft[def.key] ?? ""} onChange={setValue} />
              ))}
            </section>
          );
        })}

        {changedKeys.length > 0 && (
          <div className="st-savebar" role="region" aria-label="Unsaved changes">
            <span>
              {changedKeys.length} unsaved {changedKeys.length === 1 ? "change" : "changes"}
              {hasErrors && " · fix the highlighted fields"}
            </span>
            <div className="st-savebar-actions">
              <button type="button" className="st-btn" onClick={() => setDraft(saved)} disabled={saving}>Discard</button>
              <button type="button" className="st-btn primary" onClick={requestSave} disabled={saving || hasErrors}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </div>

      {confirming && (
        <div className="st-modal-backdrop" role="presentation" onClick={() => setConfirming(false)}>
          <div className="st-modal" role="dialog" aria-modal="true" aria-labelledby="st-confirm-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="st-confirm-title">Recalculate maintenance due dates?</h2>
            <p>The next due date of every truck and trailer will be worked out again from its last completed check:</p>
            <ul>
              {maintenanceChanges.map((def) => (
                <li key={def.key}>
                  <strong>{def.label}</strong>: {formatValue(def, saved[def.key])} → {formatValue(def, draft[def.key])}
                </li>
              ))}
            </ul>
            <p className="st-muted">You can switch back at any time with Reset to default.</p>
            <div className="st-modal-actions">
              <button type="button" className="st-btn" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="st-btn primary" onClick={save} autoFocus>Save and recalculate</button>
            </div>
          </div>
        </div>
      )}
    </AdminWorkspaceLayout>
  );
}
