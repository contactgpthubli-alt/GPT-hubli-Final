/**
 * Student exam self-entry, verification, multi-attempt subjects,
 * live exam-fee calculation, multi K2 challan (manual Exam tick — no K2 API).
 */

import { query } from "@/lib/db"
import {
  academicYearStart,
  inferCurrentSemester,
  normalizeAcademicYear,
  type EntryType,
} from "@/lib/academic-year"
import {
  computeCgpaFromCourses,
  creditsMapFromCurriculum,
  defaultSubjectCredits,
  type CgpaResult,
} from "@/lib/c20-grade-points"
import {
  branchCodeFromDept,
  getCurriculumSubjects,
  schemeFromAdmissionYear,
  type BranchCode,
} from "@/lib/curriculum-c20"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"
import { normalizeBranch } from "@/lib/branches"

export const EXAM_VERIFIERS = ["admin", "principal", "hod", "exam"] as const
export const EXAM_FEE_MANAGERS = ["admin", "exam", "principal"] as const

export type AttemptResult = "pass" | "fail" | "absent"
export type AttemptStatus = "draft" | "pending" | "verified" | "rejected"
export type FeePaymentStatus =
  | "due"
  | "challan_submitted"
  | "paid"
  | "partial"
  | "waived"
  | "rejected"

let schemaReady = false

