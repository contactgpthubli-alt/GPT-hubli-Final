/**
 * Makeup exam cycles (Exam-declared month), fee schedule, and payments.
 * Separate from regular exam fees; same K2 challan UX on the client.
 */
import { query } from "@/lib/db"
import { ensureExamResultsSchema, type ExamAttemptRow } from "@/lib/exam-results"
import { stampFromSession, type SessionLike } from "@/lib/signature-stamp"
import { stripEmoji } from "@/lib/no-emoji"

export const MAKEUP_MANAGERS = ["admin", "exam", "principal"] as const
export const MAKEUP_VERIFIERS = ["admin", "principal", "hod", "exam"] as const

export type MakeupCycleStatus = "draft" | "open" | "closed"

export type MakeupCycle = {
  id: number
  label: string
  month_label: string
  session_name: string
  status: MakeupCycleStatus
  even_sems_only: boolean
  semesters: number[]
  fee_per_subject: number
  fee_base: number
  note: string | null
  declared_by: number | null
  declared_by_name: string | null
  declared_by_role: string | null
  declared_at: string | null
  opened_at: string | null
  closed_at: string | null
  created_at: string | null
  updated_at: string | null
}

export type MakeupFeeLine = {
  label: string
  subject_code: string | null
  semester: number | null
  amount: number
  kind: string
}

let makeupSchemaReady = false

export async function ensureMakeupExamSchema(): Promise<void> {
  if (makeupSchemaReady) return
  await ensureExamResultsSchema()

  await query(`
    CREATE TABLE IF NOT EXISTS makeup_cycles (
      id                BIGSERIAL PRIMARY KEY,
      label             TEXT NOT NULL,
      month_label       TEXT NOT NULL,
      session_name      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'draft',
      even_sems_only    BOOLEAN NOT NULL DEFAULT true,
      semesters         JSONB NOT NULL DEFAULT '[2,4,6]'::jsonb,
      fee_per_subject   INT NOT NULL DEFAULT 250,
      fee_base          INT NOT NULL DEFAULT 0,
      note              TEXT,
      declared_by       BIGINT,
      declared_by_name  TEXT,
      declared_by_role  TEXT,
      declared_at       TIMESTAMPTZ,
      opened_at         TIMESTAMPTZ,
      closed_at         TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_makeup_cycles_status ON makeup_cycles(status, updated_at DESC)`,
  )

  /** Optional fine windows for a makeup cycle (same shape as regular). */
  await query(`
    CREATE TABLE IF NOT EXISTS makeup_fee_fine_schedule (
      id              BIGSERIAL PRIMARY KEY,
      makeup_cycle_id BIGINT NOT NULL REFERENCES makeup_cycles(id) ON DELETE CASCADE,
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
      CONSTRAINT makeup_fee_fine_dates CHECK (to_date >= from_date),
      CONSTRAINT makeup_fee_fine_amt CHECK (fine_amount >= 0)
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_makeup_fee_fine_cycle
       ON makeup_fee_fine_schedule(makeup_cycle_id, ord, from_date)`,
  )

  await query(
    `ALTER TABLE exam_fee_payments ADD COLUMN IF NOT EXISTS fee_kind TEXT NOT NULL DEFAULT 'regular'`,
  )
  await query(
    `ALTER TABLE exam_fee_payments ADD COLUMN IF NOT EXISTS makeup_cycle_id BIGINT`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_exam_fee_kind_cycle
       ON exam_fee_payments(fee_kind, makeup_cycle_id, status)`,
  )
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_fee_makeup_unique
       ON exam_fee_payments(reg_no, makeup_cycle_id)
       WHERE fee_kind = 'makeup' AND makeup_cycle_id IS NOT NULL`,
  )

  await query(
    `ALTER TABLE student_exam_attempts ADD COLUMN IF NOT EXISTS attempt_kind TEXT NOT NULL DEFAULT 'regular'`,
  )
  await query(
    `ALTER TABLE student_exam_attempts ADD COLUMN IF NOT EXISTS makeup_cycle_id BIGINT`,
  )

  makeupSchemaReady = true
}

