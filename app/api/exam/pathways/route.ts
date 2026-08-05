import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensurePathwaysSchema,
  listPathwayOfferings,
  ensurePathwayOfferingsSeeded,
  getStudentPathway,
  resolveActiveAcademicYear,
  mapOffering,
  mapAssignment,
} from "@/lib/pathways"
import { branchCodeFromDept, type BranchCode } from "@/lib/curriculum-c20"
import { hodBranchOf } from "@/lib/account-approvals"
import { normalizeAcademicYear } from "@/lib/academic-year"
import { loadStudentContext } from "@/lib/exam-results"
import { staffCanAccessReg } from "@/lib/exam-results"

const MANAGERS = ["admin", "principal", "hod", "exam"] as const

function canManage(
  user: { role: string; branch?: string | null },
  branch: BranchCode,
): boolean {
  if (user.role === "admin" || user.role === "principal" || user.role === "exam") return true
  if (user.role === "hod") {
    const code = branchCodeFromDept(hodBranchOf(user))
    return code === branch
  }
  return false
}

/**
 * GET
 *  ?academic_year=2025-26&branch=CSE           → offerings (+ seed)
 *  ?mode=assignments&academic_year=&branch=    → student assignments list
 *  student: own assignment + offerings for branch
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensurePathwaysSchema()

  const url = new URL(req.url)
  const mode = (url.searchParams.get("mode") || "offerings").toLowerCase()
  let ay =
    normalizeAcademicYear(url.searchParams.get("academic_year") || "") ||
    (await resolveActiveAcademicYear())

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    const ctx = await loadStudentContext(user.reg_no)
    if (!ctx?.branch_code) {
      return Response.json({
        academic_year: ay,
        assignment: null,
        offerings: [],
        note: "Branch not set on profile.",
      })
    }
    const assignment = await getStudentPathway(user.reg_no, ay)
    const offerings = await listPathwayOfferings(ctx.branch_code, ay, true)
    return Response.json({
      academic_year: ay,
      branch_code: ctx.branch_code,
      assignment,
      offerings,
      note: assignment
        ? `Your pathway for ${ay}: ${assignment.label}`
        : "HOD has not assigned your Sem 5–6 pathway yet for this academic year.",
    })
  }

  if (!(MANAGERS as readonly string[]).includes(user.role)) return unauthorized()

  let branch = (url.searchParams.get("branch") || "").toUpperCase() as BranchCode | ""
  if (user.role === "hod") {
    const code = branchCodeFromDept(hodBranchOf(user))
    if (!code) return badRequest("HOD branch not mapped")
    branch = code
  }
  if (!branch || !["CE", "CSE", "ECE", "ME"].includes(branch)) {
    return badRequest("branch required: CE | CSE | ECE | ME")
  }

  if (mode === "assignments") {
    const offerings = await listPathwayOfferings(branch as BranchCode, ay, false)
    // Students of this branch (3rd year preferred but list all with reg)
    const { rows: students } = await query(
      `SELECT u.reg_no, u.display_name, s.name AS student_name, s.dept, s.current_study_year,
              s.entry_type, s.admission_academic_year
         FROM users u
         LEFT JOIN students s ON s.reg_no = u.reg_no
        WHERE u.role = 'student' AND u.deleted_at IS NULL
          AND u.reg_no IS NOT NULL
          AND (
            CASE
              WHEN $1 = 'CSE' THEN (lower(COALESCE(s.dept,u.branch,'')) LIKE '%computer%' OR lower(COALESCE(s.dept,u.branch,'')) LIKE '%cse%')
              WHEN $1 = 'CE'  THEN lower(COALESCE(s.dept,u.branch,'')) LIKE '%civil%'
              WHEN $1 = 'ECE' THEN (lower(COALESCE(s.dept,u.branch,'')) LIKE '%electron%' OR lower(COALESCE(s.dept,u.branch,'')) LIKE '%ece%')
              WHEN $1 = 'ME'  THEN lower(COALESCE(s.dept,u.branch,'')) LIKE '%mech%'
              ELSE FALSE
            END
          )
        ORDER BY COALESCE(s.name, u.display_name)`,
      [branch],
    )
    const { rows: assigns } = await query(
      `SELECT * FROM student_pathway_assignments
        WHERE branch_code = $1 AND academic_year = $2`,
      [branch, ay],
    )
    const byReg = new Map(assigns.map((a) => [String(a.reg_no), mapAssignment(a)]))
    return Response.json({
      academic_year: ay,
      branch_code: branch,
      offerings: offerings.filter((o) => o.is_offered),
      all_offerings: offerings,
      students: students.map((s) => ({
        reg_no: s.reg_no,
        name: s.student_name || s.display_name,
        year: s.current_study_year,
        entry_type: s.entry_type,
        admission_academic_year: s.admission_academic_year,
        assignment: byReg.get(String(s.reg_no)) || null,
      })),
    })
  }

  // offerings mode
  const offerings = await ensurePathwayOfferingsSeeded(branch as BranchCode, ay)
  return Response.json({
    academic_year: ay,
    branch_code: branch,
    offerings,
    hint:
      "Pathways are per academic year. Disable tracks you are not offering this year, then assign each student. " +
      "Sem 6 subject follows the track (Internship / Research / Entrepreneurship).",
  })
}

/**
 * POST
 *  action: seed | assign | assign_bulk
 *  assign: { reg_no, pathway_key, academic_year? }
 *  assign_bulk: { assignments: [{reg_no, pathway_key}], academic_year? }
 */