export async function ensureExamResultsSchema(): Promise<void> {
  if (schemaReady) return

  await query(`
    CREATE TABLE IF NOT EXISTS student_exam_attempts (
      id            BIGSERIAL PRIMARY KEY,
      reg_no        TEXT NOT NULL,
      scheme        TEXT NOT NULL DEFAULT 'C-20',
      branch_code   TEXT NOT NULL,
      semester      INT  NOT NULL,
      subject_code  TEXT NOT NULL,
      subject_name  TEXT NOT NULL,
      exam_session  TEXT NOT NULL,
      result        TEXT NOT NULL DEFAULT 'fail',
      grade         TEXT NOT NULL DEFAULT '',
      cie_marks     INT,
      see_marks     INT,
      status        TEXT NOT NULL DEFAULT 'draft',
      reject_note   TEXT,
      submitted_at  TIMESTAMPTZ,
      verified_at   TIMESTAMPTZ,
      verified_by   BIGINT,
      verified_by_name TEXT,
      verifier_role TEXT,
      created_by    BIGINT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_stu_exam_attempts_reg ON student_exam_attempts(reg_no, semester, subject_code)`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_stu_exam_attempts_status ON student_exam_attempts(status, branch_code)`,
  )
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_stu_exam_attempts_unique
       ON student_exam_attempts(reg_no, subject_code, exam_session)
       WHERE status IS DISTINCT FROM 'rejected'`,
  )

  await query(`
    CREATE TABLE IF NOT EXISTS exam_fee_payments (
      id              BIGSERIAL PRIMARY KEY,
      reg_no          TEXT NOT NULL,
      exam_cycle      TEXT NOT NULL DEFAULT 'current',
      entry_type      TEXT NOT NULL DEFAULT 'regular',
      computed_total  INT NOT NULL DEFAULT 0,
      fine_amount     INT NOT NULL DEFAULT 0,
      breakup         JSONB NOT NULL DEFAULT '[]'::jsonb,
      status          TEXT NOT NULL DEFAULT 'due',
      challans        JSONB NOT NULL DEFAULT '[]'::jsonb,
      student_note    TEXT,
      staff_note      TEXT,
      submitted_at    TIMESTAMPTZ,
      paid_marked_at  TIMESTAMPTZ,
      paid_marked_by  BIGINT,
      paid_marked_by_name TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_exam_fee_reg ON exam_fee_payments(reg_no, exam_cycle)`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_exam_fee_status ON exam_fee_payments(status, updated_at DESC)`,
  )
  await query(
    `ALTER TABLE exam_fee_payments ADD COLUMN IF NOT EXISTS paid_marked_by_role TEXT`,
  )

  /** Exam Cell fine windows: date ranges + fine amount (0 = without fine). */
  await query(`
    CREATE TABLE IF NOT EXISTS exam_fee_fine_schedule (
      id              BIGSERIAL PRIMARY KEY,
      exam_cycle      TEXT NOT NULL DEFAULT 'current',
      from_date       DATE NOT NULL,
      to_date         DATE NOT NULL,
      fine_amount     INT  NOT NULL DEFAULT 0,
      ord             INT  NOT NULL DEFAULT 0,
      label           TEXT,
      created_by      BIGINT,
      created_by_name TEXT,
      created_by_role TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT exam_fee_fine_schedule_dates CHECK (to_date >= from_date),
      CONSTRAINT exam_fee_fine_schedule_amt CHECK (fine_amount >= 0)
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_exam_fee_fine_sched_cycle
       ON exam_fee_fine_schedule(exam_cycle, ord, from_date)`,
  )

  schemaReady = true
}

export type FineScheduleTier = {
  id?: number
  exam_cycle?: string
  from_date: string
  to_date: string
  fine_amount: number
  ord: number
  label?: string | null
}

/** Calendar date YYYY-MM-DD in Asia/Kolkata. */
export function todayIndiaISO(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

function formatDmy(iso: string): string {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}-${m[2]}-${m[1]}`
}

/**
 * Resolve fine for a calendar day from Exam Cell schedule tiers.
 * - Matching from..to inclusive → that fine
 * - Before first tier → 0
 * - After last tier ends → last tier fine (Exam must update schedule)
 */
export function resolveFineFromSchedule(
  tiers: FineScheduleTier[],
  onDate?: string | null,
): {
  fine: number
  label: string
  tier: FineScheduleTier | null
  as_of: string
  has_schedule: boolean
} {
  const asOf = (onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : todayIndiaISO()) as string
  if (!tiers.length) {
    return {
      fine: 0,
      label: "No fine schedule set by Exam Section",
      tier: null,
      as_of: asOf,
      has_schedule: false,
    }
  }
  const sorted = tiers
    .slice()
    .sort(
      (a, b) =>
        String(a.from_date).localeCompare(String(b.from_date)) ||
        (a.ord || 0) - (b.ord || 0),
    )

  for (const t of sorted) {
    const from = String(t.from_date).slice(0, 10)
    const to = String(t.to_date).slice(0, 10)
    if (asOf >= from && asOf <= to) {
      const amt = Math.max(0, Number(t.fine_amount) || 0)
      return {
        fine: amt,
        label:
          amt === 0
            ? `No fine (until ${formatDmy(to)})`
            : `Fine (${formatDmy(from)} – ${formatDmy(to)})`,
        tier: t,
        as_of: asOf,
        has_schedule: true,
      }
    }
  }

  if (asOf < String(sorted[0].from_date).slice(0, 10)) {
    return {
      fine: 0,
      label: `Before fee window (starts ${formatDmy(String(sorted[0].from_date).slice(0, 10))})`,
      tier: null,
      as_of: asOf,
      has_schedule: true,
    }
  }

  const last = sorted[sorted.length - 1]
  const amt = Math.max(0, Number(last.fine_amount) || 0)
  const lastTo = String(last.to_date).slice(0, 10)
  return {
    fine: amt,
    label:
      amt === 0
        ? `No fine (schedule ended ${formatDmy(lastTo)})`
        : `Fine (after ${formatDmy(lastTo)} — last schedule rate)`,
    tier: last,
    as_of: asOf,
    has_schedule: true,
  }
}

export async function loadFineSchedule(examCycle = "current"): Promise<FineScheduleTier[]> {
  await ensureExamResultsSchema()
  const cycle = String(examCycle || "current").trim() || "current"
  const { rows } = await query(
    `SELECT id, exam_cycle, to_char(from_date, 'YYYY-MM-DD') AS from_date,
            to_char(to_date, 'YYYY-MM-DD') AS to_date,
            fine_amount, ord, label
       FROM exam_fee_fine_schedule
      WHERE exam_cycle = $1
      ORDER BY from_date ASC, ord ASC, id ASC`,
    [cycle],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    exam_cycle: String(r.exam_cycle),
    from_date: String(r.from_date),
    to_date: String(r.to_date),
    fine_amount: Number(r.fine_amount) || 0,
    ord: Number(r.ord) || 0,
    label: r.label != null ? String(r.label) : null,
  }))
}

