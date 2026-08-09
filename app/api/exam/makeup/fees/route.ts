/**
 * Makeup exam fees — separate from regular; same K2 multi-challan flow.
 */
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureMakeupExamSchema,
  getOpenMakeupCycle,
  getMakeupCycleById,
  eligibleMakeupSubjects,
  computeMakeupFees,
  loadMakeupFineSchedule,
  resolveMakeupFine,
  makeupCycleKey,
  canManageMakeup,
  canVerifyMakeup,
} from "@/lib/makeup-exam"
import {
  loadStudentContext,
  staffCanAccessReg,
  effectiveSubjectStatus,
  parseChallans,
  challanTotal,
  type ExamAttemptRow,
  type AttemptResult,
  type AttemptStatus,
  type FeePaymentStatus,
} from "@/lib/exam-results"
import { stampFromSession } from "@/lib/signature-stamp"
import { stripEmoji } from "@/lib/no-emoji"
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

async function studentMakeupBundle(reg: string, cycleId?: number | null) {
  const ctx = await loadStudentContext(reg)
  if (!ctx) return null
  let cycle = cycleId ? await getMakeupCycleById(cycleId) : await getOpenMakeupCycle()
  if (!cycle && cycleId) return { ctx, cycle: null, fees: null, payment: null, eligible: [] }

  const { rows: attRows } = await query(
    `SELECT * FROM student_exam_attempts WHERE reg_no = $1 ORDER BY id`,
    [reg],
  )
  const attempts = attRows.map((r) => mapAttempt(r as Record<string, unknown>))
  const effective = effectiveSubjectStatus(attempts)
  const eligible = cycle ? eligibleMakeupSubjects(effective, cycle) : []

  let fineInfo = { fine: 0, label: null as string | null, as_of: "" }
  if (cycle) {
    const tiers = await loadMakeupFineSchedule(cycle.id)
    fineInfo = resolveMakeupFine(tiers)
  }

  const fees = cycle
    ? computeMakeupFees({
        cycle,
        eligibleCount: eligible.length,
        eligible,
        fine: fineInfo.fine,
        fineLabel: fineInfo.label,
      })
    : null

  let payment = null
  if (cycle) {
    const { rows: payRows } = await query(
      `SELECT * FROM exam_fee_payments
        WHERE reg_no = $1 AND fee_kind = 'makeup' AND makeup_cycle_id = $2
        ORDER BY id DESC LIMIT 1`,
      [reg, cycle.id],
    )
    const pay = payRows[0]
    if (pay) {
      const challans = parseChallans(pay.challans)
      payment = {
        id: pay.id,
        status: pay.status,
        fee_kind: "makeup",
        makeup_cycle_id: cycle.id,
        exam_cycle: pay.exam_cycle,
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
        stamp: pay.paid_marked_by_name
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
    }
  }

  return {
    ctx,
    cycle,
    eligible,
    fees,
    fine: fineInfo,
    payment,
  }
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureMakeupExamSchema()

  const url = new URL(req.url)
  let reg = (url.searchParams.get("reg_no") || "").trim()
  const cycleId = url.searchParams.get("cycle_id")
    ? Number(url.searchParams.get("cycle_id"))
    : null

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    reg = user.reg_no
    const bundle = await studentMakeupBundle(reg, cycleId)
    if (!bundle) return badRequest("Student not found")
    return Response.json({
      student: bundle.ctx,
      cycle: bundle.cycle,
      eligible: bundle.eligible,
      fees: bundle.fees,
      fine_schedule: bundle.fine,
      payment: bundle.payment,
      note:
        "Makeup fees are separate from regular. Same K2 challan process; Exam marks Paid after verify.",
    })
  }

  // Staff list mode
  if (!reg) {
    if (!canManageMakeup(user.role) && !canVerifyMakeup(user.role)) {
      return unauthorized()
    }
    const statusF = (url.searchParams.get("status") || "").trim()
    const open = await getOpenMakeupCycle()
    const cid = cycleId || open?.id
    if (!cid) {
      return Response.json({
        payments: [],
        cycle: null,
        note: "No open makeup cycle. Declare one under Makeup → Declare cycle.",
      })
    }
    const cycle = await getMakeupCycleById(cid)
    const params: unknown[] = [cid]
    let sql = `
      SELECT p.*, u.display_name, u.branch AS user_branch, s.dept
        FROM exam_fee_payments p
        JOIN users u ON u.reg_no = p.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
        LEFT JOIN students s ON s.reg_no = p.reg_no
       WHERE p.fee_kind = 'makeup' AND p.makeup_cycle_id = $1`
    if (statusF) {
      params.push(statusF)
      sql += ` AND p.status = $${params.length}`
    }
    if (user.role === "hod") {
      const my = hodBranchOf(user)
      const code = my ? branchCodeFromDept(my) : null
      if (code) {
        params.push(
          `%${code === "CSE" ? "computer" : code === "CE" ? "civil" : code === "ECE" ? "electron" : "mech"}%`,
        )
        sql += ` AND (lower(COALESCE(s.dept,u.branch,'')) LIKE $${params.length})`
      }
    }
    sql += ` ORDER BY p.updated_at DESC LIMIT 1000`
    const { rows } = await query(sql, params)
    return Response.json({
      cycle,
      payments: rows.map((r) => ({
        id: r.id,
        reg_no: r.reg_no,
        name: r.display_name,
        branch: r.dept || r.user_branch,
        status: r.status,
        computed_total: r.computed_total,
        fine_amount: r.fine_amount,
        challans: parseChallans(r.challans),
        challan_total: challanTotal(parseChallans(r.challans)),
        student_note: r.student_note,
        paid_marked_by_name: r.paid_marked_by_name,
        paid_marked_by_role: r.paid_marked_by_role,
        submitted_at: r.submitted_at,
        updated_at: r.updated_at,
      })),
    })
  }

  if (!(await staffCanAccessReg(user, reg)) && !canManageMakeup(user.role)) {
    // cash/acm not in staffCanAccessReg — allow managers
    if (!canManageMakeup(user.role)) return unauthorized()
  }
  const bundle = await studentMakeupBundle(reg, cycleId)
  if (!bundle) return badRequest("Student not found")
  return Response.json({
    student: bundle.ctx,
    cycle: bundle.cycle,
    eligible: bundle.eligible,
    fees: bundle.fees,
    fine_schedule: bundle.fine,
    payment: bundle.payment,
  })
}

