import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureExamResultsSchema,
  loadStudentContext,
  staffCanAccessReg,
  curriculumForStudent,
  effectiveSubjectStatus,
  type AttemptResult,
  type AttemptStatus,
  type ExamAttemptRow,
  EXAM_VERIFIERS,
} from "@/lib/exam-results"
import { hodBranchOf } from "@/lib/account-approvals"

function mapRow(r: Record<string, unknown>): ExamAttemptRow {
  return {
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
  }
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const url = new URL(req.url)
  const statusF = (url.searchParams.get("status") || "").trim()
  const branchF = (url.searchParams.get("branch") || "").trim()
  let reg = (url.searchParams.get("reg_no") || url.searchParams.get("reg") || "").trim()

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number on account")
    reg = user.reg_no
    const { rows } = await query(
      `SELECT * FROM student_exam_attempts WHERE reg_no = $1 ORDER BY semester, subject_code, id`,
      [reg],
    )
    const attempts = rows.map(mapRow)
    const ctx = await loadStudentContext(reg)
    const curriculum = ctx ? curriculumForStudent(ctx) : []
    return Response.json({
      attempts,
      effective: effectiveSubjectStatus(attempts),
      student: ctx,
      curriculum,
    })
  }

  if (!(EXAM_VERIFIERS as readonly string[]).includes(user.role) && user.role !== "faculty") {
    return unauthorized()
  }

  const params: unknown[] = []
  const where: string[] = []
  if (reg) {
    params.push(reg)
    where.push(`reg_no = $${params.length}`)
    if (!(await staffCanAccessReg(user, reg))) return unauthorized("Not your branch")
  }
  if (statusF) {
    params.push(statusF)
    where.push(`status = $${params.length}`)
  }
  if (user.role === "hod") {
    const my = hodBranchOf(user)
    if (!my) return badRequest("HOD has no branch")
    const { branchCodeFromDept } = await import("@/lib/curriculum-c20")
    const code = branchCodeFromDept(my)
    if (!code) return badRequest("Could not map HOD branch to CE/CSE/ECE/ME")
    params.push(code)
    where.push(`branch_code = $${params.length}`)
  } else if (branchF) {
    const { branchCodeFromDept } = await import("@/lib/curriculum-c20")
    const code = branchCodeFromDept(branchF) || branchF.toUpperCase()
    params.push(code)
    where.push(`branch_code = $${params.length}`)
  }

  const sql = `SELECT * FROM student_exam_attempts
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY status = 'pending' DESC, reg_no, semester, subject_code, id
    LIMIT 2000`
  const { rows } = await query(sql, params)
  const attempts = rows.map(mapRow)
  let student = null
  let curriculum: unknown[] = []
  let effective = null
  if (reg) {
    student = await loadStudentContext(reg)
    if (student) curriculum = curriculumForStudent(student)
    effective = effectiveSubjectStatus(attempts)
  }
  return Response.json({ attempts, effective, student, curriculum })
}

