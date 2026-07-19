"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import "./student.css"

type Tab = "home" | "profile" | "results" | "forms" | "more"

type User = {
  id: number
  email: string
  role: string
  display_name: string
  reg_no: string | null
  force_password_change?: boolean
  requires_setup?: boolean
  is_demo?: boolean
}

type Student = {
  reg_no?: string
  name?: string
  dept?: string
  year?: string | null
  cgpa?: string | null
  att?: string | null
  father?: string | null
  extra?: Record<string, unknown>
}

type ResultRow = {
  id: number
  reg: string
  name: string
  branch: string
  sem: string
  session: string
  sgpa: number | null
  result: string
  subjects?: Array<{
    name: string
    code: string
    internal: number
    external: number
    credits: number
    grade: string
  }>
}

type FormRow = {
  id: number
  title: string
  description?: string
  status: string
  submitted_by_me?: boolean
  fields?: unknown
  created_at?: string
}

type CertRow = {
  id: number
  cert_type?: string
  status?: string
  req_code?: string
  created_at?: string
  remarks?: string
}

type NoticeRow = {
  id: number
  title: string
  body?: string
  priority?: string
  created_at?: string
}

type AcmCert = {
  id: number
  cert_kind?: string
  reg_no?: string
  student_name?: string
  cert_no?: string
  issued_on?: string
  sent_to_student?: boolean
}

async function api<T = unknown>(
  path: string,
  opts?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(opts?.body ? { "Content-Type": "application/json" } : {}),
        ...(opts?.headers || {}),
      },
      ...opts,
    })
    const data = (await res.json().catch(() => null)) as T & { error?: string }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: null,
        error: (data && (data as { error?: string }).error) || `Request failed (${res.status})`,
      }
    }
    return { ok: true, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: null, error: "Network error. Check your connection." }
  }
}

function initials(name?: string | null) {
  const p = String(name || "?").trim().split(/\s+/).filter(Boolean)
  if (!p.length) return "?"
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase()
  return (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  } catch {
    return String(iso)
  }
}

function statusBadge(status?: string) {
  const s = String(status || "").toLowerCase()
  if (["ready", "collected", "approved", "pass", "open"].includes(s)) return "stu-badge-ok"
  if (["pending", "processing", "partial"].includes(s)) return "stu-badge-warn"
  if (["rejected", "fail", "closed"].includes(s)) return "stu-badge-err"
  return "stu-badge-info"
}

/** True when a cert request is ready for the student to collect / print. */
function isCertReady(status?: string) {
  const s = String(status || "").toLowerCase().trim()
  return s === "ready" || s.includes("ready") || s === "ready for collection"
}

function isPhotoKey(key: string) {
  return /profile\s*photo|^photo$|profilephoto/i.test(String(key || "").trim())
}

function isDataImage(v: unknown): v is string {
  return typeof v === "string" && v.indexOf("data:image/") === 0
}

/** Prefer Profile Photo from students.extra (base64 data URL). */
function extractProfilePhoto(extra?: Record<string, unknown> | null): string | null {
  if (!extra || typeof extra !== "object") return null
  const preferred = ["Profile Photo", "profile_photo", "ProfilePhoto", "photo", "Photo"]
  for (const k of preferred) {
    const v = extra[k]
    if (isDataImage(v)) return v
  }
  for (const [k, v] of Object.entries(extra)) {
    if (isPhotoKey(k) && isDataImage(v)) return v
  }
  for (const v of Object.values(extra)) {
    if (isDataImage(v)) return v
  }
  return null
}

