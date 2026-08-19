import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureExamResultsSchema,
  loadStudentContext,
  staffCanAccessReg,
  effectiveSubjectStatus,
  computeExamFees,
  parseChallans,
  challanTotal,
  loadFineSchedule,
  resolveFineFromSchedule,
  type ExamAttemptRow,
  type AttemptResult,
  type AttemptStatus,
  type ChallanEntry,
  EXAM_FEE_MANAGERS,
} from "@/lib/exam-results"
import { stripEmoji } from "@/lib/no-emoji"
import { stampFromSession } from "@/lib/signature-stamp"
import { hodBranchOf } from "@/lib/account-approvals"
import { branchCodeFromDept } from "@/lib/curriculum-c20"

function mapAttempt(r: Record<string, unknown>): ExamAttemptRow {
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

/**
 * GET — live fee calculation for student (or staff ?reg_no=)
 * Also returns existing payment / multi-challan record.
 *
 * No K2 government API — students enter challan numbers; Exam ticks paid manually.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const url = new URL(req.url)
  let reg = (url.searchParams.get("reg_no") || "").trim()
  const cycle = (url.searchParams.get("exam_cycle") || "current").trim() || "current"

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    reg = user.reg_no
  } else if (!reg) {
    // list mode for exam desk
    return listFees(user, url)
  } else {
    if (!(await staffCanAccessReg(user, reg))) return unauthorized()
  }

  const ctx = await loadStudentContext(reg)
  if (!ctx) return badRequest("Student not found")

  const { rows: attRows } = await query(
    `SELECT * FROM student_exam_attempts WHERE reg_no = $1 ORDER BY id`,
    [reg],
  )
  const attempts = attRows.map(mapAttempt)
  const effective = effectiveSubjectStatus(attempts)
  // Fine always from Exam Cell schedule (ignore client ?fine=)
  const schedule = await loadFineSchedule(cycle)
  const fineInfo = resolveFineFromSchedule(schedule)
  const fees = computeExamFees({
    entryType: ctx.entry_type,
    currentStudyYear: ctx.current_study_year,
    effective,
    fine: fineInfo.fine,
    fineLabel: fineInfo.label,
    includePending: true,
  })

  const { rows: payRows } = await query(
    `SELECT * FROM exam_fee_payments WHERE reg_no = $1 AND exam_cycle = $2 ORDER BY id DESC LIMIT 1`,
    [reg, cycle],
  )
  const pay = payRows[0] || null
  const challans = pay ? parseChallans(pay.challans) : []

  return Response.json({
    student: ctx,
    fees,
    fine_schedule: {
      exam_cycle: cycle,
      tiers: schedule,
      resolved: fineInfo,
    },
    payment: pay
      ? {
          id: pay.id,
          status: pay.status,
          computed_total: pay.computed_total,
          fine_amount: pay.fine_amount,
          breakup: pay.breakup,
          challans,
          challan_total: challanTotal(challans),
          student_note: pay.student_note,
          staff_note: pay.staff_note,
          submitted_at: pay.submitted_at,
          paid_marked_at: pay.paid_marked_at,
          paid_marked_by_name: pay.paid_marked_by_name,
          paid_marked_by_role: pay.paid_marked_by_role ?? null,
          stamp:
            pay.paid_marked_by_name
              ? stampFromSession(
                  {
                    id: pay.paid_marked_by != null ? Number(pay.paid_marked_by) : null,
                    display_name: String(pay.paid_marked_by_name),
                    role: pay.paid_marked_by_role != null ? String(pay.paid_marked_by_role) : null,
                  },
                  pay.status === "paid" || pay.status === "partial" ? "paid" : "updated",
                  { at: pay.paid_marked_at ? String(pay.paid_marked_at) : null },
                )
              : null,
        }
      : null,
    note:
      "K2 is a treasury challan process — there is no free public K2 API integrated. Student enters receipt number(s); Exam Section verifies manually and ticks Paid. Fine is set by Exam Section date schedule (students cannot edit fine).",
  })
}

async function listFees(
  user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null },
  url: URL,
) {
  if (!["admin", "exam", "principal", "hod"].includes(user.role)) {
    return unauthorized()
  }
  const statusF = (url.searchParams.get("status") || "").trim()
  const branchF = (url.searchParams.get("branch") || "").trim()
  const cycle = (url.searchParams.get("exam_cycle") || "current").trim() || "current"

  const params: unknown[] = [cycle]
  let sql = `
    SELECT p.*, u.display_name, u.branch AS user_branch, s.dept, s.entry_type, s.current_study_year
      FROM exam_fee_payments p
      JOIN users u ON u.reg_no = p.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
      LEFT JOIN students s ON s.reg_no = p.reg_no
     WHERE p.exam_cycle = $1
       AND COALESCE(p.fee_kind, 'regular') = 'regular'`
  if (statusF) {
    params.push(statusF)
    sql += ` AND p.status = $${params.length}`
  }
  if (user.role === "hod") {
    const my = hodBranchOf(user)
    const code = my ? branchCodeFromDept(my) : null
    if (code) {
      // filter students of branch via attempts or dept
      params.push(`%${code === "CSE" ? "computer" : code === "CE" ? "civil" : code === "ECE" ? "electron" : "mech"}%`)
      sql += ` AND (lower(COALESCE(s.dept,u.branch,'')) LIKE $${params.length})`
    }
  } else if (branchF) {
    params.push(`%${branchF.toLowerCase()}%`)
    sql += ` AND (lower(COALESCE(s.dept,u.branch,'')) LIKE $${params.length})`
  }
  sql += ` ORDER BY p.updated_at DESC LIMIT 1000`

  const { rows } = await query(sql, params)
  return Response.json({
    payments: rows.map((r) => ({
      id: r.id,
      reg_no: r.reg_no,
      name: r.display_name,
      branch: r.dept || r.user_branch,
      entry_type: r.entry_type,
      status: r.status,
      computed_total: r.computed_total,
      fine_amount: r.fine_amount,
      challans: parseChallans(r.challans),
      challan_total: challanTotal(parseChallans(r.challans)),
      student_note: r.student_note,
      staff_note: r.staff_note,
      submitted_at: r.submitted_at,
      paid_marked_at: r.paid_marked_at,
      paid_marked_by_name: r.paid_marked_by_name,
      paid_marked_by_role: r.paid_marked_by_role ?? null,
      stamp: r.paid_marked_by_name
        ? stampFromSession(
            {
              id: r.paid_marked_by != null ? Number(r.paid_marked_by) : null,
              display_name: String(r.paid_marked_by_name),
              role: r.paid_marked_by_role != null ? String(r.paid_marked_by_role) : null,
            },
            r.status === "paid" || r.status === "partial" ? "paid" : "updated",
            { at: r.paid_marked_at ? String(r.paid_marked_at) : null },
          )
        : null,
      updated_at: r.updated_at,
    })),
    exam_cycle: cycle,
  })
}

/**
 * POST — student submits multi K2 challan details (no external API).
 * Body: { challans: [{receipt_no, amount}], fine?, exam_cycle?, note? }
 */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")

  let reg = String(b.reg_no || "").trim()
  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    reg = user.reg_no
  } else {
    if (!reg) return badRequest("reg_no required")
    if (!(await staffCanAccessReg(user, reg))) return unauthorized()
  }

  const cycle = String(b.exam_cycle || "current").trim() || "current"
  const challans = parseChallans(b.challans)
  if (!challans.length) {
    // also accept k2r1/k2a1 style
    const c1 = String(b.k2_receipt_1 || b.receipt_1 || "").trim()
    const a1 = Number(b.k2_amount_1 || b.amount_1 || 0)
    const c2 = String(b.k2_receipt_2 || b.receipt_2 || "").trim()
    const a2 = Number(b.k2_amount_2 || b.amount_2 || 0)
    if (c1) challans.push({ receipt_no: c1, amount: a1 })
    if (c2) challans.push({ receipt_no: c2, amount: a2 })
  }
  if (!challans.length) {
    return badRequest("Enter at least one K2 challan (receipt no + amount). Multiple allowed if paid in parts.")
  }
  for (const c of challans) {
    if (!c.receipt_no || !(c.amount > 0)) {
      return badRequest("Each challan needs receipt_no and amount > 0")
    }
  }

  const ctx = await loadStudentContext(reg)
  if (!ctx) return badRequest("Student not found")

  const { rows: attRows } = await query(`SELECT * FROM student_exam_attempts WHERE reg_no = $1`, [reg])
  const effective = effectiveSubjectStatus(attRows.map(mapAttempt))
  // Fine always from Exam Cell schedule (ignore client body.fine)
  const schedule = await loadFineSchedule(cycle)
  const fineInfo = resolveFineFromSchedule(schedule)
  const fine = fineInfo.fine
  const fees = computeExamFees({
    entryType: ctx.entry_type,
    currentStudyYear: ctx.current_study_year,
    effective,
    fine,
    fineLabel: fineInfo.label,
    includePending: true,
  })

  const { rows: existing } = await query(
    `SELECT id, status FROM exam_fee_payments WHERE reg_no = $1 AND exam_cycle = $2 ORDER BY id DESC LIMIT 1`,
    [reg, cycle],
  )

  if (existing[0]?.status === "paid" && user.role === "student") {
    return badRequest("Exam Section already marked this cycle as Paid. Contact them for corrections.")
  }

  const note = b.note != null ? stripEmoji(String(b.note)).slice(0, 500) || null : null
  // Strip emoji from challan receipt numbers
  for (const c of challans) {
    c.receipt_no = stripEmoji(c.receipt_no).slice(0, 80)
  }
  if (existing[0]) {
    await query(
      `UPDATE exam_fee_payments SET
         entry_type = $1, computed_total = $2, fine_amount = $3, breakup = $4::jsonb,
         challans = $5::jsonb, status = 'challan_submitted', student_note = $6,
         staff_note = NULL,
         submitted_at = now(), updated_at = now()
       WHERE id = $7`,
      [
        ctx.entry_type,
        fees.total,
        fine,
        JSON.stringify(fees.lines),
        JSON.stringify(challans),
        note,
        existing[0].id,
      ],
    )
  } else {
    await query(
      `INSERT INTO exam_fee_payments
        (reg_no, exam_cycle, entry_type, computed_total, fine_amount, breakup, challans, status, student_note, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'challan_submitted',$8,now())`,
      [
        reg,
        cycle,
        ctx.entry_type,
        fees.total,
        fine,
        JSON.stringify(fees.lines),
        JSON.stringify(challans),
        note,
      ],
    )
  }

  return Response.json({
    ok: true,
    fees,
    challans,
    challan_total: challanTotal(challans),
    status: "challan_submitted",
    message:
      "Challan details saved. Exam Section will verify payment manually and mark Paid (no online K2 API).",
  })
}

