/**
 * Student mobile app version + changelog.
 * Bump STUDENT_APP_VERSION and add a changelog entry whenever you ship
 * user-visible app changes. The app only shows "What's new" once per version.
 */

export const STUDENT_APP_VERSION = "1.1.0"

export type StudentAppUpdate = {
  version: string
  date: string
  title: string
  items: string[]
}

/** Newest first. Only the current version is auto-shown; full list is in More. */
export const STUDENT_APP_CHANGELOG: StudentAppUpdate[] = [
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
