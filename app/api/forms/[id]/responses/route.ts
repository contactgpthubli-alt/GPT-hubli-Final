import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { FORM_WRITERS } from "@/lib/roles"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(...FORM_WRITERS)
  if (!user) return unauthorized()
  const { id } = await params
  const { rows } = await query(
    "SELECT * FROM form_responses WHERE form_id = $1 ORDER BY submitted_at DESC",
    [id],
  )
  return Response.json({ responses: rows })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params
  const b = await req.json().catch(() => null)
  if (!b?.answers) return badRequest("answers are required")
  const form = await query("SELECT status FROM forms WHERE id = $1", [id])
  if (form.rows.length === 0) return badRequest("Form not found")
  if (form.rows[0].status !== "open") return badRequest("This form is closed")
  const { rows } = await query(
    "INSERT INTO form_responses (form_id, answers, submitted_by) VALUES ($1,$2::jsonb,$3) RETURNING *",
    [id, JSON.stringify(b.answers), user.id],
  )
  return Response.json({ ok: true, response: rows[0] })
}