/** Map admission year → scheme (C-20: 2020-21..2024-25, C-25: 2025-26+). */
export function resolveStudentScheme(admissionAy: string | null | undefined): {
  scheme: "C-20" | "C-25" | "unknown"
  admission_year: string | null
} {
  const ay = normalizeAcademicYear(admissionAy) || (admissionAy ? String(admissionAy).trim() : null)
  return { scheme: schemeFromAdmissionYear(ay), admission_year: ay }
}

export type ExamAttemptRow = {
  id: number
  reg_no: string
  scheme: string
  branch_code: string
  semester: number
  subject_code: string
  subject_name: string
  exam_session: string
  result: AttemptResult
  grade: string
  cie_marks: number | null
  see_marks: number | null
  status: AttemptStatus
  reject_note: string | null
  submitted_at: string | null
  verified_at: string | null
  verified_by_name: string | null
  verifier_role: string | null
}

/** Latest effective status per subject (prefer verified pass; then latest attempt). */
export function effectiveSubjectStatus(attempts: ExamAttemptRow[]): {
  subject_code: string
  subject_name: string
  semester: number
  effective: AttemptResult | "unknown"
  grade: string
  latest_session: string
  passed: boolean
  attempts: ExamAttemptRow[]
}[] {
  const bySub = new Map<string, ExamAttemptRow[]>()
  for (const a of attempts) {
    const k = a.subject_code
    if (!bySub.has(k)) bySub.set(k, [])
    bySub.get(k)!.push(a)
  }
  const out: ReturnType<typeof effectiveSubjectStatus> = []
  for (const [code, list] of bySub) {
    const sorted = list.slice().sort((a, b) => {
      // verified pass wins; then by id desc
      if (a.status === "verified" && a.result === "pass" && !(b.status === "verified" && b.result === "pass"))
        return -1
      if (b.status === "verified" && b.result === "pass" && !(a.status === "verified" && a.result === "pass"))
        return 1
      return Number(b.id) - Number(a.id)
    })
    const verifiedPass = sorted.find((x) => x.status === "verified" && x.result === "pass")
    const best = verifiedPass || sorted[0]
    const passed = sorted.some((x) => x.status === "verified" && x.result === "pass")
    out.push({
      subject_code: code,
      subject_name: best.subject_name,
      semester: best.semester,
      effective: best ? best.result : "unknown",
      grade: best?.grade || "",
      latest_session: best?.exam_session || "",
      passed,
      attempts: list,
    })
  }
  return out.sort((a, b) => a.semester - b.semester || a.subject_code.localeCompare(b.subject_code))
}

/**
 * Live CGPA from exam attempts using C-20 grade points + curriculum credits.
 * - Official: only verified attempts
 * - Provisional: verified + pending (student self-view before HOD ticks)
 */
export function computeCgpaFromAttempts(
  attempts: ExamAttemptRow[],
  opts: {
    branch_code: BranchCode | null
    scheme?: string
    entry_type?: EntryType
    /** true = include pending passes for student KPI */
    provisional?: boolean
  },
): CgpaResult {
  const provisional = !!opts.provisional
  const allowed = new Set(provisional ? ["verified", "pending"] : ["verified"])
  const bySub = new Map<string, ExamAttemptRow>()
  for (const a of attempts) {
    if (!allowed.has(a.status)) continue
    if (a.result !== "pass" && a.result !== "fail" && a.result !== "absent") continue
    const prev = bySub.get(a.subject_code)
    // Prefer verified pass, else latest
    if (!prev) {
      bySub.set(a.subject_code, a)
      continue
    }
    const aScore =
      (a.status === "verified" && a.result === "pass" ? 100 : 0) +
      (a.result === "pass" ? 10 : 0) +
      Number(a.id)
    const pScore =
      (prev.status === "verified" && prev.result === "pass" ? 100 : 0) +
      (prev.result === "pass" ? 10 : 0) +
      Number(prev.id)
    if (aScore >= pScore) bySub.set(a.subject_code, a)
  }

  const scheme = String(opts.scheme || "C-20").toUpperCase()
  const curriculum =
    opts.branch_code && (scheme === "C-20" || scheme === "C-25")
      ? getCurriculumSubjects({
          scheme: scheme === "C-25" ? "C-25" : "C-20",
          branch: opts.branch_code,
          entryType: opts.entry_type || "regular",
          includeYear1ForLateral: true,
        })
      : []
  const creditMap = creditsMapFromCurriculum(curriculum)

  const courses = Array.from(bySub.values()).map((a) => ({
    subject_code: a.subject_code,
    subject_name: a.subject_name,
    grade: a.grade,
    result: a.result,
    semester: a.semester,
    credits:
      creditMap.get(a.subject_code.toUpperCase()) ??
      defaultSubjectCredits({ code: a.subject_code, name: a.subject_name }),
  }))

  return computeCgpaFromCourses(courses, { provisional })
}