export async function POST(req: Request) {
  const user = await requireRole(...MANAGERS)
  if (!user) return unauthorized()
  await ensurePathwaysSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")
  const action = String(b.action || "assign").toLowerCase()
  let ay =
    normalizeAcademicYear(String(b.academic_year || "")) || (await resolveActiveAcademicYear())

  let branch = String(b.branch || b.branch_code || "").toUpperCase() as BranchCode | ""
  if (user.role === "hod") {
    const code = branchCodeFromDept(hodBranchOf(user))
    if (!code) return badRequest("HOD branch not mapped")
    branch = code
  }
  if (!branch || !["CE", "CSE", "ECE", "ME"].includes(branch)) {
    return badRequest("branch required")
  }
  if (!canManage(user, branch as BranchCode)) return unauthorized()

  if (action === "seed") {
    const offerings = await ensurePathwayOfferingsSeeded(branch as BranchCode, ay)
    return Response.json({ ok: true, academic_year: ay, offerings })
  }

  if (action === "assign" || action === "assign_bulk") {
    const items: { reg_no: string; pathway_key: string }[] =
      action === "assign"
        ? [{ reg_no: String(b.reg_no || "").trim(), pathway_key: String(b.pathway_key || "").trim() }]
        : Array.isArray(b.assignments)
          ? b.assignments.map((x: { reg_no?: string; pathway_key?: string }) => ({
              reg_no: String(x?.reg_no || "").trim(),
              pathway_key: String(x?.pathway_key || "").trim(),
            }))
          : []

    const offerings = await listPathwayOfferings(branch as BranchCode, ay, false)
    const byKey = new Map(offerings.map((o) => [o.pathway_key, o]))
    const results: { reg_no: string; ok: boolean; error?: string }[] = []

    for (const it of items) {
      if (!it.reg_no || !it.pathway_key) {
        results.push({ reg_no: it.reg_no || "?", ok: false, error: "reg_no and pathway_key required" })
        continue
      }
      if (!(await staffCanAccessReg(user, it.reg_no))) {
        results.push({ reg_no: it.reg_no, ok: false, error: "Not your branch" })
        continue
      }
      const off = byKey.get(it.pathway_key)
      if (!off || !off.is_offered) {
        results.push({
          reg_no: it.reg_no,
          ok: false,
          error: "Pathway not offered this year — enable it in offerings first",
        })
        continue
      }
      await query(
        `INSERT INTO student_pathway_assignments
          (reg_no, academic_year, branch_code, pathway_key, label, track,
           sem5_codes, sem6_codes, notes, assigned_by, assigned_by_name, assigned_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,now(),now())
         ON CONFLICT (reg_no, academic_year) DO UPDATE SET
           branch_code = EXCLUDED.branch_code,
           pathway_key = EXCLUDED.pathway_key,
           label = EXCLUDED.label,
           track = EXCLUDED.track,
           sem5_codes = EXCLUDED.sem5_codes,
           sem6_codes = EXCLUDED.sem6_codes,
           notes = EXCLUDED.notes,
           assigned_by = EXCLUDED.assigned_by,
           assigned_by_name = EXCLUDED.assigned_by_name,
           assigned_at = now(),
           updated_at = now()`,
        [
          it.reg_no,
          ay,
          branch,
          off.pathway_key,
          off.label,
          off.track,
          JSON.stringify(off.sem5_codes),
          JSON.stringify(off.sem6_codes),
          b.notes != null ? String(b.notes) : null,
          user.id,
          user.display_name || user.email,
        ],
      )
      results.push({ reg_no: it.reg_no, ok: true })
    }

    return Response.json({
      ok: results.some((r) => r.ok),
      academic_year: ay,
      updated: results.filter((r) => r.ok).length,
      results,
    })
  }

  return badRequest("action must be seed | assign | assign_bulk")
}

