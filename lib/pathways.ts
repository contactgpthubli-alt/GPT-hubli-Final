/**
 * HOD-managed Sem 5/6 pathways — change every academic year.
 *
 * Flow:
 * 1. For each academic year, HOD seeds/offers pathways for their branch
 *    (enable/disable specialization tracks; research & entrepreneurship always available).
 * 2. HOD assigns each 3rd-year student a pathway for that year.
 * 3. Student results entry for Sem 5–6 only shows assigned pathway subjects.
 */

import { query } from "@/lib/db"
import {
  C20_BY_BRANCH,
  type BranchCode,
  type CurriculumSubject,
  branchCodeFromDept,
} from "@/lib/curriculum-c20"
import { normalizeAcademicYear, inferAcademicYearFromDate } from "@/lib/academic-year"
import { hodBranchOf } from "@/lib/account-approvals"
import { getInstituteAcademicSettings } from "@/lib/student-academic"

export type PathwayTrack = "specialization" | "research" | "entrepreneurship"

export type PathwayOffering = {
  id: number
  branch_code: string
  academic_year: string
  pathway_key: string
  label: string
  track: PathwayTrack
  sem5_codes: string[]
  sem6_codes: string[]
  is_offered: boolean
  notes: string | null
  sort_order: number
}

export type StudentPathwayAssignment = {
  id: number
  reg_no: string
  academic_year: string
  branch_code: string
  pathway_key: string
  label: string
  track: PathwayTrack
  sem5_codes: string[]
  sem6_codes: string[]
  assigned_by_name: string | null
  assigned_at: string | null
  notes: string | null
}

let schemaReady = false

export async function ensurePathwaysSchema(): Promise<void> {
  if (schemaReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS branch_pathway_offerings (
      id             BIGSERIAL PRIMARY KEY,
      branch_code    TEXT NOT NULL,
      academic_year  TEXT NOT NULL,
      pathway_key    TEXT NOT NULL,
      label          TEXT NOT NULL,
      track          TEXT NOT NULL,
      sem5_codes     JSONB NOT NULL DEFAULT '[]'::jsonb,
      sem6_codes     JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_offered     BOOLEAN NOT NULL DEFAULT TRUE,
      notes          TEXT,
      sort_order     INT NOT NULL DEFAULT 0,
      created_by     BIGINT,
      updated_by     BIGINT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (branch_code, academic_year, pathway_key)
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS student_pathway_assignments (
      id             BIGSERIAL PRIMARY KEY,
      reg_no         TEXT NOT NULL,
      academic_year  TEXT NOT NULL,
      branch_code    TEXT NOT NULL,
      pathway_key    TEXT NOT NULL,
      label          TEXT NOT NULL,
      track          TEXT NOT NULL,
      sem5_codes     JSONB NOT NULL DEFAULT '[]'::jsonb,
      sem6_codes     JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes          TEXT,
      assigned_by    BIGINT,
      assigned_by_name TEXT,
      assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (reg_no, academic_year)
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_pathway_offerings_ay ON branch_pathway_offerings(branch_code, academic_year)`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_student_pathway_reg ON student_pathway_assignments(reg_no, academic_year)`,
  )
  schemaReady = true
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x || "").trim()).filter(Boolean)
}

function mapOffering(r: Record<string, unknown>): PathwayOffering {
  return {
    id: Number(r.id),
    branch_code: String(r.branch_code),
    academic_year: String(r.academic_year),
    pathway_key: String(r.pathway_key),
    label: String(r.label),
    track: String(r.track) as PathwayTrack,
    sem5_codes: asStringArray(r.sem5_codes),
    sem6_codes: asStringArray(r.sem6_codes),
    is_offered: r.is_offered !== false && r.is_offered !== "f",
    notes: r.notes != null ? String(r.notes) : null,
    sort_order: Number(r.sort_order) || 0,
  }
}

function mapAssignment(r: Record<string, unknown>): StudentPathwayAssignment {
  return {
    id: Number(r.id),
    reg_no: String(r.reg_no),
    academic_year: String(r.academic_year),
    branch_code: String(r.branch_code),
    pathway_key: String(r.pathway_key),
    label: String(r.label),
    track: String(r.track) as PathwayTrack,
    sem5_codes: asStringArray(r.sem5_codes),
    sem6_codes: asStringArray(r.sem6_codes),
    assigned_by_name: r.assigned_by_name != null ? String(r.assigned_by_name) : null,
    assigned_at: r.assigned_at ? String(r.assigned_at) : null,
    notes: r.notes != null ? String(r.notes) : null,
  }
}

/** Default pathway templates from C-20 curriculum for a branch. */
export function defaultPathwayTemplates(branch: BranchCode): Omit<
  PathwayOffering,
  "id" | "branch_code" | "academic_year" | "is_offered" | "notes" | "sort_order"
>[] {
  const all = C20_BY_BRANCH[branch] || []
  const specs = all.filter((s) => s.semester === 5 && s.pathway === "specialization")
  const research5 = all.filter((s) => s.semester === 5 && s.pathway === "research").map((s) => s.code)
  const entrep5 = all.filter((s) => s.semester === 5 && s.pathway === "entrepreneurship").map((s) => s.code)
  const s6S = all.find((s) => s.semester === 6 && s.pathway === "specialization")
  const s6R = all.find((s) => s.semester === 6 && s.pathway === "research")
  const s6E = all.find((s) => s.semester === 6 && s.pathway === "entrepreneurship")

  const out: Omit<
    PathwayOffering,
    "id" | "branch_code" | "academic_year" | "is_offered" | "notes" | "sort_order"
  >[] = []

  specs.forEach((sp, i) => {
    out.push({
      pathway_key: `spec_${sp.code}`,
      label: sp.name,
      track: "specialization",
      sem5_codes: [sp.code],
      sem6_codes: s6S ? [s6S.code] : [],
    })
  })
  out.push({
    pathway_key: "research",
    label: "Science and Research Pathway",
    track: "research",
    sem5_codes: research5,
    sem6_codes: s6R ? [s6R.code] : [],
  })
  out.push({
    pathway_key: "entrepreneurship",
    label: "Entrepreneurship and Start-up Pathway",
    track: "entrepreneurship",
    sem5_codes: entrep5,
    sem6_codes: s6E ? [s6E.code] : [],
  })
  return out
}