/** Persist CGPA string onto students.cgpa (official = verified only). */
export async function recomputeAndStoreStudentCgpa(regNo: string): Promise<CgpaResult | null> {
  const ctx = await loadStudentContext(regNo)
  if (!ctx) return null
  const { rows } = await query(
    `SELECT * FROM student_exam_attempts WHERE reg_no = $1 ORDER BY id`,
    [regNo],
  )
  const attempts = rows.map((r) => ({
    id: Number(r.id),
    reg_no: String(r.reg_no),
    scheme: String(r.scheme),
    branch_code: String(r.branch_code),
    semester: Number(r.semester),
    subject_code: String(r.subject_code),
    subject_name: String(r.subject_name),
    exam_session: String(r.exam_session),
    result: String(r.result) as AttemptResult,
    grade: String(r.grade || ""),
    cie_marks: r.cie_marks != null ? Number(r.cie_marks) : null,
    see_marks: r.see_marks != null ? Number(r.see_marks) : null,
    status: String(r.status) as AttemptStatus,
    reject_note: r.reject_note != null ? String(r.reject_note) : null,
    submitted_at: r.submitted_at ? String(r.submitted_at) : null,
    verified_at: r.verified_at ? String(r.verified_at) : null,
    verified_by_name: r.verified_by_name != null ? String(r.verified_by_name) : null,
    verifier_role: r.verifier_role != null ? String(r.verifier_role) : null,
  }))
  const official = computeCgpaFromAttempts(attempts, {
    branch_code: ctx.branch_code,
    scheme: ctx.scheme,
    entry_type: ctx.entry_type,
    provisional: false,
  })
  const provisional = computeCgpaFromAttempts(attempts, {
    branch_code: ctx.branch_code,
    scheme: ctx.scheme,
    entry_type: ctx.entry_type,
    provisional: true,
  })
  // Store best available: official first, else provisional so KPI is not empty after student entry
  const label = official.label || provisional.label
  if (label) {
    await query(`UPDATE students SET cgpa = $2 WHERE UPPER(reg_no) = UPPER($1)`, [regNo, label])
  }
  return official.label ? official : provisional
}

/** Same fee rules as legacy Exam Fees calculator. */
export function feeForSemStatus(
  kind: "regular" | "backlog_count" | "passed" | "not_this_sem" | "bridge",
  failCount?: number,
): number {
  if (kind === "not_this_sem" || kind === "passed") return 0
  if (kind === "regular") return 350
  if (kind === "bridge") {
    const n = failCount ?? 0
    if (n <= 0) return 200
    if (n <= 2) return 250
    return 350
  }
  const n = failCount ?? 0
  if (n <= 0) return 0
  if (n === 1 || n === 2) return 250
  return 350
}

export type FeeBreakupLine = {
  label: string
  semester: number | null
  kind: string
  fail_count: number
  amount: number
}

/**
 * Compute exam fees from verified (and optionally pending) attempts.
 * - Regular current study year semesters that still have open fails → regular or backlog fee
 * - Older semesters with remaining fails → backlog fee by fail count
 */
