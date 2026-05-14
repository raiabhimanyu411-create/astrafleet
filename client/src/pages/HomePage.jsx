import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { updateDriverLocation } from "../api/driverApi";
import { getAuthSession, saveAuthSession } from "../utils/authSession";
import { gpsErrorMessage, positionToPayload, requestDriverGpsAccess } from "../utils/driverGps";

function LogoIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      {/* A shape - left stroke */}
      <path d="M10 44 L26 8 L42 44" stroke="url(#logoGrad)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Crossbar */}
      <line x1="17" y1="32" x2="35" y2="32" stroke="url(#logoGrad)" strokeWidth="4.5" strokeLinecap="round" />
      {/* Stars */}
      <circle cx="39" cy="14" r="2.2" fill="#93c5fd" />
      <circle cx="44" cy="20" r="1.4" fill="#bfdbfe" />
      <circle cx="43" cy="10" r="1" fill="#60a5fa" />
      {/* Wave arcs bottom right */}
      <path d="M32 40 Q36 37 40 40" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <path d="M34 44 Q38 41 42 44" stroke="#3b82f6" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function TruckIllustration() {
  return (
    <svg viewBox="0 0 580 210" fill="none" xmlns="http://www.w3.org/2000/svg" className="truck-svg">
      {/* Ground shadow */}
      <ellipse cx="290" cy="196" rx="260" ry="8" fill="rgba(0,0,0,0.3)" />

      {/* Road */}
      <rect x="0" y="188" width="580" height="22" rx="0" fill="rgba(0,0,0,0.25)" />
      {/* Road dashes */}
      {[40, 100, 160, 220, 280, 340, 400, 460, 520].map((x) => (
        <rect key={x} x={x} y="197" width="40" height="4" rx="2" fill="rgba(255,255,255,0.12)" />
      ))}

      {/* ── Trailer ── */}
      {/* Trailer main body */}
      <rect x="22" y="78" width="358" height="108" rx="5" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
      {/* Trailer top highlight */}
      <rect x="22" y="78" width="358" height="8" rx="5" fill="rgba(255,255,255,0.08)" />
      {/* Trailer bottom rail */}
      <rect x="22" y="174" width="358" height="6" rx="2" fill="rgba(255,255,255,0.14)" />
      {/* Trailer ribs */}
      {[70, 116, 162, 208, 254, 300, 346].map((x) => (
        <line key={x} x1={x} y1="86" x2={x} y2="180" stroke="rgba(255,255,255,0.07)" strokeWidth="1.5" />
      ))}
      {/* Trailer rear door */}
      <rect x="24" y="80" width="28" height="102" rx="2" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
      {/* Rear door handle */}
      <rect x="33" y="126" width="10" height="4" rx="2" fill="rgba(255,255,255,0.3)" />

      {/* ── Hitch / Kingpin connector ── */}
      <rect x="374" y="120" width="24" height="30" rx="3" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      <rect x="380" y="144" width="12" height="12" rx="2" fill="rgba(255,255,255,0.12)" />

      {/* ── Cab ── */}
      {/* Cab main body */}
      <path
        d="M396 186 L396 88 Q398 70 418 62 L490 62 Q508 62 516 74 L524 88 L524 186 Z"
        fill="rgba(255,255,255,0.11)"
        stroke="rgba(255,255,255,0.24)"
        strokeWidth="1.5"
      />
      {/* Cab top highlight */}
      <path d="M418 63 Q445 58 490 62 Q508 62 516 74 L510 68 Q502 62 490 63 Q460 59 418 63 Z" fill="rgba(255,255,255,0.08)" />

      {/* Windshield */}
      <path
        d="M490 64 L516 78 L516 118 L490 110 Z"
        fill="rgba(147,197,253,0.18)"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1"
      />
      {/* Windshield glare */}
      <path d="M492 66 L508 75 L508 90 L492 83 Z" fill="rgba(255,255,255,0.07)" />

      {/* Cab door */}
      <rect x="398" y="100" width="84" height="76" rx="3" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      {/* Door window */}
      <rect x="402" y="104" width="72" height="38" rx="3" fill="rgba(147,197,253,0.14)" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
      {/* Window frame top */}
      <rect x="402" y="104" width="72" height="4" rx="2" fill="rgba(255,255,255,0.06)" />
      {/* Door handle */}
      <rect x="472" y="146" width="12" height="4" rx="2" fill="rgba(255,255,255,0.28)" />

      {/* Side mirror */}
      <rect x="516" y="72" width="18" height="12" rx="3" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
      <line x1="518" y1="78" x2="516" y2="78" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />

      {/* Exhaust stack */}
      <rect x="485" y="30" width="8" height="34" rx="4" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
      <ellipse cx="489" cy="30" rx="5" ry="3" fill="rgba(255,255,255,0.2)" />
      {/* Exhaust smoke */}
      <ellipse cx="489" cy="22" rx="4" ry="5" fill="rgba(255,255,255,0.04)" />
      <ellipse cx="491" cy="14" rx="3" ry="4" fill="rgba(255,255,255,0.03)" />

      {/* Headlight */}
      <rect x="516" y="106" width="10" height="16" rx="3" fill="rgba(255,245,180,0.55)" stroke="rgba(255,230,100,0.3)" strokeWidth="1" />
      {/* Headlight glow */}
      <ellipse cx="526" cy="114" rx="12" ry="8" fill="rgba(255,240,150,0.1)" />

      {/* Front bumper */}
      <rect x="516" y="154" width="14" height="18" rx="3" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
      {/* Grille bars */}
      {[158, 163, 168].map((y) => (
        <line key={y} x1="518" y1={y} x2="528" y2={y} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      ))}

      {/* Running boards */}
      <rect x="398" y="180" width="124" height="6" rx="2" fill="rgba(255,255,255,0.14)" />

      {/* ── Wheels ── */}
      {/* Rear trailer wheel group */}
      {[82, 130].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="188" r="22" fill="rgba(15,25,45,0.95)" stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
          <circle cx={cx} cy="188" r="14" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
          <circle cx={cx} cy="188" r="8" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
          <circle cx={cx} cy="188" r="3" fill="rgba(255,255,255,0.25)" />
          {[0, 60, 120, 180, 240, 300].map((angle) => {
            const rad = (angle * Math.PI) / 180;
            return (
              <line
                key={angle}
                x1={cx + 4 * Math.cos(rad)}
                y1={188 + 4 * Math.sin(rad)}
                x2={cx + 12 * Math.cos(rad)}
                y2={188 + 12 * Math.sin(rad)}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="1.2"
              />
            );
          })}
        </g>
      ))}

      {/* Front trailer wheel group */}
      {[248, 296].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="188" r="22" fill="rgba(15,25,45,0.95)" stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
          <circle cx={cx} cy="188" r="14" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
          <circle cx={cx} cy="188" r="8" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
          <circle cx={cx} cy="188" r="3" fill="rgba(255,255,255,0.25)" />
        </g>
      ))}

      {/* Cab rear wheel */}
      <circle cx="420" cy="188" r="22" fill="rgba(15,25,45,0.95)" stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
      <circle cx="420" cy="188" r="14" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
      <circle cx="420" cy="188" r="8" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
      <circle cx="420" cy="188" r="3" fill="rgba(255,255,255,0.25)" />

      {/* Cab front wheel */}
      <circle cx="498" cy="188" r="22" fill="rgba(15,25,45,0.95)" stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
      <circle cx="498" cy="188" r="14" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
      <circle cx="498" cy="188" r="8" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
      <circle cx="498" cy="188" r="3" fill="rgba(255,255,255,0.25)" />
    </svg>
  );
}