function parseSemesters(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((n) => Number(n))
      .filter((n) => n >= 1 && n <= 6)
  }
  if (typeof raw === "string") {
    try {
      return parseSemesters(JSON.parse(raw))
    } catch {
      return [2, 4, 6]
    }
  }
  return [2, 4, 6]
}

export function mapMakeupCycle(r: Record<string, unknown>): MakeupCycle {
  return {
    id: Number(r.id),
    label: String(r.label || ""),
    month_label: String(r.month_label || ""),
    session_name: String(r.session_name || ""),
    status: String(r.status || "draft") as MakeupCycleStatus,
    even_sems_only: r.even_sems_only !== false && r.even_sems_only !== "false",
    semesters: parseSemesters(r.semesters),
    fee_per_subject: Math.max(0, Number(r.fee_per_subject) || 0),
    fee_base: Math.max(0, Number(r.fee_base) || 0),
    note: r.note != null ? String(r.note) : null,
    declared_by: r.declared_by != null ? Number(r.declared_by) : null,
    declared_by_name: r.declared_by_name != null ? String(r.declared_by_name) : null,
    declared_by_role: r.declared_by_role != null ? String(r.declared_by_role) : null,
    declared_at: r.declared_at ? String(r.declared_at) : null,
    opened_at: r.opened_at ? String(r.opened_at) : null,
    closed_at: r.closed_at ? String(r.closed_at) : null,
    created_at: r.created_at ? String(r.created_at) : null,
    updated_at: r.updated_at ? String(r.updated_at) : null,
  }
}

export async function listMakeupCycles(opts?: {
  status?: string | null
  limit?: number
}): Promise<MakeupCycle[]> {
  await ensureMakeupExamSchema()
  const params: unknown[] = []
  let sql = `SELECT * FROM makeup_cycles WHERE 1=1`
  if (opts?.status) {
    params.push(opts.status)
    sql += ` AND status = $${params.length}`
  }
  sql += ` ORDER BY
    CASE status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
    updated_at DESC
    LIMIT ${Math.min(100, opts?.limit || 50)}`
  const { rows } = await query(sql, params)
  return rows.map((r) => mapMakeupCycle(r as Record<string, unknown>))
}

export async function getOpenMakeupCycle(): Promise<MakeupCycle | null> {
  const list = await listMakeupCycles({ status: "open", limit: 1 })
  return list[0] || null
}

export async function getMakeupCycleById(id: number): Promise<MakeupCycle | null> {
  await ensureMakeupExamSchema()
  const { rows } = await query(`SELECT * FROM makeup_cycles WHERE id = $1`, [id])
  if (!rows[0]) return null
  return mapMakeupCycle(rows[0] as Record<string, unknown>)
}

export function makeupCycleKey(cycleId: number): string {
  return `makeup-${cycleId}`
}

/** Subjects eligible for makeup: not yet verified-pass, preferably fail/absent. */
export function eligibleMakeupSubjects(
  effective: {
    subject_code: string
    subject_name: string
    semester: number
    passed: boolean
    effective: string
    attempts: ExamAttemptRow[]
  }[],
  cycle: MakeupCycle,
): {
  subject_code: string
  subject_name: string
  semester: number
  effective: string
  attempts: ExamAttemptRow[]
}[] {
  const semSet = new Set(cycle.semesters.length ? cycle.semesters : [2, 4, 6])
  return effective
    .filter((e) => {
      if (e.passed) return false
      if (!semSet.has(e.semester)) return false
      // Prefer subjects that have some fail/absent history, or any non-pass open status
      const hasFail = e.attempts.some(
        (a) =>
          a.status !== "rejected" &&
          (a.result === "fail" || a.result === "absent" || (a.result !== "pass" && a.status !== "verified")),
      )
      // also include if never passed (open backlog)
      return hasFail || !e.passed
    })
    .map((e) => ({
      subject_code: e.subject_code,
      subject_name: e.subject_name,
      semester: e.semester,
      effective: e.effective,
      attempts: e.attempts,
    }))
    .sort((a, b) => a.semester - b.semester || a.subject_code.localeCompare(b.subject_code))
}

