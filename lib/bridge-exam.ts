/**
 * Bridge Course (ITI / PUC lateral-entry gap subjects) — free-text self-entry,
 * always open (no Exam-declared cycle), separate fee tiers from regular/makeup.
 *
 * Subjects are NOT curriculum-backed (students type the subject name), so attempts
 * live in their own table instead of student_exam_attempts — mixing them into that
 * table would leak phantom subjects into regular CGPA and regular exam-fee
 * computation, which group purely by subject_code with no curriculum cross-check.
 */
import { query } from "@/lib/db"
import { ensureExamResultsSchema, type AttemptResult, type AttemptStatus } from "@/lib/exam-results"
import { stampFromSession, type SessionLike } from "@/lib/signature-stamp"
import { stripEmoji } from "@/lib/no-emoji"

export const BRIDGE_MANAGERS = ["admin", "exam", "principal"] as const
export const BRIDGE_VERIFIERS = ["admin", "principal", "hod", "exam"] as const

/** exam_fee_payments rows for Bridge always use this cycle key + fee_kind='bridge'. */
export const BRIDGE_FEE_CYCLE = "bridge"

export type BridgeAttemptRow = {
  id: number
  reg_no: string
  branch_code: string
  semester: number
  subject_name: string
  result: AttemptResult
  grade: string
  status: AttemptStatus
  reject_note: string | null
  submitted_at: string | null
  verified_at: string | null
  verified_by_name: string | null
  verifier_role: string | null
  created_at: string | null
  updated_at: string | null
}

export type BridgeFeeLine = {
  label: string
  kind: "bridge_regular" | "bridge_failed"
  amount: number
}

let bridgeSchemaReady = false

export async function ensureBridgeExamSchema(): Promise<void> {
  if (bridgeSchemaReady) return
  await ensureExamResultsSchema()

  await query(`
    CREATE TABLE IF NOT EXISTS bridge_attempts (
      id            BIGSERIAL PRIMARY KEY,
      reg_no        TEXT NOT NULL,
      branch_code   TEXT NOT NULL,
      semester      INT  NOT NULL,
      subject_name  TEXT NOT NULL,
      result        TEXT NOT NULL DEFAULT 'fail',
      grade         TEXT NOT NULL DEFAULT '',
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
    `CREATE INDEX IF NOT EXISTS idx_bridge_attempts_reg ON bridge_attempts(reg_no, status)`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_bridge_attempts_status ON bridge_attempts(status, branch_code)`,
  )

  // Shared with regular/makeup fee payments; re-declared here so this module
  // doesn't need to depend on lib/makeup-exam.ts for its own readiness.
  await query(
    `ALTER TABLE exam_fee_payments ADD COLUMN IF NOT EXISTS fee_kind TEXT NOT NULL DEFAULT 'regular'`,
  )
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_fee_bridge_unique
       ON exam_fee_payments(reg_no)
       WHERE fee_kind = 'bridge'`,
  )

  bridgeSchemaReady = true
}

export function mapBridgeAttempt(r: Record<string, unknown>): BridgeAttemptRow {
  return {
    id: Number(r.id),
    reg_no: String(r.reg_no),
    branch_code: String(r.branch_code),
    semester: Number(r.semester),
    subject_name: String(r.subject_name),
    result: String(r.result) as AttemptResult,
    grade: String(r.grade || ""),
    status: String(r.status) as AttemptStatus,
    reject_note: r.reject_note != null ? String(r.reject_note) : null,
    submitted_at: r.submitted_at ? String(r.submitted_at) : null,
    verified_at: r.verified_at ? String(r.verified_at) : null,
    verified_by_name: r.verified_by_name != null ? String(r.verified_by_name) : null,
    verifier_role: r.verifier_role != null ? String(r.verifier_role) : null,
    created_at: r.created_at ? String(r.created_at) : null,
    updated_at: r.updated_at ? String(r.updated_at) : null,
  }
}

export function normalizeBridgeSubjectName(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ")
}

export function canManageBridge(role: string | null | undefined): boolean {
  return (BRIDGE_MANAGERS as readonly string[]).includes(String(role || "").toLowerCase())
}

export function canVerifyBridge(role: string | null | undefined): boolean {
  return (BRIDGE_VERIFIERS as readonly string[]).includes(String(role || "").toLowerCase())
}

/**
 * A subject counts toward the "failed re-attempt" fee tier once the student has
 * more than one non-rejected entry for it (they only add a second row after the
 * first was verified as fail/absent). Everything else is a first-time "regular" entry.
 */
export function classifyBridgeAttempts(attempts: BridgeAttemptRow[]): {
  regularCount: number
  failedCount: number
  bySubject: { key: string; name: string; attempts: BridgeAttemptRow[]; isRetry: boolean }[]
} {
  const bySub = new Map<string, BridgeAttemptRow[]>()
  for (const a of attempts) {
    if (a.status === "rejected") continue
    const key = normalizeBridgeSubjectName(a.subject_name)
    if (!bySub.has(key)) bySub.set(key, [])
    bySub.get(key)!.push(a)
  }
  let regularCount = 0
  let failedCount = 0
  const bySubject: { key: string; name: string; attempts: BridgeAttemptRow[]; isRetry: boolean }[] = []
  for (const [key, list] of bySub) {
    const sorted = list.slice().sort((a, b) => a.id - b.id)
    const isRetry = sorted.length > 1
    if (isRetry) failedCount++
    else regularCount++
    bySubject.push({ key, name: sorted[0].subject_name, attempts: sorted, isRetry })
  }
  return { regularCount, failedCount, bySubject }
}

/** Bridge Course regular (first-time) fee: up to 2 subjects Rs 200, 3+ Rs 300. */
export function bridgeRegularFee(count: number): number {
  if (count <= 0) return 0
  return count <= 2 ? 200 : 300
}

/** Failed Bridge Course subject (re-attempt) fee: 1-2 subjects Rs 250, 3+ Rs 350. */
export function bridgeFailedFee(count: number): number {
  if (count <= 0) return 0
  return count <= 2 ? 250 : 350
}

export function computeBridgeFees(opts: {
  regularCount: number
  failedCount: number
}): { total: number; lines: BridgeFeeLine[] } {
  const lines: BridgeFeeLine[] = []
  if (opts.regularCount > 0) {
    lines.push({
      label: `Bridge course — ${opts.regularCount} subject(s)`,
      kind: "bridge_regular",
      amount: bridgeRegularFee(opts.regularCount),
    })
  }
  if (opts.failedCount > 0) {
    lines.push({
      label: `Bridge course — ${opts.failedCount} failed subject(s) re-attempt`,
      kind: "bridge_failed",
      amount: bridgeFailedFee(opts.failedCount),
    })
  }
  const total = lines.reduce((s, l) => s + l.amount, 0)
  return { total, lines }
}

export function bridgeStamp(user: SessionLike, action: string) {
  return stampFromSession(user, action)
}

export function cleanBridgeText(s: unknown, max = 120): string {
  return stripEmoji(String(s || "").trim()).slice(0, max)
}