/** POST — student submits makeup K2 challans */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureMakeupExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")

  let reg = String(b.reg_no || "").trim()
  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    reg = user.reg_no
  } else {
    if (!reg) return badRequest("reg_no required")
    if (!canManageMakeup(user.role) && !(await staffCanAccessReg(user, reg))) {
      return unauthorized()
    }
  }

  const cycle =
    (b.cycle_id ? await getMakeupCycleById(Number(b.cycle_id)) : null) ||
    (await getOpenMakeupCycle())
  if (!cycle) return badRequest("No open makeup cycle")
  if (cycle.status !== "open" && user.role === "student") {
    return badRequest("Makeup cycle is not open for payment")
  }

  const challans = parseChallans(b.challans)
  if (!challans.length) {
    return badRequest("Enter at least one K2 challan (receipt no + amount)")
  }
  for (const c of challans) {
    c.receipt_no = stripEmoji(c.receipt_no)
  }

  const bundle = await studentMakeupBundle(reg, cycle.id)
  if (!bundle || !bundle.fees) return badRequest("Cannot compute makeup fees")

  const note = b.note != null ? stripEmoji(String(b.note)).slice(0, 400) : null
  const cycleKey = makeupCycleKey(cycle.id)

  const { rows: existing } = await query(
    `SELECT id, status FROM exam_fee_payments
      WHERE reg_no = $1 AND fee_kind = 'makeup' AND makeup_cycle_id = $2
      LIMIT 1`,
    [reg, cycle.id],
  )

  let payRow: Record<string, unknown> | null = null
  if (existing[0]) {
    const keepPaid = ["paid", "partial", "waived"].includes(String(existing[0].status))
    const { rows } = await query(
      `UPDATE exam_fee_payments SET
         exam_cycle = $2,
         computed_total = $3,
         fine_amount = $4,
         breakup = $5::jsonb,
         status = CASE WHEN $6 THEN status ELSE 'challan_submitted' END,
         challans = $7::jsonb,
         student_note = $8,
         submitted_at = now(),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        existing[0].id,
        cycleKey,
        bundle.fees.total,
        bundle.fees.fine,
        JSON.stringify(bundle.fees.lines),
        keepPaid,
        JSON.stringify(challans),
        note,
      ],
    )
    payRow = rows[0] as Record<string, unknown>
  } else {
    const { rows } = await query(
      `INSERT INTO exam_fee_payments (
         reg_no, exam_cycle, entry_type, fee_kind, makeup_cycle_id,
         computed_total, fine_amount, breakup, status, challans,
         student_note, submitted_at, updated_at
       ) VALUES (
         $1, $2, 'regular', 'makeup', $3,
         $4, $5, $6::jsonb, 'challan_submitted', $7::jsonb,
         $8, now(), now()
       ) RETURNING *`,
      [
        reg,
        cycleKey,
        cycle.id,
        bundle.fees.total,
        bundle.fees.fine,
        JSON.stringify(bundle.fees.lines),
        JSON.stringify(challans),
        note,
      ],
    )
    payRow = rows[0] as Record<string, unknown>
  }

  return Response.json({
    ok: true,
    message: "Makeup challan details submitted. Exam Section will verify and mark Paid.",
    cycle,
    fees: bundle.fees,
    payment: payRow,
  })
}

/** PATCH — Exam marks makeup fee paid / partial / due */
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canManageMakeup(user.role)) return unauthorized()
  await ensureMakeupExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const id = Number(b.id)
  if (!id) return badRequest("id required")
  const status = String(b.status || "").toLowerCase() as FeePaymentStatus
  if (!["paid", "partial", "due", "challan_submitted", "waived"].includes(status)) {
    return badRequest("Invalid status")
  }
  const stamp = stampFromSession(
    user,
    status === "paid" || status === "partial" ? "paid" : "updated",
  )
  const staffNote =
    b.staff_note != null ? stripEmoji(String(b.staff_note)).slice(0, 400) : null

  const { rows } = await query(
    `UPDATE exam_fee_payments SET
       status = $1,
       staff_note = COALESCE(NULLIF($2,''), staff_note),
       paid_marked_at = CASE WHEN $1 IN ('paid','partial','waived') THEN now() ELSE paid_marked_at END,
       paid_marked_by = CASE WHEN $1 IN ('paid','partial','waived') THEN $3 ELSE paid_marked_by END,
       paid_marked_by_name = CASE WHEN $1 IN ('paid','partial','waived') THEN $4 ELSE paid_marked_by_name END,
       paid_marked_by_role = CASE WHEN $1 IN ('paid','partial','waived') THEN $5 ELSE paid_marked_by_role END,
       updated_at = now()
     WHERE id = $6 AND fee_kind = 'makeup'
     RETURNING *`,
    [status, staffNote || "", stamp.by_id, stamp.by_name, stamp.by_role, id],
  )
  if (!rows[0]) return badRequest("Makeup payment not found")
  return Response.json({ ok: true, payment: rows[0], stamp })
}
