import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import { normalizeBranch } from "@/lib/branches"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"
import {
  ensureAcademicSchema,
  setStudentAcademicAction,
  applyProgressionToStudent,
  getInstituteAcademicSettings,
  rowToSnapshot,
} from "@/lib/student-academic"
import { normalizeAcademicYear, parseStudyYear, type StudyYear } from "@/lib/academic-year"

async function assertCanActOnStudent(
  user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null },
  regNo: string,
  action: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (user.role === "admin" || user.role === "principal") return { ok: true }
  if (user.role === "exam" && (action === "pass_out" || action === "set_admission" || action === "set_year")) {
    return { ok: true }
  }
  if (user.role === "hod") {
    const myBranch = hodBranchOf(user)
    if (!myBranch) return { ok: false, error: "HOD account has no branch assigned" }
    const { rows } = await query(
      `SELECT s.dept, u.branch AS user_branch
         FROM users u
         LEFT JOIN students s ON s.reg_no = u.reg_no
        WHERE u.reg_no = $1 AND u.role = 'student' AND u.deleted_at IS NULL
        LIMIT 1`,
      [regNo],
    )
    if (!rows[0]) {
      // Maybe only students table
      const { rows: srows } = await query(`SELECT dept FROM students WHERE reg_no = $1`, [regNo])
      if (!srows[0]) return { ok: false, error: "Student not found" }
      if (!branchesMatch(myBranch, normalizeBranch(srows[0].dept))) {
        return { ok: false, error: "Student is not in your branch" }
      }
      return { ok: true }
    }
    const dept = normalizeBranch(rows[0].dept) || normalizeBranch(rows[0].user_branch)
    if (!branchesMatch(myBranch, dept)) {
      return { ok: false, error: "Student is not in your branch" }
    }
    return { ok: true }
  }
  return { ok: false, error: "Not authorized for this academic action" }
}

/**
 * GET ?reg_no= — academic snapshot for one student
 * GET (staff) — optional list of needs_admission_year_review
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureAcademicSchema()
  const url = new URL(req.url)
  const reg = url.searchParams.get("reg_no") || url.searchParams.get("reg")

  if (user.role === "student") {
    const myReg = user.reg_no
    if (!myReg) return Response.json({ academic: null })
    const { rows } = await query(
      `SELECT reg_no, year, admission_academic_year, entry_type, entry_study_year,
              current_study_year, academic_status, progress_locked, pass_out_academic_year,
              needs_admission_year_review
         FROM students WHERE reg_no = $1`,
      [myReg],
    )
    const settings = await getInstituteAcademicSettings()
    return Response.json({
      academic: rows[0] ? { ...rowToSnapshot(rows[0]), active_academic_year: settings.active_academic_year } : null,
      settings,
    })
  }

  if (reg) {
    const gate = await assertCanActOnStudent(user, reg, "view")
    // view allowed for staff readers
    if (
      user.role !== "admin" &&
      user.role !== "principal" &&
      user.role !== "hod" &&
      user.role !== "exam" &&
      user.role !== "acm" &&
      user.role !== "faculty"
    ) {
      return unauthorized()
    }
    if (user.role === "hod" && !gate.ok) return badRequest(gate.error)
    await applyProgressionToStudent(reg).catch(() => null)
    const { rows } = await query(
      `SELECT reg_no, year, admission_academic_year, entry_type, entry_study_year,
              current_study_year, academic_status, progress_locked, pass_out_academic_year,
              needs_admission_year_review
         FROM students WHERE reg_no = $1`,
      [reg],
    )
    const settings = await getInstituteAcademicSettings()
    return Response.json({
      academic: rows[0] ? { ...rowToSnapshot(rows[0]), active_academic_year: settings.active_academic_year } : null,
      settings,
    })
  }

  // Review queue: missing admission year
  if (user.role === "admin" || user.role === "principal" || user.role === "hod" || user.role === "exam") {
    const hodBranch = user.role === "hod" ? hodBranchOf(user) : null
    const params: unknown[] = []
    let branchSql = ""
    if (hodBranch) {
      params.push(hodBranch)
      branchSql = ` AND (s.dept ILIKE $1 OR s.dept ILIKE $2)`
      params.push(`%${hodBranch}%`)
    }
    const { rows } = await query(
      `SELECT s.reg_no, s.name, s.dept, s.year, s.admission_academic_year, s.current_study_year,
              s.academic_status, s.needs_admission_year_review
         FROM students s
        WHERE COALESCE(s.needs_admission_year_review, FALSE) = TRUE
           OR s.admission_academic_year IS NULL
           OR s.admission_academic_year = ''
        ${branchSql}
        ORDER BY s.dept, s.reg_no
        LIMIT 200`,
      params,
    )
    const settings = await getInstituteAcademicSettings()
    return Response.json({ review: rows, settings, count: rows.length })
  }

  return unauthorized()
}

/**
 * POST body:
 * { action, reg_no, reason?, target_year?, admission_academic_year?, entry_type?, entry_study_year? }
 * actions: detain | year_back | unlock | pass_out | set_admission | set_year | recompute
 */
export async function POST(req: Request) {
  const user = await requireRole("admin", "principal", "hod", "exam")
  if (!user) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b?.action || !b?.reg_no) return badRequest("action and reg_no are required")
  const action = String(b.action).toLowerCase().trim()
  const regNo = String(b.reg_no).trim().toUpperCase()
  if (!regNo) return badRequest("reg_no required")

  const allowed = ["detain", "year_back", "unlock", "pass_out", "set_admission", "set_year", "recompute"]
  if (!allowed.includes(action)) return badRequest("Unknown action")

  if (action === "recompute") {
    const gate = await assertCanActOnStudent(user, regNo, "unlock")
    if (!gate.ok) return badRequest(gate.error)
    const res = await applyProgressionToStudent(regNo, {
      actorUserId: user.id,
      force: true,
      eventType: "manual_recompute",
    })
    return Response.json({ ok: true, academic: res?.snapshot || null, reason: res?.reason })
  }

  if (user.role === "exam" && !["pass_out", "set_admission", "set_year", "recompute"].includes(action)) {
    return badRequest("Exam Cell may mark pass-out or set admission/year only")
  }

  const gate = await assertCanActOnStudent(user, regNo, action)
  if (!gate.ok) return badRequest(gate.error)

  try {
    const academic = await setStudentAcademicAction(
      regNo,
      action as "detain" | "year_back" | "unlock" | "pass_out" | "set_admission" | "set_year",
      {
        actorUserId: user.id,
        reason: b.reason != null ? String(b.reason) : null,
        target_year: parseStudyYear(b.target_year) as StudyYear | null,
        admission_academic_year: b.admission_academic_year
          ? normalizeAcademicYear(b.admission_academic_year) || String(b.admission_academic_year)
          : null,
        entry_type: b.entry_type === "lateral" ? "lateral" : b.entry_type === "regular" ? "regular" : null,
        entry_study_year: parseStudyYear(b.entry_study_year) as StudyYear | null,
      },
    )
    return Response.json({ ok: true, academic })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Action failed"
    return badRequest(msg)
  }
}