/**
 * PATCH — Exam / Admin / Principal manually mark paid | due | waived
 * (manual tick — no K2 API)
 */
export async function PATCH(req: Request) {
  const user = await requireRole(...EXAM_FEE_MANAGERS)
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")
  const id = Number(b.id)
  const reg = String(b.reg_no || "").trim()
  const status = String(b.status || "").toLowerCase()
  if (!["paid", "due", "partial", "waived", "challan_submitted", "rejected"].includes(status)) {
    return badRequest("status must be paid | due | partial | waived | challan_submitted | rejected")
  }

  let payId = id
  if (!payId && reg) {
    const cycle = String(b.exam_cycle || "current").trim() || "current"
    const { rows } = await query(
      `SELECT id FROM exam_fee_payments WHERE reg_no = $1 AND exam_cycle = $2 ORDER BY id DESC LIMIT 1`,
      [reg, cycle],
    )
    payId = rows[0]?.id
    if (!payId) {
      // create shell record then mark
      const ctx = await loadStudentContext(reg)
      if (!ctx) return badRequest("Student not found")
      const { rows: attRows } = await query(`SELECT * FROM student_exam_attempts WHERE reg_no = $1`, [reg])
      const sched = await loadFineSchedule(cycle)
      const fineInfo = resolveFineFromSchedule(sched)
      const fees = computeExamFees({
        entryType: ctx.entry_type,
        currentStudyYear: ctx.current_study_year,
        effective: effectiveSubjectStatus(attRows.map(mapAttempt)),
        fine: fineInfo.fine,
        fineLabel: fineInfo.label,
      })
      const challans = parseChallans(b.challans)
      const { rows: ins } = await query(
        `INSERT INTO exam_fee_payments
          (reg_no, exam_cycle, entry_type, computed_total, fine_amount, breakup, challans, status, staff_note)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) RETURNING id`,
        [
          reg,
          cycle,
          ctx.entry_type,
          fees.total,
          fees.fine,
          JSON.stringify(fees.lines),
          JSON.stringify(challans),
          status,
          b.note != null ? stripEmoji(String(b.note)).slice(0, 500) || null : null,
        ],
      )
      payId = ins[0].id
    }
  }
  if (!payId) return badRequest("id or reg_no required")

  const { rows: cur } = await query(`SELECT * FROM exam_fee_payments WHERE id = $1`, [payId])
  if (!cur[0]) return badRequest("Payment record not found")
  if (!(await staffCanAccessReg(user, String(cur[0].reg_no)))) return unauthorized()

  const staffNote =
    b.note != null ? stripEmoji(String(b.note)).slice(0, 500) || null : cur[0].staff_note
  let challansJson = cur[0].challans
  if (Array.isArray(b.challans)) {
    challansJson = parseChallans(b.challans)
  }

  const action =
    status === "paid" || status === "partial"
      ? "paid"
      : status === "rejected"
        ? "rejected"
        : Array.isArray(b.challans)
          ? "edited"
          : "updated"
  const payStamp = stampFromSession(user, action)

  // Always stamp who last changed (paid / edit / reject / due)
  await query(
    `UPDATE exam_fee_payments SET
       status = $1,
       staff_note = $2,
       challans = $3::jsonb,
       paid_marked_at = now(),
       paid_marked_by = $4,
       paid_marked_by_name = $5,
       paid_marked_by_role = $6,
       updated_at = now()
     WHERE id = $7`,
    [
      status,
      staffNote,
      JSON.stringify(challansJson),
      user.id,
      user.display_name || user.email,
      user.role,
      payId,
    ],
  )

  return Response.json({
    ok: true,
    id: payId,
    status,
    stamp: payStamp,
    message:
      status === "rejected"
        ? "Submission rejected. Student can see the reason and resubmit."
        : Array.isArray(b.challans)
          ? "Challan details updated by Exam Cell."
          : "Payment status updated manually (no K2 API).",
  })
}

