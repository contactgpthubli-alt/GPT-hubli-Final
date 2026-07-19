import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { FORM_WRITERS } from "@/lib/roles"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { rows } = await query(
    `SELECT f.*,
            COALESCE((SELECT count(*)::int FROM form_responses r WHERE r.form_id = f.id), 0) AS response_count,
            EXISTS(
              SELECT 1 FROM form_responses r
               WHERE r.form_id = f.id AND r.submitted_by = $1
            ) AS submitted_by_me
       FROM forms f
      ORDER BY f.created_at DESC`,
    [user.id],
  )
  return Response.json({ forms: rows })
}

export async function POST(req: Request) {
  const user = await requireRole(...FORM_WRITERS)
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.title) return badRequest("title is required")
  if (b.id) {
    const { rows } = await query(
      "UPDATE forms SET title=$2, description=$3, fields=$4::jsonb, status=$5 WHERE id=$1 RETURNING *",
      [b.id, b.title, b.description ?? "", JSON.stringify(b.fields ?? []), b.status ?? "open"],
    )
    return Response.json({ ok: true, form: rows[0] })
  }
  const { rows } = await query(
    "INSERT INTO forms (title, description, fields, created_by) VALUES ($1,$2,$3::jsonb,$4) RETURNING *",
    [b.title, b.description ?? "", JSON.stringify(b.fields ?? []), user.id],
  )
  return Response.json({ ok: true, form: rows[0] })
}

export async function DELETE(req: Request) {
  const user = await requireRole(...FORM_WRITERS)
  if (!user) return unauthorized()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return badRequest("id is required")
  await query("DELETE FROM forms WHERE id = $1", [id])
  return Response.json({ ok: true })
}