function IconFleet() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <rect x="2" y="10" width="18" height="12" rx="2" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
      <path d="M20 14 L24 14 L26 17 L26 22 L20 22 Z" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      <circle cx="7" cy="23" r="2.5" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
      <circle cx="15" cy="23" r="2.5" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
      <circle cx="23" cy="23" r="2.5" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

function IconRoute() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <circle cx="7" cy="8" r="3" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
      <circle cx="21" cy="20" r="3" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
      <path d="M7 11 C7 18 14 10 21 17" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function IconBox() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M14 3 L24 8 L24 20 L14 25 L4 20 L4 8 Z" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      <path d="M14 3 L14 25" stroke="rgba(147,197,253,0.9)" strokeWidth="1.4" strokeDasharray="2 2" />
      <path d="M4 8 L14 13 L24 8" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <rect x="4" y="16" width="5" height="9" rx="1.5" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
      <rect x="11.5" y="10" width="5" height="15" rx="1.5" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
      <rect x="19" y="5" width="5" height="20" rx="1.5" stroke="rgba(147,197,253,0.9)" strokeWidth="1.6" fill="none" />
      <path d="M4 4 L4 26 L26 26" stroke="rgba(147,197,253,0.5)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="#64748b" strokeWidth="1.3" />
      <ellipse cx="8" cy="8" rx="3" ry="6.5" stroke="#64748b" strokeWidth="1.3" />
      <line x1="1.5" y1="8" x2="14.5" y2="8" stroke="#64748b" strokeWidth="1.3" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 5 L7 9 L11 5" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPerson() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
      <circle cx="8.5" cy="5.5" r="3" stroke="#94a3b8" strokeWidth="1.4" fill="none" />
      <path d="M2 15 C2 11.5 5 9.5 8.5 9.5 C12 9.5 15 11.5 15 15" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
      <rect x="3" y="8" width="11" height="8" rx="2" stroke="#94a3b8" strokeWidth="1.4" fill="none" />
      <path d="M5.5 8 L5.5 5.5 C5.5 3.57 6.57 2 8.5 2 C10.43 2 11.5 3.57 11.5 5.5 L11.5 8" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <circle cx="8.5" cy="12" r="1.2" fill="#94a3b8" />
    </svg>
  );
}

