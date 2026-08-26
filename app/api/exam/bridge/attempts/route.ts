/**
 * Bridge Course result self-entry — free-text subjects, always open (no cycle).
 * ITI / PUC lateral-entry students log the bridge subjects they've taken.
 */
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureBridgeExamSchema,
  mapBridgeAttempt,
  canVerifyBridge,
  cleanBridgeText,
  bridgeStamp,
  type BridgeAttemptRow,
} from "@/lib/bridge-exam"
import { loadStudentContext, staffCanAccessReg, type AttemptResult, type AttemptStatus } from "@/lib/exam-results"

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureBridgeExamSchema()

  const url = new URL(req.url)
  let reg = (url.searchParams.get("reg_no") || "").trim()
  const listMode = url.searchParams.get("list") === "1" || url.searchParams.get("status")

  // Staff pending list across students
  if (listMode && user.role !== "student") {
    if (!canVerifyBridge(user.role)) return unauthorized()
    const statusF = (url.searchParams.get("status") || "pending").trim()
    const branchF = (url.searchParams.get("branch") || "").trim().toUpperCase()
    const params: unknown[] = []
    let sql = `
      SELECT a.*, u.display_name AS student_name, s.dept
        FROM bridge_attempts a
        JOIN users u ON u.reg_no = a.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
        LEFT JOIN students s ON s.reg_no = a.reg_no
       WHERE 1=1`
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
        ...mapBridgeAttempt(r as Record<string, unknown>),
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
    if (!(await staffCanAccessReg(user, reg)) && !canVerifyBridge(user.role)) {
      return unauthorized()
    }
  }

  const ctx = await loadStudentContext(reg)
  if (!ctx) return badRequest("Student not found")

  const { rows } = await query(
    `SELECT * FROM bridge_attempts WHERE reg_no = $1 ORDER BY semester, id`,
    [reg],
  )
  const attempts = rows.map((r) => mapBridgeAttempt(r as Record<string, unknown>))

  return Response.json({
    student: ctx,
    attempts,
    note: "Bridge Course entry is always open — add a subject, save, and submit for HOD / Exam verification.",
  })
}

