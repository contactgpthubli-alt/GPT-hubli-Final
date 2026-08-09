/**
 * Regular exam cycle declare (month / session) — Exam Cell.
 * Parallel to makeup_cycles but for regular sitting.
 */
import { query } from "@/lib/db"
import { stampFromSession, type SessionLike } from "@/lib/signature-stamp"
import { stripEmoji } from "@/lib/no-emoji"

export const REGULAR_EXAM_MANAGERS = ["admin", "exam", "principal"] as const

export type RegularCycleStatus = "draft" | "open" | "closed"

export type RegularExamCycle = {
  id: number
  label: string
  month_label: string
  session_name: string
  exam_cycle: string
  status: RegularCycleStatus
  note: string | null
  declared_by_name: string | null
  declared_by_role: string | null
  declared_at: string | null
  opened_at: string | null
  closed_at: string | null
}

let ready = false

export async function ensureRegularExamSchema(): Promise<void> {
  if (ready) return
  await query(`
    CREATE TABLE IF NOT EXISTS regular_exam_cycles (
      id                BIGSERIAL PRIMARY KEY,
      label             TEXT NOT NULL,
      month_label       TEXT NOT NULL,
      session_name      TEXT NOT NULL,
      exam_cycle        TEXT NOT NULL DEFAULT 'current',
      status            TEXT NOT NULL DEFAULT 'draft',
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
    `CREATE INDEX IF NOT EXISTS idx_regular_exam_cycles_status
       ON regular_exam_cycles(status, updated_at DESC)`,
  )
  ready = true
}

export function mapRegularCycle(r: Record<string, unknown>): RegularExamCycle {
  return {
    id: Number(r.id),
    label: String(r.label || ""),
    month_label: String(r.month_label || ""),
    session_name: String(r.session_name || ""),
    exam_cycle: String(r.exam_cycle || "current"),
    status: String(r.status || "draft") as RegularCycleStatus,
    note: r.note != null ? String(r.note) : null,
    declared_by_name: r.declared_by_name != null ? String(r.declared_by_name) : null,
    declared_by_role: r.declared_by_role != null ? String(r.declared_by_role) : null,
    declared_at: r.declared_at ? String(r.declared_at) : null,
    opened_at: r.opened_at ? String(r.opened_at) : null,
    closed_at: r.closed_at ? String(r.closed_at) : null,
  }
}

export function canManageRegularExam(role: string | null | undefined): boolean {
  return (REGULAR_EXAM_MANAGERS as readonly string[]).includes(String(role || "").toLowerCase())
}

export function cleanLabel(s: unknown, max = 120): string {
  return stripEmoji(String(s || "").trim()).slice(0, max)
}

export function declareStamp(user: SessionLike, action: string) {
  return stampFromSession(user, action)
}

export async function listRegularCycles(limit = 40): Promise<RegularExamCycle[]> {
  await ensureRegularExamSchema()
  const { rows } = await query(
    `SELECT * FROM regular_exam_cycles
     ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, updated_at DESC
     LIMIT $1`,
    [limit],
  )
  return rows.map((r) => mapRegularCycle(r as Record<string, unknown>))
}

export async function getOpenRegularCycle(): Promise<RegularExamCycle | null> {
  await ensureRegularExamSchema()
  const { rows } = await query(
    `SELECT * FROM regular_exam_cycles WHERE status = 'open' ORDER BY updated_at DESC LIMIT 1`,
  )
  if (!rows[0]) return null
  return mapRegularCycle(rows[0] as Record<string, unknown>)
}