/** Student save/submit attempts batch */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")

  const action = String(b.action || "save") // save | submit
  let regNo = String(b.reg_no || "").trim()

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    regNo = user.reg_no
  } else if ((EXAM_VERIFIERS as readonly string[]).includes(user.role) || user.role === "admin") {
    if (!regNo) return badRequest("reg_no required")
    if (!(await staffCanAccessReg(user, regNo))) return unauthorized()
  } else {
    return unauthorized()
  }

  const ctx = await loadStudentContext(regNo)
  if (!ctx) return badRequest("Student not found")
  if (!ctx.branch_code) return badRequest("Student branch not set — cannot load subjects")
  if (ctx.scheme === "C-25") {
    return badRequest("C-25 syllabus subjects are not available yet. Contact Exam Section.")
  }
  if (ctx.scheme === "unknown") {
    return badRequest("Admission year missing — set Year of Admission / Admission Academic Year on profile (2020-21…2024-25 = C-20).")
  }

  const items = Array.isArray(b.attempts) ? b.attempts : []
  if (!items.length) return badRequest("attempts[] required")

  const wantStatus: AttemptStatus = action === "submit" ? "pending" : "draft"
  const saved: number[] = []
  const errors: string[] = []

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const it = raw as Record<string, unknown>
    const subject_code = String(it.subject_code || "").trim()
    const subject_name = String(it.subject_name || "").trim()
    const exam_session = String(it.exam_session || "").trim()
    const semester = Number(it.semester)
    const result = String(it.result || "fail").toLowerCase() as AttemptResult
    const grade = String(it.grade || "").trim()
    if (!subject_code || !exam_session || !semester) {
      errors.push("Missing subject_code / exam_session / semester")
      continue
    }
    if (!["pass", "fail", "absent"].includes(result)) {
      errors.push(`${subject_code}: invalid result`)
      continue
    }

    // Block edit of verified unless admin
    const { rows: existing } = await query(
      `SELECT id, status FROM student_exam_attempts
        WHERE reg_no = $1 AND subject_code = $2 AND exam_session = $3
        LIMIT 1`,
      [regNo, subject_code, exam_session],
    )
    if (existing[0]?.status === "verified" && user.role !== "admin") {
      errors.push(`${subject_code} (${exam_session}): verified — locked`)
      continue
    }
    if (existing[0]?.status === "pending" && user.role === "student" && action === "save") {
      // allow student to still edit pending? plan said pending until verified — allow re-save as pending
    }

    const cie = it.cie_marks != null && it.cie_marks !== "" ? Number(it.cie_marks) : null
    const see = it.see_marks != null && it.see_marks !== "" ? Number(it.see_marks) : null
    const status = existing[0]?.status === "verified" && user.role === "admin" ? "verified" : wantStatus

    if (existing[0]) {
      await query(
        `UPDATE student_exam_attempts SET
           subject_name = $1, semester = $2, result = $3, grade = $4,
           cie_marks = $5, see_marks = $6, status = $7,
           scheme = $8, branch_code = $9,
           submitted_at = CASE WHEN $7 = 'pending' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
           reject_note = CASE WHEN $7 = 'pending' THEN NULL ELSE reject_note END,
           updated_at = now()
         WHERE id = $10`,
        [
          subject_name || subject_code,
          semester,
          result,
          grade,
          Number.isFinite(cie as number) ? cie : null,
          Number.isFinite(see as number) ? see : null,
          status,
          ctx.scheme,
          ctx.branch_code,
          existing[0].id,
        ],
      )
      saved.push(Number(existing[0].id))
    } else {
      const { rows: ins } = await query(
        `INSERT INTO student_exam_attempts
          (reg_no, scheme, branch_code, semester, subject_code, subject_name,
           exam_session, result, grade, cie_marks, see_marks, status, submitted_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
           CASE WHEN $12 = 'pending' THEN now() ELSE NULL END, $13)
         RETURNING id`,
        [
          regNo,
          ctx.scheme,
          ctx.branch_code,
          semester,
          subject_code,
          subject_name || subject_code,
          exam_session,
          result,
          grade,
          Number.isFinite(cie as number) ? cie : null,
          Number.isFinite(see as number) ? see : null,
          status,
          user.id,
        ],
      )
      saved.push(Number(ins[0].id))
    }
  }

  const { rows } = await query(
    `SELECT * FROM student_exam_attempts WHERE reg_no = $1 ORDER BY semester, subject_code, id`,
    [regNo],
  )
  return Response.json({
    ok: true,
    saved: saved.length,
    errors,
    attempts: rows.map(mapRow),
    effective: effectiveSubjectStatus(rows.map(mapRow)),
  })
}

/** Staff verify / reject / admin unlock */
export async function PATCH(req: Request) {
  const user = await requireRole(...EXAM_VERIFIERS)
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")
  const action = String(b.action || "").toLowerCase() // verify | reject | unlock
  const ids: number[] = Array.isArray(b.ids)
    ? b.ids.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0)
    : b.id
      ? [Number(b.id)]
      : []
  if (!ids.length) return badRequest("id or ids[] required")
  if (!["verify", "reject", "unlock"].includes(action)) {
    return badRequest("action must be verify | reject | unlock")
  }
  if (action === "unlock" && user.role !== "admin") {
    return unauthorized("Only Admin can unlock verified results")
  }

  const note = b.note != null ? String(b.note).trim() : null
  const results: { id: number; ok: boolean; error?: string }[] = []

  for (const id of ids) {
    const { rows } = await query(`SELECT * FROM student_exam_attempts WHERE id = $1`, [id])
    const row = rows[0]
    if (!row) {
      results.push({ id, ok: false, error: "Not found" })
      continue
    }
    if (!(await staffCanAccessReg(user, String(row.reg_no)))) {
      results.push({ id, ok: false, error: "Not authorized for this student" })
      continue
    }
    if (action === "verify") {
      if (row.status === "verified") {
        results.push({ id, ok: true })
        continue
      }
      await query(
        `UPDATE student_exam_attempts SET
           status = 'verified', verified_at = now(), verified_by = $1,
           verified_by_name = $2, verifier_role = $3, reject_note = NULL, updated_at = now()
         WHERE id = $4`,
        [user.id, user.display_name || user.email, user.role, id],
      )
      results.push({ id, ok: true })
    } else if (action === "reject") {
      await query(
        `UPDATE student_exam_attempts SET
           status = 'rejected', reject_note = $1, verified_at = now(),
           verified_by = $2, verified_by_name = $3, verifier_role = $4, updated_at = now()
         WHERE id = $5`,
        [note || "Rejected", user.id, user.display_name || user.email, user.role, id],
      )
      results.push({ id, ok: true })
    } else {
      // unlock → draft for re-edit
      await query(
        `UPDATE student_exam_attempts SET
           status = 'draft', verified_at = NULL, verified_by = NULL,
           verified_by_name = NULL, verifier_role = NULL, updated_at = now()
         WHERE id = $1`,
        [id],
      )
      results.push({ id, ok: true })
    }
  }

  return Response.json({
    ok: results.some((r) => r.ok),
    updated: results.filter((r) => r.ok).length,
    results,
  })
}