/** POST — save/submit bridge subject rows (add new, or edit an existing non-verified row) */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureBridgeExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")

  const action = String(b.action || "save")
  let regNo = String(b.reg_no || "").trim()
  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    regNo = user.reg_no
  } else if (canVerifyBridge(user.role)) {
    if (!regNo) return badRequest("reg_no required")
    if (!(await staffCanAccessReg(user, regNo))) return unauthorized()
  } else {
    return unauthorized()
  }

  const ctx = await loadStudentContext(regNo)
  if (!ctx) return badRequest("Student not found")
  if (!ctx.branch_code) return badRequest("Student branch not set")

  const items = Array.isArray(b.attempts) ? b.attempts : []
  if (!items.length) return badRequest("attempts[] required")

  const { rows: existingRows } = await query(
    `SELECT * FROM bridge_attempts WHERE reg_no = $1 ORDER BY id`,
    [regNo],
  )
  const existing = existingRows.map((r) => mapBridgeAttempt(r as Record<string, unknown>))

  const wantStatus: AttemptStatus = action === "submit" ? "pending" : "draft"
  const saved: number[] = []
  const errors: string[] = []

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const it = raw as Record<string, unknown>
    const subject_name = cleanBridgeText(it.subject_name, 160)
    const semester = Number(it.semester)
    const result = String(it.result || "fail").toLowerCase() as AttemptResult
    const grade = cleanBridgeText(it.grade, 10)
    const id = it.id != null ? Number(it.id) : null

    if (!subject_name || !semester || semester < 1 || semester > 6) {
      errors.push("Missing subject name / semester (1-6)")
      continue
    }
    if (!["pass", "fail", "absent"].includes(result)) {
      errors.push(`${subject_name}: invalid result`)
      continue
    }

    const row = id ? existing.find((a) => a.id === id) : null
    if (id && !row) {
      errors.push(`${subject_name}: row not found`)
      continue
    }

    if (row) {
      if (row.status === "verified" && user.role !== "admin") {
        errors.push(`${subject_name}: verified — locked`)
        continue
      }
      const status = row.status === "verified" && user.role === "admin" ? "verified" : wantStatus
      await query(
        `UPDATE bridge_attempts SET
           subject_name = $1, semester = $2, result = $3, grade = $4, status = $5,
           submitted_at = CASE WHEN $5 = 'pending' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
           reject_note = CASE WHEN $5 = 'pending' THEN NULL ELSE reject_note END,
           updated_at = now()
         WHERE id = $6`,
        [subject_name, semester, result, grade, status, row.id],
      )
      saved.push(row.id)
    } else {
      // New subject: only allowed if there's no open (non-rejected, not-yet-failed) entry
      // for the same name — a second row means the first was verified fail/absent.
      const sameName = existing.filter(
        (a) =>
          a.status !== "rejected" &&
          a.subject_name.trim().toLowerCase() === subject_name.trim().toLowerCase(),
      )
      const openOne = sameName.find((a) => !(a.status === "verified" && (a.result === "fail" || a.result === "absent")))
      if (openOne) {
        errors.push(`${subject_name}: already have an entry for this subject — edit it instead of adding a new one`)
        continue
      }
      const { rows: ins } = await query(
        `INSERT INTO bridge_attempts
          (reg_no, branch_code, semester, subject_name, result, grade, status, submitted_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
           CASE WHEN $7 = 'pending' THEN now() ELSE NULL END, $8)
         RETURNING id`,
        [regNo, ctx.branch_code, semester, subject_name, result, grade, wantStatus, user.id],
      )
      saved.push(Number(ins[0].id))
      existing.push({
        id: Number(ins[0].id),
        reg_no: regNo,
        branch_code: ctx.branch_code,
        semester,
        subject_name,
        result,
        grade,
        status: wantStatus,
        reject_note: null,
        submitted_at: null,
        verified_at: null,
        verified_by_name: null,
        verifier_role: null,
        created_at: null,
        updated_at: null,
      })
    }
  }

  const { rows } = await query(
    `SELECT * FROM bridge_attempts WHERE reg_no = $1 ORDER BY semester, id`,
    [regNo],
  )

  return Response.json({
    ok: true,
    saved: saved.length,
    errors,
    attempts: rows.map((r) => mapBridgeAttempt(r as Record<string, unknown>)),
    stamp: bridgeStamp(user, action === "submit" ? "submitted" : "updated"),
  })
}

/** DELETE — student removes a not-yet-submitted draft row */
export async function DELETE(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureBridgeExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const id = Number(b.id)
  if (!id) return badRequest("id required")

  const { rows } = await query(`SELECT * FROM bridge_attempts WHERE id = $1`, [id])
  const row = rows[0] as (BridgeAttemptRow & { reg_no: string }) | undefined
  if (!row) return badRequest("Row not found")

  if (user.role === "student") {
    if (user.reg_no !== row.reg_no) return unauthorized()
  } else if (!(await staffCanAccessReg(user, row.reg_no)) && !canVerifyBridge(user.role)) {
    return unauthorized()
  }
  if (row.status === "verified" && user.role !== "admin") {
    return badRequest("Verified rows cannot be deleted")
  }

  await query(`DELETE FROM bridge_attempts WHERE id = $1`, [id])
  return Response.json({ ok: true, deleted: true, id })
}

/** PATCH — verify / reject a bridge attempt (HOD/Exam/Principal/Admin) */
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canVerifyBridge(user.role)) return unauthorized()
  await ensureBridgeExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const id = Number(b.id)
  if (!id) return badRequest("id required")
  const action = String(b.action || b.status || "").toLowerCase()
  if (!["verify", "verified", "reject", "rejected"].includes(action)) {
    return badRequest("action must be verify or reject")
  }
  const status: AttemptStatus = action === "verify" || action === "verified" ? "verified" : "rejected"
  const rejectNote = b.reject_note != null ? cleanBridgeText(b.reject_note, 400) : null
  const stamp = bridgeStamp(user, status === "verified" ? "verified" : "rejected")

  const { rows: check } = await query(`SELECT * FROM bridge_attempts WHERE id = $1`, [id])
  if (!check[0]) return badRequest("Attempt not found")
  if (!(await staffCanAccessReg(user, String(check[0].reg_no)))) return unauthorized()

  const { rows } = await query(
    `UPDATE bridge_attempts SET
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

  return Response.json({
    ok: true,
    attempt: mapBridgeAttempt(rows[0] as Record<string, unknown>),
    stamp,
  })
}
