/**
 * College survey / forms — schema helpers + field parsing.
 * Workflow: Admin builds → audience fills → verifier approves → PDF.
 */

import { query } from "@/lib/db"
import { STAFF_ROLES } from "@/lib/roles"

export const FORM_BUILDERS = ["admin", "principal"] as const
export const FORM_VERIFIER_ROLES = [
  "none",
  "admin",
  "principal",
  "hod",
  "acm",
  "exam",
  "registrar",
  "est",
] as const

export type FormAudience = "students" | "staff" | "both"
export type FormStatus = "draft" | "open" | "closed"
export type ResponseStatus = "pending" | "verified" | "rejected"

export type FormField = {
  id?: string
  type?: string
  question?: string
  label?: string
  required?: boolean
  options?: string[]
  desc?: string
}

let schemaReady = false

export async function ensureFormsSchema(): Promise<void> {
  if (schemaReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS forms (
      id          BIGSERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
      status      TEXT NOT NULL DEFAULT 'open',
      created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS form_responses (
      id           BIGSERIAL PRIMARY KEY,
      form_id      BIGINT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      answers      JSONB NOT NULL DEFAULT '{}'::jsonb,
      submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'students'`)
  await query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS verify_role TEXT NOT NULL DEFAULT 'admin'`)
  await query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'`)
  await query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`)

  await query(
    `ALTER TABLE form_responses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`,
  )
  await query(`ALTER TABLE form_responses ADD COLUMN IF NOT EXISTS verified_by BIGINT`)
  await query(`ALTER TABLE form_responses ADD COLUMN IF NOT EXISTS verified_by_name TEXT`)
  await query(`ALTER TABLE form_responses ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`)
  await query(`ALTER TABLE form_responses ADD COLUMN IF NOT EXISTS verifier_note TEXT`)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_form_responses_form ON form_responses(form_id)`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_form_responses_submitter ON form_responses(submitted_by, submitted_at DESC)`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_form_responses_status ON form_responses(status, form_id)`,
  )
  schemaReady = true
}

export function parseFormFields(raw: unknown): FormField[] {
  if (Array.isArray(raw)) return raw as FormField[]
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw)
      return Array.isArray(j) ? (j as FormField[]) : []
    } catch {
      return []
    }
  }
  return []
}

export function fieldLabel(f: FormField): string {
  return String(f.question || f.label || f.id || "Question").trim() || "Question"
}

export function normalizeAudience(v: unknown): FormAudience {
  const s = String(v || "students").toLowerCase()
  if (s === "staff" || s === "faculty") return "staff"
  if (s === "both" || s === "all") return "both"
  return "students"
}

export function normalizeVerifyRole(v: unknown): string {
  const s = String(v || "admin").toLowerCase().trim()
  if (s === "none" || s === "auto" || s === "no") return "none"
  if (FORM_VERIFIER_ROLES.includes(s as (typeof FORM_VERIFIER_ROLES)[number])) return s
  return "admin"
}

export function normalizeFormStatus(v: unknown): FormStatus {
  const s = String(v || "open").toLowerCase()
  if (s === "draft" || s === "closed" || s === "open") return s
  return "open"
}

export function isStaffRole(role: string | null | undefined): boolean {
  const r = String(role || "").toLowerCase()
  return STAFF_ROLES.includes(r)
}

/** Whether this user may fill a form based on audience. */
export function canAudienceFill(
  audience: string | null | undefined,
  userRole: string | null | undefined,
): boolean {
  const a = normalizeAudience(audience)
  const r = String(userRole || "").toLowerCase()
  if (r === "admin" || r === "principal") return true
  if (a === "both") return true
  if (a === "students") return r === "student"
  if (a === "staff") return r !== "student" && isStaffRole(r)
  return false
}

/** Whether this user may verify responses for a form. */
export function canVerifyForm(
  verifyRole: string | null | undefined,
  userRole: string | null | undefined,
): boolean {
  const vr = normalizeVerifyRole(verifyRole)
  const r = String(userRole || "").toLowerCase()
  if (r === "admin") return true // admin can always verify
  if (vr === "none") return false
  return r === vr
}

export function verifierLabel(role: string): string {
  const map: Record<string, string> = {
    none: "No verification (auto-accept)",
    admin: "Root Admin",
    principal: "Principal",
    hod: "HOD",
    acm: "ACM Section",
    exam: "Exam Cell",
    registrar: "Registrar",
    est: "EST",
  }
  return map[String(role || "").toLowerCase()] || role
}
