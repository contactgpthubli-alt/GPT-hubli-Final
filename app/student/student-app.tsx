"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { buildStudyCertPrintHtml, formFromAcmCert, downloadStudyCertPdf } from "@/lib/study-cert-print"
import {
  buildStudentProfilePrintHtml,
  downloadStudentProfilePdf,
} from "@/lib/student-profile-print"
import {
  STUDENT_APP_CHANGELOG,
  STUDENT_APP_VERSION,
  currentUpdate,
  setSeenAppVersion,
  shouldShowWhatsNew,
} from "@/lib/student-app-version"
import { ensureLatestWebApp, forceWebAppReload } from "@/lib/student-web-update"
import {
  ensureNativeNotificationChannel,
  isNativeAndroid,
  showNativeNotification,
} from "@/lib/native-android"
import { isValidStudentRegNo, normalizeStudentRegNo } from "@/lib/student-reg-no"
import { type ThemePref, getEffectiveTheme, initTheme, setTheme } from "@/lib/theme"
import { StudentFeesPanel } from "./student-fees-panel"
import "./student.css"

type Tab = "home" | "profile" | "results" | "forms" | "more"
type AuthMode = "login" | "register"
type MoreView =
  | "menu"
  | "certs"
  | "notices"
  | "attendance"
  | "password"
  | "grievances"
  | "certRequest"
  | "formFill"
  | "whatsNew"
  | "notifications"
  | "timetable"
  | "fees"

type PortalMode = "student" | "parent"

type User = {
  id: number
  email: string
  role: string
  display_name: string
  reg_no: string | null
  force_password_change?: boolean
  requires_setup?: boolean
  is_demo?: boolean
  is_alumni?: boolean
  read_only_portal?: boolean
  academic?: {
    year_label?: string
    academic_status?: string
    admission_academic_year?: string | null
    current_study_year?: number | null
    is_alumni?: boolean
    read_only_portal?: boolean
    pass_out_academic_year?: string | null
    active_academic_year?: string
  } | null
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
  academic_status?: string
  is_alumni?: boolean
  read_only_portal?: boolean
  admission_academic_year?: string | null
  current_study_year?: number | null
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
  edit_request_status?: string | null
  subjects?: Array<{
    name: string
    code: string
    internal: number | null
    external: number | null
    credits: number
    grade: string
  }>
}

type FormField = {
  id?: string
  type?: string
  question?: string
  label?: string
  required?: boolean
  options?: string[]
}

type FormRow = {
  id: number
  title: string
  description?: string
  status: string
  submitted_by_me?: boolean
  fields?: unknown
  created_at?: string
  audience?: string
  verify_role?: string
  my_response?: {
    id?: number
    status?: string
    submitted_at?: string
    verified_at?: string | null
    verified_by_name?: string | null
    verifier_note?: string | null
  } | null
}

type CertRow = {
  id: number
  cert_type?: string
  status?: string
  req_code?: string
  created_at?: string
  remarks?: string
  routed_to?: string
}

type AppNotif = {
  id: string
  title: string
  desc: string
  time?: string
  unread?: boolean
  kind?: string
  created_at?: string | null
  sort_ts?: number
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
  cert_no?: string
  issued_on?: string
  reg_no?: string
  student_name?: string
  father_name?: string
  mother_name?: string
  branch?: string
  photo?: string
  form_data?: unknown
  printed_at?: string
  sent_to_student_at?: string
  status?: string
}

type Grievance = {
  id: number
  subject?: string
  category?: string
  description?: string
  expectation?: string
  status?: string
  resolution?: string
  created_at?: string
}

type SchemaField = {
  id?: string
  label: string
  type?: string
  options?: string[]
  editable?: boolean
  required?: boolean
  value?: string
}

type SchemaSection = {
  id?: string
  title?: string
  visible?: boolean
  fields?: SchemaField[]
}

const CERT_TYPES = [
  "Study Certificate",
  "Studying Certificate",
  "Transfer Certificate",
  "NOC",
  "PDC",
  "Provisional Degree Certificate",
] as const

const YEAR_OPTIONS = ["1st Year", "2nd Year", "3rd Year", "Completed", "Lateral Entry"]
const BRANCH_OPTIONS = [
  "Civil Engineering",
  "Computer Science and Engineering",
  "Electronics and Communication Engineering",
  "Mechanical Engineering",
]
const GRIEVANCE_CATS = [
  "Academic",
  "Hostel",
  "Harassment",
  "Infrastructure",
  "Fees / Accounts",
  "Other",
]

const DEFAULT_SCHEMA: SchemaSection[] = [
  {
    title: "Academic Information",
    visible: true,
    fields: [
      { label: "Current Year", type: "select", options: YEAR_OPTIONS, editable: true },
      { label: "Branch", type: "select", options: BRANCH_OPTIONS, editable: true },
      { label: "Register Number", type: "text", editable: false },
    ],
  },
  {
    title: "Personal Details",
    visible: true,
    fields: [
      { label: "Student (As per SSLC)", type: "text", editable: true },
      { label: "Student (As per Aadhar)", type: "text", editable: true },
      { label: "Father Name", type: "text", editable: true },
      { label: "Mother Name", type: "text", editable: true },
      { label: "Date of Birth", type: "text", editable: true },
      { label: "Gender", type: "select", options: ["Male", "Female", "Other"], editable: true },
      { label: "Home Address", type: "textarea", editable: true },
    ],
  },
  {
    title: "Identity & Contact",
    visible: true,
    fields: [
      { label: "Aadhar Number", type: "text", editable: true },
      { label: "APAAR ID", type: "text", editable: true },
      { label: "Category", type: "text", editable: true },
      { label: "Religion", type: "text", editable: true },
      { label: "Student Mobile", type: "text", editable: true },
      { label: "Parent Mobile", type: "text", editable: true },
      { label: "Email", type: "text", editable: true },
    ],
  },
]

async function api<T = unknown>(
  path: string,
  opts?: Omit<RequestInit, "body"> & { body?: unknown },
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const { body, ...requestOptions } = opts || {}
    const res = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(opts?.headers || {}),
      },
      ...requestOptions,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
  if (["ready", "collected", "approved", "pass", "resolved"].includes(s)) return "stu-badge-ok"
  if (["pending", "processing", "partial", "open"].includes(s)) return "stu-badge-warn"
  if (["rejected", "fail", "closed"].includes(s)) return "stu-badge-err"
  return "stu-badge-info"
}

function isCertReady(status?: string) {
  const s = String(status || "").toLowerCase().trim()
  return s === "ready" || s.includes("ready")
}

function isPhotoKey(key: string) {
  return /profile\s*photo|^photo$|profilephoto/i.test(String(key || "").trim())
}

function isDataImage(v: unknown): v is string {
  return typeof v === "string" && v.indexOf("data:image/") === 0
}

function extractProfilePhoto(extra?: Record<string, unknown> | null): string | null {
  if (!extra || typeof extra !== "object") return null
  for (const k of ["Profile Photo", "profile_photo", "ProfilePhoto", "photo", "Photo"]) {
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

function parseFormFields(fields: unknown): FormField[] {
  let raw: unknown = fields
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((f) => f && typeof f === "object")
    .map((f) => f as FormField)
    .filter((f) => String(f.type || "").toLowerCase() !== "section")
}

function fieldLabel(f: FormField) {
  return String(f.question || f.label || f.id || "Question").trim() || "Question"
}

function compressImage(file: File, maxW = 480, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read image"))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxW / Math.max(img.width, 1))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Canvas not supported"))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL("image/jpeg", quality))
      }
      img.onerror = () => reject(new Error("Invalid image"))
      img.src = String(reader.result || "")
    }
    reader.readAsDataURL(file)
  })
}

function isLockedField(label: string) {
  const l = label.toLowerCase()
  return l.includes("register number") || l === "reg no" || l === "reg_no"
}

/** Persisted until logout — only asked once per login account. */
const PORTAL_MODE_KEY = "gpth_portal_mode"
const PORTAL_MODE_USER_KEY = "gpth_portal_mode_user"

function readSavedPortalMode(userId?: number | null): PortalMode | null {
  try {
    const mode = localStorage.getItem(PORTAL_MODE_KEY)
    const uid = localStorage.getItem(PORTAL_MODE_USER_KEY)
    if ((mode === "student" || mode === "parent") && (!userId || !uid || String(userId) === uid)) {
      // If user id stored and matches (or no id yet), restore
      if (userId && uid && String(userId) !== uid) return null
      return mode
    }
  } catch {
    /* ignore */
  }
  return null
}

function savePortalMode(mode: PortalMode, userId?: number | null) {
  try {
    localStorage.setItem(PORTAL_MODE_KEY, mode)
    if (userId) localStorage.setItem(PORTAL_MODE_USER_KEY, String(userId))
  } catch {
    /* ignore */
  }
}

function clearPortalMode() {
  try {
    localStorage.removeItem(PORTAL_MODE_KEY)
    localStorage.removeItem(PORTAL_MODE_USER_KEY)
    sessionStorage.removeItem(PORTAL_MODE_KEY)
  } catch {
    /* ignore */
  }
}

/** Idle auto-logout: 20 minutes without real user activity. */
const IDLE_MS = 20 * 60 * 1000
const IDLE_TOUCH_THROTTLE_MS = 60 * 1000

