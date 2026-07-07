import { query } from "@/lib/db"
import { requireRole, unauthorized, badRequest } from "@/lib/auth"
import { NOTICE_WRITERS } from "@/lib/roles"

// Notices appear on the public landing page.
export async function GET() {
  const { rows } = await query("SELECT * FROM notices ORDER BY created_at DESC")
  return Response.json({ notices: rows })
}

export async function POST(req: Request) {
  const user = await requireRole(...NOTICE_WRITERS)
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.title) return badRequest("title is required")
  const { rows } = await query(
    "INSERT INTO notices (title, body, priority) VALUES ($1,$2,$3) RETURNING *",
    [b.title, b.body ?? "", b.priority ?? "normal"],
  )
  return Response.json({ ok: true, notice: rows[0] })
}

export async function DELETE(req: Request) {
  const user = await requireRole(...NOTICE_WRITERS)
  if (!user) return unauthorized()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return badRequest("id is required")
  await query("DELETE FROM notices WHERE id = $1", [id])
  return Response.json({ ok: true })
}
