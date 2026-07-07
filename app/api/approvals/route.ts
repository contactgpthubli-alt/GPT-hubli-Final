import { query } from "@/lib/db"
import { requireRole, unauthorized, badRequest } from "@/lib/auth"

export async function GET() {
  const user = await requireRole("admin")
  if (!user) return unauthorized()
  const { rows } = await query(
    `SELECT id, email, role, display_name, reg_no, status, created_at
       FROM users WHERE status = 'pending' ORDER BY created_at`,
  )
  return Response.json({ pending: rows })
}

export async function POST(req: Request) {
  const user = await requireRole("admin")
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.id || !["approved", "rejected"].includes(b.action)) {
    return badRequest("id and action (approved|rejected) are required")
  }
  const { rows } = await query(
    "UPDATE users SET status = $2 WHERE id = $1 AND status = 'pending' RETURNING id, email, status",
    [b.id, b.action],
  )
  if (rows.length === 0) return badRequest("Pending user not found")
  return Response.json({ ok: true, user: rows[0] })
}