export default function StudentApp() {
  const [booting, setBooting] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [theme, setThemeState] = useState<ThemePref>("light")

  useEffect(() => {
    setThemeState(initTheme())
  }, [])

  const toggleTheme = useCallback(() => {
    const next: ThemePref = getEffectiveTheme() === "dark" ? "light" : "dark"
    setTheme(next)
    setThemeState(next)
  }, [])
  const idleLastActivityRef = useRef(Date.now())
  const idleLastTouchRef = useRef(0)
  const idleLogoutLockRef = useRef(false)
  const [tab, setTab] = useState<Tab>("home")
  const [moreView, setMoreView] = useState<MoreView>("menu")
  /** After login: choose Student vs Parent view (same credentials). */
  const [portalMode, setPortalMode] = useState<PortalMode | null>(null)
  const [needPortalChoice, setNeedPortalChoice] = useState(false)

  const [authMode, setAuthMode] = useState<AuthMode>("login")
  const [loginId, setLoginId] = useState("")
  const [loginPw, setLoginPw] = useState("")
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginErr, setLoginErr] = useState("")

  // Create account (no email — register number only, same as web portal)
  const [regName, setRegName] = useState("")
  const [regNo, setRegNo] = useState("")
  const [regBranch, setRegBranch] = useState(BRANCH_OPTIONS[0])
  const [regPw, setRegPw] = useState("")
  const [regPw2, setRegPw2] = useState("")
  const [regBusy, setRegBusy] = useState(false)
  const [regErr, setRegErr] = useState("")
  const [regOk, setRegOk] = useState("")

  // What's new (only when version changes)
  const [showWhatsNew, setShowWhatsNew] = useState(false)

  const [setupEmail, setSetupEmail] = useState("")
  const [setupCurPw, setSetupCurPw] = useState("")
  const [setupNewPw, setSetupNewPw] = useState("")
  const [setupNewPw2, setSetupNewPw2] = useState("")
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupErr, setSetupErr] = useState("")
  const [setupOk, setSetupOk] = useState("")

  const [student, setStudent] = useState<Student | null>(null)
  const [results, setResults] = useState<ResultRow[]>([])
  const [resultEditId, setResultEditId] = useState<number | null>(null)
  const [resultEditDraft, setResultEditDraft] = useState<ResultRow | null>(null)
  const [resultEditBusy, setResultEditBusy] = useState(false)
  const [resultEditMessage, setResultEditMessage] = useState("")
  const [forms, setForms] = useState<FormRow[]>([])
  const [certs, setCerts] = useState<CertRow[]>([])
  const [acmCerts, setAcmCerts] = useState<AcmCert[]>([])
  const [notices, setNotices] = useState<NoticeRow[]>([])
  const [grievances, setGrievances] = useState<Grievance[]>([])
  const [schema, setSchema] = useState<SchemaSection[]>(DEFAULT_SCHEMA)
  const [profilePending, setProfilePending] = useState(false)
  const [dataErr, setDataErr] = useState("")
  const [dataLoading, setDataLoading] = useState(false)
  const [toast, setToast] = useState("")
  const [appNotifs, setAppNotifs] = useState<AppNotif[]>([])

  // Profile edit
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileDraft, setProfileDraft] = useState<Record<string, string>>({})
  const [profilePhotoDraft, setProfilePhotoDraft] = useState<string | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileMsg, setProfileMsg] = useState("")
  const [profileErr, setProfileErr] = useState("")

  // Password
  const [pwCur, setPwCur] = useState("")
  const [pwNew, setPwNew] = useState("")
  const [pwNew2, setPwNew2] = useState("")
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState("")
  const [pwOk, setPwOk] = useState("")

  // Cert request
  const [certType, setCertType] = useState<string>(CERT_TYPES[0])
  const [certPurpose, setCertPurpose] = useState("")
  const [certReason, setCertReason] = useState("")
  const [certNote, setCertNote] = useState("")
  const [certBusy, setCertBusy] = useState(false)
  const [certErr, setCertErr] = useState("")
  const [certOk, setCertOk] = useState("")
  const [printBusyId, setPrintBusyId] = useState<number | null>(null)

  // Form fill
  const [activeForm, setActiveForm] = useState<FormRow | null>(null)
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({})
  const [formBusy, setFormBusy] = useState(false)
  const [formErr, setFormErr] = useState("")

  // Grievance
  const [gSubject, setGSubject] = useState("")
  const [gCategory, setGCategory] = useState(GRIEVANCE_CATS[0])
  const [gDesc, setGDesc] = useState("")
  const [gExpect, setGExpect] = useState("")
  const [gBusy, setGBusy] = useState(false)
  const [gErr, setGErr] = useState("")
  const [gOk, setGOk] = useState("")

  // Time table (own branch + study year only)
  type TimetableRow = {
    id: number
    branch?: string
    study_year?: number
    file_name?: string
    mime_type?: string
    updated_at?: string
    uploaded_by_name?: string
    file_data?: string
  }
  const [ttLoading, setTtLoading] = useState(false)
  const [ttErr, setTtErr] = useState("")
  const [ttRow, setTtRow] = useState<TimetableRow | null>(null)
  const [ttMeta, setTtMeta] = useState<{ branch?: string | null; study_year?: number | null }>({})
  const [ttOpenBusy, setTtOpenBusy] = useState(false)

  const requiresSetup = !!(user?.force_password_change || user?.requires_setup)
  const profilePhoto = useMemo(() => {
    if (profilePhotoDraft) return profilePhotoDraft
    return extractProfilePhoto(student?.extra || null)
  }, [student, profilePhotoDraft])
  const readyCerts = useMemo(() => certs.filter((c) => isCertReady(c.status)), [certs])
  const accountApprovedNotif = useMemo(
    () =>
      appNotifs.find(
        (n) =>
          n.unread !== false &&
          (n.kind === "account_approved" ||
            (n.title || "").toLowerCase().includes("account approved")),
      ) || null,
    [appNotifs],
  )
  /** Newest-first sort key for notifications */
  const notifSortTs = (n: AppNotif): number => {
    if (typeof n.sort_ts === "number" && Number.isFinite(n.sort_ts) && n.sort_ts > 0) return n.sort_ts
    if (n.created_at) {
      const t = new Date(n.created_at).getTime()
      if (Number.isFinite(t)) return t
    }
    // id like un-123 — higher id is usually newer
    const m = String(n.id || "").match(/(\d+)/)
    if (m) return Number(m[1])
    return 0
  }

  /** Absent alerts — always newest first (parent prefers parent-kind). */
  const absentNotifs = useMemo(() => {
    const isAbsent = (n: AppNotif) =>
      n.kind === "attendance_absent" ||
      n.kind === "attendance_absent_parent" ||
      (n.title || "").toLowerCase().includes("absent")
    let list = appNotifs.filter(isAbsent)
    if (portalMode === "parent") {
      // Prefer ward/parent wording; drop pure student-kind when parent row exists
      const parentRows = list.filter(
        (n) =>
          n.kind === "attendance_absent_parent" ||
          (n.title || "").toLowerCase().includes("ward"),
      )
      if (parentRows.length) list = parentRows
    } else if (portalMode === "student") {
      list = list.filter((n) => n.kind !== "attendance_absent_parent")
    }
    return [...list].sort((a, b) => notifSortTs(b) - notifSortTs(a)).slice(0, 20)
  }, [appNotifs, portalMode])

  /** All notifications for the list — newest first, mode-filtered */
  const sortedAppNotifs = useMemo(() => {
    return [...appNotifs]
      .filter((n) => {
        if (portalMode === "parent" && n.kind === "attendance_absent") return false
        if (portalMode === "student" && n.kind === "attendance_absent_parent") return false
        return true
      })
      .sort((a, b) => notifSortTs(b) - notifSortTs(a))
  }, [appNotifs, portalMode])

  const unreadAppNotifs = useMemo(() => {
    return sortedAppNotifs.filter((n) => n.unread).slice(0, 8)
  }, [sortedAppNotifs])
  const profileLocked = useMemo(() => {
    const extra = student?.extra || {}
    return extra.profile_edit_locked === true || extra.profile_edit_locked === "true"
  }, [student])
  /** First-time fill: open until student/staff marks profile_first_filled (import seed lock must not block). */
  const profileFirstTime = useMemo(() => {
    const extra = (student?.extra || {}) as Record<string, unknown>
    if (extra.profile_first_filled === true || extra.profile_first_filled === "true") return false
    const importSeed = !!(
      extra.imported_from_dte_pdf === true ||
      extra.imported_from_dte_pdf === "true" ||
      extra.imported_from_excel === true ||
      extra.imported_from_excel === "true" ||
      extra.imported_missing_ece ||
      extra["Temporary Reg No"] === true ||
      extra["Temporary Reg No"] === "true"
    )
    // Legacy staff lock without import seed = already reviewed
    if (profileLocked && !importSeed) return false
    return true
  }, [student, profileLocked])
  const openForms = useMemo(
    () => forms.filter((f) => String(f.status).toLowerCase() === "open"),
    [forms],
  )
  const pendingForms = openForms.filter((f) => !f.submitted_by_me)

  /** Shared AudioContext — must be resumed after a user gesture on Android WebView. */
  const audioCtxRef = useRef<AudioContext | null>(null)

  function unlockNotifyAudio() {
    try {
      const AC =
        typeof window !== "undefined"
          ? window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : null
      if (!AC) return null
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AC()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === "suspended") {
        void ctx.resume()
      }
      return ctx
    } catch {
      return null
    }
  }

  /** Short double-beep + vibrate for new absent alerts (in-app fallback). */
  function playAbsentNotifySound() {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate([120, 60, 180])
        } catch {
          /* ignore */
        }
      }
      const ctx = unlockNotifyAudio()
      if (!ctx) return
      const play = () => {
        try {
          const beep = (freq: number, start: number, dur: number, gain = 0.22) => {
            const o = ctx.createOscillator()
            const g = ctx.createGain()
            o.type = "sine"
            o.frequency.value = freq
            g.gain.value = 0.0001
            o.connect(g)
            g.connect(ctx.destination)
            const t0 = ctx.currentTime + start
            g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02)
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
            o.start(t0)
            o.stop(t0 + dur + 0.03)
          }
          // Louder triple chime so parents notice on phone speakers
          beep(880, 0, 0.16, 0.28)
          beep(1175, 0.2, 0.18, 0.28)
          beep(1319, 0.42, 0.22, 0.24)
        } catch {
          /* ignore */
        }
      }
      if (ctx.state === "suspended") {
        void ctx.resume().then(play).catch(play)
      } else {
        play()
      }
    } catch {
      /* autoplay / unsupported — ignore */
    }
  }

  /** System notification bar + default Android notification ringtone (APK). */
  async function fireSystemAbsentAlert(n: AppNotif) {
    const title = n.title || "Your ward is Absent"
    const body = (n.desc || "Absent mark recorded. Open GPT Hubli Student app.").slice(0, 240)
    const idMatch = String(n.id || "").match(/(\d+)/)
    const nid = idMatch ? Number(idMatch[1]) : undefined
    const ok = await showNativeNotification({
      title,
      body,
      id: nid,
      channelId: "gpth_attendance",
    })
    // Always also play in-app sound as backup when app is foreground
    playAbsentNotifySound()
    return ok
  }

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(""), 3200)
  }

  const buildDraftFromStudent = useCallback(
    (stu: Student | null, u: User | null, sections: SchemaSection[]) => {
      const extra = (stu?.extra && typeof stu.extra === "object" ? stu.extra : {}) as Record<
        string,
        unknown
      >
      const draft: Record<string, string> = {}
      const seed: Record<string, string> = {
        "Register Number": String(stu?.reg_no || u?.reg_no || ""),
        Branch: String(stu?.dept || ""),
        "Current Year": String(stu?.year || ""),
        "Father Name": String(stu?.father || ""),
        "Student (As per SSLC)": String(stu?.name || u?.display_name || ""),
        Email: String(u?.email || ""),
      }
      for (const [k, v] of Object.entries(extra)) {
        if (k === "profile_edit_locked" || isPhotoKey(k) || isDataImage(v)) continue
        if (v == null) continue
        draft[k] = String(v)
      }
      for (const [k, v] of Object.entries(seed)) {
        if (v && !draft[k]) draft[k] = v
      }
      // Ensure every schema label has a key
      for (const sec of sections) {
        for (const f of sec.fields || []) {
          if (!f?.label) continue
          if (draft[f.label] == null) draft[f.label] = ""
        }
      }
      return draft
    },
    [],
  )

  const loadDashboard = useCallback(async () => {
    setDataLoading(true)
    setDataErr("")
    const [s, r, f, c, a, n, pr, sch, g, notif, exam] = await Promise.all([
      api<{ students: Student[] }>("/api/students"),
      api<{ results: ResultRow[] }>("/api/results"),
      api<{ forms: FormRow[] }>("/api/forms"),
      api<{ requests: CertRow[] }>("/api/cert-requests"),
      api<{ certificates?: AcmCert[] }>("/api/acm-certs?kind=mine"),
      api<{ notices: NoticeRow[] }>("/api/notices"),
      api<{ pending?: unknown[]; mine_pending?: number }>("/api/profile-requests?mine=1"),
      api<{ schema?: SchemaSection[] | null }>("/api/profile-schema?key=student"),
      api<{ grievances: Grievance[] }>("/api/grievances"),
      api<{ notifications?: AppNotif[] }>("/api/notifications"),
      api<{ cgpa?: string | null }>("/api/exam/attempts"),
    ])

    let nextStudent: Student | null = null
    if (s.ok && s.data?.students?.[0]) nextStudent = s.data.students[0]
    // Live C-20 CGPA from exam results (grade points × credits)
    if (exam.ok && exam.data?.cgpa && nextStudent) {
      nextStudent = { ...nextStudent, cgpa: String(exam.data.cgpa) }
    } else if (exam.ok && exam.data?.cgpa && !nextStudent) {
      /* ignore */
    }
    setStudent(nextStudent)

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
    if (g.ok && Array.isArray(g.data?.grievances)) setGrievances(g.data.grievances)
    else setGrievances([])
    if (notif.ok && Array.isArray(notif.data?.notifications)) {
      setAppNotifs(notif.data.notifications)
    } else {
      setAppNotifs([])
    }

    const pending =
      (pr.ok && typeof pr.data?.mine_pending === "number" && pr.data.mine_pending > 0) ||
      (pr.ok && Array.isArray(pr.data?.pending) && pr.data.pending.length > 0)
    setProfilePending(!!pending)

    let nextSchema = DEFAULT_SCHEMA
    if (sch.ok && Array.isArray(sch.data?.schema) && sch.data.schema.length) {
      nextSchema = sch.data.schema.filter((sec) => sec && sec.visible !== false)
    }
    setSchema(nextSchema)

    // refresh draft when not actively editing
    setProfileDraft((prev) => {
      if (profileEditing && Object.keys(prev).length) return prev
      return buildDraftFromStudent(nextStudent, user, nextSchema)
    })

    if (!s.ok && s.status === 401) setDataErr("Session expired. Please sign in again.")
    setDataLoading(false)
  }, [buildDraftFromStudent, profileEditing, user])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Auto-pull latest web app for old APK shells (v1.3.0 etc.) — no reinstall
      try {
        const upd = await ensureLatestWebApp()
        if (upd.reloading) return // page will navigate away
      } catch {
        /* continue offline / failed version check */
      }
      if (cancelled) return

      const me = await api<{ user: User | null; requires_setup?: boolean }>("/api/auth/me")
      if (cancelled) return
      if (me.ok && me.data?.user) {
        const u = me.data.user
        if (u.role !== "student") setUser(null)
        else {
          setUser({
            ...u,
            requires_setup: !!(u.force_password_change || me.data.requires_setup || u.requires_setup),
          })
          // Restore Student/Parent choice (saved until logout). Ask only if never chosen.
          const saved = readSavedPortalMode(u.id)
          if (saved) {
            setPortalMode(saved)
            setNeedPortalChoice(false)
          } else {
            setPortalMode(null)
            setNeedPortalChoice(true)
          }
        }
      }
      setBooting(false)
      // Show What's New only after a real version bump (once per version)
      if (!cancelled && shouldShowWhatsNew()) {
        setShowWhatsNew(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function submitResultEditRequest() {
    if (!resultEditDraft || resultEditId == null) return
    setResultEditBusy(true)
    setResultEditMessage("")
    const response = await api("/api/result-edit-requests", {
      method: "POST",
      body: { result_id: resultEditId, proposed: resultEditDraft },
    })
    setResultEditBusy(false)
    if (!response.ok) {
      setResultEditMessage(response.error || "Could not submit result edit request")
      return
    }
    setResultEditMessage("Edit request sent to HOD for approval.")
    setResultEditId(null)
    setResultEditDraft(null)
    setResults((current) => current.map((item) => item.id === resultEditId ? { ...item, edit_request_status: "pending" } : item))
  }

  useEffect(() => {
    if (user && !requiresSetup) loadDashboard()
  }, [user, requiresSetup, loadDashboard])

  // 20-minute idle auto-logout (student mobile + web)
  useEffect(() => {
    if (!user) return

    idleLastActivityRef.current = Date.now()
    idleLastTouchRef.current = 0
    idleLogoutLockRef.current = false

    let cancelled = false

    async function forceIdleLogout() {
      if (cancelled || idleLogoutLockRef.current) return
      idleLogoutLockRef.current = true
      try {
        await api("/api/auth/logout", { method: "POST", body: "{}" })
      } catch {
        /* ignore */
      }
      clearPortalMode()
      setUser(null)
      setPortalMode(null)
      setNeedPortalChoice(false)
      setStudent(null)
      setResults([])
      setForms([])
      setCerts([])
      setAcmCerts([])
      setGrievances([])
      setAppNotifs([])
      setProfileEditing(false)
      setActiveForm(null)
      setTab("home")
      setMoreView("menu")
      setLoginErr("Session expired after 20 minutes of inactivity. Please sign in again.")
    }

    function noteActivity() {
      if (cancelled) return
      idleLastActivityRef.current = Date.now()
      if (Date.now() - idleLastTouchRef.current < IDLE_TOUCH_THROTTLE_MS) return
      idleLastTouchRef.current = Date.now()
      fetch("/api/auth/touch", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: "{}",
      })
        .then((r) => {
          if (r.status === 401) void forceIdleLogout()
        })
        .catch(() => {
          /* network blip */
        })
    }

    function checkIdle() {
      if (cancelled) return
      if (Date.now() - idleLastActivityRef.current >= IDLE_MS) {
        void forceIdleLogout()
      }
    }

    const events: Array<keyof DocumentEventMap> = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "click",
      "wheel",
    ]
    events.forEach((ev) => document.addEventListener(ev, noteActivity, { capture: true, passive: true }))
    const onVis = () => {
      if (document.visibilityState === "visible") checkIdle()
    }
    document.addEventListener("visibilitychange", onVis)
    const timer = window.setInterval(checkIdle, 15000)
    // Align server sliding expiry with this session
    noteActivity()

    // Quiet heartbeat — does not extend idle; only detects dead sessions
    const hb = window.setInterval(() => {
      if (cancelled) return
      if (Date.now() - idleLastActivityRef.current >= IDLE_MS) {
        void forceIdleLogout()
        return
      }
      void fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
        .then(async (r) => {
          const data = await r.json().catch(() => null)
          if (!data?.user) void forceIdleLogout()
        })
        .catch(() => {
          /* ignore */
        })
    }, 45000)

    return () => {
      cancelled = true
      events.forEach((ev) => document.removeEventListener(ev, noteActivity, true))
      document.removeEventListener("visibilitychange", onVis)
      window.clearInterval(timer)
      window.clearInterval(hb)
    }
  }, [user])

  function dismissWhatsNew() {
    setSeenAppVersion(STUDENT_APP_VERSION)
    setShowWhatsNew(false)
  }

  function openWhatsNewHistory() {
    setShowWhatsNew(false)
    setMoreView("whatsNew")
    setTab("more")
  }

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
    setLoginId("")
    setUser({
      ...u,
      requires_setup: !!(u.force_password_change || res.data.requires_setup || u.requires_setup),
    })
    // First login only: ask Student vs Parent if not already saved for this account
    const saved = readSavedPortalMode(u.id)
    if (saved) {
      setPortalMode(saved)
      setNeedPortalChoice(false)
      flash(saved === "parent" ? "Parent view (saved preference)" : "Student view (saved preference)")
    } else {
      setPortalMode(null)
      setNeedPortalChoice(true)
    }
    setTab("home")
  }

  function choosePortalMode(mode: PortalMode) {
    // Unlock WebView audio on this user tap (required on Android)
    unlockNotifyAudio()
    setPortalMode(mode)
    setNeedPortalChoice(false)
    savePortalMode(mode, user?.id)
    flash(
      mode === "parent"
        ? isNativeAndroid()
          ? "Parent view saved. Allow notifications when asked. Logout to switch role later."
          : "Parent view saved. Logout and login again to switch to Student."
        : "Student view saved. Logout and login again to switch to Parent.",
    )
    // Request system notification permission (Android 13+) + default ringtone channel
    if (mode === "parent") {
      void ensureNativeNotificationChannel()
    }
    // Refresh notifications so parent sees latest absent alerts
    void loadDashboard().then(async () => {
      if (mode !== "parent") return
      try {
        const res = await api<{ notifications?: AppNotif[] }>("/api/notifications")
        const list = res.ok && Array.isArray(res.data?.notifications) ? res.data.notifications : []
        const unreadAbsent = list
          .filter(
            (n) =>
              n.unread &&
              (n.kind === "attendance_absent_parent" ||
                n.kind === "attendance_absent" ||
                (n.title || "").toLowerCase().includes("absent")),
          )
          .sort((a, b) => notifSortTs(b) - notifSortTs(a))
        if (unreadAbsent[0]) {
          await fireSystemAbsentAlert(unreadAbsent[0])
        }
      } catch {
        /* ignore */
      }
    })
  }

  // System notification bar + tone when parent view sees a NEW absent alert
  useEffect(() => {
    if (portalMode !== "parent" || !user) return
    const unreadAbsent = [...appNotifs]
      .filter(
        (n) =>
          n.unread &&
          (n.kind === "attendance_absent_parent" ||
            (n.title || "").toLowerCase().includes("ward") ||
            (n.title || "").toLowerCase().includes("absent")),
      )
      .sort((a, b) => notifSortTs(b) - notifSortTs(a))
    if (!unreadAbsent.length) return
    const latest = unreadAbsent[0]
    const latestKey = `${latest.id}:${notifSortTs(latest)}`
    try {
      const key = `gpth_parent_absent_sound_${user.id}`
      const prev = sessionStorage.getItem(key)
      if (prev === latestKey) return
      sessionStorage.setItem(key, latestKey)
      void fireSystemAbsentAlert(latest)
    } catch {
      void fireSystemAbsentAlert(latest)
    }
  }, [portalMode, appNotifs, user])

  // Poll for new absent notifications (status bar + default ringtone on new arrivals)
  useEffect(() => {
    if (portalMode !== "parent" || !user) return
    void ensureNativeNotificationChannel()
    const tick = () => {
      void (async () => {
        try {
          const res = await api<{ notifications?: AppNotif[] }>("/api/notifications")
          if (!res.ok || !Array.isArray(res.data?.notifications)) return
          const next = res.data.notifications
          setAppNotifs((prev) => {
            const prevIds = new Set(prev.map((p) => p.id))
            const prevMax = prev.reduce((m, n) => Math.max(m, notifSortTs(n)), 0)
            const newcomers = next.filter((n) => {
              if (!n.unread) return false
              const isAbs =
                n.kind === "attendance_absent_parent" ||
                n.kind === "attendance_absent" ||
                (n.title || "").toLowerCase().includes("absent")
              if (!isAbs) return false
              return !prevIds.has(n.id) || notifSortTs(n) > prevMax
            })
            if (newcomers.length) {
              const newest = [...newcomers].sort((a, b) => notifSortTs(b) - notifSortTs(a))[0]
              void fireSystemAbsentAlert(newest)
            }
            return next
          })
        } catch {
          /* ignore poll errors */
        }
      })()
    }
    const id = window.setInterval(tick, 20000)
    // Also poll when app returns to foreground
    const onVis = () => {
      if (document.visibilityState === "visible") tick()
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [portalMode, user])

  async function doRegister() {
    setRegErr("")
    setRegOk("")
    const name = regName.trim()
    const regRaw = regNo.trim()
    if (!name || name.length < 2) {
      setRegErr("Enter your full name.")
      return
    }
    if (!isValidStudentRegNo(regRaw)) {
      setRegErr(
        "Enter a valid diploma Register Number (e.g. 171CS25001). Do not enter an email address.",
      )
      return
    }
    const reg = normalizeStudentRegNo(regRaw)
    if (!regBranch) {
      setRegErr("Select your branch.")
      return
    }
    if (regPw.length < 8) {
      setRegErr("Password must be at least 8 characters.")
      return
    }
    if (regPw !== regPw2) {
      setRegErr("Passwords do not match.")
      return
    }
    setRegBusy(true)
    const res = await api<{ ok?: boolean; message?: string; status?: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name,
        password: regPw,
        role: "student",
        regNo: reg,
        branch: regBranch,
      }),
    })
    setRegBusy(false)
    if (!res.ok) {
      setRegErr(res.error || "Could not create account")
      return
    }
    setRegOk(
      res.data?.message ||
        "Account created. An admin must approve your account before you can sign in. Login with Register Number + password.",
    )
    setRegPw("")
    setRegPw2("")
    flash("Registration submitted — wait for admin approval")
  }

  function switchAuthMode(mode: AuthMode) {
    setAuthMode(mode)
    setLoginErr("")
    setRegErr("")
    setRegOk("")
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
    setUser({ ...res.data.user, requires_setup: false, force_password_change: false })
    setSetupCurPw("")
    setSetupNewPw("")
    setSetupNewPw2("")
  }

  async function doLogout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" })
    // Clear portal mode so next login can choose Student or Parent again
    clearPortalMode()
    setUser(null)
    setPortalMode(null)
    setNeedPortalChoice(false)
    setStudent(null)
    setResults([])
    setForms([])
    setCerts([])
    setAcmCerts([])
    setGrievances([])
    setAppNotifs([])
    setProfileEditing(false)
    setActiveForm(null)
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
    const res = await api("/api/auth/change-password", {
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
    if (user) setUser({ ...user, force_password_change: false, requires_setup: false })
  }

  function startProfileEdit() {
    // Students may always raise an edit request (even when view-only / "locked")
    if (portalMode === "parent") {
      setProfileErr("Parent view is read-only. Switch to Student to edit the profile.")
      flash("Parent view is read-only")
      return
    }
    if (profilePending) {
      setProfileErr("You already have an edit request pending approval.")
      return
    }
    setProfileErr("")
    setProfileMsg("")
    setProfileDraft(buildDraftFromStudent(student, user, schema))
    setProfilePhotoDraft(extractProfilePhoto(student?.extra || null))
    setProfileEditing(true)
  }

  function cancelProfileEdit() {
    setProfileEditing(false)
    setProfileErr("")
    setProfileMsg("")
    setProfileDraft(buildDraftFromStudent(student, user, schema))
    setProfilePhotoDraft(null)
  }

  async function onPhotoPick(file: File | null) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setProfileErr("Please choose a JPG or PNG photo.")
      return
    }
    try {
      const dataUrl = await compressImage(file)
      setProfilePhotoDraft(dataUrl)
      setProfileErr("")
    } catch {
      setProfileErr("Could not process photo.")
    }
  }

  async function submitProfileUpdate() {
    if (!user?.reg_no) {
      setProfileErr("Register number missing on account.")
      return
    }
    setProfileBusy(true)
    setProfileErr("")
    setProfileMsg("")

    const prev = buildDraftFromStudent(student, user, schema)
    const prevPhoto = extractProfilePhoto(student?.extra || null)
    const changes: Record<string, string> = {}

    for (const [k, v] of Object.entries(profileDraft)) {
      if (isLockedField(k)) continue
      const next = String(v ?? "").trim()
      const before = String(prev[k] ?? "").trim()
      if (next !== before) changes[k] = next
    }
    if (profilePhotoDraft && profilePhotoDraft !== prevPhoto) {
      changes["Profile Photo"] = profilePhotoDraft
    }

    if (!Object.keys(changes).length) {
      setProfileBusy(false)
      setProfileErr("No changes to submit.")
      return
    }

    const res = await api<{ applied_immediately?: boolean; message?: string; error?: string }>("/api/profile-requests", {
      method: "POST",
      body: JSON.stringify({
        targetType: "student",
        targetId: user.reg_no,
        changes,
        ...(profileFirstTime ? { first_time_save: true } : {}),
      }),
    })
    setProfileBusy(false)
    if (!res.ok) {
      setProfileErr(res.error || "Could not submit profile update")
      return
    }
    if (res.data?.applied_immediately) {
      setProfileMsg(res.data.message || "Profile saved. You can edit again until staff locks the profile.")
      setProfileEditing(false)
      setProfilePending(false)
      setProfilePhotoDraft(null)
      flash("Profile saved")
    } else {
      setProfileMsg("Update submitted. Waiting for Admin/HOD/ACM approval.")
      setProfileEditing(false)
      setProfilePending(true)
      setProfilePhotoDraft(null)
      flash("Profile update submitted for approval")
    }
    await loadDashboard()
  }

  async function submitCertRequest() {
    if (portalMode === "parent") {
      setCertErr("Parent view is read-only. Switch to Student to request certificates.")
      return
    }
    setCertErr("")
    setCertOk("")
    if (!certType) {
      setCertErr("Select a certificate type.")
      return
    }
    if (!certPurpose.trim() && !certReason.trim()) {
      setCertErr("Enter purpose or reason for the certificate.")
      return
    }
    setCertBusy(true)
    const res = await api<{ request?: CertRow }>("/api/cert-requests", {
      method: "POST",
      body: JSON.stringify({
        certType,
        regNo: user?.reg_no || student?.reg_no,
        studentName: student?.name || user?.display_name,
        branch: student?.dept || profileDraft.Branch || "",
        purpose: certPurpose.trim(),
        reason: certReason.trim(),
        remarks: certNote.trim(),
        details: {
          Purpose: certPurpose.trim(),
          Reason: certReason.trim(),
          "Student remarks": certNote.trim(),
        },
      }),
    })
    setCertBusy(false)
    if (!res.ok) {
      setCertErr(res.error || "Could not submit request")
      return
    }
    setCertOk(
      `Request submitted${res.data?.request?.req_code ? ` (${res.data.request.req_code})` : ""}. Status: pending.`,
    )
    setCertPurpose("")
    setCertReason("")
    setCertNote("")
    flash("Certificate request submitted")
    await loadDashboard()
    setMoreView("certs")
  }

  async function downloadIssuedCertPdf(c: AcmCert) {
    setPrintBusyId(c.id)
    try {
      // Prefer profile photo if cert form has no photo
      const profilePhoto = extractProfilePhoto(student?.extra || null)
      const enriched: AcmCert = {
        ...c,
        photo:
          (typeof c.photo === "string" && c.photo.indexOf("data:image/") === 0 ? c.photo : "") ||
          profilePhoto ||
          undefined,
        student_name: c.student_name || student?.name || user?.display_name || "",
        reg_no: c.reg_no || student?.reg_no || user?.reg_no || "",
        branch: c.branch || student?.dept || "",
        father_name: c.father_name || student?.father || "",
      }
      const { kind, form } = formFromAcmCert(enriched)
      if (!form.student_name || !form.reg_no) {
        flash("Certificate details incomplete. Contact ACM.")
        return
      }
      const html = buildStudyCertPrintHtml(kind, form)
      flash("Preparing PDF…")
      await downloadStudyCertPdf(html, form.reg_no)
      flash("PDF ready — use Share / Save if the file did not auto-download")
    } catch {
      flash("Could not create PDF. Try again, or use Share from the preview.")
    } finally {
      setTimeout(() => setPrintBusyId(null), 400)
    }
  }

  async function downloadFullProfilePdf() {
    const extra = (student?.extra && typeof student.extra === "object" ? student.extra : {}) as Record<
      string,
      unknown
    >
    const mother =
      (extra["Mother Name"] != null ? String(extra["Mother Name"]) : "") ||
      (extra["Mother's Name"] != null ? String(extra["Mother's Name"]) : "")
    const reg = student?.reg_no || user?.reg_no || ""
    const profileInput = {
      name: student?.name || user?.display_name || "",
      reg_no: reg,
      branch: student?.dept || String(extra.Branch || profileDraft.Branch || ""),
      year: student?.year || String(extra["Current Year"] || profileDraft["Current Year"] || ""),
      father: student?.father || String(extra["Father Name"] || ""),
      mother,
      email: user?.email || String(extra.Email || extra["Valid E-mail ID"] || ""),
      cgpa: student?.cgpa || null,
      attendance: student?.att || null,
      photo: profilePhoto || extractProfilePhoto(extra),
      fields: {
        ...extra,
        ...profileDraft,
        Email: user?.email || profileDraft.Email || extra.Email,
        "Register Number": reg,
        Branch: student?.dept || profileDraft.Branch || extra.Branch,
      },
    }
    const html = buildStudentProfilePrintHtml(profileInput)
    try {
      flash("Preparing A4 PDF…")
      // Pass structured input so jsPDF builds exact A4 (not blank html2canvas capture)
      await downloadStudentProfilePdf(html, reg, profileInput)
      flash("A4 profile PDF ready — use Share / Save")
    } catch (e) {
      console.error("[profile pdf]", e)
      flash("Could not create profile PDF. Try again.")
    }
  }

  /** Hard-reload production web app so students get updates without reinstalling APK. */
  function refreshAppUpdate() {
    forceWebAppReload("manual")
  }

  function parseStudyYearLoose(v: unknown): number | null {
    if (v === 1 || v === 2 || v === 3) return Number(v)
    const n = Number(v)
    if (n === 1 || n === 2 || n === 3) return n
    const s = String(v ?? "").toLowerCase()
    if (!s) return null
    if (/alumni|pass/.test(s)) return null
    if (/\b3\b|iii|third|3rd/.test(s)) return 3
    if (/\b2\b|ii|second|2nd/.test(s)) return 2
    if (/\b1\b|\bi\b|first|1st/.test(s)) return 1
    return null
  }

  function studyYearLabel(y: number | null | undefined): string {
    if (y === 1) return "1st Year"
    if (y === 2) return "2nd Year"
    if (y === 3) return "3rd Year"
    return "Your year"
  }

  async function loadStudentTimetable() {
    setTtLoading(true)
    setTtErr("")
    try {
      const myYear =
        parseStudyYearLoose(student?.current_study_year) ||
        parseStudyYearLoose(student?.year) ||
        parseStudyYearLoose(user?.academic?.current_study_year) ||
        parseStudyYearLoose(user?.academic?.year_label)
      const branch = student?.dept || ""
      let url = "/api/timetables"
      const qs: string[] = []
      if (branch) qs.push(`branch=${encodeURIComponent(branch)}`)
      if (myYear) qs.push(`year=${encodeURIComponent(String(myYear))}`)
      qs.push(`_ts=${Date.now()}`)
      url += `?${qs.join("&")}`
      const res = await api<{
        timetables?: TimetableRow[]
        branch?: string | null
        study_year?: number | null
      }>(url)
      if (!res.ok) {
        setTtErr(res.error || "Could not load timetable")
        setTtRow(null)
        return
      }
      const list = Array.isArray(res.data?.timetables) ? res.data.timetables : []
      const year = parseStudyYearLoose(res.data?.study_year) || myYear
      setTtMeta({ branch: res.data?.branch || branch, study_year: year })
      setTtRow(list[0] || null)
    } catch {
      setTtErr("Could not load timetable")
      setTtRow(null)
    } finally {
      setTtLoading(false)
    }
  }

  async function openStudentTimetableFile() {
    if (!ttRow?.id) return
    setTtOpenBusy(true)
    try {
      const res = await api<{ timetable?: TimetableRow }>(
        `/api/timetables?id=${encodeURIComponent(String(ttRow.id))}&include_data=1`,
      )
      const row = res.ok ? res.data?.timetable : null
      if (!row?.file_data) {
        flash(res.error || "File not available")
        return
      }
      const raw = String(row.file_data)
      const m = raw.match(/^data:([^;]+);base64,(.+)$/i)
      const b64 = m ? m[2] : raw
      const mime = m?.[1] || row.mime_type || "application/pdf"
      const bin = atob(b64)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      const blob = new Blob([arr], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = row.file_name || "timetable.pdf"
      a.target = "_blank"
      a.rel = "noopener"
      document.body.appendChild(a)
      a.click()
      a.remove()
      try {
        window.open(url, "_blank")
      } catch {
        /* download is enough */
      }
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url)
        } catch {
          /* ignore */
        }
      }, 120_000)
      flash("Timetable opened")
    } catch {
      flash("Could not open timetable")
    } finally {
      setTtOpenBusy(false)
    }
  }

  function formMyStatus(form: FormRow): string {
    return String(form.my_response?.status || "").toLowerCase()
  }

  function canFillForm(form: FormRow): boolean {
    if (String(form.status).toLowerCase() !== "open") return false
    const st = formMyStatus(form)
    if (st === "pending" || st === "verified") return false
    // rejected or never submitted → can fill
    return true
  }

  function openFormFill(form: FormRow) {
    if (!canFillForm(form)) {
      const st = formMyStatus(form)
      if (st === "pending") flash("Already submitted — pending verification")
      else if (st === "verified") flash("Already verified — download PDF from My submissions")
      else flash("This form is closed")
      return
    }
    setActiveForm(form)
    setFormAnswers({})
    setFormErr("")
    setTab("forms")
    setMoreView("formFill")
  }

  async function submitFormResponse() {
    if (!activeForm) return
    const fields = parseFormFields(activeForm.fields).filter(
      (f) => String(f.type || "").toLowerCase() !== "section",
    )
    for (const f of fields) {
      const key = fieldLabel(f)
      if (f.required && !String(formAnswers[key] || "").trim()) {
        setFormErr(`Please answer: ${key}`)
        return
      }
    }
    setFormBusy(true)
    setFormErr("")
    const res = await api<{ response?: { status?: string } }>(`/api/forms/${activeForm.id}/responses`, {
      method: "POST",
      body: JSON.stringify({ answers: formAnswers }),
    })
    setFormBusy(false)
    if (!res.ok) {
      setFormErr(res.error || "Could not submit form")
      return
    }
    const st = String(res.data?.response?.status || "pending")
    flash(
      st === "verified"
        ? "Submitted and verified — download PDF from My submissions"
        : "Submitted — waiting for verification",
    )
    setActiveForm(null)
    setMoreView("menu")
    setTab("forms")
    await loadDashboard()
  }

  async function downloadVerifiedFormPdf(form: FormRow) {
    const rid = form.my_response?.id
    if (!rid) {
      flash("No submission found")
      return
    }
    try {
      flash("Preparing PDF…")
      const res = await api<{
        response?: {
          id?: number
          answers?: Record<string, unknown>
          status?: string
          submitted_at?: string
          verified_at?: string | null
          verified_by_name?: string | null
          verifier_note?: string | null
          form_title?: string
          form_fields?: unknown
          submitter_name?: string
          submitter_reg?: string
          submitter_email?: string
        }
        form?: { title?: string; description?: string; fields?: unknown }
      }>(`/api/forms/${form.id}/responses?response_id=${encodeURIComponent(String(rid))}`)
      if (!res.ok || !res.data?.response) {
        flash(res.error || "Could not load submission")
        return
      }
      const r = res.data.response
      if (String(r.status).toLowerCase() !== "verified") {
        flash("PDF available only after verification")
        return
      }
      const { downloadFormResponsePdf } = await import("@/lib/form-print")
      await downloadFormResponsePdf({
        form_title: r.form_title || res.data.form?.title || form.title,
        form_description: res.data.form?.description || form.description,
        fields: r.form_fields || res.data.form?.fields || form.fields,
        answers: (r.answers || {}) as Record<string, unknown>,
        submitter_name: r.submitter_name || user?.display_name || "",
        submitter_reg: r.submitter_reg || user?.reg_no || "",
        submitter_email: r.submitter_email || user?.email || "",
        submitted_at: r.submitted_at,
        status: r.status,
        verified_by_name: r.verified_by_name,
        verified_at: r.verified_at,
        verifier_note: r.verifier_note,
      })
      flash("PDF ready")
    } catch (e) {
      console.error("[form pdf]", e)
      flash("Could not create PDF")
    }
  }

  async function submitGrievance() {
    setGErr("")
    setGOk("")
    if (!gSubject.trim() || !gCategory) {
      setGErr("Subject and category are required.")
      return
    }
    if (!gDesc.trim()) {
      setGErr("Please describe the issue.")
      return
    }
    setGBusy(true)
    const res = await api("/api/grievances", {
      method: "POST",
      body: JSON.stringify({
        subject: gSubject.trim(),
        category: gCategory,
        description: gDesc.trim(),
        expectation: gExpect.trim(),
      }),
    })
    setGBusy(false)
    if (!res.ok) {
      setGErr(res.error || "Could not submit grievance")
      return
    }
    setGOk("Grievance submitted to Principal.")
    setGSubject("")
    setGDesc("")
    setGExpect("")
    flash("Grievance submitted")
    await loadDashboard()
  }

  const title = useMemo(() => {
    if (tab === "home") return "Dashboard"
    if (tab === "profile") return profileEditing ? "Edit Profile" : "My Profile"
    if (tab === "results") return "Results"
    if (tab === "forms") {
      if (moreView === "formFill" && activeForm) return activeForm.title
      return "Forms"
    }
    if (tab === "more") {
      if (moreView === "certs") return "Certificates"
      if (moreView === "certRequest") return "Request Certificate"
      if (moreView === "notices") return "Notices"
      if (moreView === "notifications") return "Notifications"
      if (moreView === "attendance") return "Attendance"
      if (moreView === "timetable") return "Time Table"
      if (moreView === "password") return "Change Password"
      if (moreView === "grievances") return "Grievances"
      if (moreView === "whatsNew") return "What's New"
      return "More"
    }
    return "Student"
  }, [tab, moreView, profileEditing, activeForm])

  const whatsNewUpdate = currentUpdate()

  if (booting) return <div className="stu-loading">Loading student app…</div>

  if (!user) {
    return (
      <div className="stu-auth">
        <div className="stu-auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/college-logo.png"
            alt="GPT Hubli"
            onError={(e) => {
              ;(e.target as HTMLImageElement).src = "/images/gpt-logo.png"
            }}
          />
          <div>
            <h1>Government Polytechnic Hubli</h1>
            <p>Student mobile app · v{STUDENT_APP_VERSION}</p>
          </div>
        </div>
        <div className="stu-auth-card">
          <div className="stu-auth-tabs">
            <button
              type="button"
              className={authMode === "login" ? "act" : ""}
              onClick={() => switchAuthMode("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={authMode === "register" ? "act" : ""}
              onClick={() => switchAuthMode("register")}
            >
              Create account
            </button>
          </div>

          {authMode === "login" ? (
            <form
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault()
                void doLogin()
              }}
            >
              <h2>Student sign in</h2>
              <p className="sub">
                Use your <strong>Register Number</strong> and password. Imported students use the temporary password
                until first login setup.
              </p>
              {loginErr ? <div className="stu-msg stu-msg-err">{loginErr}</div> : null}
              <div className="stu-field">
                <label>Register Number</label>
                <input
                  name="gpth_stu_id"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  placeholder="e.g. 171CS25001"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                />
              </div>
              <div className="stu-field">
                <label>Password</label>
                <input
                  type="password"
                  name="gpth_stu_pw"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                />
              </div>
              <button type="submit" className="stu-btn stu-btn-primary" disabled={loginBusy}>
                {loginBusy ? "Signing in…" : "Sign in"}
              </button>
              <p className="stu-auth-switch">
                New student?{" "}
                <button type="button" className="stu-link-btn" onClick={() => switchAuthMode("register")}>
                  Create account
                </button>
              </p>
            </form>
          ) : (
            <>
              <h2>Create student account</h2>
              <p className="sub">
                After you register, a <strong>college admin must approve</strong> your account before you can sign in.
              </p>
              {regErr ? <div className="stu-msg stu-msg-err">{regErr}</div> : null}
              {regOk ? <div className="stu-msg stu-msg-ok">{regOk}</div> : null}
              <div className="stu-field">
                <label>Full name *</label>
                <input
                  autoComplete="name"
                  placeholder="As per SSLC"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
              </div>
              <div className="stu-field">
                <label>Register Number *</label>
                <input
                  autoComplete="off"
                  autoCapitalize="characters"
                  placeholder="e.g. 171CS25001"
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value.toUpperCase())}
                />
                <div style={{ fontSize: "0.72rem", color: "var(--stu-muted)", marginTop: 4 }}>
                  Diploma register number only — not an email address.
                </div>
              </div>
              <div className="stu-field">
                <label>Branch *</label>
                <select value={regBranch} onChange={(e) => setRegBranch(e.target.value)}>
                  {BRANCH_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div className="stu-field">
                <label>Password * (min 8)</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={regPw}
                  onChange={(e) => setRegPw(e.target.value)}
                />
              </div>
              <div className="stu-field">
                <label>Confirm password *</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={regPw2}
                  onChange={(e) => setRegPw2(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doRegister()}
                />
              </div>
              <button type="button" className="stu-btn stu-btn-primary" disabled={regBusy} onClick={doRegister}>
                {regBusy ? "Submitting…" : "Create account"}
              </button>
              {regOk ? (
                <button
                  type="button"
                  className="stu-btn stu-btn-ghost"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    switchAuthMode("login")
                    setLoginId(regNo)
                  }}
                >
                  Go to sign in
                </button>
              ) : (
                <p className="stu-auth-switch">
                  Already have an account?{" "}
                  <button type="button" className="stu-link-btn" onClick={() => switchAuthMode("login")}>
                    Sign in
                  </button>
                </p>
              )}
            </>
          )}
        </div>
        <div className="stu-auth-foot">
          Staff / Admin? Use the <a href="/">main portal</a>
        </div>

        {showWhatsNew && whatsNewUpdate ? (
          <div className="stu-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
            <div className="stu-modal">
              <div className="stu-modal-badge">Update v{whatsNewUpdate.version}</div>
              <h2 id="whats-new-title">What&apos;s new</h2>
              <p className="stu-modal-sub">
                {whatsNewUpdate.title} · {whatsNewUpdate.date}
              </p>
              <ul className="stu-whats-list">
                {whatsNewUpdate.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="stu-actions" style={{ marginTop: 12 }}>
                <button type="button" className="stu-btn stu-btn-primary" onClick={() => { dismissWhatsNew(); refreshAppUpdate() }}>
                  Update now
                </button>
                <button type="button" className="stu-btn stu-btn-ghost" onClick={dismissWhatsNew}>
                  Got it
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const isParentMode = portalMode === "parent"
  const isReadOnlyPortal =
    isParentMode || user.is_alumni || user.read_only_portal || student?.is_alumni

  if (needPortalChoice && user && !requiresSetup) {
    return (
      <div className="stu-auth">
        <div className="stu-auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/college-logo.png"
            alt="GPT Hubli"
            onError={(e) => {
              ;(e.target as HTMLImageElement).src = "/images/gpt-logo.png"
            }}
          />
          <div>
            <h1>Continue as…</h1>
            <p>
              {user.display_name} · {user.reg_no || "Student"}
            </p>
          </div>
        </div>
        <div className="stu-auth-card">
          <h2>Who is using the app?</h2>
          <p className="sub">
            Choose once for this account. Same login works for both. Parents get a read-only view and absent alerts.
            To switch later, <strong>log out and log in again</strong>.
          </p>
          <div className="stu-actions" style={{ flexDirection: "column", gap: 12, marginTop: 16 }}>
            <button type="button" className="stu-btn stu-btn-primary" onClick={() => choosePortalMode("student")}>
              🎓 Student
            </button>
            <button type="button" className="stu-btn stu-btn-ghost" onClick={() => choosePortalMode("parent")}>
              👨‍👩‍👧 Parent / Guardian
            </button>
          </div>
          <p className="stu-auth-switch" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="stu-link-btn"
              onClick={() => {
                void doLogout()
              }}
            >
              Sign out
            </button>
          </p>
        </div>
      </div>
    )
  }

  if (requiresSetup) {
    return (
      <div className="stu-auth">
        <div className="stu-auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/college-logo.png"
            alt="GPT Hubli"
            onError={(e) => {
              ;(e.target as HTMLImageElement).src = "/images/gpt-logo.png"
            }}
          />
          <div>
            <h1>Complete your account</h1>
            <p>
              {user.display_name} · {user.reg_no || "Student"}
            </p>
          </div>
        </div>
        <div className="stu-auth-card">
          <h2>Update email &amp; password</h2>
          <p className="sub">You must set a personal email and new password before using the app.</p>
          <div className="stu-msg stu-msg-info">
            Current login email on file: <strong>{user.email}</strong>
          </div>
          {setupErr ? <div className="stu-msg stu-msg-err">{setupErr}</div> : null}
          {setupOk ? <div className="stu-msg stu-msg-ok">{setupOk}</div> : null}
          <div className="stu-field">
            <label>Your email ID</label>
            <input type="email" value={setupEmail} onChange={(e) => setSetupEmail(e.target.value)} />
          </div>
          <div className="stu-field">
            <label>Current (temporary) password</label>
            <input type="password" value={setupCurPw} onChange={(e) => setSetupCurPw(e.target.value)} />
          </div>
          <div className="stu-field">
            <label>New password (min 8)</label>
            <input type="password" value={setupNewPw} onChange={(e) => setSetupNewPw(e.target.value)} />
          </div>
          <div className="stu-field">
            <label>Confirm new password</label>
            <input type="password" value={setupNewPw2} onChange={(e) => setSetupNewPw2(e.target.value)} />
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

  return (
    <div className="stu-app">
      <header className="stu-topbar">
        <div>
          <h1>{title}</h1>
          <div className="meta">
            {user.display_name}
            {user.reg_no ? ` · ${user.reg_no}` : ""}
            {isParentMode
              ? " · Parent view"
              : user.is_alumni || user.read_only_portal
                ? " · Alumni"
                : user.academic?.year_label
                  ? ` · ${user.academic.year_label}`
                  : student?.year
                    ? ` · ${student.year}`
                    : ""}
          </div>
        </div>
        <button
          type="button"
          className="stu-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
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
        {toast ? <div className="stu-msg stu-msg-ok">{toast}</div> : null}
        {dataErr ? <div className="stu-msg stu-msg-err">{dataErr}</div> : null}

        {isParentMode ? (
          <div className="stu-msg stu-msg-info" role="status">
            <strong>👨‍👩‍👧 Parent / Guardian view (read-only)</strong>
            <p style={{ margin: "6px 0 0", fontSize: "0.88rem", lineHeight: 1.45 }}>
              Focus: your ward&apos;s <strong>attendance</strong> and absent alerts. Profile edits and form submissions
              are disabled. To open as <strong>Student</strong>, log out and log in again, then choose Student.
            </p>
          </div>
        ) : null}

        {/* ---------- HOME ---------- */}
        {tab === "home" && (
          <>
            {/* Parent: attendance is the primary panel */}
            {isParentMode ? (
              <div
                className="stu-card"
                style={{
                  marginBottom: 14,
                  border: "2px solid #1a4fa0",
                  borderRadius: 14,
                  padding: 16,
                  background: "linear-gradient(180deg, #eff6ff 0%, #fff 55%)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1a4fa0", letterSpacing: "0.04em" }}>
                      PRIORITY · ATTENDANCE
                    </div>
                    <h3 style={{ margin: "4px 0 0", color: "#0f2d5c" }}>Ward attendance</h3>
                    <p style={{ margin: "6px 0 0", fontSize: "0.84rem", color: "var(--stu-muted)" }}>
                      {user.display_name}
                      {user.reg_no ? ` · ${user.reg_no}` : ""}
                    </p>
                  </div>
                  <div
                    style={{
                      minWidth: 72,
                      textAlign: "center",
                      background: "#fff",
                      borderRadius: 12,
                      padding: "10px 12px",
                      border: "1px solid #bfdbfe",
                    }}
                  >
                    <div style={{ fontSize: "0.65rem", color: "var(--stu-muted)", fontWeight: 700 }}>TODAY %</div>
                    <div style={{ fontSize: "1.35rem", fontWeight: 800, color: "#1a4fa0" }}>
                      {student?.att || "—"}
                    </div>
                  </div>
                </div>
                {absentNotifs.length > 0 ? (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 10,
                      background: "rgba(254,226,226,0.65)",
                      border: "1px solid #fca5a5",
                    }}
                  >
                    <strong style={{ color: "#991b1b" }}>
                      ⚠️ {absentNotifs.filter((n) => n.unread).length || absentNotifs.length} absent alert
                      {(absentNotifs.filter((n) => n.unread).length || absentNotifs.length) === 1 ? "" : "s"}
                    </strong>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.86rem", lineHeight: 1.45 }}>
                      {absentNotifs.slice(0, 4).map((n) => (
                        <li key={n.id} style={{ marginBottom: 6 }}>
                          <strong>{n.title}</strong>
                          {n.desc ? <div style={{ marginTop: 2 }}>{n.desc}</div> : null}
                          {n.time ? (
                            <div style={{ fontSize: "0.72rem", opacity: 0.75, marginTop: 2 }}>{n.time}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p style={{ margin: "12px 0 0", fontSize: "0.86rem", opacity: 0.8 }}>
                    No recent absent marks. You will get an alert here when staff mark your ward absent.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <button
                    type="button"
                    className="stu-btn stu-btn-primary stu-btn-sm"
                    onClick={() => {
                      setTab("more")
                      setMoreView("attendance")
                    }}
                  >
                    Open attendance
                  </button>
                  <button
                    type="button"
                    className="stu-btn stu-btn-ghost stu-btn-sm"
                    onClick={() => {
                      setTab("more")
                      setMoreView("notifications")
                    }}
                  >
                    All notifications
                  </button>
                  <button
                    type="button"
                    className="stu-btn stu-btn-ghost stu-btn-sm"
                    onClick={() => {
                      unlockNotifyAudio()
                      void (async () => {
                        await ensureNativeNotificationChannel()
                        await showNativeNotification({
                          title: "Test: Your ward is Absent",
                          body: "This is a test alert with the default notification tone.",
                          id: 900001,
                          channelId: "gpth_attendance",
                        })
                        playAbsentNotifySound()
                        flash("Test notification sent — check status bar")
                        void loadDashboard()
                      })()
                    }}
                  >
                    Refresh / test alert
                  </button>
                </div>
              </div>
            ) : null}

            {(user.is_alumni || user.read_only_portal || student?.is_alumni || student?.academic_status === "passed_out") && !isParentMode ? (
              <div className="stu-msg stu-msg-info" role="status">
                <strong>🎓 Alumni / Pass-out portal (read-only)</strong>
                <p style={{ margin: "6px 0 0", fontSize: "0.88rem", lineHeight: 1.45 }}>
                  You have completed the diploma programme. You can still view results, certificates, and your
                  records. Class attendance and current-year editing no longer apply.
                  {user.academic?.pass_out_academic_year
                    ? ` Pass-out year: ${user.academic.pass_out_academic_year}.`
                    : ""}
                  {user.academic?.admission_academic_year
                    ? ` Admission batch: ${user.academic.admission_academic_year}.`
                    : student?.admission_academic_year
                      ? ` Admission batch: ${student.admission_academic_year}.`
                      : ""}
                </p>
              </div>
            ) : null}

            {/* Student home absent banner (parent has priority card above) */}
            {!isParentMode && absentNotifs.length > 0 ? (
              <div
                className="stu-alert-ready"
                role="status"
                style={{ borderColor: "#dc2626", background: "rgba(254,226,226,0.45)" }}
              >
                <h3>⚠️ Absent alerts ({absentNotifs.length})</h3>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.88rem", lineHeight: 1.45 }}>
                  {absentNotifs.slice(0, 5).map((n) => (
                    <li key={n.id} style={{ marginBottom: 8 }}>
                      <strong>{n.title}</strong>
                      {n.desc ? <div style={{ marginTop: 2 }}>{n.desc}</div> : null}
                      {n.time ? (
                        <div style={{ fontSize: "0.75rem", opacity: 0.75, marginTop: 2 }}>{n.time}</div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    type="button"
                    className="stu-btn stu-btn-ghost stu-btn-sm"
                    onClick={() => {
                      setTab("more")
                      setMoreView("notifications")
                    }}
                  >
                    All notifications
                  </button>
                  <button
                    type="button"
                    className="stu-btn stu-btn-ghost stu-btn-sm"
                    onClick={async () => {
                      await api("/api/notifications", {
                        method: "PATCH",
                        body: JSON.stringify({}),
                      })
                      setAppNotifs((prev) => prev.map((n) => ({ ...n, unread: false })))
                      flash("Notifications marked read")
                    }}
                  >
                    Mark all read
                  </button>
                </div>
              </div>
            ) : null}

            {accountApprovedNotif ? (
              <div className="stu-alert-ready" role="status" style={{ borderColor: "#16a34a" }}>
                <h3>{accountApprovedNotif.title || "✅ Account Approved"}</h3>
                <p style={{ margin: "6px 0 0", fontSize: "0.88rem", lineHeight: 1.45 }}>
                  {accountApprovedNotif.desc}
                </p>
                {accountApprovedNotif.time ? (
                  <p style={{ margin: "6px 0 0", fontSize: "0.75rem", opacity: 0.75 }}>
                    {accountApprovedNotif.time}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="stu-btn stu-btn-ghost stu-btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={async () => {
                    await api("/api/notifications", {
                      method: "PATCH",
                      body: JSON.stringify({}),
                    })
                    setAppNotifs((prev) =>
                      prev.map((n) =>
                        n.kind === "account_approved" || (n.title || "").toLowerCase().includes("account approved")
                          ? { ...n, unread: false }
                          : n,
                      ),
                    )
                    flash("Dismissed")
                  }}
                >
                  Got it
                </button>
              </div>
            ) : null}

            {unreadAppNotifs.filter(
              (n) =>
                n.kind !== "attendance_absent" &&
                n.kind !== "attendance_absent_parent" &&
                n.kind !== "account_approved" &&
                !(n.title || "").toLowerCase().includes("account approved") &&
                !(n.title || "").toLowerCase().includes("absent"),
            ).length > 0 ? (
              <div className="stu-msg stu-msg-info">
                <strong>
                  🔔{" "}
                  {
                    unreadAppNotifs.filter(
                      (n) =>
                        n.kind !== "attendance_absent" &&
                        n.kind !== "attendance_absent_parent" &&
                        n.kind !== "account_approved",
                    ).length
                  }{" "}
                  other notification(s)
                </strong>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {unreadAppNotifs
                    .filter(
                      (n) =>
                        n.kind !== "attendance_absent" &&
                        n.kind !== "attendance_absent_parent" &&
                        n.kind !== "account_approved" &&
                        !(n.title || "").toLowerCase().includes("absent"),
                    )
                    .slice(0, 4)
                    .map((n) => (
                      <li key={n.id} style={{ marginBottom: 4 }}>
                        <strong>{n.title}</strong>
                        {n.desc ? ` — ${n.desc}` : ""}
                      </li>
                    ))}
                </ul>
                <button
                  type="button"
                  className="stu-btn stu-btn-ghost stu-btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    setTab("more")
                    setMoreView("notifications")
                  }}
                >
                  View all
                </button>
              </div>
            ) : null}

            {readyCerts.length > 0 ? (
              <div className="stu-alert-ready" role="status">
                <h3>🔔 Certificate ready for collection</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {readyCerts.map((c) => (
                    <li key={c.id}>
                      <strong>{c.cert_type || "Certificate"}</strong>
                      {c.req_code ? ` · ${c.req_code}` : ""}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="stu-btn stu-btn-primary stu-btn-sm"
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

            {profilePending ? (
              <div className="stu-msg stu-msg-info">⏳ Profile update is pending Admin/HOD approval.</div>
            ) : null}

            <div className="stu-kpis">
              {isParentMode ? (
                <>
                  <div
                    className="stu-kpi"
                    style={{ border: "2px solid #1a4fa0", cursor: "pointer" }}
                    onClick={() => {
                      setTab("more")
                      setMoreView("attendance")
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setTab("more")
                        setMoreView("attendance")
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="label">Attendance</div>
                    <div className="value">{student?.att || "—"}</div>
                  </div>
                  <div
                    className="stu-kpi"
                    style={{ border: absentNotifs.length ? "2px solid #dc2626" : undefined, cursor: "pointer" }}
                    onClick={() => {
                      setTab("more")
                      setMoreView("notifications")
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setTab("more")
                        setMoreView("notifications")
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="label">Absent alerts</div>
                    <div className="value" style={{ color: absentNotifs.length ? "#dc2626" : undefined }}>
                      {absentNotifs.length}
                    </div>
                  </div>
                  <div className="stu-kpi">
                    <div className="label">CGPA</div>
                    <div className="value">{student?.cgpa || "—"}</div>
                  </div>
                  <div className="stu-kpi">
                    <div className="label">Results</div>
                    <div className="value">{results.length}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="stu-kpi">
                    <div className="label">CGPA</div>
                    <div className="value">{student?.cgpa || "—"}</div>
                  </div>
                  <div className="stu-kpi">
                    <div className="label">Attendance</div>
                    <div className="value">{student?.att || "—"}</div>
                  </div>
                  <div className="stu-kpi">
                    <div className="label">Open forms</div>
                    <div className="value">{pendingForms.length}</div>
                  </div>
                  <div className="stu-kpi">
                    <div className="label">Ready certs</div>
                    <div className="value">{readyCerts.length}</div>
                  </div>
                </>
              )}
            </div>

            <div className="stu-section-title">Do something</div>
            <div className="stu-quick" style={{ marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => {
                  setTab("more")
                  setMoreView("certRequest")
                }}
              >
                <span className="ico">📄</span>
                <span className="t">Request certificate</span>
                <span className="d">Study, TC, NOC, PDC…</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("profile")
                  if (!profilePending) startProfileEdit()
                }}
              >
                <span className="ico">✏️</span>
                <span className="t">Raise edit request</span>
                <span className="d">{profilePending ? "Pending approval" : "Edit & send for approval"}</span>
              </button>
              <button type="button" onClick={() => setTab("forms")}>
                <span className="ico">📝</span>
                <span className="t">Submit forms</span>
                <span className="d">{pendingForms.length} waiting</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("more")
                  setMoreView("fees")
                }}
              >
                <span className="ico">💳</span>
                <span className="t">Fees</span>
                <span className="d">Exam · Makeup · Admission · K2</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("more")
                  setMoreView("grievances")
                }}
              >
                <span className="ico">📨</span>
                <span className="t">Grievance</span>
                <span className="d">Write to Principal</span>
              </button>
            </div>

            <div className="stu-card">
              <h3>My details</h3>
              {dataLoading && !student ? (
                <div className="stu-empty">Loading…</div>
              ) : (
                <>
                  <div className="stu-row">
                    <span className="k">Name</span>
                    <span className="v">{student?.name || user.display_name}</span>
                  </div>
                  <div className="stu-row">
                    <span className="k">Reg. No.</span>
                    <span className="v">{student?.reg_no || user.reg_no || "—"}</span>
                  </div>
                  <div className="stu-row">
                    <span className="k">Branch</span>
                    <span className="v">{student?.dept || "—"}</span>
                  </div>
                  <div className="stu-row">
                    <span className="k">Year</span>
                    <span className="v">{student?.year || "—"}</span>
                  </div>
                  <div className="stu-row">
                    <span className="k">Email</span>
                    <span className="v">{user.email}</span>
                  </div>
                </>
              )}
              <div className="stu-actions">
                <button type="button" className="stu-btn stu-btn-primary stu-btn-sm" onClick={() => setTab("profile")}>
                  Open profile
                </button>
                <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" onClick={() => void downloadFullProfilePdf()}>
                  ⬇ PDF
                </button>
                <button
                  type="button"
                  className="stu-btn stu-btn-ghost stu-btn-sm"
                  onClick={() => loadDashboard()}
                >
                  Refresh
                </button>
              </div>
            </div>
          </>
        )}

        {/* ---------- PROFILE ---------- */}
        {tab === "profile" && (
          <div className="stu-card">
            {profileErr ? <div className="stu-msg stu-msg-err">{profileErr}</div> : null}
            {profileMsg ? <div className="stu-msg stu-msg-ok">{profileMsg}</div> : null}
            {profilePending ? (
              <div className="stu-msg stu-msg-info">
                Edit request raised — waiting for Admin / HOD / ACM. Profile stays view-only until reviewed.
              </div>
            ) : null}
            {profileFirstTime && !profilePending ? (
              <div className="stu-msg stu-msg-ok">
                <strong>First-time profile update is open.</strong> Fill your details and save — no staff unlock needed.
              </div>
            ) : null}
            {profileLocked && !profilePending && !profileFirstTime ? (
              <div className="stu-msg stu-msg-info">
                Profile is view-only. Use <strong>Raise edit request</strong> below anytime — no unlock needed.
              </div>
            ) : null}

            <div className="stu-photo-edit">
              {profilePhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="stu-photo" src={profilePhoto} alt="Profile" />
              ) : (
                <div className="stu-photo-ph">{initials(student?.name || user.display_name)}</div>
              )}
              {profileEditing ? (
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/jpg"
                  onChange={(e) => onPhotoPick(e.target.files?.[0] || null)}
                />
              ) : null}
            </div>

            {!profileEditing ? (
              <>
                <div className="stu-row">
                  <span className="k">Name</span>
                  <span className="v">{student?.name || user.display_name}</span>
                </div>
                <div className="stu-row">
                  <span className="k">Register No.</span>
                  <span className="v">{student?.reg_no || user.reg_no || "—"}</span>
                </div>
                <div className="stu-row">
                  <span className="k">Branch</span>
                  <span className="v">{student?.dept || "—"}</span>
                </div>
                <div className="stu-row">
                  <span className="k">Year</span>
                  <span className="v">{student?.year || "—"}</span>
                </div>
                <div className="stu-row">
                  <span className="k">Father</span>
                  <span className="v">{student?.father || "—"}</span>
                </div>
                <div className="stu-row">
                  <span className="k">CGPA</span>
                  <span className="v">{student?.cgpa || "—"}</span>
                </div>
                <div className="stu-row">
                  <span className="k">Attendance</span>
                  <span className="v">{student?.att || "—"}</span>
                </div>
                <div className="stu-row">
                  <span className="k">Email</span>
                  <span className="v">{user.email}</span>
                </div>
                {student?.extra
                  ? Object.entries(student.extra)
                      .filter(([k, v]) => k !== "profile_edit_locked" && !isPhotoKey(k) && !isDataImage(v))
                      .slice(0, 30)
                      .map(([k, v]) => (
                        <div className="stu-row" key={k}>
                          <span className="k">{k}</span>
                          <span className="v">{v == null || String(v).trim() === "" ? "—" : String(v)}</span>
                        </div>
                      ))
                  : null}
                <div className="stu-actions">
                  <button type="button" className="stu-btn stu-btn-primary" onClick={() => void downloadFullProfilePdf()}>
                    ⬇ Download profile PDF
                  </button>
                  <button
                    type="button"
                    className="stu-btn stu-btn-primary"
                    disabled={profilePending}
                    onClick={startProfileEdit}
                  >
                    {profilePending
                      ? "Edit request pending"
                      : profileFirstTime
                        ? "Fill My Profile (First Time)"
                        : "Raise edit request"}
                  </button>
                  <button
                    type="button"
                    className="stu-btn stu-btn-ghost"
                    onClick={() => {
                      setTab("more")
                      setMoreView("password")
                    }}
                  >
                    🔐 Password
                  </button>
                </div>
              </>
            ) : (
              <>
                {schema.map((sec, si) => (
                  <div className="stu-sec-card" key={sec.id || sec.title || si}>
                    <h4>{sec.title || `Section ${si + 1}`}</h4>
                    {(sec.fields || []).map((f) => {
                      const label = f.label
                      if (!label || isPhotoKey(label)) return null
                      const locked = isLockedField(label) || f.editable === false
                      // Allow editing empty fields even if schema says not editable (first fill)
                      const canEdit = !isLockedField(label) && (f.editable !== false || !String(profileDraft[label] || "").trim())
                      const type = String(f.type || "text").toLowerCase()
                      const options =
                        Array.isArray(f.options) && f.options.length
                          ? f.options
                          : label === "Branch"
                            ? BRANCH_OPTIONS
                            : label === "Current Year"
                              ? YEAR_OPTIONS
                              : []
                      return (
                        <div className="stu-field" key={label}>
                          <label>
                            {label}
                            {f.required ? " *" : ""}
                          </label>
                          {type === "select" || options.length ? (
                            <select
                              disabled={!canEdit}
                              value={profileDraft[label] || ""}
                              onChange={(e) =>
                                setProfileDraft((d) => ({ ...d, [label]: e.target.value }))
                              }
                            >
                              <option value="">Select…</option>
                              {options.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : type === "textarea" ? (
                            <textarea
                              disabled={!canEdit}
                              value={profileDraft[label] || ""}
                              onChange={(e) =>
                                setProfileDraft((d) => ({ ...d, [label]: e.target.value }))
                              }
                            />
                          ) : (
                            <input
                              disabled={!canEdit}
                              value={profileDraft[label] || ""}
                              onChange={(e) =>
                                setProfileDraft((d) => ({ ...d, [label]: e.target.value }))
                              }
                            />
                          )}
                          {locked && isLockedField(label) ? (
                            <div style={{ fontSize: "0.72rem", color: "var(--stu-muted)", marginTop: 4 }}>
                              Cannot change register number
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ))}
                <div className="stu-sticky-bar">
                  <div className="stu-actions" style={{ marginTop: 0 }}>
                    <button
                      type="button"
                      className="stu-btn stu-btn-primary"
                      disabled={profileBusy}
                      onClick={submitProfileUpdate}
                    >
                      {profileBusy ? "Submitting…" : "Submit edit request"}
                    </button>
                    <button type="button" className="stu-btn stu-btn-ghost" onClick={cancelProfileEdit}>
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---------- RESULTS ---------- */}
        {tab === "results" && (
          <div className="stu-card">
            <h3>Semester results</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--stu-muted)", marginTop: 0, lineHeight: 1.45 }}>
              Official published ledger. To enter regular / makeup subject marks for verification, use the main web
              portal Results desk when Exam opens entry.
            </p>
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
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    {r.edit_request_status === "pending" ? (
                      <span className="stu-badge pending">Edit request pending HOD approval</span>
                    ) : (
                      <button
                        type="button"
                        className="stu-btn stu-btn-ghost"
                        onClick={() => {
                          setResultEditId(r.id)
                          setResultEditDraft(JSON.parse(JSON.stringify(r)))
                          setResultEditMessage("")
                        }}
                      >
                        Request result correction
                      </button>
                    )}
                    {resultEditMessage && resultEditId === null ? <span style={{ fontSize: "0.78rem" }}>{resultEditMessage}</span> : null}
                  </div>
                  {resultEditId === r.id && resultEditDraft ? (
                    <div style={{ marginTop: 10, padding: 12, border: "1px solid var(--stu-border)", borderRadius: 8 }}>
                      <strong>Proposed correction</strong>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                        <label>SGPA<input value={String(resultEditDraft.sgpa ?? "")} onChange={(e) => setResultEditDraft({ ...resultEditDraft, sgpa: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                        <label>Result<input value={resultEditDraft.result || ""} onChange={(e) => setResultEditDraft({ ...resultEditDraft, result: e.target.value })} /></label>
                      </div>
                      {resultEditDraft.subjects?.map((subject, index) => (
                        <div key={subject.code || index} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                          <span style={{ alignSelf: "center" }}>{subject.code} {subject.name}</span>
                          <input aria-label={`${subject.code} internal`} value={String(subject.internal ?? "")} onChange={(e) => { const subjects = [...(resultEditDraft.subjects || [])]; subjects[index] = { ...subjects[index], internal: e.target.value === "" ? null : Number(e.target.value) }; setResultEditDraft({ ...resultEditDraft, subjects }) }} />
                          <input aria-label={`${subject.code} external`} value={String(subject.external ?? "")} onChange={(e) => { const subjects = [...(resultEditDraft.subjects || [])]; subjects[index] = { ...subjects[index], external: e.target.value === "" ? null : Number(e.target.value) }; setResultEditDraft({ ...resultEditDraft, subjects }) }} />
                          <input aria-label={`${subject.code} grade`} value={subject.grade || ""} onChange={(e) => { const subjects = [...(resultEditDraft.subjects || [])]; subjects[index] = { ...subjects[index], grade: e.target.value }; setResultEditDraft({ ...resultEditDraft, subjects }) }} />
                        </div>
                      ))}
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button type="button" className="stu-btn stu-btn-primary" disabled={resultEditBusy} onClick={submitResultEditRequest}>{resultEditBusy ? "Sending…" : "Send to HOD"}</button>
                        <button type="button" className="stu-btn stu-btn-ghost" onClick={() => { setResultEditId(null); setResultEditDraft(null) }}>Cancel</button>
                        {resultEditMessage ? <span style={{ fontSize: "0.78rem", alignSelf: "center" }}>{resultEditMessage}</span> : null}
                      </div>
                    </div>
                  ) : null}
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

        {/* ---------- FORMS LIST ---------- */}
        {tab === "forms" && moreView !== "formFill" && (
          <div className="stu-card">
            <h3>Submit forms</h3>
            <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "var(--stu-muted)" }}>
              Fill open surveys. Verified copies stay under My submissions for PDF download.
            </p>
            <h4 style={{ margin: "8px 0", fontSize: "0.9rem" }}>Open forms</h4>
            {!forms.filter((f) => String(f.status).toLowerCase() === "open").length ? (
              <div className="stu-empty">No open forms right now.</div>
            ) : (
              forms
                .filter((f) => String(f.status).toLowerCase() === "open")
                .map((f) => {
                  const st = formMyStatus(f)
                  const fill = canFillForm(f)
                  return (
                    <div className="stu-list-item" key={f.id}>
                      <div style={{ flex: 1 }}>
                        <div className="title">{f.title}</div>
                        <div className="desc">{f.description || "No description"}</div>
                        {fill ? (
                          <button
                            type="button"
                            className="stu-link-btn"
                            style={{ marginTop: 6 }}
                            onClick={() => openFormFill(f)}
                          >
                            Fill &amp; submit →
                          </button>
                        ) : null}
                        {st === "verified" ? (
                          <button
                            type="button"
                            className="stu-link-btn"
                            style={{ marginTop: 6 }}
                            onClick={() => void downloadVerifiedFormPdf(f)}
                          >
                            ⬇ Download PDF
                          </button>
                        ) : null}
                      </div>
                      <span
                        className={`stu-badge ${statusBadge(
                          st === "verified" ? "ready" : st === "pending" ? "pending" : f.status,
                        )}`}
                      >
                        {st || f.status}
                      </span>
                    </div>
                  )
                })
            )}
            <h4 style={{ margin: "18px 0 8px", fontSize: "0.9rem" }}>My submissions</h4>
            {!forms.filter((f) => f.my_response).length ? (
              <div className="stu-empty">No submissions yet.</div>
            ) : (
              forms
                .filter((f) => f.my_response)
                .map((f) => {
                  const st = formMyStatus(f)
                  return (
                    <div className="stu-list-item" key={`mine-${f.id}`}>
                      <div style={{ flex: 1 }}>
                        <div className="title">{f.title}</div>
                        <div className="desc">
                          Submitted {fmtDate(f.my_response?.submitted_at)}
                          {f.my_response?.verified_by_name
                            ? ` · ${f.my_response.verified_by_name}`
                            : ""}
                        </div>
                        {f.my_response?.verifier_note ? (
                          <div className="desc">Note: {f.my_response.verifier_note}</div>
                        ) : null}
                        {st === "verified" ? (
                          <button
                            type="button"
                            className="stu-link-btn"
                            style={{ marginTop: 6 }}
                            onClick={() => void downloadVerifiedFormPdf(f)}
                          >
                            ⬇ Download PDF
                          </button>
                        ) : null}
                        {st === "rejected" && String(f.status).toLowerCase() === "open" ? (
                          <button
                            type="button"
                            className="stu-link-btn"
                            style={{ marginTop: 6 }}
                            onClick={() => openFormFill(f)}
                          >
                            Resubmit →
                          </button>
                        ) : null}
                      </div>
                      <span
                        className={`stu-badge ${statusBadge(
                          st === "verified" ? "ready" : st === "pending" ? "pending" : st,
                        )}`}
                      >
                        {st || "—"}
                      </span>
                    </div>
                  )
                })
            )}
          </div>
        )}

        {/* ---------- FORM FILL ---------- */}
        {tab === "forms" && moreView === "formFill" && activeForm && (
          <div className="stu-card">
            <button
              type="button"
              className="stu-btn stu-btn-ghost stu-btn-sm"
              style={{ marginBottom: 12 }}
              onClick={() => {
                setActiveForm(null)
                setMoreView("menu")
                setTab("forms")
              }}
            >
              ← Back to forms
            </button>
            <h3>{activeForm.title}</h3>
            {activeForm.description ? (
              <p style={{ fontSize: "0.84rem", color: "var(--stu-muted)" }}>{activeForm.description}</p>
            ) : null}
            {formErr ? <div className="stu-msg stu-msg-err">{formErr}</div> : null}
            {parseFormFields(activeForm.fields).map((f, i) => {
              const key = fieldLabel(f)
              const type = String(f.type || "text").toLowerCase()
              const opts = Array.isArray(f.options) ? f.options : []
              return (
                <div className="stu-field" key={f.id || key + i}>
                  <label>
                    {key}
                    {f.required ? " *" : ""}
                  </label>
                  {type === "textarea" || type === "paragraph" ? (
                    <textarea
                      value={formAnswers[key] || ""}
                      onChange={(e) => setFormAnswers((a) => ({ ...a, [key]: e.target.value }))}
                    />
                  ) : type === "select" || type === "dropdown" ? (
                    <select
                      value={formAnswers[key] || ""}
                      onChange={(e) => setFormAnswers((a) => ({ ...a, [key]: e.target.value }))}
                    >
                      <option value="">Select…</option>
                      {opts.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : type === "radio" ? (
                    <div className="stu-chip-row">
                      {opts.map((o) => (
                        <button
                          type="button"
                          key={o}
                          className={`stu-chip ${formAnswers[key] === o ? "act" : ""}`}
                          onClick={() => setFormAnswers((a) => ({ ...a, [key]: o }))}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      type={type === "email" ? "email" : type === "number" ? "number" : "text"}
                      value={formAnswers[key] || ""}
                      onChange={(e) => setFormAnswers((a) => ({ ...a, [key]: e.target.value }))}
                    />
                  )}
                </div>
              )
            })}
            {!parseFormFields(activeForm.fields).length ? (
              <div className="stu-empty">This form has no questions configured.</div>
            ) : (
              <div className="stu-sticky-bar">
                <button
                  type="button"
                  className="stu-btn stu-btn-primary"
                  disabled={formBusy}
                  onClick={submitFormResponse}
                >
                  {formBusy ? "Submitting…" : "Submit form"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---------- MORE MENU ---------- */}
        {tab === "more" && moreView === "menu" && (
          <>
            {readyCerts.length > 0 ? (
              <div className="stu-alert-ready">
                <h3>🔔 {readyCerts.length} certificate(s) ready</h3>
                <button type="button" className="stu-btn stu-btn-primary stu-btn-sm" onClick={() => setMoreView("certs")}>
                  Open certificates
                </button>
              </div>
            ) : null}
            <div className="stu-quick">
              {isParentMode ? (
                <>
                  <button type="button" onClick={() => setMoreView("attendance")}>
                    <span className="ico">📅</span>
                    <span className="t">Attendance</span>
                    <span className="d">{student?.att || "Ward summary"} · Priority</span>
                  </button>
                  <button type="button" onClick={() => setMoreView("notifications")}>
                    <span className="ico">🔔</span>
                    <span className="t">Absent alerts</span>
                    <span className="d">
                      {absentNotifs.length ? `${absentNotifs.length} alert(s)` : "No absents yet"}
                    </span>
                  </button>
                  <button type="button" onClick={() => setTab("results")}>
                    <span className="ico">📊</span>
                    <span className="t">Results</span>
                    <span className="d">View only</span>
                  </button>
                  <button type="button" onClick={() => setMoreView("notices")}>
                    <span className="ico">📢</span>
                    <span className="t">Notices</span>
                    <span className="d">{notices.length} recent</span>
                  </button>
                </>
              ) : null}
              {!isParentMode ? (
              <button type="button" onClick={() => setMoreView("fees")}>
                <span className="ico">💳</span>
                <span className="t">Fees</span>
                <span className="d">Regular exam · Makeup · Admission · K2</span>
              </button>
              ) : null}
              {!isParentMode ? (
              <button type="button" onClick={() => setMoreView("certRequest")}>
                <span className="ico">➕</span>
                <span className="t">Request certificate</span>
                <span className="d">New ACM / Exam request</span>
              </button>
              ) : null}
              {!isParentMode ? (
              <button type="button" onClick={() => setMoreView("certs")}>
                <span className="ico">📜</span>
                <span className="t">My certificates</span>
                <span className="d">{readyCerts.length ? `${readyCerts.length} ready` : `${certs.length} request(s)`}</span>
              </button>
              ) : null}
              {!isParentMode ? (
              <button type="button" onClick={() => setMoreView("grievances")}>
                <span className="ico">📨</span>
                <span className="t">Grievances</span>
                <span className="d">{grievances.length} filed</span>
              </button>
              ) : null}
              {!isParentMode ? (
              <button type="button" onClick={() => setMoreView("attendance")}>
                <span className="ico">📊</span>
                <span className="t">Attendance</span>
                <span className="d">{student?.att || "Summary"}</span>
              </button>
              ) : null}
              {!isParentMode ? (
              <button
                type="button"
                onClick={() => {
                  setMoreView("timetable")
                  void loadStudentTimetable()
                }}
              >
                <span className="ico">📅</span>
                <span className="t">Time Table</span>
                <span className="d">
                  {studyYearLabel(
                    parseStudyYearLoose(student?.current_study_year) ||
                      parseStudyYearLoose(student?.year),
                  )}{" "}
                  only
                </span>
              </button>
              ) : null}
              {!isParentMode ? (
              <button type="button" onClick={() => setMoreView("notifications")}>
                <span className="ico">🔔</span>
                <span className="t">Notifications</span>
                <span className="d">
                  Absent alerts & updates
                  {unreadAppNotifs.length ? ` · ${unreadAppNotifs.length} new` : ""}
                </span>
              </button>
              ) : null}
              {!isParentMode ? (
              <button type="button" onClick={() => setMoreView("notices")}>
                <span className="ico">📢</span>
                <span className="t">Notices</span>
                <span className="d">{notices.length} recent</span>
              </button>
              ) : null}
              {!isParentMode ? (
              <button type="button" onClick={() => setMoreView("whatsNew")}>
                <span className="ico">✨</span>
                <span className="t">What&apos;s new</span>
                <span className="d">App v{STUDENT_APP_VERSION}</span>
              </button>
              ) : null}
              <button type="button" onClick={() => refreshAppUpdate()}>
                <span className="ico">🔄</span>
                <span className="t">Update / refresh app</span>
                <span className="d">Get latest features (no reinstall)</span>
              </button>
              {!isParentMode ? (
              <button type="button" onClick={() => setMoreView("password")}>
                <span className="ico">🔐</span>
                <span className="t">Change password</span>
                <span className="d">Account security</span>
              </button>
              ) : null}
            </div>
            <div className="stu-card" style={{ marginTop: 12 }}>
              <h3>Account</h3>
              <div className="stu-row">
                <span className="k">Email</span>
                <span className="v">{user.email}</span>
              </div>
              <div className="stu-row">
                <span className="k">Register No.</span>
                <span className="v">{user.reg_no || "—"}</span>
              </div>
              <div className="stu-actions">
                <button type="button" className="stu-btn stu-btn-ghost" onClick={() => loadDashboard()}>
                  Refresh data
                </button>
                <button type="button" className="stu-btn stu-btn-danger" onClick={doLogout}>
                  Sign out
                </button>
              </div>
              <p
                style={{
                  marginTop: 16,
                  marginBottom: 0,
                  textAlign: "center",
                  fontSize: "0.72rem",
                  color: "var(--stu-muted)",
                }}
              >
                Developed by <strong>Akshay Uppar</strong>
              </p>
            </div>
          </>
        )}

        {/* ---------- NOTIFICATIONS ---------- */}
        {tab === "more" && moreView === "notifications" && (
          <div className="stu-card">
            <button
              type="button"
              className="stu-btn stu-btn-ghost stu-btn-sm"
              style={{ marginBottom: 12 }}
              onClick={() => setMoreView("menu")}
            >
              ← Back
            </button>
            <h3>{isParentMode ? "Parent notifications" : "Notifications"}</h3>
            <p style={{ fontSize: "0.82rem", color: "var(--stu-muted)", marginTop: 0 }}>
              {isParentMode
                ? "Absent alerts for your ward appear here when staff mark attendance."
                : "Absent marks and other updates from the college appear here."}
            </p>
            <div className="stu-actions" style={{ marginBottom: 12 }}>
              <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" onClick={() => loadDashboard()}>
                Refresh
              </button>
              <button
                type="button"
                className="stu-btn stu-btn-ghost stu-btn-sm"
                onClick={async () => {
                  await api("/api/notifications", { method: "PATCH", body: JSON.stringify({}) })
                  setAppNotifs((prev) => prev.map((n) => ({ ...n, unread: false })))
                  flash("All marked read")
                }}
              >
                Mark all read
              </button>
            </div>
            {absentNotifs.length > 0 ? (
              <>
                <h4 style={{ margin: "8px 0" }}>Absent alerts</h4>
                {absentNotifs.map((n) => (
                  <div
                    key={n.id}
                    className="stu-row"
                    style={{
                      flexDirection: "column",
                      alignItems: "stretch",
                      borderLeft: n.unread ? "3px solid #dc2626" : "3px solid transparent",
                      paddingLeft: 10,
                      marginBottom: 10,
                    }}
                  >
                    <strong>{n.title}</strong>
                    <span style={{ fontSize: "0.86rem", marginTop: 4 }}>{n.desc}</span>
                    {n.time ? (
                      <span style={{ fontSize: "0.75rem", opacity: 0.7, marginTop: 4 }}>{n.time}</span>
                    ) : null}
                  </div>
                ))}
              </>
            ) : (
              <p style={{ opacity: 0.75 }}>No absent alerts yet.</p>
            )}
            <h4 style={{ margin: "16px 0 8px" }}>All notifications (latest first)</h4>
            {sortedAppNotifs.length === 0 ? (
              <p style={{ opacity: 0.75 }}>No notifications yet.</p>
            ) : (
              sortedAppNotifs.map((n) => (
                  <div
                    key={n.id}
                    className="stu-row"
                    style={{
                      flexDirection: "column",
                      alignItems: "stretch",
                      opacity: n.unread ? 1 : 0.75,
                      marginBottom: 10,
                    }}
                  >
                    <strong>
                      {n.unread ? "• " : ""}
                      {n.title}
                    </strong>
                    <span style={{ fontSize: "0.86rem", marginTop: 4 }}>{n.desc}</span>
                    {n.time ? (
                      <span style={{ fontSize: "0.75rem", opacity: 0.7, marginTop: 4 }}>{n.time}</span>
                    ) : null}
                  </div>
                ))
            )}
          </div>
        )}

        {/* ---------- CERT REQUEST ---------- */}
        {tab === "more" && moreView === "certRequest" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <h3>Request a certificate</h3>
            <p style={{ fontSize: "0.82rem", color: "var(--stu-muted)", marginTop: 0 }}>
              Request goes to ACM (Study/TC/NOC) or Exam Cell (PDC). You will be notified in the app when status is{" "}
              <strong>ready</strong>.
            </p>
            {certErr ? <div className="stu-msg stu-msg-err">{certErr}</div> : null}
            {certOk ? <div className="stu-msg stu-msg-ok">{certOk}</div> : null}
            <div className="stu-field">
              <label>Certificate type</label>
              <div className="stu-chip-row">
                {CERT_TYPES.map((t) => (
                  <button
                    type="button"
                    key={t}
                    className={`stu-chip ${certType === t ? "act" : ""}`}
                    onClick={() => setCertType(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="stu-field">
              <label>Purpose *</label>
              <input
                placeholder="e.g. Higher studies / Passport / Job"
                value={certPurpose}
                onChange={(e) => setCertPurpose(e.target.value)}
              />
            </div>
            <div className="stu-field">
              <label>Reason / details</label>
              <textarea
                placeholder="Any extra details for ACM / Exam Cell"
                value={certReason}
                onChange={(e) => setCertReason(e.target.value)}
              />
            </div>
            <div className="stu-field">
              <label>Note (optional)</label>
              <input value={certNote} onChange={(e) => setCertNote(e.target.value)} />
            </div>
            <div className="stu-row">
              <span className="k">Name</span>
              <span className="v">{student?.name || user.display_name}</span>
            </div>
            <div className="stu-row">
              <span className="k">Reg. No.</span>
              <span className="v">{user.reg_no || "—"}</span>
            </div>
            <div className="stu-row">
              <span className="k">Branch</span>
              <span className="v">{student?.dept || "—"}</span>
            </div>
            <button type="button" className="stu-btn stu-btn-primary" disabled={certBusy} onClick={submitCertRequest}>
              {certBusy ? "Submitting…" : "Submit request"}
            </button>
          </div>
        )}

        {/* ---------- CERT LIST ---------- */}
        {tab === "more" && moreView === "certs" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <div className="stu-actions" style={{ marginTop: 0, marginBottom: 12 }}>
              <button type="button" className="stu-btn stu-btn-primary stu-btn-sm" onClick={() => setMoreView("certRequest")}>
                ➕ New request
              </button>
            </div>
            <h3>My requests</h3>
            {readyCerts.length > 0 ? (
              <div className="stu-alert-ready" style={{ marginBottom: 12 }}>
                <h3>Ready for collection</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {readyCerts.map((c) => (
                    <li key={`r-${c.id}`}>
                      {c.cert_type} {c.req_code ? `· ${c.req_code}` : ""}
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
                      {c.routed_to ? ` · ${c.routed_to}` : ""}
                    </div>
                    {c.remarks ? <div className="desc">{c.remarks}</div> : null}
                  </div>
                  <span className={`stu-badge ${statusBadge(c.status)}`}>{c.status || "pending"}</span>
                </div>
              ))
            )}
            <h3 style={{ marginTop: 18 }}>Issued certificates (PDF)</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--stu-muted)", marginTop: 0 }}>
              After ACM releases your Study / Studying certificate, tap <strong>Download PDF</strong> to
              save a copy (includes profile photo when available).
            </p>
            {!acmCerts.length ? (
              <div className="stu-empty">
                No certificates released yet. When ACM completes and sends your Study / Studying
                certificate, it will appear here with a Download PDF button.
              </div>
            ) : (
              acmCerts.map((c) => {
                const typeLabel =
                  String(c.cert_kind || "").toLowerCase() === "studying"
                    ? "Studying Certificate"
                    : String(c.cert_kind || "").toLowerCase() === "study"
                      ? "Study Certificate"
                      : c.cert_kind || "Certificate"
                const when = c.sent_to_student_at || c.printed_at || c.issued_on
                return (
                  <div className="stu-list-item" key={c.id} style={{ flexWrap: "wrap", gap: 8 }}>
                    <div style={{ flex: "1 1 140px" }}>
                      <div className="title">{typeLabel}</div>
                      <div className="desc">
                        {c.cert_no || `#${c.id}`}
                        {when ? ` · ${fmtDate(when)}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span className="stu-badge stu-badge-ok">Ready</span>
                      <button
                        type="button"
                        className="stu-btn stu-btn-primary stu-btn-sm"
                        disabled={printBusyId === c.id}
                        onClick={() => void downloadIssuedCertPdf(c)}
                      >
                        {printBusyId === c.id ? "…" : "⬇ PDF"}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ---------- GRIEVANCES ---------- */}
        {tab === "more" && moreView === "grievances" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <h3>Submit grievance</h3>
            <p style={{ fontSize: "0.82rem", color: "var(--stu-muted)" }}>Only the Principal can view this.</p>
            {gErr ? <div className="stu-msg stu-msg-err">{gErr}</div> : null}
            {gOk ? <div className="stu-msg stu-msg-ok">{gOk}</div> : null}
            <div className="stu-field">
              <label>Subject *</label>
              <input value={gSubject} onChange={(e) => setGSubject(e.target.value)} />
            </div>
            <div className="stu-field">
              <label>Category *</label>
              <select value={gCategory} onChange={(e) => setGCategory(e.target.value)}>
                {GRIEVANCE_CATS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="stu-field">
              <label>Description *</label>
              <textarea value={gDesc} onChange={(e) => setGDesc(e.target.value)} />
            </div>
            <div className="stu-field">
              <label>Expected resolution</label>
              <input value={gExpect} onChange={(e) => setGExpect(e.target.value)} />
            </div>
            <button type="button" className="stu-btn stu-btn-primary" disabled={gBusy} onClick={submitGrievance}>
              {gBusy ? "Submitting…" : "Submit grievance"}
            </button>
            <h3 style={{ marginTop: 20 }}>My grievances</h3>
            {!grievances.length ? (
              <div className="stu-empty">None yet.</div>
            ) : (
              grievances.map((g) => (
                <div className="stu-list-item" key={g.id}>
                  <div>
                    <div className="title">{g.subject}</div>
                    <div className="desc">
                      {g.category} · {fmtDate(g.created_at)}
                    </div>
                    {g.description ? <div className="desc">{g.description}</div> : null}
                    {g.resolution ? <div className="desc">Resolution: {g.resolution}</div> : null}
                  </div>
                  <span className={`stu-badge ${statusBadge(g.status)}`}>{g.status || "open"}</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "more" && moreView === "attendance" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <h3>Attendance summary</h3>
            <div className="stu-row">
              <span className="k">Overall</span>
              <span className="v">{student?.att || "—"}</span>
            </div>
            <p className="stu-empty" style={{ paddingTop: 12 }}>
              Day-wise attendance is marked by faculty. This shows your official summary.
            </p>
          </div>
        )}

        {tab === "more" && moreView === "timetable" && (
          <div className="stu-card">
            <button
              type="button"
              className="stu-btn stu-btn-ghost stu-btn-sm"
              style={{ marginBottom: 12 }}
              onClick={() => setMoreView("menu")}
            >
              ← Back
            </button>
            <h3>Time Table</h3>
            <p className="stu-empty" style={{ paddingTop: 0, paddingBottom: 10 }}>
              You only see the timetable for <strong>your branch and study year</strong>.
            </p>
            {ttLoading ? (
              <p className="stu-empty">Loading…</p>
            ) : ttErr ? (
              <div className="stu-empty" style={{ color: "var(--stu-danger)" }}>
                {ttErr}
              </div>
            ) : (
              <>
                <div className="stu-row">
                  <span className="k">Branch</span>
                  <span className="v">{ttMeta.branch || student?.dept || "—"}</span>
                </div>
                <div className="stu-row">
                  <span className="k">Study year</span>
                  <span className="v">{studyYearLabel(ttMeta.study_year)}</span>
                </div>
                {!ttMeta.study_year ? (
                  <div className="stu-empty" style={{ marginTop: 12, color: "var(--stu-warn)" }}>
                    Your study year is not set on the student record. Contact HOD / Admin.
                  </div>
                ) : ttRow ? (
                  <>
                    <div className="stu-row">
                      <span className="k">File</span>
                      <span className="v">{ttRow.file_name || "Timetable"}</span>
                    </div>
                    <div className="stu-row">
                      <span className="k">Updated</span>
                      <span className="v">
                        {ttRow.updated_at
                          ? new Date(ttRow.updated_at).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                        {ttRow.uploaded_by_name ? ` · ${ttRow.uploaded_by_name}` : ""}
                      </span>
                    </div>
                    <div className="stu-actions" style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        className="stu-btn stu-btn-primary"
                        disabled={ttOpenBusy}
                        onClick={() => void openStudentTimetableFile()}
                      >
                        {ttOpenBusy ? "Opening…" : "👁️ View / Download timetable"}
                      </button>
                      <button
                        type="button"
                        className="stu-btn stu-btn-ghost"
                        onClick={() => void loadStudentTimetable()}
                      >
                        🔄 Refresh
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="stu-empty" style={{ marginTop: 12, color: "var(--stu-warn)" }}>
                    {studyYearLabel(ttMeta.study_year)} timetable has not been uploaded yet. Contact
                    your department faculty / HOD.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === "more" && moreView === "fees" && (
          <StudentFeesPanel
            api={api}
            flash={flash}
            readOnly={!!isReadOnlyPortal}
            onBack={() => setMoreView("menu")}
          />
        )}

        {tab === "more" && moreView === "notices" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
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

        {tab === "more" && moreView === "whatsNew" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <h3>What&apos;s new</h3>
            <p style={{ fontSize: "0.84rem", color: "var(--stu-muted)", marginTop: 0 }}>
              App version <strong>{STUDENT_APP_VERSION}</strong>. This screen lists app updates. The popup only appears
              once when a new version is released. You do <strong>not</strong> need to reinstall the APK — use{" "}
              <strong>Update / refresh app</strong> under More.
            </p>
            <button
              type="button"
              className="stu-btn stu-btn-primary"
              style={{ marginBottom: 14, width: "100%" }}
              onClick={() => refreshAppUpdate()}
            >
              🔄 Update / refresh app now
            </button>
            {STUDENT_APP_CHANGELOG.map((entry) => (
              <div className="stu-sec-card" key={entry.version}>
                <h4>
                  v{entry.version} · {entry.title}
                </h4>
                <div className="desc" style={{ fontSize: "0.78rem", color: "var(--stu-muted)", marginBottom: 8 }}>
                  {entry.date}
                  {entry.version === STUDENT_APP_VERSION ? " · Current" : ""}
                </div>
                <ul className="stu-whats-list">
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {tab === "more" && moreView === "password" && (
          <div className="stu-card">
            <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" style={{ marginBottom: 12 }} onClick={() => setMoreView("menu")}>
              ← Back
            </button>
            <h3>Change password</h3>
            {pwErr ? <div className="stu-msg stu-msg-err">{pwErr}</div> : null}
            {pwOk ? <div className="stu-msg stu-msg-ok">{pwOk}</div> : null}
            <div className="stu-field">
              <label>Current password</label>
              <input type="password" value={pwCur} onChange={(e) => setPwCur(e.target.value)} />
            </div>
            <div className="stu-field">
              <label>New password</label>
              <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
            </div>
            <div className="stu-field">
              <label>Confirm new password</label>
              <input type="password" value={pwNew2} onChange={(e) => setPwNew2(e.target.value)} />
            </div>
            <button type="button" className="stu-btn stu-btn-primary" disabled={pwBusy} onClick={doChangePassword}>
              {pwBusy ? "Updating…" : "Update password"}
            </button>
          </div>
        )}
      </main>

      <nav className="stu-nav" aria-label="Student navigation">
        <button
          type="button"
          className={tab === "home" ? "act" : ""}
          onClick={() => {
            setTab("home")
            setMoreView("menu")
          }}
        >
          <span className="ico">🏠</span>
          Home
          {readyCerts.length > 0 ? <span className="stu-nav-badge">{readyCerts.length}</span> : null}
        </button>
        <button
          type="button"
          className={tab === "profile" ? "act" : ""}
          onClick={() => {
            setTab("profile")
            setMoreView("menu")
          }}
        >
          <span className="ico">👤</span>
          Profile
        </button>
        <button
          type="button"
          className={tab === "results" ? "act" : ""}
          onClick={() => {
            setTab("results")
            setMoreView("menu")
          }}
        >
          <span className="ico">📊</span>
          Results
        </button>
        <button
          type="button"
          className={tab === "forms" ? "act" : ""}
          onClick={() => {
            setTab("forms")
            setMoreView("menu")
            setActiveForm(null)
          }}
        >
          <span className="ico">📝</span>
          Forms
          {pendingForms.length > 0 ? <span className="stu-nav-badge">{pendingForms.length}</span> : null}
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
        </button>
      </nav>

      {showWhatsNew && whatsNewUpdate ? (
        <div className="stu-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="whats-new-title-in">
          <div className="stu-modal">
            <div className="stu-modal-badge">Update v{whatsNewUpdate.version}</div>
            <h2 id="whats-new-title-in">What&apos;s new in the app</h2>
            <p className="stu-modal-sub">
              {whatsNewUpdate.title} · {whatsNewUpdate.date}
            </p>
            <ul className="stu-whats-list">
              {whatsNewUpdate.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="stu-actions" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="stu-btn stu-btn-primary"
                onClick={() => {
                  dismissWhatsNew()
                  refreshAppUpdate()
                }}
              >
                Update now
              </button>
              <button type="button" className="stu-btn stu-btn-ghost" onClick={dismissWhatsNew}>
                Got it
              </button>
              <button
                type="button"
                className="stu-btn stu-btn-ghost"
                onClick={() => {
                  dismissWhatsNew()
                  openWhatsNewHistory()
                }}
              >
                Full history
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
