"use client"

import { useEffect, useState } from "react"
import { Loader2, Moon, Sun } from "lucide-react"
import styles from "./cms-login-gate.module.css"
import { type ThemePref, getEffectiveTheme, initTheme, setTheme } from "@/lib/theme"

export default function CmsLoginGate() {
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [theme, setThemeState] = useState<ThemePref>("light")

  useEffect(() => {
    setThemeState(initTheme())
  }, [])

  function toggleTheme() {
    const next: ThemePref = getEffectiveTheme() === "dark" ? "light" : "dark"
    setTheme(next)
    setThemeState(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const id = identifier.trim()
    if (!id || !password) {
      setError("Enter username / register number and password.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: id, password }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError((data && data.error) || `Login failed (HTTP ${res.status})`)
        setBusy(false)
        return
      }
      if (!data || !data.user) {
        setError("Login failed — no user returned.")
        setBusy(false)
        return
      }
      // Hard reload: hands off to the existing dashboard boot pipeline for the
      // now-authenticated session, unchanged.
      window.location.assign("/")
    } catch {
      setError("Network error. Please try again.")
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.themeToggle}
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <div className={styles.bg} aria-hidden="true">
        <img
          className={styles.bgImg}
          src="/images/campus-building.jpg"
          alt=""
          decoding="async"
          fetchPriority="high"
          width={1600}
          height={734}
        />
        <div className={styles.bgOverlay} />
      </div>
      <div className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.cardHd}>
            <img
              className={styles.logo}
              src="/images/college-logo.png"
              alt="Government Polytechnic Hubballi"
              width={96}
              height={96}
            />
            <h1>Government Polytechnic Hubballi</h1>
            <p>
              Management Information System
              <br />
              Dept. of Technical Education, Karnataka · Estd. 2009
            </p>
            <div className={styles.badge}>Secure CMS Login</div>
          </div>
          <div className={styles.cardBd}>
            <form onSubmit={handleSubmit} autoComplete="off">
              <div className={styles.field}>
                <label htmlFor="cmsLoginId">Username / Register No. / Email</label>
                <input
                  id="cmsLoginId"
                  name="gpth_login_id"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  placeholder="Register number, username, or email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="cmsLoginPw">Password</label>
                <input
                  id="cmsLoginPw"
                  name="gpth_login_pw"
                  type="password"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className={styles.errorMsg} role="alert">
                {error}
              </div>
              <button type="submit" className={styles.submit} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 size={16} className={styles.spin} aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  "Sign in →"
                )}
              </button>
            </form>
            <div className={styles.foot}>
              Private portal — authorised users only.
              <br />
              <a href="/student" style={{ display: "inline-block", margin: "6px 0 2px", fontWeight: 700 }}>
                📱 Open Student Mobile App
              </a>
              <br />
              <a href="/?legacy=1">New here? Create account</a>
              <br />
              <span style={{ display: "inline-block", marginTop: 10, fontSize: "0.72rem", opacity: 0.9 }}>
                Developed by <strong>Akshay Uppar</strong>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
