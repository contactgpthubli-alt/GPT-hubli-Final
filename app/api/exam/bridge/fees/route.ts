/**
 * Bridge Course fees — fixed tiers (not admin-editable), separate from regular/makeup.
 * Regular (first-time) subjects: up to 2 = Rs 200, 3+ = Rs 300.
 * Failed subjects (re-attempt): 1-2 = Rs 250, 3+ = Rs 350.
 */
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureBridgeExamSchema,
  mapBridgeAttempt,
  classifyBridgeAttempts,
  computeBridgeFees,
  canManageBridge,
  canVerifyBridge,
  cleanBridgeText,
  bridgeStamp,
  BRIDGE_FEE_CYCLE,
} from "@/lib/bridge-exam"
import {
  loadStudentContext,
  staffCanAccessReg,
  parseChallans,
  challanTotal,
  type FeePaymentStatus,
} from "@/lib/exam-results"
import { stampFromSession } from "@/lib/signature-stamp"
import { hodBranchOf } from "@/lib/account-approvals"
import { branchCodeFromDept } from "@/lib/curriculum-c20"

async function studentBridgeBundle(reg: string) {
  const ctx = await loadStudentContext(reg)
  if (!ctx) return null

  const { rows: attRows } = await query(
    `SELECT * FROM bridge_attempts WHERE reg_no = $1 ORDER BY id`,
    [reg],
  )
  const attempts = attRows.map((r) => mapBridgeAttempt(r as Record<string, unknown>))
  const { regularCount, failedCount, bySubject } = classifyBridgeAttempts(attempts)
  const fees = computeBridgeFees({ regularCount, failedCount })

  const { rows: payRows } = await query(
    `SELECT * FROM exam_fee_payments
      WHERE reg_no = $1 AND fee_kind = 'bridge' AND exam_cycle = $2
      ORDER BY id DESC LIMIT 1`,
    [reg, BRIDGE_FEE_CYCLE],
  )
  const pay = payRows[0]
  let payment = null
  if (pay) {
    const challans = parseChallans(pay.challans)
    payment = {
      id: pay.id,
      status: pay.status,
      fee_kind: "bridge",
      computed_total: pay.computed_total,
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

  return { ctx, regularCount, failedCount, bySubject, fees, payment }
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureBridgeExamSchema()

  const url = new URL(req.url)
  let reg = (url.searchParams.get("reg_no") || "").trim()

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    reg = user.reg_no
    const bundle = await studentBridgeBundle(reg)
    if (!bundle) return badRequest("Student not found")
    return Response.json({
      student: bundle.ctx,
      regular_count: bundle.regularCount,
      failed_count: bundle.failedCount,
      fees: bundle.fees,
      payment: bundle.payment,
      note: "Bridge fees: Rs 200 (up to 2 subjects) / Rs 300 (3+) for new subjects. Failed subjects re-attempt: Rs 250 (1-2) / Rs 350 (3+). Same K2 challan process.",
    })
  }

  // Staff list mode
  if (!reg) {
    if (!canManageBridge(user.role) && !canVerifyBridge(user.role)) return unauthorized()
    const statusF = (url.searchParams.get("status") || "").trim()
    const params: unknown[] = []
    let sql = `
      SELECT p.*, u.display_name, u.branch AS user_branch, s.dept
        FROM exam_fee_payments p
        JOIN users u ON u.reg_no = p.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
        LEFT JOIN students s ON s.reg_no = p.reg_no
       WHERE p.fee_kind = 'bridge'`
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
      payments: rows.map((r) => ({
        id: r.id,
        reg_no: r.reg_no,
        name: r.display_name,
        branch: r.dept || r.user_branch,
        status: r.status,
        computed_total: r.computed_total,
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

  if (!(await staffCanAccessReg(user, reg)) && !canManageBridge(user.role)) {
    return unauthorized()
  }
  const bundle = await studentBridgeBundle(reg)
  if (!bundle) return badRequest("Student not found")
  return Response.json({
    student: bundle.ctx,
    regular_count: bundle.regularCount,
    failed_count: bundle.failedCount,
    fees: bundle.fees,
    payment: bundle.payment,
  })
}

/** POST — student submits bridge K2 challans */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureBridgeExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")

  let reg = String(b.reg_no || "").trim()
  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    reg = user.reg_no
  } else {
    if (!reg) return badRequest("reg_no required")
    if (!canManageBridge(user.role) && !(await staffCanAccessReg(user, reg))) {
      return unauthorized()
    }
  }

  const challans = parseChallans(b.challans)
  if (!challans.length) {
    return badRequest("Enter at least one K2 challan (receipt no + amount)")
  }
  for (const c of challans) {
    c.receipt_no = cleanBridgeText(c.receipt_no, 60)
  }

  const bundle = await studentBridgeBundle(reg)
  if (!bundle) return badRequest("Cannot compute bridge fees")
  if (!bundle.fees.total) {
    return badRequest("No bridge subjects entered yet — nothing to pay for")
  }

  const note = b.note != null ? cleanBridgeText(b.note, 400) : null

  const { rows: existing } = await query(
    `SELECT id, status FROM exam_fee_payments
      WHERE reg_no = $1 AND fee_kind = 'bridge' AND exam_cycle = $2
      LIMIT 1`,
    [reg, BRIDGE_FEE_CYCLE],
  )

  let payRow: Record<string, unknown> | null = null
  if (existing[0]) {
    const keepPaid = ["paid", "partial", "waived"].includes(String(existing[0].status))
    const { rows } = await query(
      `UPDATE exam_fee_payments SET
         computed_total = $2,
         breakup = $3::jsonb,
         status = CASE WHEN $4 THEN status ELSE 'challan_submitted' END,
         challans = $5::jsonb,
         student_note = $6,
         staff_note = CASE WHEN $4 THEN staff_note ELSE NULL END,
         submitted_at = now(),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        existing[0].id,
        bundle.fees.total,
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
         reg_no, exam_cycle, entry_type, fee_kind,
         computed_total, fine_amount, breakup, status, challans,
         student_note, submitted_at, updated_at
       ) VALUES (
         $1, $2, 'regular', 'bridge',
         $3, 0, $4::jsonb, 'challan_submitted', $5::jsonb,
         $6, now(), now()
       ) RETURNING *`,
      [
        reg,
        BRIDGE_FEE_CYCLE,
        bundle.fees.total,
        JSON.stringify(bundle.fees.lines),
        JSON.stringify(challans),
        note,
      ],
    )
    payRow = rows[0] as Record<string, unknown>
  }

  return Response.json({
    ok: true,
    message: "Bridge Course challan details submitted. Exam Section will verify and mark Paid.",
    fees: bundle.fees,
    payment: payRow,
  })
}

/** PATCH — Exam marks bridge fee paid / partial / due / rejected, or edits challans */
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canManageBridge(user.role)) return unauthorized()
  await ensureBridgeExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const id = Number(b.id)
  if (!id) return badRequest("id required")
  const status = String(b.status || "").toLowerCase() as FeePaymentStatus
  if (!["paid", "partial", "due", "challan_submitted", "waived", "rejected"].includes(status)) {
    return badRequest("Invalid status")
  }
  const action =
    status === "paid" || status === "partial"
      ? "paid"
      : status === "rejected"
        ? "rejected"
        : Array.isArray(b.challans)
          ? "edited"
          : "updated"
  const stamp = bridgeStamp(user, action)
  const staffNoteRaw =
    b.staff_note != null
      ? cleanBridgeText(b.staff_note, 400)
      : b.note != null
        ? cleanBridgeText(b.note, 400)
        : null

  const { rows: cur } = await query(
    `SELECT * FROM exam_fee_payments WHERE id = $1 AND fee_kind = 'bridge'`,
    [id],
  )
  if (!cur[0]) return badRequest("Bridge payment not found")
  if (!(await staffCanAccessReg(user, String(cur[0].reg_no)))) return unauthorized()

  let challansJson = cur[0].challans
  if (Array.isArray(b.challans)) {
    challansJson = parseChallans(b.challans)
  }

  const { rows } = await query(
    `UPDATE exam_fee_payments SET
       status = $1,
       staff_note = COALESCE(NULLIF($2,''), staff_note),
       challans = $3::jsonb,
       paid_marked_at = now(),
       paid_marked_by = $4,
       paid_marked_by_name = $5,
       paid_marked_by_role = $6,
       updated_at = now()
     WHERE id = $7 AND fee_kind = 'bridge'
     RETURNING *`,
    [
      status,
      staffNoteRaw || "",
      JSON.stringify(challansJson),
      stamp.by_id,
      stamp.by_name,
      stamp.by_role,
      id,
    ],
  )
  if (!rows[0]) return badRequest("Bridge payment not found")
  return Response.json({
    ok: true,
    payment: rows[0],
    stamp,
    message:
      status === "rejected"
        ? "Submission rejected. Student can see the reason and resubmit."
        : Array.isArray(b.challans)
          ? "Bridge challan details updated by Exam Cell."
          : "Bridge fee status updated.",
  })
}

/**
 * DELETE — Exam Cell removes a wrong bridge fee submission.
 * Body: { id, reason } — reason required; shown to the student.
 */
export async function DELETE(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canManageBridge(user.role)) return unauthorized()
  await ensureBridgeExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const id = Number(b.id)
  if (!id) return badRequest("id required")

  const reason = cleanBridgeText(b.reason || b.note, 500)
  if (!reason) {
    return badRequest("Tell the student what is wrong (reason is required before delete).")
  }

  const { rows: cur } = await query(
    `SELECT * FROM exam_fee_payments WHERE id = $1 AND fee_kind = 'bridge'`,
    [id],
  )
  if (!cur[0]) return badRequest("Bridge payment not found")
  if (!(await staffCanAccessReg(user, String(cur[0].reg_no)))) return unauthorized()

  const stamp = bridgeStamp(user, "deleted")
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
     WHERE id = $5 AND fee_kind = 'bridge'`,
    [reason, stamp.by_id, stamp.by_name, stamp.by_role, id],
  )

  return Response.json({
    ok: true,
    deleted: true,
    id,
    status: "rejected",
    reason,
    stamp,
    message: "Bridge submission removed. Student will see why and can enter corrected challan details.",
  })
}