export function computeExamFees(opts: {
  entryType: EntryType
  currentStudyYear: number | null
  /** Running semester from calendar (Jun odd / Jan even). Falls back to inferred. */
  currentSemester?: number | null
  effective: ReturnType<typeof effectiveSubjectStatus>
  fine?: number
  /** Label for the fine line (e.g. date window from Exam schedule). */
  fineLabel?: string | null
  /** If true, count pending+verified; else verified only for "must pay" */
  includePending?: boolean
}): { total: number; fine: number; lines: FeeBreakupLine[] } {
  const includePending = opts.includePending !== false
  const fine = Math.max(0, Number(opts.fine) || 0)
  const fineLabel = (opts.fineLabel && String(opts.fineLabel).trim()) || "Fine"
  const lines: FeeBreakupLine[] = []

  // Only subjects that are not yet passed (verified pass)
  const open = opts.effective.filter((e) => {
    if (e.passed) return false
    // need at least one attempt that is fail/absent and pending or verified
    const relevant = e.attempts.filter((a) => {
      if (a.result === "pass" && a.status === "verified") return false
      if (!includePending && a.status !== "verified") return false
      if (a.status === "rejected" || a.status === "draft") return false
      return a.result === "fail" || a.result === "absent"
    })
    // also count subjects with no pass yet even if only draft — for student preview
    if (relevant.length) return true
    // no pass attempt at all → still backlog if they marked fail in draft for fees preview
    return e.attempts.some((a) => a.result !== "pass" && a.status !== "rejected")
  })

  const bySem = new Map<number, typeof open>()
  for (const e of open) {
    if (!bySem.has(e.semester)) bySem.set(e.semester, [])
    bySem.get(e.semester)!.push(e)
  }

  // Only the calendar-running semester counts as regular (Jun–Dec odd, Jan–May even)
  const cy = opts.currentStudyYear
  const regularSems = new Set<number>()
  const running = opts.currentSemester ?? inferCurrentSemester(cy)
  if (running != null) regularSems.add(running)

  for (let sem = 1; sem <= 6; sem++) {
    if (opts.entryType === "lateral" && sem < 3) continue
    const fails = bySem.get(sem) || []
    const failCount = fails.length
    const isRegularWindow = regularSems.has(sem)

    if (failCount === 0 && !isRegularWindow) continue

    if (failCount === 0 && isRegularWindow) {
      // Appearing as regular (no backlog listed) — charge regular
      const amount = feeForSemStatus("regular")
      lines.push({
        label: `Sem ${sem} — Regular appearance`,
        semester: sem,
        kind: "regular",
        fail_count: 0,
        amount,
      })
      continue
    }

    if (failCount > 0) {
      const amount = feeForSemStatus("backlog_count", failCount)
      lines.push({
        label: `Sem ${sem} — ${failCount} backlog subject(s)`,
        semester: sem,
        kind: "backlog",
        fail_count: failCount,
        amount,
      })
    }
  }

  // Lateral bridge optional lines are manual fine-style — skip auto unless fails in "bridge" not modeled
  let total = lines.reduce((s, l) => s + l.amount, 0) + fine
  if (fine > 0) {
    lines.push({
      label: fineLabel,
      semester: null,
      kind: "fine",
      fail_count: 0,
      amount: fine,
    })
  } else if (opts.fineLabel) {
    // Show zero-fine window so students see Exam schedule status
    lines.push({
      label: fineLabel,
      semester: null,
      kind: "fine",
      fail_count: 0,
      amount: 0,
    })
  }
  return { total, fine, lines }
}

export async function loadStudentContext(regNo: string): Promise<{
  reg_no: string
  name: string
  branch: string
  branch_code: BranchCode | null
  admission_academic_year: string | null
  entry_type: EntryType
  current_study_year: number | null
  scheme: "C-20" | "C-25" | "unknown"
} | null> {
  const { rows } = await query(
    `SELECT u.reg_no, u.display_name, u.branch AS user_branch,
            s.name AS student_name, s.dept, s.admission_academic_year,
            s.entry_type, s.current_study_year, s.extra
       FROM users u
       LEFT JOIN students s ON s.reg_no = u.reg_no
      WHERE u.reg_no = $1 AND u.role = 'student' AND u.deleted_at IS NULL
      LIMIT 1`,
    [regNo],
  )
  const r = rows[0]
  if (!r) return null
  const extra =
    r.extra && typeof r.extra === "object" && !Array.isArray(r.extra)
      ? (r.extra as Record<string, unknown>)
      : {}
  const adm =
    (r.admission_academic_year && String(r.admission_academic_year)) ||
    (typeof extra["Admission Academic Year"] === "string"
      ? String(extra["Admission Academic Year"])
      : typeof extra["Year of Admission"] === "string"
        ? String(extra["Year of Admission"])
        : null)
  const { scheme, admission_year } = resolveStudentScheme(adm)
  const dept = normalizeBranch(r.dept) || normalizeBranch(r.user_branch) || ""
  const branch_code = branchCodeFromDept(dept)
  const entryRaw = String(r.entry_type || "regular").toLowerCase()
  const entry_type: EntryType = entryRaw === "lateral" ? "lateral" : "regular"
  return {
    reg_no: r.reg_no,
    name: r.student_name || r.display_name || regNo,
    branch: dept || "—",
    branch_code,
    admission_academic_year: admission_year,
    entry_type,
    current_study_year: r.current_study_year != null ? Number(r.current_study_year) : null,
    scheme,
  }
}

