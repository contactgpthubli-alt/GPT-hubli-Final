"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { buildStudyCertPrintHtml, formFromAcmCert, printStudyCertHtml } from "@/lib/study-cert-print"
import {
  buildStudentProfilePrintHtml,
  printStudentProfileHtml,
} from "@/lib/student-profile-print"
import {
  STUDENT_APP_CHANGELOG,
  STUDENT_APP_VERSION,
  currentUpdate,
  setSeenAppVersion,
  shouldShowWhatsNew,
} from "@/lib/student-app-version"
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

export default function StudentApp() {
  const [booting, setBooting] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [tab, setTab] = useState<Tab>("home")
  const [moreView, setMoreView] = useState<MoreView>("menu")

  const [authMode, setAuthMode] = useState<AuthMode>("login")
  const [loginId, setLoginId] = useState("")
  const [loginPw, setLoginPw] = useState("")
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginErr, setLoginErr] = useState("")

  // Create account
  const [regName, setRegName] = useState("")
  const [regNo, setRegNo] = useState("")
  const [regBranch, setRegBranch] = useState(BRANCH_OPTIONS[0])
  const [regEmail, setRegEmail] = useState("")
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

  const requiresSetup = !!(user?.force_password_change || user?.requires_setup)
  const profilePhoto = useMemo(() => {
    if (profilePhotoDraft) return profilePhotoDraft
    return extractProfilePhoto(student?.extra || null)
  }, [student, profilePhotoDraft])
  const readyCerts = useMemo(() => certs.filter((c) => isCertReady(c.status)), [certs])
  const profileLocked = useMemo(() => {
    const extra = student?.extra || {}
    return extra.profile_edit_locked === true || extra.profile_edit_locked === "true"
  }, [student])
  const openForms = useMemo(
    () => forms.filter((f) => String(f.status).toLowerCase() === "open"),
    [forms],
  )
  const pendingForms = openForms.filter((f) => !f.submitted_by_me)

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
    const [s, r, f, c, a, n, pr, sch, g] = await Promise.all([
      api<{ students: Student[] }>("/api/students"),
      api<{ results: ResultRow[] }>("/api/results"),
      api<{ forms: FormRow[] }>("/api/forms"),
      api<{ requests: CertRow[] }>("/api/cert-requests"),
      api<{ certificates?: AcmCert[] }>("/api/acm-certs?kind=mine"),
      api<{ notices: NoticeRow[] }>("/api/notices"),
      api<{ pending?: unknown[]; mine_pending?: number }>("/api/profile-requests?mine=1"),
      api<{ schema?: SchemaSection[] | null }>("/api/profile-schema?key=student"),
      api<{ grievances: Grievance[] }>("/api/grievances"),
    ])

    let nextStudent: Student | null = null
    if (s.ok && s.data?.students?.[0]) nextStudent = s.data.students[0]
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

  useEffect(() => {
    if (user && !requiresSetup) loadDashboard()
  }, [user, requiresSetup, loadDashboard])

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
    setUser({
      ...u,
      requires_setup: !!(u.force_password_change || res.data.requires_setup || u.requires_setup),
    })
    setTab("home")
  }

  async function doRegister() {
    setRegErr("")
    setRegOk("")
    const name = regName.trim()
    const reg = regNo.trim().toUpperCase()
    const email = regEmail.trim().toLowerCase()
    if (!name || name.length < 2) {
      setRegErr("Enter your full name.")
      return
    }
    if (!reg || reg.length < 6) {
      setRegErr("Enter a valid Register Number.")
      return
    }
    if (!regBranch) {
      setRegErr("Select your branch.")
      return
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegErr("Enter a valid email address.")
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
        email,
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
        "Account created. An admin must approve your account before you can sign in.",
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
    setUser(null)
    setStudent(null)
    setResults([])
    setForms([])
    setCerts([])
    setAcmCerts([])
    setGrievances([])
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
    if (profileLocked) {
      setProfileErr("Profile editing is locked by Admin. Contact the office.")
      return
    }
    if (profilePending) {
      setProfileErr("You already have a profile update pending approval.")
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
    if (profileLocked) {
      setProfileErr("Profile editing is locked by Admin.")
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

    const res = await api("/api/profile-requests", {
      method: "POST",
      body: JSON.stringify({
        targetType: "student",
        targetId: user.reg_no,
        changes,
      }),
    })
    setProfileBusy(false)
    if (!res.ok) {
      setProfileErr(res.error || "Could not submit profile update")
      return
    }
    setProfileMsg("Update submitted. Waiting for Admin/HOD/ACM approval.")
    setProfileEditing(false)
    setProfilePending(true)
    setProfilePhotoDraft(null)
    flash("Profile update submitted for approval")
    await loadDashboard()
  }

  async function submitCertRequest() {
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

  function printIssuedCert(c: AcmCert) {
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
      printStudyCertHtml(html)
      flash("Opening print…")
    } catch {
      flash("Could not open print. Try again.")
    } finally {
      setTimeout(() => setPrintBusyId(null), 800)
    }
  }

  function printFullProfile() {
    const extra = (student?.extra && typeof student.extra === "object" ? student.extra : {}) as Record<
      string,
      unknown
    >
    const mother =
      (extra["Mother Name"] != null ? String(extra["Mother Name"]) : "") ||
      (extra["Mother's Name"] != null ? String(extra["Mother's Name"]) : "")
    const html = buildStudentProfilePrintHtml({
      name: student?.name || user?.display_name || "",
      reg_no: student?.reg_no || user?.reg_no || "",
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
        "Register Number": student?.reg_no || user?.reg_no || "",
        Branch: student?.dept || profileDraft.Branch || extra.Branch,
      },
    })
    printStudentProfileHtml(html)
    flash("Opening full profile print (A4)…")
  }

  function openFormFill(form: FormRow) {
    if (form.submitted_by_me) {
      flash("You already submitted this form")
      return
    }
    if (String(form.status).toLowerCase() !== "open") {
      flash("This form is closed")
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
    const fields = parseFormFields(activeForm.fields)
    for (const f of fields) {
      const key = fieldLabel(f)
      if (f.required && !String(formAnswers[key] || "").trim()) {
        setFormErr(`Please answer: ${key}`)
        return
      }
    }
    setFormBusy(true)
    setFormErr("")
    const res = await api(`/api/forms/${activeForm.id}/responses`, {
      method: "POST",
      body: JSON.stringify({ answers: formAnswers }),
    })
    setFormBusy(false)
    if (!res.ok) {
      setFormErr(res.error || "Could not submit form")
      return
    }
    flash("Form submitted successfully")
    setActiveForm(null)
    setMoreView("menu")
    setTab("forms")
    await loadDashboard()
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
      if (moreView === "attendance") return "Attendance"
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
            <>
              <h2>Student sign in</h2>
              <p className="sub">
                Use your <strong>Register Number</strong> and password. Imported students use the temporary password
                until first login setup.
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
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doLogin()}
                />
              </div>
              <button type="button" className="stu-btn stu-btn-primary" disabled={loginBusy} onClick={doLogin}>
                {loginBusy ? "Signing in…" : "Sign in"}
              </button>
              <p className="stu-auth-switch">
                New student?{" "}
                <button type="button" className="stu-link-btn" onClick={() => switchAuthMode("register")}>
                  Create account
                </button>
              </p>
            </>
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
                  placeholder="e.g. 171CS15003"
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value.toUpperCase())}
                />
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
                <label>Email *</label>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                />
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
                    setLoginId(regEmail || regNo)
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
              <button type="button" className="stu-btn stu-btn-primary" onClick={dismissWhatsNew}>
                Got it
              </button>
            </div>
          </div>
        ) : null}
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
        {toast ? <div className="stu-msg stu-msg-ok">{toast}</div> : null}
        {dataErr ? <div className="stu-msg stu-msg-err">{dataErr}</div> : null}

        {/* ---------- HOME ---------- */}
        {tab === "home" && (
          <>
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
                  if (!profilePending && !profileLocked) startProfileEdit()
                }}
              >
                <span className="ico">✏️</span>
                <span className="t">Update profile</span>
                <span className="d">{profilePending ? "Pending approval" : "Send for approval"}</span>
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
                <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" onClick={printFullProfile}>
                  🖨️ Print A4
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
              <div className="stu-msg stu-msg-info">Profile is view-only while an update is pending approval.</div>
            ) : null}
            {profileLocked ? (
              <div className="stu-msg stu-msg-info">Editing locked by Admin. Contact the office for changes.</div>
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
                  <button type="button" className="stu-btn stu-btn-primary" onClick={printFullProfile}>
                    🖨️ Print full profile (A4)
                  </button>
                  <button
                    type="button"
                    className="stu-btn stu-btn-ghost"
                    disabled={profilePending || profileLocked}
                    onClick={startProfileEdit}
                  >
                    ✏️ Edit &amp; request update
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
                      {profileBusy ? "Submitting…" : "Submit for approval"}
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

        {/* ---------- FORMS LIST ---------- */}
        {tab === "forms" && moreView !== "formFill" && (
          <div className="stu-card">
            <h3>Submit forms</h3>
            <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "var(--stu-muted)" }}>
              Tap a form to fill and submit. Already submitted forms stay marked Done.
            </p>
            {!forms.length ? (
              <div className="stu-empty">No forms available.</div>
            ) : (
              forms.map((f) => (
                <div className="stu-list-item" key={f.id}>
                  <div style={{ flex: 1 }}>
                    <div className="title">{f.title}</div>
                    <div className="desc">{f.description || "No description"}</div>
                    <div className="desc">{fmtDate(f.created_at)}</div>
                    {!f.submitted_by_me && String(f.status).toLowerCase() === "open" ? (
                      <button
                        type="button"
                        className="stu-link-btn"
                        style={{ marginTop: 6 }}
                        onClick={() => openFormFill(f)}
                      >
                        Fill &amp; submit →
                      </button>
                    ) : null}
                  </div>
                  <span className={`stu-badge ${statusBadge(f.submitted_by_me ? "ready" : f.status)}`}>
                    {f.submitted_by_me ? "Done" : f.status}
                  </span>
                </div>
              ))
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
              <button type="button" onClick={() => setMoreView("certRequest")}>
                <span className="ico">➕</span>
                <span className="t">Request certificate</span>
                <span className="d">New ACM / Exam request</span>
              </button>
              <button type="button" onClick={() => setMoreView("certs")}>
                <span className="ico">📜</span>
                <span className="t">My certificates</span>
                <span className="d">{readyCerts.length ? `${readyCerts.length} ready` : `${certs.length} request(s)`}</span>
              </button>
              <button type="button" onClick={() => setMoreView("grievances")}>
                <span className="ico">📨</span>
                <span className="t">Grievances</span>
                <span className="d">{grievances.length} filed</span>
              </button>
              <button type="button" onClick={() => setMoreView("attendance")}>
                <span className="ico">📅</span>
                <span className="t">Attendance</span>
                <span className="d">{student?.att || "Summary"}</span>
              </button>
              <button type="button" onClick={() => setMoreView("notices")}>
                <span className="ico">📢</span>
                <span className="t">Notices</span>
                <span className="d">{notices.length} recent</span>
              </button>
              <button type="button" onClick={() => setMoreView("whatsNew")}>
                <span className="ico">✨</span>
                <span className="t">What&apos;s new</span>
                <span className="d">App v{STUDENT_APP_VERSION}</span>
              </button>
              <button type="button" onClick={() => setMoreView("password")}>
                <span className="ico">🔐</span>
                <span className="t">Change password</span>
                <span className="d">Account security</span>
              </button>
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
            </div>
          </>
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
            <h3 style={{ marginTop: 18 }}>Issued certificates (ready to print)</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--stu-muted)", marginTop: 0 }}>
              After ACM releases your Study / Studying certificate, use <strong>Print</strong> for your
              own copy (includes profile photo when available).
            </p>
            {!acmCerts.length ? (
              <div className="stu-empty">
                No certificates released yet. When ACM completes and sends your Study / Studying
                certificate, it will appear here with a Print button.
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
                        onClick={() => printIssuedCert(c)}
                      >
                        {printBusyId === c.id ? "…" : "🖨️ Print"}
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
              once when a new version is released.
            </p>
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
              <button type="button" className="stu-btn stu-btn-primary" onClick={dismissWhatsNew}>
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
