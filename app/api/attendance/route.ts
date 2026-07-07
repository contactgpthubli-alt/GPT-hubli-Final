import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/roles"

export async function GET() {
  const user = await getCurrentUser()
  if (!user || !STAFF_ROLES.includes(user.role)) return unauthorized()
  const { rows } = await query("SELECT * FROM attendance ORDER BY att_date DESC LIMIT 100")
  return Response.json({ attendance: rows })
}

export async function POST(req: Request) {
  const user = await requireRole("admin", "hod", "faculty")
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.class_id || !Array.isArray(b.entries)) return badRequest("class_id and entries[] are required")
  const { rows } = await query(
    `INSERT INTO attendance (class_id, att_date, entries, marked_by)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3::jsonb, $4)
     ON CONFLICT (class_id, att_date) DO UPDATE SET entries = EXCLUDED.entries, marked_by = EXCLUDED.marked_by
     RETURNING *`,
    [b.class_id, b.date ?? null, JSON.stringify(b.entries), user.id],
  )
  return Response.json({ ok: true, attendance: rows[0] })
}