function IconEye({ show, onClick }) {
  return (
    <button type="button" className="eye-btn" onClick={onClick} tabIndex={-1}>
      {show ? (
        <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
          <path d="M1 8.5 C3 5 5.5 3 8.5 3 C11.5 3 14 5 16 8.5 C14 12 11.5 14 8.5 14 C5.5 14 3 12 1 8.5 Z" stroke="#94a3b8" strokeWidth="1.4" fill="none" />
          <circle cx="8.5" cy="8.5" r="2.2" stroke="#94a3b8" strokeWidth="1.4" fill="none" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
          <path d="M1 8.5 C3 5 5.5 3 8.5 3 C11.5 3 14 5 16 8.5" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          <path d="M2 13 L14 4" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M7 13.7 C7.5 13.9 8 14 8.5 14 C11.5 14 14 12 16 8.5" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </svg>
      )}
    </button>
  );
}

function IconLogin() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M7 3 H3 C2.4 3 2 3.4 2 4 V14 C2 14.6 2.4 15 3 15 H7" stroke="white" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M12 6 L16 9 L12 12" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="6" y1="9" x2="16" y2="9" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}


const features = [
  { Icon: IconFleet, label: "Fleet\nManagement" },
  { Icon: IconRoute, label: "Trip & Route\nOptimization" },
  { Icon: IconBox, label: "Load & Order\nManagement" },
  { Icon: IconChart, label: "Real-time\nVisibility" },
];

export function HomePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const session = getAuthSession();

    if (session?.role === "admin") {
      navigate("/admin", { replace: true });
    } else if (session?.role === "driver") {
      navigate("/driver", { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/api/auth/login", { email, password });

      if (data.role === "driver") {
        try {
          const position = await requestDriverGpsAccess();
          await updateDriverLocation(data.id, positionToPayload(position));
        } catch (gpsError) {
          setError(gpsErrorMessage(gpsError));
          return;
        }
      }

      saveAuthSession({ id: data.id, name: data.name, role: data.role });
      navigate(data.role === "admin" ? "/admin" : "/driver");
    } catch (err) {
      setError(err.response?.data?.error || "Unable to connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lp-page">
      <div className="lp-card">
        {/* ── Left dark panel ── */}
        <div className="lp-left">
          <div className="lp-left-inner">
            {/* Brand */}
            <div className="lp-brand">
              <LogoIcon />
              <div>
                <h2 className="lp-brand-name">AstraFleet</h2>
                <span className="lp-brand-sub">FLEET TMS</span>
              </div>
            </div>

            {/* Tagline */}
            <div className="lp-tagline">
              <h1>Smarter Logistics.<br />Stronger Business.</h1>
              <p>Streamline operations, optimize fleet performance and deliver more.</p>
            </div>

            {/* Truck */}
            <div className="lp-truck">
              <TruckIllustration />
            </div>

            {/* Features */}
            <div className="lp-features">
              {features.map(({ Icon, label }, i) => (
                <div className="lp-feature" key={i}>
                  <Icon />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right light panel ── */}
        <div className="lp-right">
          {/* Language */}
          <div className="lp-lang">
            <IconGlobe />
            <span>English</span>
            <IconChevron />
          </div>

          <div className="lp-form-wrap">
            <div className="lp-form-head">
              <h1>Welcome Back</h1>
              <p>Login to your AstraFleet TMS account</p>
            </div>

            <form className="lp-form" onSubmit={handleSubmit}>
              {/* Email */}
              <div className="lp-field">
                <label>Email Address</label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon"><IconPerson /></span>
                  <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="lp-field">
                <label>Password</label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon"><IconLock /></span>
                  <input
                    type={showPass ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <IconEye show={showPass} onClick={() => setShowPass(!showPass)} />
                </div>
              </div>

              {/* Forgot */}
              <div className="lp-forgot">
                <a href="#">Forgot Password?</a>
              </div>

              {error && <p className="lp-error">{error}</p>}

              {/* Login btn */}
              <button type="submit" className="lp-login-btn" disabled={loading}>
                <IconLogin />
                {loading ? "Logging in…" : "Login"}
              </button>
            </form>
          </div>

          <footer className="lp-footer">
            <span>© 2025 AstraFleet. All rights reserved.</span>
            <span className="lp-footer-credit">
              Designed and developed by <strong>Devmora Technology</strong>
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
