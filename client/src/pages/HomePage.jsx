import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { updateDriverLocation } from "../api/driverApi";
import { getAuthSession, saveAuthSession } from "../utils/authSession";
import { gpsErrorMessage, positionToPayload, requestDriverGpsAccess } from "../utils/driverGps";
import astraLogo from "../../images/Logo1.png";

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

const IconRadar = () => (
  <Svg>
    <circle cx="12" cy="10" r="3" />
    <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
  </Svg>
);
const IconDispatch = () => (
  <Svg>
    <path d="M3 7h11v9H3z" />
    <path d="M14 10h4l3 3v3h-7" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </Svg>
);
const IconShield = ({ size = 18 }) => (
  <Svg size={size}>
    <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
const IconInvoice = () => (
  <Svg>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);
const IconLockSmall = ({ size = 13 }) => (
  <Svg size={size}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
const IconUsers = ({ size = 13 }) => (
  <Svg size={size}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c0-2.8-1.6-4.9-4-5.7" />
  </Svg>
);
const IconClock = ({ size = 13 }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
const IconMail = () => (
  <Svg size={17}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </Svg>
);
const IconUser = () => (
  <Svg size={17}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
  </Svg>
);
const IconPhone = () => (
  <Svg size={17}>
    <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z" />
  </Svg>
);
const IconBadge = () => (
  <Svg size={17}>
    <rect x="3" y="7" width="18" height="13" rx="2.5" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Svg>
);
const IconLock = () => (
  <Svg size={17}>
    <rect x="4" y="10" width="16" height="11" rx="2.5" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.5" r="1" fill="currentColor" />
  </Svg>
);
const IconArrow = () => (
  <Svg size={18} strokeWidth="2">
    <path d="M5 12h14M13 6l6 6-6 6" />
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

/* Decorative orbit rings in the brand panel — echoes the logo's globe and arrows. */
function OrbitArt() {
  return (
    <svg className="lp-orbit" viewBox="0 0 520 520" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="lpViolet" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7C3AED" stopOpacity="0" />
          <stop offset="0.6" stopColor="#8B5CF6" stopOpacity="0.9" />
          <stop offset="1" stopColor="#C4B5FD" />
        </linearGradient>
      </defs>
      <circle cx="260" cy="260" r="250" stroke="rgba(124,58,237,0.07)" />
      <circle cx="260" cy="260" r="190" stroke="rgba(124,58,237,0.09)" />
      <circle cx="260" cy="260" r="130" stroke="rgba(124,58,237,0.08)" />
      <ellipse cx="260" cy="260" rx="190" ry="70" stroke="rgba(124,58,237,0.08)" transform="rotate(-30 260 260)" />
      <g className="lp-orbit-spin">
        <circle cx="260" cy="260" r="190" stroke="rgba(124,58,237,0.3)" strokeDasharray="2 12" />
        <circle cx="450" cy="260" r="4" fill="#A78BFA" />
        <circle cx="94" cy="168" r="3" fill="#C4B5FD" />
      </g>
      <path d="M40 360 C 150 300, 300 230, 430 110" stroke="url(#lpViolet)" strokeWidth="6" strokeLinecap="round" />
      <path d="M412 96 L446 96 L438 130 Z" fill="#A78BFA" transform="rotate(8 430 110)" />
    </svg>
  );
}

const pillars = [
  { Icon: IconRadar, title: "Live fleet tracking", text: "Real-time GPS for every vehicle and driver" },
  { Icon: IconDispatch, title: "Dispatch & job control", text: "Plan trips, assign loads, track proof of delivery" },
  { Icon: IconShield, title: "Compliance & maintenance", text: "Documents, checks and service history in one place" },
  { Icon: IconInvoice, title: "Billing & finance", text: "From completed job to invoice without re-keying" },
];

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

  return (
    <div className="lp-page">
      <div className="lp-card">
        {/* ── Brand panel ── */}
        <aside className="lp-left">
          <OrbitArt />
          <div className="lp-left-inner">
            <img className="lp-hero-logo" src={astraLogo} alt="AstraFleet TMS" />

            <div className="lp-eyebrow">Transport Management System</div>
            <h1 className="lp-headline">
              Every load. Every driver.
              <br />
              <span>One command centre.</span>
            </h1>
            <p className="lp-lede">
              AstraFleet brings dispatch, live tracking, compliance and billing together, so your
              operation runs on time, every time.
            </p>

            <ul className="lp-pillars">
              {pillars.map(({ Icon, title, text }) => (
                <li className="lp-pillar" key={title}>
                  <span className="lp-pillar-icon"><Icon /></span>
                  <div>
                    <strong>{title}</strong>
                    <small>{text}</small>
                  </div>
                </li>
              ))}
            </ul>

            <div className="lp-left-foot">
              <span><IconLockSmall /> Encrypted sessions</span>
              <span><IconUsers /> Role-based access</span>
              <span><IconClock /> UK time, always</span>
            </div>
          </div>
        </aside>

        {/* ── Form panel ── */}
        <main className="lp-right">
          <div className="lp-form-wrap">
            <img className="lp-mobile-logo" src={astraLogo} alt="AstraFleet TMS" />

            <div className="lp-form-head">
              <span className="lp-kicker"><IconLockSmall size={11} /> {isLogin ? "Secure sign-in" : "Staff access request"}</span>
              <h2>{isLogin ? "Welcome back" : "Request employee access"}</h2>
              <p>
                {isLogin
                  ? "Sign in to your AstraFleet TMS workspace."
                  : "Create your login. An admin will approve your access."}
              </p>
            </div>

            <div className="lp-role-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={isLogin}
                className={`lp-role-tab${isLogin ? " active" : ""}`}
                onClick={() => switchMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isLogin}
                className={`lp-role-tab${!isLogin ? " active" : ""}`}
                onClick={() => switchMode("register")}
              >
                Employee register
              </button>
            </div>

            <form className="lp-form" onSubmit={isLogin ? handleSubmit : handleRegister}>
              {!isLogin && (
                <>
                  <div className="lp-field">
                    <label htmlFor="lp-name">Full name</label>
                    <div className="lp-input-wrap">
                      <span className="lp-input-icon"><IconUser /></span>
                      <input
                        id="lp-name"
                        type="text"
                        autoComplete="name"
                        placeholder="Your full name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="lp-field">
                    <label htmlFor="lp-dept">Work area</label>
                    <div className="lp-input-wrap">
                      <select id="lp-dept" value={department} onChange={(e) => setDepartment(e.target.value)} required>
                        <option value="finance">Finance</option>
                        <option value="trips">Dispatch Planning</option>
                        <option value="jobs">Job Management</option>
                        <option value="billing">Billing</option>
                        <option value="tracking">Live Tracking</option>
                        <option value="drivers">Driver Management</option>
                        <option value="vehicles">Vehicle Management</option>
                      </select>
                    </div>
                  </div>

                  <div className="lp-field">
                    <label htmlFor="lp-title">Job title</label>
                    <div className="lp-input-wrap">
                      <span className="lp-input-icon"><IconBadge /></span>
                      <input
                        id="lp-title"
                        type="text"
                        autoComplete="organization-title"
                        placeholder="e.g. Finance executive"
                        value={jobTitle}
                        onChange={(e) => setJobTitle(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="lp-field">
                    <label htmlFor="lp-phone">Phone</label>
                    <div className="lp-input-wrap">
                      <span className="lp-input-icon"><IconPhone /></span>
                      <input
                        id="lp-phone"
                        type="tel"
                        autoComplete="tel"
                        placeholder="Phone number"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="lp-field">
                <label htmlFor="lp-email">{isLogin ? "Email address" : "Work email"}</label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon"><IconMail /></span>
                  <input
                    id="lp-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="lp-field">
                <div className="lp-field-row">
                  <label htmlFor="lp-password">Password</label>
                  {isLogin && <a className="lp-forgot" href="#">Forgot password?</a>}
                </div>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon"><IconLock /></span>
                  <input
                    id="lp-password"
                    type={showPass ? "text" : "password"}
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    placeholder={isLogin ? "Enter your password" : "Create a password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <IconEye show={showPass} onClick={() => setShowPass(!showPass)} />
                </div>
              </div>

              {error && (
                <div className="lp-alert lp-error" role="alert">
                  <IconAlertCircle color="#AD0A0A" />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="lp-alert lp-success" role="status">
                  <IconCheckCircle color="#026A0A" />
                  <span>{success}</span>
                </div>
              )}

              <button type="submit" className="lp-login-btn" disabled={loading}>
                {loading ? (
                  <>
                    <span className="lp-spinner" />
                    Please wait…
                  </>
                ) : (
                  <>
                    {isLogin ? "Sign in to AstraFleet" : "Submit for admin approval"}
                    <IconArrow />
                  </>
                )}
              </button>

              <div className="lp-trust-strip">
                <IconShield size={14} />
                Protected by encrypted, role-based access
              </div>
            </form>
          </div>

          <footer className="lp-footer">
            <span>© {new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Europe/London" }).format(new Date())} AstraFleet TMS. All rights reserved.</span>
            <span className="lp-footer-credit">
              Built by <strong>Devmora Technology</strong>
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
