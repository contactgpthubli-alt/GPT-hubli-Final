/**
 * Student mobile app version + changelog.
 * Bump STUDENT_APP_VERSION and add a changelog entry whenever you ship
 * user-visible app changes. The app only shows "What's new" once per version.
 *
 * Note: Students on older APK shells (e.g. 1.3.0) still load this web app from
 * production. Use More → "Update / refresh app" to force-load the latest web build
 * without reinstalling the APK.
 */

export const STUDENT_APP_VERSION = "1.7.0"

export type StudentAppUpdate = {
  version: string
  date: string
  title: string
  items: string[]
}

/** Newest first. Only the current version is auto-shown; full list is in More. */
export const STUDENT_APP_CHANGELOG: StudentAppUpdate[] = [
  {
    version: "1.7.0",
    date: "2026-08-27",
    title: "Dark mode + smoother mobile app",
    items: [
      "New dark theme — tap the moon/sun icon at the top of the app to switch anytime.",
      "Follows your phone's system theme automatically until you choose one yourself.",
      "Mobile screens, forms, and buttons polished for phones and the Android app.",
    ],
  },
  {
    version: "1.6.2",
    date: "2026-08-19",
    title: "Exam fee reject reason on Fees",
    items: [
      "If Exam Cell deletes a wrong challan submission, Fees shows what is wrong.",
      "You can correct the receipt/amount and submit again after a rejection.",
    ],
  },
  {
    version: "1.6.1",
    date: "2026-08-09",
    title: "App update push — Fees + account fixes live",
    items: [
      "Ship shell APK v1.6.0 (versionCode 8) aligned with live student portal.",
      "Fees: Regular exam, Makeup, Admission + K2 challan submit under More → Fees.",
      "Create Account: diploma Register Number only (no email field).",
      "More → Update / refresh app to load the newest web build instantly.",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-08-09",
    title: "Fees on Android + stricter Create Account",
    items: [
      "More → Fees: Regular exam fees, Makeup fees, Admission fees with live status.",
      "K2 challan guide + multi-receipt submit (same as web portal).",
      "Create Account: email removed; diploma Register Number only (e.g. 171CS25001).",
      "Use More → Update / refresh app to load this build without reinstalling the APK.",
    ],
  },
  {
    version: "1.5.4",
    date: "2026-07-26",
    title: "Survey forms with verification",
    items: [
      "Submit Forms: open surveys + My submissions with pending / verified / rejected.",
      "After verifier (e.g. ACM) approves, download official PDF.",
      "Admin builds forms; chooses audience and verifier desk.",
    ],
  },
  {
    version: "1.5.3",
    date: "2026-07-26",
    title: "Time Table + fixed profile PDF on web",
    items: [
      "More → Time Table — view/download your branch timetable for your study year only.",
      "1st year students see 1st year only; 2nd year see 2nd year only.",
      "Profile PDF download works on web browsers (not only the Android app).",
    ],
  },
  {
    version: "1.5.2",
    date: "2026-07-26",
    title: "Student / Parent choice once per login",
    items: [
      "Choose Student or Parent only on first login — remembered until you log out.",
      "To switch roles, log out and log in again (no prompt every app open).",
      "Absent status-bar alerts when the app is open / returns to screen (true push needs FCM later).",
    ],
  },
  {
    version: "1.5.1",
    date: "2026-07-26",
    title: "A4 profile PDF + reliable status-bar alerts",
    items: [
      "Student Profile PDF is true A4 (210×297 mm) with professional college header layout.",
      "Status-bar notifications use Android NotificationManager + default ringtone (new APK).",
      "Allow Notifications when prompted — required for alert sound.",
      "Install APK v1.5.1 for notification bar + improved PDF.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-07-26",
    title: "System notification bar + PDF Share (new APK)",
    items: [
      "Absent alerts appear in the Android notification bar with the default notification ringtone.",
      "Parent view asks for notification permission (Android 13+).",
      "PDF Download opens native Share / Save sheet (Drive, Files, WhatsApp).",
      "Install the new APK (v1.5.0) for status-bar tone and reliable PDF save.",
    ],
  },
  {
    version: "1.4.4",
    date: "2026-07-26",
    title: "Notifications order, sound & PDF on Android",
    items: [
      "Notifications list shows latest first (newest absent alert on top).",
      "Parent alert sound + vibrate (unlocks on Parent view / Refresh; polls every 25s).",
      "PDF download: Share / Save / in-app preview when Android blocks auto-download.",
      "Use More → Update / refresh app to load this version without reinstalling APK.",
    ],
  },
  {
    version: "1.4.3",
    date: "2026-07-26",
    title: "Parent attendance alerts",
    items: [
      "Parent login prioritizes ward attendance and absent alerts on Home.",
      "Absent notifications use correct date & time (e.g. 26-07-2026 at 3:32 PM).",
      "Short sound when a new absent alert arrives in Parent view.",
      "More → Notifications lists all absent alerts; student vs parent wording is separated.",
    ],
  },
  {
    version: "1.4.2",
    date: "2026-07-21",
    title: "Account approval notification",
    items: [
      "When Admin, Principal, or HOD approves your student account, you get an in-app notification.",
      "The notice shows who approved your account and when.",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-07-20",
    title: "Auto-update without reinstalling APK",
    items: [
      "App checks for new web updates when you open it (works on APK v1.3.0 — no uninstall).",
      "More → Update / refresh app still works anytime.",
      "PDF download and typing fixes from 1.4.0 included.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-07-20",
    title: "PDF download, smoother typing, update button",
    items: [
      "Download profile and certificates as PDF (print removed — more reliable on phone).",
      "Update / refresh app button — get the latest features without reinstalling the APK.",
      "Smoother typing on Android (keyboard no longer zooms/jumps as much).",
      "What's New offers Update now to reload the live app.",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-07-20",
    title: "Mobile print fixed",
    items: [
      "Print opens a full-screen preview on the phone (profile + certificates).",
      "Use Print for the system dialog, or Share / Save if print is blocked.",
      "Works in the Android app WebView where print was previously silent.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-07-20",
    title: "Profile print & clearer updates",
    items: [
      "Print your full student profile on one A4 sheet (Profile → Print).",
      "Create Account from the app (admin approval before login).",
      "Print Study / Studying certificates when ACM releases them.",
      "What's New shows only once after each real app update.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-07-20",
    title: "Print full profile on A4",
    items: [
      "Print your complete student profile on a single A4 sheet from Profile.",
      "Same full-profile print on the website (My Profile).",
      "Includes photo, register number, branch, and all profile fields.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-07-20",
    title: "Create account & certificate print",
    items: [
      "Create Account from the app (pending admin approval before login).",
      "Print Study / Studying certificates when ACM releases them.",
      "Profile updates are sent only when something actually changed.",
      "What's New alert appears only after a real app update.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-07-19",
    title: "Student mobile app",
    items: [
      "Sign in with Register Number and password.",
      "Dashboard, profile, results, forms, certificates, grievances.",
      "First-login email and password setup for imported accounts.",
    ],
  },
]

const STORAGE_KEY = "gpth_student_app_seen_version"

export function getSeenAppVersion(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setSeenAppVersion(version: string = STUDENT_APP_VERSION): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, version)
  } catch {
    /* ignore private mode */
  }
}

/** True when user has not dismissed the current version yet. */
export function shouldShowWhatsNew(): boolean {
  const seen = getSeenAppVersion()
  return seen !== STUDENT_APP_VERSION
}

export function currentUpdate(): StudentAppUpdate | undefined {
  return STUDENT_APP_CHANGELOG.find((u) => u.version === STUDENT_APP_VERSION) || STUDENT_APP_CHANGELOG[0]
}