function formatFieldValue(v: unknown): string {
  if (v == null || String(v).trim() === "") return "—"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

export default function StudentApp() {
  const [booting, setBooting] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [tab, setTab] = useState<Tab>("home")
  const [moreView, setMoreView] = useState<"menu" | "certs" | "notices" | "attendance" | "password">("menu")

  // Login form
  const [loginId, setLoginId] = useState("")
  const [loginPw, setLoginPw] = useState("")
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginErr, setLoginErr] = useState("")

  // Setup form
  const [setupEmail, setSetupEmail] = useState("")
  const [setupCurPw, setSetupCurPw] = useState("")
  const [setupNewPw, setSetupNewPw] = useState("")
  const [setupNewPw2, setSetupNewPw2] = useState("")
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupErr, setSetupErr] = useState("")
  const [setupOk, setSetupOk] = useState("")

  // Data
  const [student, setStudent] = useState<Student | null>(null)
  const [results, setResults] = useState<ResultRow[]>([])
  const [forms, setForms] = useState<FormRow[]>([])
  const [certs, setCerts] = useState<CertRow[]>([])
  const [acmCerts, setAcmCerts] = useState<AcmCert[]>([])
  const [notices, setNotices] = useState<NoticeRow[]>([])
  const [dataErr, setDataErr] = useState("")
  const [dataLoading, setDataLoading] = useState(false)

  // Change password (app)
  const [pwCur, setPwCur] = useState("")
  const [pwNew, setPwNew] = useState("")
  const [pwNew2, setPwNew2] = useState("")
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState("")
  const [pwOk, setPwOk] = useState("")

  const requiresSetup = !!(user?.force_password_change || user?.requires_setup)
  const profilePhoto = useMemo(() => extractProfilePhoto(student?.extra || null), [student])
  const readyCerts = useMemo(
    () => certs.filter((c) => isCertReady(c.status)),
    [certs],
  )

  const loadDashboard = useCallback(async () => {
    setDataLoading(true)
    setDataErr("")
    const [s, r, f, c, a, n] = await Promise.all([
      api<{ students: Student[] }>("/api/students"),
      api<{ results: ResultRow[] }>("/api/results"),
      api<{ forms: FormRow[] }>("/api/forms"),
      api<{ requests: CertRow[] }>("/api/cert-requests"),
      api<{ certificates?: AcmCert[] }>("/api/acm-certs?kind=mine"),
      api<{ notices: NoticeRow[] }>("/api/notices"),
    ])
    if (s.ok && s.data?.students?.[0]) setStudent(s.data.students[0])
    else setStudent(null)
    if (r.ok && Array.isArray(r.data?.results)) setResults(r.data.results)
    else setResults([])
    if (f.ok && Array.isArray(f.data?.forms)) setForms(f.data.forms)
    else setForms([])
    if (c.ok && Array.isArray(c.data?.requests)) setCerts(c.data.requests)
    else setCerts([])
    if (a.ok && Array.isArray(a.data?.certificates)) setAcmCerts(a.data.certificates)
    else setAcmCerts([])
    if (n.ok && Array.isArray(n.data?.notices)) setNotices(n.data.notices.slice(0, 20))
    else setNotices([])
    if (!s.ok && s.status === 401) setDataErr("Session expired. Please sign in again.")
    setDataLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const me = await api<{ user: User | null; requires_setup?: boolean }>("/api/auth/me")
      if (cancelled) return
      if (me.ok && me.data?.user) {
        const u = me.data.user
        if (u.role !== "student") {
          // Staff should use the main CMS portal
          setUser(null)
        } else {
          setUser({
            ...u,
            requires_setup: !!(u.force_password_change || me.data.requires_setup || u.requires_setup),
          })
        }
      }
      setBooting(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (user && !requiresSetup) {
      loadDashboard()
    }
  }, [user, requiresSetup, loadDashboard])

  async function doLogin() {
    setLoginErr("")
    if (!loginId.trim() || !loginPw) {
      setLoginErr("Enter register number (or email) and password.")
      return
    }
    setLoginBusy(true)
    const res = await api<{ user: User; requires_setup?: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: loginId.trim(), password: loginPw }),
    })
    setLoginBusy(false)
    if (!res.ok || !res.data?.user) {
      setLoginErr(res.error || "Login failed")
      return
    }
    const u = res.data.user
    if (u.role !== "student") {
      await api("/api/auth/logout", { method: "POST", body: "{}" })
      setLoginErr("This app is for students only. Staff should use the main portal.")
      return
    }
    setLoginPw("")
    setUser({
      ...u,
      requires_setup: !!(u.force_password_change || res.data.requires_setup || u.requires_setup),
    })
    setSetupCurPw("")
    setTab("home")
  }

  async function doSetup() {
    setSetupErr("")
    setSetupOk("")
    if (!setupEmail.trim() || !setupCurPw || !setupNewPw) {
      setSetupErr("Fill email, current password, and new password.")
      return
    }
    if (setupNewPw.length < 8) {
      setSetupErr("New password must be at least 8 characters.")
      return
    }
    if (setupNewPw !== setupNewPw2) {
      setSetupErr("New passwords do not match.")
      return
    }
    setSetupBusy(true)
    const res = await api<{ user: User; message?: string }>("/api/auth/complete-setup", {
      method: "POST",
      body: JSON.stringify({
        email: setupEmail.trim(),
        currentPassword: setupCurPw,
        newPassword: setupNewPw,
      }),
    })
    setSetupBusy(false)
    if (!res.ok || !res.data?.user) {
      setSetupErr(res.error || "Setup failed")
      return
    }
    setSetupOk(res.data.message || "Setup complete")
    setUser({
      ...res.data.user,
      requires_setup: false,
      force_password_change: false,
    })
    setSetupCurPw("")
    setSetupNewPw("")
    setSetupNewPw2("")
  }

  async function doLogout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" })
    setUser(null)
    setStudent(null)
    setResults([])
    setForms([])
    setCerts([])
    setAcmCerts([])
    setTab("home")
    setMoreView("menu")
  }

  async function doChangePassword() {
    setPwErr("")
    setPwOk("")
    if (!pwCur || !pwNew) {
      setPwErr("Enter current and new password.")
      return
    }
    if (pwNew.length < 8) {
      setPwErr("New password must be at least 8 characters.")
      return
    }
    if (pwNew !== pwNew2) {
      setPwErr("New passwords do not match.")
      return
    }
    setPwBusy(true)
    const res = await api<{ ok?: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: pwCur, newPassword: pwNew }),
    })
    setPwBusy(false)
    if (!res.ok) {
      setPwErr(res.error || "Could not change password")
      return
    }
    setPwOk("Password updated successfully.")
    setPwCur("")
    setPwNew("")
    setPwNew2("")
    if (user) {
      setUser({ ...user, force_password_change: false, requires_setup: false })
    }
  }

  const openForms = useMemo(
    () => forms.filter((f) => String(f.status).toLowerCase() === "open"),
    [forms],
  )
  const pendingForms = openForms.filter((f) => !f.submitted_by_me)

  if (booting) {
    return <div className="stu-loading">Loading student app…</div>
  }

  // ---- Login ----
  if (!user) {
    return (
      <div className="stu-auth">
        <div className="stu-auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/college-logo.png" alt="GPT Hubli" onError={(e) => {
            ;(e.target as HTMLImageElement).src = "/images/gpt-logo.png"
          }} />
          <div>
            <h1>Government Polytechnic Hubli</h1>
            <p>Student mobile app</p>
          </div>
        </div>
        <div className="stu-auth-card">
          <h2>Student sign in</h2>
          <p className="sub">
            Use your <strong>Register Number</strong> and password. First-time login uses the temporary password
            given by the college — then you must set your own email and password.
          </p>
          {loginErr ? <div className="stu-msg stu-msg-err">{loginErr}</div> : null}
          <div className="stu-field">
            <label>Register No. / Email</label>
            <input
              autoComplete="username"
              placeholder="e.g. 171CS15003"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
            />
          </div>
          <div className="stu-field">
            <label>Password</label>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Enter password"
              value={loginPw}
              onChange={(e) => setLoginPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
            />
          </div>
          <button type="button" className="stu-btn stu-btn-primary" disabled={loginBusy} onClick={doLogin}>
            {loginBusy ? "Signing in…" : "Sign in"}
          </button>
        </div>
        <div className="stu-auth-foot">
          Staff / Admin? Use the{" "}
          <a href="/">main portal</a>
        </div>
      </div>
    )
  }

  // ---- First-time setup (OTP-less) ----
  if (requiresSetup) {
    return (
      <div className="stu-auth">
        <div className="stu-auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/college-logo.png" alt="GPT Hubli" onError={(e) => {
            ;(e.target as HTMLImageElement).src = "/images/gpt-logo.png"
          }} />
          <div>
            <h1>Complete your account</h1>
            <p>{user.display_name} · {user.reg_no || "Student"}</p>
          </div>
        </div>
        <div className="stu-auth-card">
          <h2>Update email &amp; password</h2>
          <p className="sub">
            First login is complete. You <strong>must</strong> set a personal email and a new password before using
            the app. Use a real email you can access.
          </p>
          <div className="stu-msg stu-msg-info">
            Temporary / current login email on file: <strong>{user.email}</strong>
          </div>
          {setupErr ? <div className="stu-msg stu-msg-err">{setupErr}</div> : null}
          {setupOk ? <div className="stu-msg stu-msg-ok">{setupOk}</div> : null}
          <div className="stu-field">
            <label>Your email ID</label>
            <input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={setupEmail}
              onChange={(e) => setSetupEmail(e.target.value)}
            />
          </div>
          <div className="stu-field">
            <label>Current (temporary) password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={setupCurPw}
              onChange={(e) => setSetupCurPw(e.target.value)}
            />
          </div>
          <div className="stu-field">
            <label>New password (min 8 characters)</label>
            <input
              type="password"
              autoComplete="new-password"
              value={setupNewPw}
              onChange={(e) => setSetupNewPw(e.target.value)}
            />
          </div>
          <div className="stu-field">
            <label>Confirm new password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={setupNewPw2}
              onChange={(e) => setSetupNewPw2(e.target.value)}
            />
          </div>
          <button type="button" className="stu-btn stu-btn-primary" disabled={setupBusy} onClick={doSetup}>
            {setupBusy ? "Saving…" : "Save & continue"}
          </button>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="stu-btn stu-btn-ghost" onClick={doLogout}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---- Main shell ----
  return (
    <div className="stu-app">
      <header className="stu-topbar">
        <div>
          <h1>
            {tab === "home" && "Dashboard"}
            {tab === "profile" && "My Profile"}
            {tab === "results" && "Results"}
            {tab === "forms" && "Forms"}
            {tab === "more" && (
              moreView === "menu"
                ? "More"
                : moreView === "certs"
                  ? "Certificates"
                  : moreView === "notices"
                    ? "Notices"
                    : moreView === "password"
                      ? "Change Password"
                      : "Attendance"
            )}
          </h1>
          <div className="meta">
            {user.display_name}
            {user.reg_no ? ` · ${user.reg_no}` : ""}
          </div>
        </div>
        <div className="stu-avatar" title={user.email}>
          {profilePhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profilePhoto} alt="" />
          ) : (
            initials(user.display_name)
          )}
        </div>
      </header>

      <main className="stu-main">
        {dataErr ? <div className="stu-msg stu-msg-err">{dataErr}</div> : null}

        {tab === "home" && (
          <>
            {/* Notify only when a requested certificate is ready */}
            {readyCerts.length > 0 ? (
              <div className="stu-alert-ready" role="status">
                <h3>🔔 Certificate ready for collection</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {readyCerts.map((c) => (
                    <li key={c.id}>
                      <strong>{c.cert_type || "Certificate"}</strong>
                      {c.req_code ? ` · ${c.req_code}` : ""} — status: {c.status}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="stu-btn stu-btn-primary"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    setTab("more")
                    setMoreView("certs")
                  }}
                >
                  View certificates
                </button>
              </div>
            ) : null}

            <div className="stu-kpis">
              <div className="stu-kpi">
                <div className="label">CGPA</div>
                <div className="value">{student?.cgpa || "—"}</div>
                <div className="hint">From exam records</div>
              </div>
              <div className="stu-kpi">
                <div className="label">Attendance</div>
                <div className="value">{student?.att || "—"}</div>
                <div className="hint">Summary %</div>
              </div>
              <div className="stu-kpi">
                <div className="label">Open forms</div>
                <div className="value">{pendingForms.length}</div>
                <div className="hint">{pendingForms.length ? "Action needed" : "All clear"}</div>
              </div>
              <div className="stu-kpi">
                <div className="label">Ready certs</div>
                <div className="value">{readyCerts.length}</div>
                <div className="hint">{readyCerts.length ? "Collect now" : "None ready"}</div>
              </div>
            </div>

            <div className="stu-section-title">Quick access</div>
            <div className="stu-quick" style={{ marginBottom: 14 }}>
              <button type="button" onClick={() => setTab("results")}>
                <span className="ico">📊</span>
                <span className="t">Results</span>
                <span className="d">{results.length} semester record(s)</span>
              </button>
              <button type="button" onClick={() => setTab("forms")}>
                <span className="ico">📝</span>
                <span className="t">Forms</span>
                <span className="d">{pendingForms.length} pending</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("more")
                  setMoreView("certs")
                }}
              >
                <span className="ico">📜</span>
                <span className="t">Certificates</span>
                <span className="d">{certs.length + acmCerts.length} item(s)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("more")
                  setMoreView("notices")
                }}
              >
                <span className="ico">📢</span>
                <span className="t">Notices</span>
                <span className="d">{notices.length} recent</span>
              </button>
            </div>

            <div className="stu-card">
              <h3>My details</h3>
              {dataLoading && !student ? (
                <div className="stu-empty">Loading…</div>
              ) : (
                <>
                  <div className="stu-row"><span className="k">Name</span><span className="v">{student?.name || user.display_name}</span></div>
                  <div className="stu-row"><span className="k">Reg. No.</span><span className="v">{student?.reg_no || user.reg_no || "—"}</span></div>
                  <div className="stu-row"><span className="k">Branch</span><span className="v">{student?.dept || "—"}</span></div>
                  <div className="stu-row"><span className="k">Year</span><span className="v">{student?.year || "—"}</span></div>
                  <div className="stu-row"><span className="k">Email</span><span className="v">{user.email}</span></div>
                </>
              )}
            </div>

            {notices[0] ? (
              <div className="stu-card">
                <h3>Latest notice</h3>
                <div className="stu-list-item">
                  <div>
                    <div className="title">{notices[0].title}</div>
                    <div className="desc">{notices[0].body || "—"}</div>
                    <div className="desc">{fmtDate(notices[0].created_at)}</div>
                  </div>
                  <span className={`stu-badge ${statusBadge(notices[0].priority)}`}>
                    {notices[0].priority || "notice"}
                  </span>
                </div>
              </div>
            ) : null}
          </>
        )}

        {tab === "profile" && (
          <div className="stu-card">
            <h3>My Profile</h3>
            <div className="stu-photo-wrap">
              {profilePhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="stu-photo" src={profilePhoto} alt="Profile" />
              ) : (
                <div className="stu-photo-ph">{initials(student?.name || user.display_name)}</div>
              )}
              <div style={{ fontSize: "0.78rem", color: "var(--stu-muted)" }}>
                {profilePhoto ? "Profile photo" : "No photo on file"}
              </div>
            </div>
            <div className="stu-row"><span className="k">Name</span><span className="v">{student?.name || user.display_name}</span></div>
            <div className="stu-row"><span className="k">Register No.</span><span className="v">{student?.reg_no || user.reg_no || "—"}</span></div>
            <div className="stu-row"><span className="k">Branch / Dept</span><span className="v">{student?.dept || "—"}</span></div>
            <div className="stu-row"><span className="k">Year</span><span className="v">{student?.year || "—"}</span></div>
            <div className="stu-row"><span className="k">Father</span><span className="v">{student?.father || "—"}</span></div>
            <div className="stu-row"><span className="k">CGPA</span><span className="v">{student?.cgpa || "—"}</span></div>
            <div className="stu-row"><span className="k">Attendance</span><span className="v">{student?.att || "—"}</span></div>
            <div className="stu-row"><span className="k">Email</span><span className="v">{user.email}</span></div>
            {student?.extra && Object.keys(student.extra).filter((k) => k !== "profile_edit_locked").length > 0 ? (
              <>
                <h3 style={{ marginTop: 16 }}>Additional fields</h3>
                {Object.entries(student.extra)
                  .filter(([k, v]) => {
                    if (k === "profile_edit_locked") return false
                    // Never dump base64 photo as text
                    if (isPhotoKey(k) || isDataImage(v)) return false
                    return true
                  })
                  .slice(0, 40)
                  .map(([k, v]) => (
                    <div className="stu-row" key={k}>
                      <span className="k">{k}</span>
                      <span className="v">{formatFieldValue(v)}</span>
                    </div>
                  ))}
              </>
            ) : (
              <p className="stu-empty" style={{ padding: "12px 0 0" }}>
                Full My Profile fields appear after you submit them on the web portal (or when staff imports data).
              </p>
            )}
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="stu-btn stu-btn-ghost"
                onClick={() => {
                  setTab("more")
                  setMoreView("password")
                }}
              >
                🔐 Change password
              </button>
            </div>
          </div>
        )}

        {tab === "results" && (
          <div className="stu-card">
            <h3>Semester results</h3>
            {!results.length ? (
              <div className="stu-empty">No results published yet.</div>
            ) : (
              results.map((r) => (
                <div key={r.id} style={{ marginBottom: 16 }}>
                  <div className="stu-list-item">
                    <div>
                      <div className="title">
                        Sem {r.sem} · {r.session}
                      </div>
                      <div className="desc">{r.branch || student?.dept || ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="title">SGPA {r.sgpa ?? "—"}</div>
                      <span className={`stu-badge ${statusBadge(r.result)}`}>{r.result || "—"}</span>
                    </div>
                  </div>
                  {Array.isArray(r.subjects) && r.subjects.length > 0 ? (
                    <div className="stu-table-wrap" style={{ marginTop: 8 }}>
                      <table className="stu-table">
                        <thead>
                          <tr>
                            <th>Subject</th>
                            <th>Int</th>
                            <th>Ext</th>
                            <th>Gr</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.subjects.map((s, i) => (
                            <tr key={i}>
                              <td>{s.name || s.code || "—"}</td>
                              <td>{s.internal ?? "—"}</td>
                              <td>{s.external ?? "—"}</td>
                              <td>{s.grade || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        )}

        {tab === "forms" && (
          <div className="stu-card">
            <h3>Submit forms</h3>
            {!forms.length ? (
              <div className="stu-empty">No forms available.</div>
            ) : (
              forms.map((f) => (
                <div className="stu-list-item" key={f.id}>
                  <div>
                    <div className="title">{f.title}</div>
                    <div className="desc">{f.description || "No description"}</div>
                    <div className="desc">
                      {f.submitted_by_me ? "You already submitted this form" : "Not submitted yet"}
                      {" · "}
                      {fmtDate(f.created_at)}
                    </div>
                  </div>
                  <span className={`stu-badge ${statusBadge(f.submitted_by_me ? "ready" : f.status)}`}>
                    {f.submitted_by_me ? "Done" : f.status}
                  </span>
                </div>
              ))
            )}
            <p className="stu-empty" style={{ paddingTop: 8 }}>
              To fill multi-field forms, use the full portal on desktop if a form needs complex answers. Status here is live from the server.
            </p>
          </div>
        )}

        {tab === "more" && moreView === "menu" && (
          <>
            {readyCerts.length > 0 ? (
              <div className="stu-alert-ready" role="status">
                <h3>🔔 {readyCerts.length} certificate(s) ready</h3>
                <p style={{ margin: "0 0 8px", fontSize: "0.84rem" }}>
                  Open Certificates to see details for collection.
                </p>
                <button type="button" className="stu-btn stu-btn-primary" onClick={() => setMoreView("certs")}>
                  Open certificates
                </button>
              </div>
            ) : null}
            <div className="stu-quick">
              <button type="button" onClick={() => setMoreView("attendance")}>
                <span className="ico">📅</span>
                <span className="t">Attendance</span>
                <span className="d">Summary from records</span>
              </button>
              <button type="button" onClick={() => setMoreView("certs")}>
                <span className="ico">📜</span>
                <span className="t">Certificates</span>
                <span className="d">
                  {readyCerts.length ? `${readyCerts.length} ready` : `${certs.length} request(s)`}
                </span>
              </button>
              <button type="button" onClick={() => setMoreView("password")}>
                <span className="ico">🔐</span>
                <span className="t">Change password</span>
                <span className="d">Update login password</span>
              </button>
              <button type="button" onClick={() => setMoreView("notices")}>
                <span className="ico">📢</span>
                <span className="t">Notices</span>
                <span className="d">College announcements</span>
              </button>
              <button type="button" onClick={() => loadDashboard()}>
                <span className="ico">🔄</span>
                <span className="t">Refresh data</span>
                <span className="d">Pull latest from server</span>
              </button>
            </div>
            <div className="stu-card" style={{ marginTop: 12 }}>
              <h3>Account</h3>
              <div className="stu-row"><span className="k">Signed in as</span><span className="v">{user.email}</span></div>
              <div className="stu-row"><span className="k">Register No.</span><span className="v">{user.reg_no || "—"}</span></div>
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                <button type="button" className="stu-btn stu-btn-ghost" onClick={() => setMoreView("password")}>
                  🔐 Change password
                </button>
                <button type="button" className="stu-btn stu-btn-danger" onClick={doLogout}>
                  Sign out
                </button>
              </div>
              <p className="stu-empty" style={{ paddingTop: 12 }}>
                Full staff portal: <a href="/">open main site</a>
              </p>
            </div>
          </>
        )}

        {tab === "more" && moreView === "attendance" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <h3>Attendance summary</h3>
            <div className="stu-row"><span className="k">Overall</span><span className="v">{student?.att || "—"}</span></div>
            <p className="stu-empty" style={{ paddingTop: 12 }}>
              Detailed day-wise attendance is managed by faculty. This screen shows the official summary on your student record.
            </p>
          </div>
        )}

        {tab === "more" && moreView === "certs" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <h3>My certificate requests</h3>
            {readyCerts.length > 0 ? (
              <div className="stu-alert-ready" style={{ marginBottom: 12 }}>
                <h3>Ready for collection</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {readyCerts.map((c) => (
                    <li key={`ready-${c.id}`}>
                      <strong>{c.cert_type || "Certificate"}</strong>
                      {c.req_code ? ` · ${c.req_code}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!certs.length ? (
              <div className="stu-empty">No certificate requests yet.</div>
            ) : (
              certs.map((c) => (
                <div className="stu-list-item" key={c.id}>
                  <div>
                    <div className="title">{c.cert_type || "Certificate"}</div>
                    <div className="desc">
                      {c.req_code || `#${c.id}`} · {fmtDate(c.created_at)}
                      {c.remarks ? ` · ${c.remarks}` : ""}
                      {isCertReady(c.status) ? " · Collect from office / ACM" : ""}
                    </div>
                  </div>
                  <span className={`stu-badge ${statusBadge(c.status)}`}>{c.status || "pending"}</span>
                </div>
              ))
            )}
            <h3 style={{ marginTop: 18 }}>Issued to me (ACM)</h3>
            {!acmCerts.length ? (
              <div className="stu-empty">No certificates sent to you yet.</div>
            ) : (
              acmCerts.map((c) => (
                <div className="stu-list-item" key={c.id}>
                  <div>
                    <div className="title">{c.cert_kind || "Certificate"}</div>
                    <div className="desc">
                      {c.cert_no || `#${c.id}`}
                      {c.issued_on ? ` · ${fmtDate(c.issued_on)}` : ""}
                    </div>
                  </div>
                  <span className="stu-badge stu-badge-ok">Issued</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "more" && moreView === "notices" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <h3>College notices</h3>
            {!notices.length ? (
              <div className="stu-empty">No notices right now.</div>
            ) : (
              notices.map((n) => (
                <div className="stu-list-item" key={n.id}>
                  <div>
                    <div className="title">{n.title}</div>
                    <div className="desc">{n.body || ""}</div>
                    <div className="desc">{fmtDate(n.created_at)}</div>
                  </div>
                  <span className={`stu-badge ${statusBadge(n.priority)}`}>{n.priority || "info"}</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "more" && moreView === "password" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <h3>Change password</h3>
            <p className="sub" style={{ margin: "0 0 14px", fontSize: "0.84rem", color: "var(--stu-muted)" }}>
              Update your login password. Minimum 8 characters.
            </p>
            {pwErr ? <div className="stu-msg stu-msg-err">{pwErr}</div> : null}
            {pwOk ? <div className="stu-msg stu-msg-ok">{pwOk}</div> : null}
            <div className="stu-field">
              <label>Current password</label>
              <input
                type="password"
                autoComplete="current-password"
                value={pwCur}
                onChange={(e) => setPwCur(e.target.value)}
              />
            </div>
            <div className="stu-field">
              <label>New password</label>
              <input
                type="password"
                autoComplete="new-password"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
              />
            </div>
            <div className="stu-field">
              <label>Confirm new password</label>
              <input
                type="password"
                autoComplete="new-password"
                value={pwNew2}
                onChange={(e) => setPwNew2(e.target.value)}
              />
            </div>
            <button type="button" className="stu-btn stu-btn-primary" disabled={pwBusy} onClick={doChangePassword}>
              {pwBusy ? "Updating…" : "Update password"}
            </button>
          </div>
        )}
      </main>

      <nav className="stu-nav" aria-label="Student navigation">
        <button type="button" className={tab === "home" ? "act" : ""} onClick={() => setTab("home")}>
          <span className="ico">🏠</span>
          Home
          {readyCerts.length > 0 ? <span className="stu-nav-badge">{readyCerts.length}</span> : null}
        </button>
        <button type="button" className={tab === "profile" ? "act" : ""} onClick={() => setTab("profile")}>
          <span className="ico">👤</span>
          Profile
        </button>
        <button type="button" className={tab === "results" ? "act" : ""} onClick={() => setTab("results")}>
          <span className="ico">📊</span>
          Results
        </button>
        <button type="button" className={tab === "forms" ? "act" : ""} onClick={() => setTab("forms")}>
          <span className="ico">📝</span>
          Forms
        </button>
        <button
          type="button"
          className={tab === "more" ? "act" : ""}
          onClick={() => {
            setTab("more")
            setMoreView("menu")
          }}
        >
          <span className="ico">☰</span>
          More
          {readyCerts.length > 0 ? <span className="stu-nav-badge">{readyCerts.length}</span> : null}
        </button>
      </nav>
    </div>
  )
}
