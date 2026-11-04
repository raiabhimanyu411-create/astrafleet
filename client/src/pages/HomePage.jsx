import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { updateDriverLocation } from "../api/driverApi";
import { getAuthSession, saveAuthSession } from "../utils/authSession";
import { gpsErrorMessage, positionToPayload, requestDriverGpsAccess } from "../utils/driverGps";
import "./HomePage.css";

/* Icons use currentColor so CSS controls their colour. */
function Svg({ size = 18, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

const IconCheck = () => (
  <Svg size={16} strokeWidth="2.2">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

function IconEye({ show, onClick }) {
  return (
    <button
      type="button"
      className="eye-btn"
      onClick={onClick}
      aria-label={show ? "Hide password" : "Show password"}
    >
      {show ? (
        <Svg size={17}>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </Svg>
      ) : (
        <Svg size={17}>
          <path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
        </Svg>
      )}
    </button>
  );
}

function IconAlertCircle({ color = "currentColor" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="lp-alert-icon">
      <circle cx="8" cy="8" r="7" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="8" y1="5" x2="8" y2="8.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.8" fill={color} />
    </svg>
  );
}

function IconCheckCircle({ color = "currentColor" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="lp-alert-icon">
      <circle cx="8" cy="8" r="7" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M5 8.2 L7 10.2 L11 6" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

const trustPoints = ["Live GPS tracking", "DVSA compliance alerts", "Automated invoicing"];

export function HomePage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("finance");
  const [jobTitle, setJobTitle] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const session = getAuthSession();

    if (session?.role === "admin") {
      navigate("/admin", { replace: true });
    } else if (session?.role === "driver") {
      navigate("/driver", { replace: true });
    } else if (session?.role === "employee") {
      navigate(session.accessModules?.[0] ? `/admin/${session.accessModules[0]}` : "/", { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const { data } = await api.post("/api/auth/login", { email: email.trim().toLowerCase(), password });

      if (data.role === "driver") {
        saveAuthSession({
          id: data.id,
          name: data.name,
          role: data.role,
          sessionToken: data.sessionToken,
          accessModules: data.accessModules || [],
          approvalStatus: data.approvalStatus
        });
        try {
          const position = await requestDriverGpsAccess();
          await updateDriverLocation(data.id, positionToPayload(position));
        } catch (gpsError) {
          window.localStorage.removeItem("astrafleet_session");
          setError(gpsErrorMessage(gpsError));
          return;
        }
      }

      if (data.role !== "driver") {
        saveAuthSession({
          id: data.id,
          name: data.name,
          role: data.role,
          sessionToken: data.sessionToken,
          accessModules: data.accessModules || [],
          approvalStatus: data.approvalStatus
        });
      }
      if (data.role === "admin") {
        navigate("/admin");
      } else if (data.role === "employee") {
        navigate(data.accessModules?.[0] ? `/admin/${data.accessModules[0]}` : "/");
      } else {
        navigate("/driver");
      }
    } catch (err) {
      setError(err.response?.data?.error || "Unable to connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const { data } = await api.post("/api/auth/employees/register", {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        phone: phone.trim(),
        department,
        jobTitle: jobTitle.trim()
      });
      setSuccess(data.message || "Registration submitted. Admin approval is required.");
      setMode("login");
      setPassword("");
      setName("");
      setPhone("");
      setJobTitle("");
    } catch (err) {
      setError(err.response?.data?.error || "Unable to submit registration. Please try again.");
    } finally {
      setLoading(false);
    }
  }


  function switchMode(next) {
    setMode(next);
    setError("");
    setSuccess("");
  }

  const isLogin = mode === "login";

  // Display only: warn when Caps Lock is on while typing the password.
  function trackCapsLock(event) {
    if (typeof event.getModifierState === "function") setCapsLock(event.getModifierState("CapsLock"));
  }

  return (
    <div className="ln-page">
      {/* ── Brand panel (hidden on mobile) ── */}
      <aside className="ln-brand" aria-hidden="true">
        <div className="ln-logo">
          <span className="ln-logo-mark"><img src="/favicon.png" alt="" /></span>
          <span>AstraFleet</span>
        </div>

        <div className="ln-brand-copy">
          <h1>Run your fleet from<br />one control tower.</h1>
          <p>Jobs, dispatch, live tracking and billing for UK hauliers.</p>
        </div>

        <ul className="ln-trust">
          {trustPoints.map((point) => (
            <li key={point}><IconCheck />{point}</li>
          ))}
        </ul>
      </aside>

      {/* ── Form panel ── */}
      <main className="ln-main">
        <div className="ln-form-wrap">
          <div className="ln-mobile-logo">
            <span className="ln-logo-mark"><img src="/favicon.png" alt="" /></span>
            <span>AstraFleet</span>
          </div>

          <div className="ln-head">
            <h2>{isLogin ? "Sign in" : "Request access"}</h2>
            <p>
              {isLogin
                ? "Welcome back. Enter your details to continue."
                : "Create your login. An administrator will approve your access."}
            </p>
          </div>

          <form className="ln-form" onSubmit={isLogin ? handleSubmit : handleRegister}>
            {!isLogin && (
              <>
                <div className="ln-field">
                  <label htmlFor="lp-name">Full name</label>
                  <input
                    id="lp-name"
                    className="ln-input"
                    type="text"
                    autoComplete="name"
                    placeholder="Your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="ln-field">
                  <label htmlFor="lp-dept">Work area</label>
                  <select id="lp-dept" className="ln-input" value={department} onChange={(e) => setDepartment(e.target.value)} required>
                    <option value="finance">Finance</option>
                    <option value="trips">Dispatch planning</option>
                    <option value="jobs">Job management</option>
                    <option value="billing">Billing</option>
                    <option value="tracking">Live tracking</option>
                    <option value="drivers">Driver management</option>
                    <option value="vehicles">Vehicle management</option>
                  </select>
                </div>

                <div className="ln-field">
                  <label htmlFor="lp-title">Job title</label>
                  <input
                    id="lp-title"
                    className="ln-input"
                    type="text"
                    autoComplete="organization-title"
                    placeholder="e.g. Finance executive"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="ln-field">
                  <label htmlFor="lp-phone">Phone <span className="ln-optional">(optional)</span></label>
                  <input
                    id="lp-phone"
                    className="ln-input"
                    type="tel"
                    autoComplete="tel"
                    placeholder="07700 900123"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="ln-field">
              <label htmlFor="lp-email">{isLogin ? "Email" : "Work email"}</label>
              <input
                id="lp-email"
                className="ln-input"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="you@company.co.uk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="ln-field">
              <div className="ln-label-row">
                <label htmlFor="lp-password">Password</label>
                {isLogin && <a className="ln-link" href="#">Forgot password?</a>}
              </div>
              <div className="ln-password">
                <input
                  id="lp-password"
                  className="ln-input"
                  type={showPass ? "text" : "password"}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  placeholder={isLogin ? "Enter your password" : "Create a password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={trackCapsLock}
                  onKeyUp={trackCapsLock}
                  onBlur={() => setCapsLock(false)}
                  aria-describedby={capsLock ? "lp-caps" : undefined}
                  required
                />
                <IconEye show={showPass} onClick={() => setShowPass(!showPass)} />
              </div>
              {capsLock && <p className="ln-caps" id="lp-caps">Caps Lock is on</p>}
            </div>

            {error && (
              <div className="ln-alert error" role="alert">
                <IconAlertCircle color="#C62828" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="ln-alert success" role="status">
                <IconCheckCircle color="#1A7F37" />
                <span>{success}</span>
              </div>
            )}

            <button type="submit" className="ln-submit" disabled={loading}>
              {loading && <span className="ln-spinner" aria-hidden="true" />}
              {loading
                ? (isLogin ? "Signing in…" : "Submitting…")
                : (isLogin ? "Sign in" : "Submit for approval")}
            </button>
          </form>

          <p className="ln-access">
            {isLogin ? (
              <>Need access? <button type="button" className="ln-link" onClick={() => switchMode("register")}>Request employee access</button></>
            ) : (
              <>Already have a login? <button type="button" className="ln-link" onClick={() => switchMode("login")}>Sign in</button></>
            )}
          </p>
        </div>

        <footer className="ln-footer">
          <span>© {new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Europe/London" }).format(new Date())} AstraFleet TMS</span>
          <span>Built by Devmora Technology</span>
        </footer>
      </main>
    </div>
  );
}