/**
 * DELETE — Exam Cell removes a wrong student fee submission.
 * Body: { id, reason } — reason is required and shown to the student.
 * Soft-rejects (status=rejected, challans cleared) so the student can fix and resubmit.
 */
export async function DELETE(req: Request) {
  const user = await requireRole(...EXAM_FEE_MANAGERS)
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")

  const id = Number(b.id)
  if (!id || !Number.isFinite(id)) return badRequest("id required")

  const reason = stripEmoji(String(b.reason || b.note || "")).trim().slice(0, 500)
  if (!reason) {
    return badRequest("Tell the student what is wrong (reason is required before delete).")
  }

  const { rows: cur } = await query(`SELECT * FROM exam_fee_payments WHERE id = $1`, [id])
  if (!cur[0]) return badRequest("Payment record not found")
  if (!(await staffCanAccessReg(user, String(cur[0].reg_no)))) return unauthorized()

  const stamp = stampFromSession(user, "deleted")
  const hard = b.hard === true || b.mode === "hard"

  if (hard && user.role === "admin") {
    await query(`DELETE FROM exam_fee_payments WHERE id = $1`, [id])
    return Response.json({
      ok: true,
      deleted: true,
      hard: true,
      id,
      reason,
      stamp,
      message: "Fee submission permanently deleted.",
    })
  }

  // Soft delete / reject — keep row, clear challans, store reason for student
  await query(
    `UPDATE exam_fee_payments SET
       status = 'rejected',
       staff_note = $1,
       challans = '[]'::jsonb,
       paid_marked_at = now(),
       paid_marked_by = $2,
       paid_marked_by_name = $3,
       paid_marked_by_role = $4,
       updated_at = now()
     WHERE id = $5`,
    [reason, user.id, user.display_name || user.email, user.role, id],
  )

  return Response.json({
    ok: true,
    deleted: true,
    hard: false,
    id,
    status: "rejected",
    reason,
    stamp,
    message:
      "Submission removed. Student will see why and can enter corrected challan details.",
  })
}
