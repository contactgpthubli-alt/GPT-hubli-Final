import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureAdmissionFeesSchema,
  canVerifyAdmissionFees,
  normalizeStudyYear,
  yearLabel,
  type AdmissionFeeStatus,
} from "@/lib/admission-fees"
import { stampFromSession } from "@/lib/signature-stamp"
import { stripEmoji } from "@/lib/no-emoji"
import { hodBranchOf } from "@/lib/account-approvals"
import { branchCodeFromDept } from "@/lib/curriculum-c20"
import { loadStudentContext } from "@/lib/exam-results"

/** Admission-fee verifiers: broad office + academic; HOD limited to branch. */
async function canAccessAdmissionStudent(
  user: { role: string; branch?: string | null; display_name?: string | null },
  regNo: string,
): Promise<boolean> {
  if (!canVerifyAdmissionFees(user.role)) return false
  if (user.role !== "hod") return true
  const my = hodBranchOf(user)
  if (!my) return false
  const ctx = await loadStudentContext(regNo)
  if (!ctx) return false
  const code = (ctx.branch_code || "").toUpperCase()
  const dept = (ctx.branch || "").toUpperCase()
  const mine = my.toUpperCase()
  return code === mine || dept.includes(mine) || (ctx.reg_no || "").toUpperCase().includes(mine)
}

function mapRow(r: Record<string, unknown>) {
  const status = String(r.status || "not_paid") as AdmissionFeeStatus
  return {
    id: Number(r.id),
    reg_no: String(r.reg_no),
    study_year: Number(r.study_year) || 1,
    year_label: yearLabel(Number(r.study_year) || 1),
    academic_year: r.academic_year != null ? String(r.academic_year) : null,
    status,
    amount: r.amount != null ? String(r.amount) : null,
    receipt_no: r.receipt_no != null ? String(r.receipt_no) : null,
    paid_date: r.paid_date != null ? String(r.paid_date) : null,
    student_note: r.student_note != null ? String(r.student_note) : null,
    staff_note: r.staff_note != null ? String(r.staff_note) : null,
    submitted_at: r.submitted_at ? String(r.submitted_at) : null,
    submitted_by_name: r.submitted_by_name != null ? String(r.submitted_by_name) : null,
    verified_at: r.verified_at ? String(r.verified_at) : null,
    verified_by_name: r.verified_by_name != null ? String(r.verified_by_name) : null,
    verified_by_role: r.verified_by_role != null ? String(r.verified_by_role) : null,
    stamp:
      r.verified_by_name
        ? stampFromSession(
            {
              id: r.verified_by != null ? Number(r.verified_by) : null,
              display_name: String(r.verified_by_name),
              role: r.verified_by_role != null ? String(r.verified_by_role) : null,
            },
            status === "paid" ? "paid" : status === "not_paid" ? "not_paid" : "verified",
            { at: r.verified_at ? String(r.verified_at) : null },
          )
        : null,
  }
}

