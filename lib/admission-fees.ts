/**
 * Admission / year tuition fee status — student proof + verifier confirm.
 * Live Paid / Not paid bar on student Fees section.
 */
import { query } from "@/lib/db"

export type AdmissionFeeStatus = "not_paid" | "pending" | "paid"

export const ADMISSION_FEE_VERIFIERS = [
  "admin",
  "principal",
  "registrar",
  "cash",
  "accounts",
  "acm",
  "hod",
  "exam",
] as const

export function canVerifyAdmissionFees(role: string | null | undefined): boolean {
  const r = String(role || "").toLowerCase().trim()
  return (ADMISSION_FEE_VERIFIERS as readonly string[]).includes(r)
}

export async function ensureAdmissionFeesSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS admission_fee_records (
      id                  BIGSERIAL PRIMARY KEY,
      reg_no              TEXT NOT NULL,
      study_year          INT  NOT NULL DEFAULT 1,
      academic_year       TEXT,
      status              TEXT NOT NULL DEFAULT 'not_paid',
      amount              TEXT,
      receipt_no          TEXT,
      paid_date           TEXT,
      student_note        TEXT,
      staff_note          TEXT,
      submitted_at        TIMESTAMPTZ,
      submitted_by_name   TEXT,
      verified_at         TIMESTAMPTZ,
      verified_by         BIGINT,
      verified_by_name    TEXT,
      verified_by_role    TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_admission_fee_reg_year
       ON admission_fee_records(reg_no, study_year)`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_admission_fee_status
       ON admission_fee_records(status, updated_at DESC)`,
  )
}

export function normalizeStudyYear(raw: unknown): number {
  if (typeof raw === "number" && raw >= 1 && raw <= 3) return Math.floor(raw)
  const s = String(raw || "").trim()
  if (/^III|3|3rd/i.test(s)) return 3
  if (/^II|2|2nd/i.test(s)) return 2
  if (/^I|1|1st/i.test(s)) return 1
  const n = parseInt(s, 10)
  if (n >= 1 && n <= 3) return n
  return 1
}

export function yearLabel(studyYear: number): string {
  if (studyYear === 3) return "3rd Year"
  if (studyYear === 2) return "2nd Year"
  return "1st Year"
}