/**
 * PATCH offerings: enable/disable, rename label for this academic year
 *  { academic_year, branch, pathway_key, is_offered?, label?, notes? }
 *  or { ids: [{pathway_key, is_offered, label}] }
 */
export async function PATCH(req: Request) {
  const user = await requireRole(...MANAGERS)
  if (!user) return unauthorized()
  await ensurePathwaysSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")
  let ay =
    normalizeAcademicYear(String(b.academic_year || "")) || (await resolveActiveAcademicYear())
  let branch = String(b.branch || b.branch_code || "").toUpperCase() as BranchCode | ""
  if (user.role === "hod") {
    const code = branchCodeFromDept(hodBranchOf(user))
    if (!code) return badRequest("HOD branch not mapped")
    branch = code
  }
  if (!branch || !["CE", "CSE", "ECE", "ME"].includes(branch)) {
    return badRequest("branch required")
  }
  if (!canManage(user, branch as BranchCode)) return unauthorized()

  await ensurePathwayOfferingsSeeded(branch as BranchCode, ay)

  const updates: { pathway_key: string; is_offered?: boolean; label?: string; notes?: string | null }[] =
    Array.isArray(b.offerings)
      ? b.offerings
      : b.pathway_key
        ? [
            {
              pathway_key: String(b.pathway_key),
              is_offered: typeof b.is_offered === "boolean" ? b.is_offered : undefined,
              label: b.label != null ? String(b.label) : undefined,
              notes: b.notes !== undefined ? (b.notes == null ? null : String(b.notes)) : undefined,
            },
          ]
        : []

  if (!updates.length) return badRequest("pathway_key or offerings[] required")

  for (const u of updates) {
    const key = String(u.pathway_key || "").trim()
    if (!key) continue
    const sets: string[] = ["updated_at = now()", "updated_by = $4"]
    const params: unknown[] = [branch, ay, key, user.id]
    if (typeof u.is_offered === "boolean") {
      params.push(u.is_offered)
      sets.push(`is_offered = $${params.length}`)
    }
    if (u.label != null && String(u.label).trim()) {
      params.push(String(u.label).trim())
      sets.push(`label = $${params.length}`)
    }
    if (u.notes !== undefined) {
      params.push(u.notes)
      sets.push(`notes = $${params.length}`)
    }
    await query(
      `UPDATE branch_pathway_offerings SET ${sets.join(", ")}
        WHERE branch_code = $1 AND academic_year = $2 AND pathway_key = $3`,
      params,
    )
  }

  const offerings = await listPathwayOfferings(branch as BranchCode, ay, false)
  return Response.json({ ok: true, academic_year: ay, offerings })
}

/**
 * DELETE student assignment for year
 *  ?reg_no=&academic_year=
 */
export async function DELETE(req: Request) {
  const user = await requireRole(...MANAGERS)
  if (!user) return unauthorized()
  await ensurePathwaysSchema()
  const url = new URL(req.url)
  const reg = (url.searchParams.get("reg_no") || "").trim()
  const ay =
    normalizeAcademicYear(url.searchParams.get("academic_year") || "") ||
    (await resolveActiveAcademicYear())
  if (!reg) return badRequest("reg_no required")
  if (!(await staffCanAccessReg(user, reg))) return unauthorized()
  await query(`DELETE FROM student_pathway_assignments WHERE reg_no = $1 AND academic_year = $2`, [
    reg,
    ay,
  ])
  return Response.json({ ok: true })
}
