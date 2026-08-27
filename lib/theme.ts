/**
 * Shared light/dark theme helper for the React-rendered pages (CMS login
 * gate, student app). The CMS dashboard (legacy-app.js) and the very first
 * paint (public/cms-boot.js) apply the same [data-theme] contract in plain
 * JS so there's no flash before hydration — keep the storage key and value
 * set ("light" | "dark") in sync with those.
 */

export const THEME_STORAGE_KEY = "gpth_theme"

export type ThemePref = "light" | "dark"

export function getStoredTheme(): ThemePref | null {
  if (typeof window === "undefined") return null
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    return v === "light" || v === "dark" ? v : null
  } catch {
    return null
  }
}

export function getEffectiveTheme(): ThemePref {
  const stored = getStoredTheme()
  if (stored) return stored
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark"
  }
  return "light"
}

export function applyTheme(theme: ThemePref) {
  if (typeof document === "undefined") return
  document.documentElement.setAttribute("data-theme", theme)
}

export function setTheme(theme: ThemePref) {
  applyTheme(theme)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
}

/** Reads the current effective theme and (re-)applies it. Safe to call on every mount. */
export function initTheme(): ThemePref {
  const theme = getEffectiveTheme()
  applyTheme(theme)
  return theme
}
