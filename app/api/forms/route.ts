import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import {
  ensureFormsSchema,
  FORM_BUILDERS,
  normalizeAudience,
  normalizeVerifyRole,
  normalizeFormStatus,
  canAudienceFill,
  canVerifyForm,
  parseFormFields,
} from "@/lib/forms"

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureFormsSchema()

  const url = new URL(req.url)
  const mine = url.searchParams.get("mine") === "1"
  const pendingVerify = url.searchParams.get("pending_verify") === "1"
  const role = String(user.role || "").toLowerCase()

  // Verifier inbox: forms this role can verify + pending response counts
  if (pendingVerify) {
    const { rows: forms } = await query(
      `SELECT f.*,
              COALESCE((
                SELECT count(*)::int FROM form_responses r
                 WHERE r.form_id = f.id AND r.status = 'pending'
              ), 0) AS pending_count
         FROM forms f
        WHERE f.status = 'open' OR f.status = 'closed'
        ORDER BY f.created_at DESC`,
    )
    const visible = forms.filter((f) =>
      canVerifyForm(String((f as { verify_role?: string }).verify_role), role),
    )
    // Load pending responses for those forms
    const formIds = visible.map((f) => Number((f as { id: number }).id)).filter(Boolean)
    let responses: unknown[] = []
    if (formIds.length) {
      const { rows } = await query(
        `SELECT r.*,
                f.title AS form_title,
                f.verify_role,
                u.display_name AS submitter_name,
                u.email AS submitter_email,
                u.reg_no AS submitter_reg,
                u.role AS submitter_role
           FROM form_responses r
           JOIN forms f ON f.id = r.form_id
           LEFT JOIN users u ON u.id = r.submitted_by
          WHERE r.status = 'pending' AND r.form_id = ANY($1::bigint[])
          ORDER BY r.submitted_at ASC`,
        [formIds],
      )
      responses = rows.filter((r) =>
        canVerifyForm(String((r as { verify_role?: string }).verify_role), role),
      )
    }
    return Response.json({
      forms: visible,
      responses,
      pending_count: responses.length,
    })
  }

  const { rows } = await query(
    `SELECT f.*,
            COALESCE((SELECT count(*)::int FROM form_responses r WHERE r.form_id = f.id), 0) AS response_count,
            COALESCE((SELECT count(*)::int FROM form_responses r WHERE r.form_id = f.id AND r.status = 'pending'), 0) AS pending_count,
            (
              SELECT row_to_json(x) FROM (
                SELECT r.id, r.status, r.submitted_at, r.verified_at, r.verifier_note, r.verified_by_name
                  FROM form_responses r
                 WHERE r.form_id = f.id AND r.submitted_by = $1
                 ORDER BY r.submitted_at DESC
                 LIMIT 1
              ) x
            ) AS my_response,
            EXISTS(
              SELECT 1 FROM form_responses r
               WHERE r.form_id = f.id AND r.submitted_by = $1
                 AND r.status IN ('pending', 'verified')
            ) AS submitted_by_me
       FROM forms f
      ORDER BY f.created_at DESC`,
    [user.id],
  )

  // Builders see all; others only audience-matched + non-draft (or own)
  const isBuilder = (FORM_BUILDERS as readonly string[]).includes(role)
  let forms = rows as Array<Record<string, unknown>>
  if (!isBuilder) {
    forms = forms.filter((f) => {
      const st = String(f.status || "").toLowerCase()
      if (st === "draft") return false
      return canAudienceFill(String(f.audience || "students"), role)
    })
  }

  if (mine) {
    forms = forms.filter((f) => f.my_response)
  }

  return Response.json({ forms })
}

export async function POST(req: Request) {
  const user = await requireRole(...FORM_BUILDERS)
  if (!user) return unauthorized()
  await ensureFormsSchema()

  const b = await req.json().catch(() => null)
  if (!b?.title) return badRequest("title is required")

  const title = String(b.title).trim()
  const description = String(b.description ?? b.desc ?? "").trim()
  const fields = parseFormFields(b.fields)
  const status = normalizeFormStatus(b.status)
  const audience = normalizeAudience(b.audience)
  const verify_role = normalizeVerifyRole(b.verify_role)
  const priority = ["normal", "important", "emergency"].includes(String(b.priority || "").toLowerCase())
    ? String(b.priority).toLowerCase()
    : "normal"

  if (b.id) {
    const { rows } = await query(
      `UPDATE forms
          SET title = $2,
              description = $3,
              fields = $4::jsonb,
              status = $5,
              audience = $6,
              verify_role = $7,
              priority = $8,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        Number(b.id),
        title,
        description,
        JSON.stringify(fields),
        status,
        audience,
        verify_role,
        priority,
      ],
    )
    if (!rows[0]) return badRequest("Form not found")
    return Response.json({ ok: true, form: rows[0] })
  }

  const { rows } = await query(
    `INSERT INTO forms
       (title, description, fields, status, audience, verify_role, priority, created_by)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      title,
      description,
      JSON.stringify(fields),
      status,
      audience,
      verify_role,
      priority,
      user.id,
    ],
  )
  return Response.json({ ok: true, form: rows[0] })
}

export async function DELETE(req: Request) {
  const user = await requireRole(...FORM_BUILDERS)
  if (!user) return unauthorized()
  await ensureFormsSchema()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return badRequest("id is required")
  await query(`DELETE FROM forms WHERE id = $1`, [Number(id)])
  return Response.json({ ok: true })
}
