import { query } from "@/lib/db"
import { requireRole, unauthorized, badRequest } from "@/lib/auth"
import { GALLERY_WRITERS } from "@/lib/roles"

// Gallery is publicly viewable (it appears on the landing page).
export async function GET() {
  const { rows } = await query("SELECT * FROM gallery_items ORDER BY created_at DESC")
  return Response.json({ items: rows })
}

export async function POST(req: Request) {
  const user = await requireRole(...GALLERY_WRITERS)
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.src) return badRequest("src is required")
  const { rows } = await query(
    "INSERT INTO gallery_items (src, caption, category) VALUES ($1,$2,$3) RETURNING *",
    [b.src, b.caption ?? "", b.category ?? "General"],
  )
  return Response.json({ ok: true, item: rows[0] })
}

export async function DELETE(req: Request) {
  const user = await requireRole(...GALLERY_WRITERS)
  if (!user) return unauthorized()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return badRequest("id is required")
  await query("DELETE FROM gallery_items WHERE id = $1", [id])
  return Response.json({ ok: true })
}
