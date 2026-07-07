import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES, STAFF_WRITERS } from "@/lib/roles"

export async function GET() {
  const user = await getCurrentUser()
  if (!user || !STAFF_ROLES.includes(user.role)) return unauthorized()
  const { rows } = await query("SELECT * FROM staff ORDER BY staff_type, name")
  return Response.json({ staff: rows })
}

export async function POST(req: Request) {
  const user = await requireRole(...STAFF_WRITERS)
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.staff_type || !b?.name) return badRequest("staff_type and name are required")
  if (b.id) {
    const { rows } = await query(
      "UPDATE staff SET staff_type=$2, name=$3, extra=$4::jsonb WHERE id=$1 RETURNING *",
      [b.id, b.staff_type, b.name, JSON.stringify(b.extra ?? {})],
    )
    return Response.json({ ok: true, staff: rows[0] })
  }
  const { rows } = await query(
    "INSERT INTO staff (staff_type, name, extra) VALUES ($1,$2,$3::jsonb) RETURNING *",
    [b.staff_type, b.name, JSON.stringify(b.extra ?? {})],
  )
  return Response.json({ ok: true, staff: rows[0] })
}

export async function DELETE(req: Request) {
  const user = await requireRole(...STAFF_WRITERS)
  if (!user) return unauthorized()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return badRequest("id is required")
  await query("DELETE FROM staff WHERE id = $1", [id])
  return Response.json({ ok: true })
}