/**
 * GET — student: own live status for current study year (or ?study_year=).
 * Staff: list pending / filtered records (?status=&branch=&reg_no=).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureAdmissionFeesSchema()

  const url = new URL(req.url)
  let reg = (url.searchParams.get("reg_no") || "").trim()
  const studyYearParam = url.searchParams.get("study_year")

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    reg = user.reg_no
    const ctx = await loadStudentContext(reg)
    if (!ctx) return badRequest("Student not found")
    const studyYear = studyYearParam
      ? normalizeStudyYear(studyYearParam)
      : normalizeStudyYear(ctx.current_study_year)

    const { rows } = await query(
      `SELECT * FROM admission_fee_records WHERE reg_no = $1 AND study_year = $2 LIMIT 1`,
      [reg, studyYear],
    )
    const row = rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null
    return Response.json({
      reg_no: reg,
      study_year: studyYear,
      year_label: yearLabel(studyYear),
      name: ctx.name || user.display_name || null,
      status: row?.status || "not_paid",
      record: row,
      live: {
        status: row?.status || "not_paid",
        label:
          (row?.status || "not_paid") === "paid"
            ? "Paid"
            : (row?.status || "not_paid") === "pending"
              ? "Pending verification"
              : "Not paid",
      },
    })
  }

  // Staff: single student lookup
  if (reg) {
    if (!(await canAccessAdmissionStudent(user, reg))) return unauthorized()
    const ctx = await loadStudentContext(reg)
    if (!ctx) return badRequest("Student not found")
    const studyYear = studyYearParam
      ? normalizeStudyYear(studyYearParam)
      : normalizeStudyYear(ctx.current_study_year)
    const { rows } = await query(
      `SELECT * FROM admission_fee_records WHERE reg_no = $1 AND study_year = $2 LIMIT 1`,
      [reg, studyYear],
    )
    const row = rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null
    return Response.json({
      reg_no: reg,
      study_year: studyYear,
      year_label: yearLabel(studyYear),
      name: ctx.name || null,
      status: row?.status || "not_paid",
      record: row,
      can_verify: canVerifyAdmissionFees(user.role),
    })
  }

  // Staff list
  if (!canVerifyAdmissionFees(user.role)) return unauthorized()

  const status = (url.searchParams.get("status") || "").trim()
  const branch = (url.searchParams.get("branch") || "").trim().toUpperCase()
  const params: unknown[] = []
  let where = "WHERE 1=1"
  if (status) {
    params.push(status)
    where += ` AND a.status = $${params.length}`
  }
  if (user.role === "hod") {
    const hb = hodBranchOf(user)
    if (hb) {
      params.push(`%${hb}%`)
      where += ` AND (s.dept ILIKE $${params.length} OR COALESCE(s.extra->>'Branch','') ILIKE $${params.length})`
    }
  } else if (branch) {
    params.push(`%${branch}%`)
    where += ` AND (
      UPPER(COALESCE(s.extra->>'Branch','')) LIKE $${params.length}
      OR s.dept ILIKE $${params.length}
      OR UPPER(s.reg_no) LIKE $${params.length}
    )`
  }

  const { rows } = await query(
    `SELECT a.*, s.name, s.dept, s.year, s.current_study_year, s.extra
       FROM admission_fee_records a
       LEFT JOIN students s ON UPPER(s.reg_no) = UPPER(a.reg_no)
       ${where}
       ORDER BY
         CASE a.status WHEN 'pending' THEN 0 WHEN 'not_paid' THEN 1 ELSE 2 END,
         a.updated_at DESC
       LIMIT 500`,
    params,
  )

  const records = rows.map((r) => {
    const base = mapRow(r as Record<string, unknown>)
    const extra =
      r.extra && typeof r.extra === "object" && !Array.isArray(r.extra)
        ? (r.extra as Record<string, unknown>)
        : {}
    const dept = String(r.dept || extra["Branch"] || "")
    return {
      ...base,
      name: r.name != null ? String(r.name) : null,
      dept,
      branch_code: branchCodeFromDept(dept) || null,
      current_study_year: r.current_study_year != null ? Number(r.current_study_year) : null,
    }
  })

  return Response.json({
    records,
    can_verify: true,
    note: "Students submit proof; mark Paid or Not paid. Status shows live on student Fees.",
  })
}

/**
 * POST — student submits admission fee proof → status pending.
 * Body: { amount, receipt_no, paid_date?, note?, study_year? }
 */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (user.role !== "student") return badRequest("Only students submit admission fee proof")
  if (!user.reg_no) return badRequest("No reg number")
  await ensureAdmissionFeesSchema()

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const ctx = await loadStudentContext(user.reg_no)
  if (!ctx) return badRequest("Student not found")

  const studyYear = body.study_year
    ? normalizeStudyYear(body.study_year)
    : normalizeStudyYear(ctx.current_study_year)
  const amount = stripEmoji(String(body.amount || "").trim())
  const receiptNo = stripEmoji(String(body.receipt_no || "").trim())
  const paidDate = stripEmoji(String(body.paid_date || "").trim())
  const note = stripEmoji(String(body.note || "").trim())

  if (!amount || !receiptNo) {
    return badRequest("Amount and receipt number are required")
  }

  const stamp = stampFromSession(user, "submitted")

  const { rows } = await query(
    `INSERT INTO admission_fee_records (
       reg_no, study_year, academic_year, status,
       amount, receipt_no, paid_date, student_note,
       submitted_at, submitted_by_name, updated_at
     ) VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,now(),$8,now())
     ON CONFLICT (reg_no, study_year) DO UPDATE SET
       status = 'pending',
       amount = EXCLUDED.amount,
       receipt_no = EXCLUDED.receipt_no,
       paid_date = EXCLUDED.paid_date,
       student_note = EXCLUDED.student_note,
       submitted_at = now(),
       submitted_by_name = EXCLUDED.submitted_by_name,
       verified_at = NULL,
       verified_by = NULL,
       verified_by_name = NULL,
       verified_by_role = NULL,
       updated_at = now()
     RETURNING *`,
    [
      user.reg_no,
      studyYear,
      ctx.admission_academic_year || null,
      amount,
      receiptNo,
      paidDate || null,
      note || null,
      stamp.by_name,
    ],
  )

  return Response.json({
    ok: true,
    message: "Submitted for verification. Your verifier will confirm Paid or Not paid.",
    record: mapRow(rows[0] as Record<string, unknown>),
    stamp,
  })
}

