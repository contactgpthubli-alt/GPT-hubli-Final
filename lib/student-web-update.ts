/**
 * Over-the-air web update for Capacitor APK shells (e.g. v1.3.0).
 * The APK only hosts a WebView to production — no reinstall needed for feature updates.
 * We fetch a cache-busted version JSON and hard-reload when the live site is newer
 * than what this page instance was built with / last loaded.
 */

import { STUDENT_APP_VERSION } from "./student-app-version"

const LOADED_KEY = "gpth_web_loaded_version"
const RELOAD_GUARD_KEY = "gpth_web_reload_once"
const VERSION_URL = "/student-app-version.json"

export type LiveVersionInfo = {
  version: string
  message?: string
}

/** Hard-reload the WebView so students get the latest production build. No APK install. */
export function forceWebAppReload(reason = "update"): void {
  try {
    if ("caches" in window) {
      void caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    }
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href)
  // Drop old bust params, set fresh ones
  url.searchParams.delete("_ts")
  url.searchParams.set("_app_v", STUDENT_APP_VERSION)
  url.searchParams.set("_upd", reason)
  url.searchParams.set("_ts", String(Date.now()))
  // location.replace avoids back-stack to stale page
  window.location.replace(url.toString())
}

export function markWebVersionLoaded(version: string = STUDENT_APP_VERSION): void {
  try {
    localStorage.setItem(LOADED_KEY, version)
  } catch {
    /* ignore */
  }
}

export function getLoadedWebVersion(): string | null {
  try {
    return localStorage.getItem(LOADED_KEY)
  } catch {
    return null
  }
}

/**
 * Fetch live version from server (never from HTTP cache).
 * Returns null on network failure.
 */
export async function fetchLiveAppVersion(): Promise<LiveVersionInfo | null> {
  try {
    const r = await fetch(`${VERSION_URL}?_ts=${Date.now()}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    })
    if (!r.ok) return null
    const data = (await r.json()) as { version?: string; message?: string }
    if (!data?.version) return null
    return { version: String(data.version), message: data.message }
  } catch {
    return null
  }
}

function versionsDiffer(a: string, b: string): boolean {
  return String(a || "").trim() !== String(b || "").trim()
}

/**
 * On cold start: if live version ≠ this JS bundle version, force one hard reload.
 * Prevents infinite loops with a sessionStorage guard (max 1 auto-reload per few minutes).
 * Returns true if a reload was triggered (caller should stop rendering).
 */
export async function ensureLatestWebApp(): Promise<{ reloading: boolean; live?: LiveVersionInfo }> {
  if (typeof window === "undefined") return { reloading: false }

  // Avoid reload loop if we just reloaded
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
    if (last && Date.now() - last < 45_000) {
      // Recently reloaded — accept this bundle
      markWebVersionLoaded(STUDENT_APP_VERSION)
      return { reloading: false }
    }
  } catch {
    /* ignore */
  }

  const live = await fetchLiveAppVersion()
  if (!live) {
    markWebVersionLoaded(STUDENT_APP_VERSION)
    return { reloading: false }
  }

  // If JSON says newer than this built bundle → reload to get new JS from server
  if (versionsDiffer(live.version, STUDENT_APP_VERSION)) {
    forceWebAppReload(`v${live.version}`)
    return { reloading: true, live }
  }

  // Same as bundle: still reload once if we never marked this version (first open after deploy
  // with stale HTTP cache of the HTML shell)
  const loaded = getLoadedWebVersion()
  if (loaded && versionsDiffer(loaded, STUDENT_APP_VERSION)) {
    markWebVersionLoaded(STUDENT_APP_VERSION)
    forceWebAppReload(`loaded-${STUDENT_APP_VERSION}`)
    return { reloading: true, live }
  }

  markWebVersionLoaded(STUDENT_APP_VERSION)
  return { reloading: false, live }
}
