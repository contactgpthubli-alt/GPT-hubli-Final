/**
 * Makeup result self-entry: eligible fails + save/submit under open cycle session.
 */
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureMakeupExamSchema,
  getOpenMakeupCycle,
  getMakeupCycleById,
  eligibleMakeupSubjects,
  canVerifyMakeup,
} from "@/lib/makeup-exam"
import {
  loadStudentContext,
  staffCanAccessReg,
  effectiveSubjectStatus,
  recomputeAndStoreStudentCgpa,
  type ExamAttemptRow,
  type AttemptResult,
  type AttemptStatus,
  EXAM_VERIFIERS,
} from "@/lib/exam-results"
import { stripEmoji } from "@/lib/no-emoji"
import { stampFromSession } from "@/lib/signature-stamp"

function mapAttempt(r: Record<string, unknown>): ExamAttemptRow & {
  attempt_kind?: string
  makeup_cycle_id?: number | null
} {
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
    attempt_kind: r.attempt_kind != null ? String(r.attempt_kind) : "regular",
    makeup_cycle_id: r.makeup_cycle_id != null ? Number(r.makeup_cycle_id) : null,
  }
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureMakeupExamSchema()

  const url = new URL(req.url)
  let reg = (url.searchParams.get("reg_no") || "").trim()
  const cycleIdParam = url.searchParams.get("cycle_id")
  const listMode = url.searchParams.get("list") === "1" || url.searchParams.get("status")

  // Staff pending makeup list
  if (listMode && user.role !== "student") {
    if (!canVerifyMakeup(user.role)) return unauthorized()
    const statusF = (url.searchParams.get("status") || "pending").trim()
    const branchF = (url.searchParams.get("branch") || "").trim().toUpperCase()
    const params: unknown[] = []
    let sql = `
      SELECT a.*, u.display_name AS student_name, s.dept
        FROM student_exam_attempts a
        JOIN users u ON u.reg_no = a.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
        LEFT JOIN students s ON s.reg_no = a.reg_no
       WHERE COALESCE(a.attempt_kind, 'regular') = 'makeup'`
    if (statusF) {
      params.push(statusF)
      sql += ` AND a.status = $${params.length}`
    }
    if (user.role === "hod") {
      const { hodBranchOf } = await import("@/lib/account-approvals")
      const { branchCodeFromDept } = await import("@/lib/curriculum-c20")
      const my = hodBranchOf(user)
      const code = my ? branchCodeFromDept(my) : null
      if (code) {
        params.push(code)
        sql += ` AND a.branch_code = $${params.length}`
      }
    } else if (branchF) {
      params.push(branchF)
      sql += ` AND a.branch_code = $${params.length}`
    }
    sql += ` ORDER BY a.status = 'pending' DESC, a.updated_at DESC LIMIT 800`
    const { rows } = await query(sql, params)
    return Response.json({
      attempts: rows.map((r) => ({
        ...mapAttempt(r as Record<string, unknown>),
        student_name: r.student_name,
        dept: r.dept,
      })),
    })
  }

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    reg = user.reg_no
  } else {
    if (!reg) return badRequest("reg_no required")
    if (!(await staffCanAccessReg(user, reg)) && !canVerifyMakeup(user.role)) {
      return unauthorized()
    }
  }

  const ctx = await loadStudentContext(reg)
  if (!ctx) return badRequest("Student not found")

  const cycle = cycleIdParam
    ? await getMakeupCycleById(Number(cycleIdParam))
    : await getOpenMakeupCycle()

  const { rows: attRows } = await query(
    `SELECT * FROM student_exam_attempts WHERE reg_no = $1 ORDER BY id`,
    [reg],
  )
  const attempts = attRows.map((r) => mapAttempt(r as Record<string, unknown>))
  const effective = effectiveSubjectStatus(attempts)
  const eligible = cycle ? eligibleMakeupSubjects(effective, cycle) : []
  const makeupAttempts = cycle
    ? attempts.filter(
        (a) =>
          (a as { attempt_kind?: string }).attempt_kind === "makeup" ||
          a.exam_session === cycle.session_name ||
          (a as { makeup_cycle_id?: number | null }).makeup_cycle_id === cycle.id,
      )
    : attempts.filter((a) => (a as { attempt_kind?: string }).attempt_kind === "makeup")

  return Response.json({
    student: ctx,
    cycle,
    open: cycle?.status === "open",
    eligible,
    makeup_attempts: makeupAttempts,
    all_attempts: attempts,
    note: cycle
      ? cycle.status === "open"
        ? `Makeup open: ${cycle.month_label}. Enter only failed subjects.`
        : `Makeup cycle is ${cycle.status}.`
      : "No makeup cycle declared yet. Exam Section will open July/August (or other) when ready.",
  })
}

