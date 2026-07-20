import type { Metadata, Viewport } from "next"
import Script from "next/script"
import StudentApp from "./student-app"

export const metadata: Metadata = {
  title: "Student App — Government Polytechnic Hubli",
  description:
    "Mobile student portal for Government Polytechnic Hubli — results, attendance, forms, certificates and profile.",
  appleWebApp: {
    capable: true,
    title: "GPT Hubli Student",
    statusBarStyle: "default",
  },
  applicationName: "GPT Hubli Student",
  manifest: "/student-manifest.webmanifest",
}

export const viewport: Viewport = {
  themeColor: "#1a4fa0",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
}

/**
 * Runs before React. Fetches live version JSON (never cached) so old Capacitor
 * APK shells (e.g. v1.3.0) hard-reload once and pick up the latest web app
 * without reinstalling the APK.
 */
const OTA_BOOTSTRAP = `
(function () {
  try {
    var KEY = "gpth_web_loaded_version";
    var GUARD = "gpth_web_reload_once";
    var guard = 0;
    try { guard = Number(sessionStorage.getItem(GUARD) || 0); } catch (e) {}
    if (guard && (Date.now() - guard) < 45000) return;
    fetch("/student-app-version.json?_ts=" + Date.now(), {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.version) return;
        var last = null;
        try { last = localStorage.getItem(KEY); } catch (e2) {}
        if (last === j.version) return;
        try { sessionStorage.setItem(GUARD, String(Date.now())); } catch (e3) {}
        try { localStorage.setItem(KEY, j.version); } catch (e4) {}
        try {
          if (window.caches && caches.keys) {
            caches.keys().then(function (keys) {
              keys.forEach(function (k) { caches.delete(k); });
            });
          }
        } catch (e5) {}
        var u = new URL(location.href);
        u.searchParams.set("_app_v", j.version);
        u.searchParams.set("_ts", String(Date.now()));
        location.replace(u.toString());
      })
      .catch(function () {});
  } catch (e) {}
})();
`

export default function StudentPage() {
  return (
    <>
      <Script id="gpth-ota-bootstrap" strategy="beforeInteractive">
        {OTA_BOOTSTRAP}
      </Script>
      <StudentApp />
    </>
  )
}
