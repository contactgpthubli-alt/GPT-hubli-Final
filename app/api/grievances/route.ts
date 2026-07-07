import { query } from "@/lib/db"
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { GRIEVANCE_RESOLVERS } from "@/lib/roles"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (user.role === "student") {
    const { rows } = await query(
      "SELECT * FROM grievances WHERE student_reg = $1 ORDER BY created_at DESC",
      [user.reg_no],
    )
    return Response.json({ grievances: rows })
  }
  const { rows } = await query("SELECT * FROM grievances ORDER BY created_at DESC")
  return Response.json({ grievances: rows })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user || user.role !== "student") return unauthorized("Only students can submit grievances")
  const b = await req.json().catch(() => null)
  if (!b?.subject || !b?.category) return badRequest("subject and category are required")
  const { rows } = await query(
    `INSERT INTO grievances (student_reg, subject, category, description, expectation)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [user.reg_no, b.subject, b.category, b.description ?? "", b.expectation ?? ""],
  )
  return Response.json({ ok: true, grievance: rows[0] })
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user || !GRIEVANCE_RESOLVERS.includes(user.role)) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.id || !b?.status) return badRequest("id and status are required")
  const { rows } = await query(
    `UPDATE grievances
        SET status = $2,
            resolution = COALESCE($3, resolution),
            resolved_at = CASE WHEN $2 = 'Resolved' THEN now() ELSE resolved_at END
      WHERE id = $1 RETURNING *`,
    [b.id, b.status, b.resolution ?? null],
  )
  if (rows.length === 0) return badRequest("Grievance not found")
  return Response.json({ ok: true, grievance: rows[0] })
}
