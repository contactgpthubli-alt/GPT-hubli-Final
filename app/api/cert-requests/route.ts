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

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (user.role === "student") {
    const { rows } = await query(
      "SELECT * FROM cert_requests WHERE user_id = $1 ORDER BY created_at DESC",
      [user.id],
    )
    return Response.json({ requests: rows })
  }
  if (!STAFF_ROLES.includes(user.role)) return unauthorized()
  const { rows } = await query("SELECT * FROM cert_requests ORDER BY created_at DESC")
  return Response.json({ requests: rows })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user || user.role !== "student") return unauthorized("Only students can request certificates")
  const b = await req.json().catch(() => null)
  if (!b?.certType) return badRequest("certType is required")
  if (!CERT_TYPES.some((t) => b.certType.includes(t) || t.includes(b.certType)) && b.certType.length > 60) {
    return badRequest("Unrecognized certificate type")
  }
  const routedTo = b.routedTo === "Exam Cell" ? "Exam Cell" : "ACM Section"
  const reqCode = `CERT/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 9000) + 1000)}`

  // Pull branch from the student record when available
  const stu = await query("SELECT dept AS branch FROM students WHERE upper(reg_no) = upper($1)", [user.reg_no ?? ""])
  const { rows } = await query(
    `INSERT INTO cert_requests (req_code, user_id, student_name, reg_no, branch, cert_type, routed_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      reqCode,
      user.id,
      user.display_name ?? "",
      user.reg_no ?? "",
      stu.rows[0]?.branch ?? "",
      b.certType,
      routedTo,
    ],
  )
  return Response.json({ ok: true, request: rows[0] })
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user || !CERT_PROCESSORS.includes(user.role)) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.id || !b?.status) return badRequest("id and status are required")
  if (!["pending", "ready", "rejected", "collected"].includes(b.status)) return badRequest("Invalid status")
  const { rows } = await query(
    "UPDATE cert_requests SET status = $2, remarks = COALESCE($3, remarks) WHERE id = $1 RETURNING *",
    [b.id, b.status, b.remarks ?? null],
  )
  if (rows.length === 0) return badRequest("Request not found")
  return Response.json({ ok: true, request: rows[0] })
}
