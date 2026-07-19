import { query } from "@/lib/db"
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/roles"

// Roles allowed to process certificate requests
const CERT_PROCESSORS = ["admin", "exam", "acm", "registrar", "principal"]

const CERT_TYPES = [
  "Transfer Certificate",
  "Study Certificate",
  "Studying Certificate",
  "NOC",
  "PDC",
  "Provisional Degree Certificate",
]

const STATUSES = ["pending", "processing", "ready", "rejected", "collected"] as const

function isAcmType(certType: string): boolean {
  const t = certType.toLowerCase()
  // PDC / Provisional Degree → Exam Cell; rest → ACM
  if (t.includes("pdc") || t.includes("provisional")) return false
  return true
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  if (user.role === "student") {
    const { rows } = await query(
      "SELECT * FROM cert_requests WHERE user_id = $1 ORDER BY created_at DESC",
      [user.id],
    )
    return Response.json(
      { requests: rows },
      { headers: { "Cache-Control": "no-store" } },
    )
  }
  if (!STAFF_ROLES.includes(user.role)) return unauthorized()

  const { searchParams } = new URL(req.url)
  const routed = (searchParams.get("routed_to") || "").trim()
  const status = (searchParams.get("status") || "").trim()
  const certType = (searchParams.get("cert_type") || "").trim()
  const q = (searchParams.get("q") || "").trim()

  const where: string[] = []
  const params: unknown[] = []

  // ACM staff default to ACM Section queue (can pass routed_to=all)
  if (user.role === "acm" && !routed) {
    where.push(`routed_to = 'ACM Section'`)
  } else if (routed && routed !== "all") {
    params.push(routed)
    where.push(`routed_to = $${params.length}`)
  }

  if (status) {
    params.push(status)
    where.push(`status = $${params.length}`)
  }
  if (certType) {
    params.push(`%${certType}%`)
    where.push(`cert_type ILIKE $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    where.push(
      `(student_name ILIKE $${params.length} OR reg_no ILIKE $${params.length} OR req_code ILIKE $${params.length})`,
    )
  }

  const sql = `
    SELECT * FROM cert_requests
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'processing' THEN 1
        WHEN 'ready' THEN 2
        WHEN 'collected' THEN 3
        ELSE 4
      END,
      created_at DESC`

  const { rows } = await query(sql, params)

  // Stats for ACM dashboard (always ACM Section scope for acm role)
  const statsScope =
    user.role === "acm" || routed === "ACM Section"
      ? `WHERE routed_to = 'ACM Section'`
      : routed && routed !== "all"
        ? `WHERE routed_to = $1`
        : ""
  const statsParams =
    statsScope.includes("$1") && routed && routed !== "all" && routed !== "ACM Section"
      ? [routed]
      : []
  const { rows: statsRows } = await query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
        COUNT(*) FILTER (WHERE status = 'ready')::int AS ready,
        COUNT(*) FILTER (WHERE status = 'collected')::int AS collected,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
       FROM cert_requests
       ${user.role === "acm" || !routed || routed === "ACM Section" ? "WHERE routed_to = 'ACM Section'" : statsScope}`,
    user.role === "acm" || !routed || routed === "ACM Section" ? [] : statsParams,
  )

  return Response.json(
    { requests: rows, stats: statsRows[0] || {} },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b?.certType) return badRequest("certType is required")
  const certType = String(b.certType).trim()
  if (
    !CERT_TYPES.some((t) => certType.includes(t) || t.includes(certType)) &&
    certType.length > 60
  ) {
    return badRequest("Unrecognized certificate type")
  }

  // Student self-request
  if (user.role === "student") {
    // Force routing by certificate type (ignore client spoofing)
    const routedTo =
      b.routedTo === "Exam Cell" || !isAcmType(certType) ? "Exam Cell" : "ACM Section"
    const reqCode = `CERT/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 9000) + 1000)}`

    const regNo = String(b.regNo || b.reg_no || user.reg_no || "").trim()
    // Students may only submit for their own register number
    if (user.reg_no && regNo && user.reg_no.toUpperCase() !== regNo.toUpperCase()) {
      return badRequest("Register number must match your account")
    }
    const effectiveReg = (user.reg_no || regNo || "").trim()

    const stu = await query(
      `SELECT name, dept AS branch, year, extra FROM students WHERE upper(reg_no) = upper($1) LIMIT 1`,
      [effectiveReg],
    )
    const studentName =
      String(b.studentName || b.student_name || "").trim() ||
      (stu.rows[0]?.name && String(stu.rows[0].name)) ||
      user.display_name ||
      ""
    const branch =
      String(b.branch || "").trim() ||
      (stu.rows[0]?.branch && String(stu.rows[0].branch)) ||
      ""

    // Pack form details into remarks so ACM/Exam can see purpose/reason
    const detailParts: string[] = []
    const details = b.details && typeof b.details === "object" ? (b.details as Record<string, unknown>) : {}
    for (const [k, v] of Object.entries(details)) {
      if (v == null || String(v).trim() === "") continue
      detailParts.push(`${k}: ${String(v).trim()}`)
    }
    // Fallback flat fields only when not already present in details
    if (b.reason && !details.Reason) detailParts.push(`Reason: ${String(b.reason).trim()}`)
    if (b.purpose && !details.Purpose) detailParts.push(`Purpose: ${String(b.purpose).trim()}`)
    if (b.remarks && String(b.remarks).trim() && !details["Student remarks"]) {
      detailParts.push(`Student note: ${String(b.remarks).trim()}`)
    }

    const baseRemark = "Request received by " + routedTo + ". Processing in progress."
    const remarks =
      detailParts.length > 0 ? baseRemark + " | " + detailParts.join(" · ") : baseRemark

    const { rows } = await query(
      `INSERT INTO cert_requests (req_code, user_id, student_name, reg_no, branch, cert_type, routed_to, status, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8) RETURNING *`,
      [
        reqCode,
        user.id,
        studentName,
        effectiveReg.toUpperCase(),
        branch,
        certType,
        routedTo,
        remarks,
      ],
    )
    return Response.json({ ok: true, request: rows[0] }, { headers: { "Cache-Control": "no-store" } })
  }

  // ACM / admin walk-in issue (staff creates and optionally marks ready)
  if (!CERT_PROCESSORS.includes(user.role)) {
    return unauthorized("Only ACM / exam staff can issue certificates")
  }
  const regNo = String(b.regNo || b.reg_no || "").trim()
  if (!regNo) return badRequest("regNo is required for staff-issued certificates")

  const { rows: urows } = await query(
    `SELECT id, display_name, reg_no FROM users
      WHERE role = 'student' AND upper(reg_no) = upper($1)
        AND deleted_at IS NULL AND status = 'approved'
      LIMIT 1`,
    [regNo],
  )
  const { rows: srows } = await query(
    `SELECT name, dept, year FROM students WHERE upper(reg_no) = upper($1) LIMIT 1`,
    [regNo],
  )
  const studentName =
    (srows[0]?.name && String(srows[0].name)) ||
    (urows[0]?.display_name && String(urows[0].display_name)) ||
    String(b.studentName || regNo)
  const branch = (srows[0]?.dept && String(srows[0].dept)) || String(b.branch || "")
  const routedTo =
    b.routedTo === "Exam Cell" || !isAcmType(certType) ? "Exam Cell" : "ACM Section"
  const status = b.status === "ready" || b.markReady ? "ready" : "pending"
  const reqCode = `CERT/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 9000) + 1000)}`
  const remarks =
    b.remarks != null
      ? String(b.remarks)
      : status === "ready"
        ? "Issued at ACM counter. Ready for collection."
        : "Walk-in request registered at ACM."

  // user_id required by schema — use student user if found, else staff self as placeholder
  const userId = urows[0]?.id ?? user.id

  const { rows } = await query(
    `INSERT INTO cert_requests (req_code, user_id, student_name, reg_no, branch, cert_type, routed_to, status, remarks)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [reqCode, userId, studentName, regNo.toUpperCase(), branch, certType, routedTo, status, remarks],
  )
  return Response.json({ ok: true, request: rows[0] })
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user || !CERT_PROCESSORS.includes(user.role)) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.id || !b?.status) return badRequest("id and status are required")
  if (!STATUSES.includes(b.status)) return badRequest("Invalid status")

  let remarks = b.remarks != null ? String(b.remarks) : null
  if (!remarks) {
    if (b.status === "ready") remarks = "Certificate ready for collection at ACM Section."
    else if (b.status === "rejected") remarks = "Request rejected by ACM. Contact the office."
    else if (b.status === "collected") remarks = "Certificate collected by student."
    else if (b.status === "processing") remarks = "Under process at ACM Section."
  }

  const { rows } = await query(
    "UPDATE cert_requests SET status = $2, remarks = COALESCE($3, remarks) WHERE id = $1 RETURNING *",
    [b.id, b.status, remarks],
  )
  if (rows.length === 0) return badRequest("Request not found")
  return Response.json({ ok: true, request: rows[0] })
}