export function computeMakeupFees(opts: {
  cycle: MakeupCycle
  eligibleCount: number
  eligible: { subject_code: string; subject_name: string; semester: number }[]
  fine?: number
  fineLabel?: string | null
}): { total: number; fine: number; lines: MakeupFeeLine[] } {
  const lines: MakeupFeeLine[] = []
  const per = Math.max(0, opts.cycle.fee_per_subject || 0)
  const base = Math.max(0, opts.cycle.fee_base || 0)
  if (base > 0) {
    lines.push({
      label: `Makeup base fee (${opts.cycle.month_label})`,
      subject_code: null,
      semester: null,
      amount: base,
      kind: "base",
    })
  }
  for (const s of opts.eligible) {
    if (per <= 0) continue
    lines.push({
      label: `${s.subject_code} — ${s.subject_name} (Sem ${s.semester})`,
      subject_code: s.subject_code,
      semester: s.semester,
      amount: per,
      kind: "per_subject",
    })
  }
  // If no per-subject fee configured but student has fails, still show count line at 0
  if (!lines.length && opts.eligibleCount > 0) {
    lines.push({
      label: `${opts.eligibleCount} makeup subject(s) — set fee_per_subject in cycle`,
      subject_code: null,
      semester: null,
      amount: 0,
      kind: "info",
    })
  }
  const fine = Math.max(0, Number(opts.fine) || 0)
  if (fine > 0) {
    lines.push({
      label: opts.fineLabel || "Makeup fine",
      subject_code: null,
      semester: null,
      amount: fine,
      kind: "fine",
    })
  }
  const total = lines.reduce((s, l) => s + l.amount, 0)
  return { total, fine, lines }
}

export async function loadMakeupFineSchedule(cycleId: number) {
  await ensureMakeupExamSchema()
  const { rows } = await query(
    `SELECT * FROM makeup_fee_fine_schedule
      WHERE makeup_cycle_id = $1
      ORDER BY ord, from_date`,
    [cycleId],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    makeup_cycle_id: Number(r.makeup_cycle_id),
    from_date: String(r.from_date).slice(0, 10),
    to_date: String(r.to_date).slice(0, 10),
    fine_amount: Number(r.fine_amount) || 0,
    ord: Number(r.ord) || 0,
    label: r.label != null ? String(r.label) : null,
  }))
}

/** Calendar date YYYY-MM-DD India. */
export function todayIndiaISO(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

export function resolveMakeupFine(
  tiers: { from_date: string; to_date: string; fine_amount: number; label?: string | null }[],
  asOf?: string,
): { fine: number; label: string | null; as_of: string } {
  const day = asOf || todayIndiaISO()
  if (!tiers.length) return { fine: 0, label: null, as_of: day }
  const hit = tiers.find((t) => t.from_date <= day && day <= t.to_date)
  if (hit) {
    return {
      fine: hit.fine_amount,
      label: hit.label || `${hit.from_date} to ${hit.to_date}`,
      as_of: day,
    }
  }
  // After last window: keep last fine amount
  const sorted = tiers.slice().sort((a, b) => a.to_date.localeCompare(b.to_date))
  const last = sorted[sorted.length - 1]
  if (day > last.to_date) {
    return {
      fine: last.fine_amount,
      label: last.label || `After ${last.to_date}`,
      as_of: day,
    }
  }
  return { fine: 0, label: "Before first fine window", as_of: day }
}

export function canManageMakeup(role: string | null | undefined): boolean {
  return (MAKEUP_MANAGERS as readonly string[]).includes(String(role || "").toLowerCase())
}

export function canVerifyMakeup(role: string | null | undefined): boolean {
  return (MAKEUP_VERIFIERS as readonly string[]).includes(String(role || "").toLowerCase())
}

export function declareStamp(user: SessionLike, action: string) {
  return stampFromSession(user, action)
}

export function cleanLabel(s: unknown, max = 120): string {
  return stripEmoji(String(s || "").trim()).slice(0, max)
}