/** POST — save/submit makeup attempts for open cycle */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureMakeupExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")

  const action = String(b.action || "save")
  let regNo = String(b.reg_no || "").trim()
  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    regNo = user.reg_no
  } else if ((EXAM_VERIFIERS as readonly string[]).includes(user.role)) {
    if (!regNo) return badRequest("reg_no required")
    if (!(await staffCanAccessReg(user, regNo))) return unauthorized()
  } else {
    return unauthorized()
  }

  const cycle =
    (b.cycle_id ? await getMakeupCycleById(Number(b.cycle_id)) : null) ||
    (await getOpenMakeupCycle())
  if (!cycle) return badRequest("No makeup cycle open")
  if (cycle.status !== "open" && user.role === "student") {
    return badRequest("Makeup cycle is not open for entry")
  }

  const ctx = await loadStudentContext(regNo)
  if (!ctx) return badRequest("Student not found")
  if (!ctx.branch_code) return badRequest("Student branch not set")

  // Eligibility check for students
  const { rows: attRows } = await query(
    `SELECT * FROM student_exam_attempts WHERE reg_no = $1 ORDER BY id`,
    [regNo],
  )
  const allAttempts = attRows.map((r) => mapAttempt(r as Record<string, unknown>))
  const effective = effectiveSubjectStatus(allAttempts)
  const eligibleCodes = new Set(
    eligibleMakeupSubjects(effective, cycle).map((e) => e.subject_code),
  )

  const items = Array.isArray(b.attempts) ? b.attempts : []
  if (!items.length) return badRequest("attempts[] required")

  const wantStatus: AttemptStatus = action === "submit" ? "pending" : "draft"
  const session = cycle.session_name
  const saved: number[] = []
  const errors: string[] = []

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const it = raw as Record<string, unknown>
    const subject_code = stripEmoji(String(it.subject_code || "").trim())
    const subject_name = stripEmoji(String(it.subject_name || "").trim())
    const semester = Number(it.semester)
    const result = String(it.result || "fail").toLowerCase() as AttemptResult
    const grade = stripEmoji(String(it.grade || "").trim())
    if (!subject_code || !semester) {
      errors.push("Missing subject_code / semester")
      continue
    }
    if (!["pass", "fail", "absent"].includes(result)) {
      errors.push(`${subject_code}: invalid result`)
      continue
    }
    if (user.role === "student" && !eligibleCodes.has(subject_code)) {
      // Allow re-edit of existing makeup row for this cycle
      const hasOwn = allAttempts.some(
        (a) =>
          a.subject_code === subject_code &&
          (a.exam_session === session ||
            (a as { makeup_cycle_id?: number | null }).makeup_cycle_id === cycle.id),
      )
      if (!hasOwn) {
        errors.push(`${subject_code}: not eligible for this makeup (already passed or out of scope)`)
        continue
      }
    }

    const { rows: existing } = await query(
      `SELECT id, status FROM student_exam_attempts
        WHERE reg_no = $1 AND subject_code = $2 AND exam_session = $3
        LIMIT 1`,
      [regNo, subject_code, session],
    )
    if (existing[0]?.status === "verified" && user.role !== "admin") {
      errors.push(`${subject_code}: verified — locked`)
      continue
    }

    const status =
      existing[0]?.status === "verified" && user.role === "admin" ? "verified" : wantStatus

    if (existing[0]) {
      await query(
        `UPDATE student_exam_attempts SET
           subject_name = $1, semester = $2, result = $3, grade = $4,
           status = $5, scheme = $6, branch_code = $7,
           attempt_kind = 'makeup', makeup_cycle_id = $8,
           submitted_at = CASE WHEN $5 = 'pending' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
           reject_note = CASE WHEN $5 = 'pending' THEN NULL ELSE reject_note END,
           updated_at = now()
         WHERE id = $9`,
        [
          subject_name || subject_code,
          semester,
          result,
          grade,
          status,
          ctx.scheme,
          ctx.branch_code,
          cycle.id,
          existing[0].id,
        ],
      )
      saved.push(Number(existing[0].id))
    } else {
      const { rows: ins } = await query(
        `INSERT INTO student_exam_attempts
          (reg_no, scheme, branch_code, semester, subject_code, subject_name,
           exam_session, result, grade, status, submitted_at, created_by,
           attempt_kind, makeup_cycle_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           CASE WHEN $10 = 'pending' THEN now() ELSE NULL END, $11,
           'makeup', $12)
         RETURNING id`,
        [
          regNo,
          ctx.scheme,
          ctx.branch_code,
          semester,
          subject_code,
          subject_name || subject_code,
          session,
          result,
          grade,
          status,
          user.id,
          cycle.id,
        ],
      )
      saved.push(Number(ins[0].id))
    }
  }

  try {
    await recomputeAndStoreStudentCgpa(regNo)
  } catch {
    /* ignore */
  }

  const { rows } = await query(
    `SELECT * FROM student_exam_attempts
      WHERE reg_no = $1 AND (attempt_kind = 'makeup' OR makeup_cycle_id = $2 OR exam_session = $3)
      ORDER BY semester, subject_code, id`,
    [regNo, cycle.id, session],
  )

  return Response.json({
    ok: true,
    saved: saved.length,
    errors,
    cycle,
    makeup_attempts: rows.map((r) => mapAttempt(r as Record<string, unknown>)),
    stamp: stampFromSession(user, action === "submit" ? "submitted" : "updated"),
  })
}