/** Seed offerings for branch+AY if none exist (HOD can then edit/offer/disable). */
export async function ensurePathwayOfferingsSeeded(
  branch: BranchCode,
  academicYear: string,
): Promise<PathwayOffering[]> {
  await ensurePathwaysSchema()
  const ay = normalizeAcademicYear(academicYear) || academicYear
  const { rows: existing } = await query(
    `SELECT * FROM branch_pathway_offerings
      WHERE branch_code = $1 AND academic_year = $2
      ORDER BY sort_order, id`,
    [branch, ay],
  )
  if (existing.length) return existing.map(mapOffering)

  const templates = defaultPathwayTemplates(branch)
  let order = 0
  for (const t of templates) {
    await query(
      `INSERT INTO branch_pathway_offerings
        (branch_code, academic_year, pathway_key, label, track, sem5_codes, sem6_codes, is_offered, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,TRUE,$8)
       ON CONFLICT (branch_code, academic_year, pathway_key) DO NOTHING`,
      [
        branch,
        ay,
        t.pathway_key,
        t.label,
        t.track,
        JSON.stringify(t.sem5_codes),
        JSON.stringify(t.sem6_codes),
        order++,
      ],
    )
  }
  const { rows } = await query(
    `SELECT * FROM branch_pathway_offerings
      WHERE branch_code = $1 AND academic_year = $2
      ORDER BY sort_order, id`,
    [branch, ay],
  )
  return rows.map(mapOffering)
}

export async function listPathwayOfferings(
  branch: BranchCode,
  academicYear: string,
  offeredOnly = false,
): Promise<PathwayOffering[]> {
  const all = await ensurePathwayOfferingsSeeded(branch, academicYear)
  return offeredOnly ? all.filter((o) => o.is_offered) : all
}

export async function getStudentPathway(
  regNo: string,
  academicYear?: string | null,
): Promise<StudentPathwayAssignment | null> {
  await ensurePathwaysSchema()
  let ay = academicYear ? normalizeAcademicYear(academicYear) || academicYear : null
  if (!ay) {
    try {
      const settings = await getInstituteAcademicSettings()
      ay = settings.active_academic_year || inferAcademicYearFromDate()
    } catch {
      ay = inferAcademicYearFromDate()
    }
  }
  const { rows } = await query(
    `SELECT * FROM student_pathway_assignments
      WHERE reg_no = $1 AND academic_year = $2
      LIMIT 1`,
    [regNo, ay],
  )
  return rows[0] ? mapAssignment(rows[0]) : null
}

/**
 * Filter curriculum: Sem 1–4 unchanged; Sem 5–6 only assigned pathway subjects.
 * If no assignment, pathway subjects are removed and `pathway_required` flag is set.
 */
export function filterCurriculumByPathway(
  subjects: CurriculumSubject[],
  assignment: StudentPathwayAssignment | null,
): {
  subjects: CurriculumSubject[]
  pathway_required: boolean
  pathway: StudentPathwayAssignment | null
  pathway_note: string | null
} {
  const core = subjects.filter((s) => s.semester < 5 || !s.pathway)
  const pathSubs = subjects.filter((s) => s.semester >= 5 && s.pathway)

  if (!assignment) {
    return {
      subjects: core,
      pathway_required: pathSubs.length > 0,
      pathway: null,
      pathway_note:
        "HOD has not assigned your Sem 5–6 pathway for this academic year. Contact your HOD.",
    }
  }

  const allowed = new Set([
    ...assignment.sem5_codes,
    ...assignment.sem6_codes,
  ])
  const filteredPath = pathSubs.filter((s) => allowed.has(s.code))

  // If codes missing from catalog, inject synthetic rows so student can still enter results
  const have = new Set(filteredPath.map((s) => s.code))
  for (const code of assignment.sem5_codes) {
    if (!have.has(code)) {
      filteredPath.push({
        code,
        name: assignment.label + " (Sem 5)",
        semester: 5,
        pathway: assignment.track,
      })
    }
  }
  for (const code of assignment.sem6_codes) {
    if (!have.has(code)) {
      filteredPath.push({
        code,
        name: assignment.label + " (Sem 6 – pathway)",
        semester: 6,
        pathway: assignment.track,
      })
    }
  }

  return {
    subjects: [...core, ...filteredPath].sort(
      (a, b) => a.semester - b.semester || a.code.localeCompare(b.code),
    ),
    pathway_required: false,
    pathway: assignment,
    pathway_note: `Pathway for ${assignment.academic_year}: ${assignment.label} (${assignment.track}) — set by HOD`,
  }
}

export async function resolveActiveAcademicYear(): Promise<string> {
  try {
    const s = await getInstituteAcademicSettings()
    if (s.active_academic_year) return s.active_academic_year
  } catch {
    /* ignore */
  }
  return inferAcademicYearFromDate()
}

export function staffBranchCode(user: {
  role: string
  branch?: string | null
  reg_no?: string | null
  display_name?: string | null
}): BranchCode | null {
  if (user.role === "hod") {
    return branchCodeFromDept(hodBranchOf(user))
  }
  return null
}

export { mapOffering, mapAssignment }