export async function staffCanAccessReg(
  user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null },
  regNo: string,
): Promise<boolean> {
  if (user.role === "admin" || user.role === "principal" || user.role === "exam") return true
  if (user.role !== "hod") return false
  const my = hodBranchOf(user)
  if (!my) return false
  const ctx = await loadStudentContext(regNo)
  if (!ctx) return false
  return branchesMatch(my, ctx.branch)
}

export function curriculumForStudent(ctx: {
  scheme: string
  branch_code: BranchCode | null
  entry_type: EntryType
}) {
  if (!ctx.branch_code) return []
  const scheme = String(ctx.scheme || "").toUpperCase()
  if (scheme !== "C-20" && scheme !== "C-25") return []
  return getCurriculumSubjects({
    scheme: scheme === "C-25" ? "C-25" : "C-20",
    branch: ctx.branch_code,
    entryType: ctx.entry_type,
    includeYear1ForLateral: false,
  })
}

/** Async: apply HOD pathway assignment for Sem 5–6. */
export async function curriculumForStudentWithPathway(
  ctx: {
    scheme: string
    branch_code: BranchCode | null
    entry_type: EntryType
    reg_no?: string
  },
  academicYear?: string | null,
) {
  const base = curriculumForStudent(ctx)
  if (!ctx.reg_no) {
    return {
      subjects: base,
      pathway_required: false,
      pathway: null as null,
      pathway_note: null as string | null,
    }
  }
  const { getStudentPathway, filterCurriculumByPathway } = await import("@/lib/pathways")
  const assignment = await getStudentPathway(ctx.reg_no, academicYear)
  return filterCurriculumByPathway(base, assignment)
}

export type ChallanEntry = {
  receipt_no: string
  amount: number
  paid_on?: string | null
  note?: string | null
}

export function parseChallans(raw: unknown): ChallanEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((c) => {
      if (!c || typeof c !== "object") return null
      const o = c as Record<string, unknown>
      const receipt_no = String(o.receipt_no || o.receipt || "").trim()
      const amount = Number(o.amount) || 0
      if (!receipt_no && amount <= 0) return null
      return {
        receipt_no,
        amount,
        paid_on: o.paid_on != null ? String(o.paid_on) : null,
        note: o.note != null ? String(o.note) : null,
      }
    })
    .filter(Boolean) as ChallanEntry[]
}

export function challanTotal(challans: ChallanEntry[]): number {
  return challans.reduce((s, c) => s + (Number(c.amount) || 0), 0)
}

/** Detect ITI / PUC style notes in free text for desk badges. */
export function entryPathwayHint(entryType: EntryType, extra?: Record<string, unknown>): string | null {
  if (entryType === "lateral") {
    const blob = JSON.stringify(extra || {}).toLowerCase()
    if (blob.includes("iti")) return "Lateral — ITI pathway"
    if (blob.includes("puc") || blob.includes("12th") || blob.includes("ii puc")) return "Lateral — PUC pathway"
    return "Lateral entry (ITI / PUC) — Year-1 subjects usually N/A"
  }
  return null
}

export function academicYearInC20Range(ay: string | null): boolean {
  const y = academicYearStart(ay || "")
  return y != null && y >= 2020 && y <= 2024
}