/** PATCH — verify / reject makeup attempt (HOD/Exam/Principal/Admin) */
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canVerifyMakeup(user.role)) return unauthorized()
  await ensureMakeupExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const id = Number(b.id)
  if (!id) return badRequest("id required")
  const action = String(b.action || b.status || "").toLowerCase()
  if (!["verify", "verified", "reject", "rejected"].includes(action)) {
    return badRequest("action must be verify or reject")
  }
  const status: AttemptStatus =
    action === "verify" || action === "verified" ? "verified" : "rejected"
  const rejectNote =
    b.reject_note != null ? stripEmoji(String(b.reject_note)).slice(0, 400) : null
  const stamp = stampFromSession(user, status === "verified" ? "verified" : "rejected")

  const { rows: check } = await query(
    `SELECT * FROM student_exam_attempts WHERE id = $1`,
    [id],
  )
  if (!check[0]) return badRequest("Attempt not found")
  if (!(await staffCanAccessReg(user, String(check[0].reg_no)))) {
    return unauthorized()
  }

  const { rows } = await query(
    `UPDATE student_exam_attempts SET
       status = $1,
       reject_note = CASE WHEN $1 = 'rejected' THEN $2 ELSE NULL END,
       verified_at = now(),
       verified_by = $3,
       verified_by_name = $4,
       verifier_role = $5,
       updated_at = now()
     WHERE id = $6
     RETURNING *`,
    [status, rejectNote, stamp.by_id, stamp.by_name, stamp.by_role, id],
  )

  try {
    await recomputeAndStoreStudentCgpa(String(rows[0].reg_no))
  } catch {
    /* ignore */
  }

  return Response.json({
    ok: true,
    attempt: mapAttempt(rows[0] as Record<string, unknown>),
    stamp,
  })
}