/**
 * PATCH — verifier marks paid | not_paid (or re-open pending).
 * Body: { id } or { reg_no, study_year } + { status, staff_note? }
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canVerifyAdmissionFees(user.role)) return unauthorized()
  await ensureAdmissionFeesSchema()

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const statusRaw = String(body.status || "").trim().toLowerCase()
  if (!["paid", "not_paid", "pending"].includes(statusRaw)) {
    return badRequest("status must be paid, not_paid, or pending")
  }
  const status = statusRaw as AdmissionFeeStatus
  const staffNote = stripEmoji(String(body.staff_note || "").trim())
  const stamp = stampFromSession(user, status === "paid" ? "paid" : status === "not_paid" ? "not_paid" : "updated")

  let id = body.id != null ? Number(body.id) : null
  const regNo = String(body.reg_no || "").trim()
  const studyYear = body.study_year != null ? normalizeStudyYear(body.study_year) : null

  if (!id && regNo && studyYear) {
    // Upsert then set status (staff can mark without student submit)
    const { rows: up } = await query(
      `INSERT INTO admission_fee_records (reg_no, study_year, status, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (reg_no, study_year) DO UPDATE SET
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id`,
      [regNo, studyYear, status],
    )
    id = Number(up[0]?.id)
  }

  if (!id || !Number.isFinite(id)) return badRequest("id or reg_no+study_year required")

  // HOD / access check
  {
    const { rows: check } = await query(
      `SELECT reg_no FROM admission_fee_records WHERE id = $1`,
      [id],
    )
    if (!check[0]) return badRequest("Record not found")
    if (!(await canAccessAdmissionStudent(user, String(check[0].reg_no)))) return unauthorized()
  }

  const { rows } = await query(
    `UPDATE admission_fee_records SET
       status = $1,
       staff_note = COALESCE(NULLIF($2,''), staff_note),
       verified_at = now(),
       verified_by = $3,
       verified_by_name = $4,
       verified_by_role = $5,
       updated_at = now()
     WHERE id = $6
     RETURNING *`,
    [status, staffNote, stamp.by_id, stamp.by_name, stamp.by_role, id],
  )
  if (!rows[0]) return badRequest("Record not found")

  return Response.json({
    ok: true,
    record: mapRow(rows[0] as Record<string, unknown>),
    stamp,
  })
}
