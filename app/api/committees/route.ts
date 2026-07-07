import { query } from "@/lib/db"
import { requireRole, unauthorized, badRequest } from "@/lib/auth"
import { COMMITTEE_WRITERS } from "@/lib/roles"

// Committees appear on the public landing page.
export async function GET() {
  const { rows } = await query(
    `SELECT c.id, c.name, c.icon, c.color,
            COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'role', m.role, 'dept', m.dept,
              'designation', m.designation, 'mobile', m.mobile)
              ORDER BY m.id) FILTER (WHERE m.id IS NOT NULL), '[]') AS members
       FROM committees c
       LEFT JOIN committee_members m ON m.committee_id = c.id
       GROUP BY c.id ORDER BY c.id`,
  )
  return Response.json({ committees: rows })
}

// Add a member: { committee: name, name, role, dept }
export async function POST(req: Request) {
  const user = await requireRole(...COMMITTEE_WRITERS)
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.committee || !b?.name) return badRequest("committee and name are required")
  const cm = await query("SELECT id FROM committees WHERE name = $1", [b.committee])
  if (cm.rows.length === 0) return badRequest("Committee not found")
  const { rows } = await query(
    "INSERT INTO committee_members (committee_id, name, role, dept, designation, mobile) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [cm.rows[0].id, b.name, b.role ?? "Member", b.dept ?? "", b.designation ?? "", b.mobile ?? ""],
  )
  return Response.json({ ok: true, member: rows[0] })
}

export async function DELETE(req: Request) {
  const user = await requireRole(...COMMITTEE_WRITERS)
  if (!user) return unauthorized()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return badRequest("id is required")
  await query("DELETE FROM committee_members WHERE id = $1", [id])
  return Response.json({ ok: true })
}
