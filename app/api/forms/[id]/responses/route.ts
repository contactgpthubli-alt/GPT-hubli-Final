import { query } from "@/lib/db"
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import {
  ensureFormsSchema,
  FORM_BUILDERS,
  canAudienceFill,
  canVerifyForm,
  normalizeVerifyRole,
  parseFormFields,
  fieldLabel,
  fieldMaxMb,
  approxBase64Bytes,
  type FormField,
} from "@/lib/forms"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Ctx) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureFormsSchema()
  const { id } = await params
  const formId = Number(id)
  if (!Number.isFinite(formId)) return badRequest("Invalid form id")

  const role = String(user.role || "").toLowerCase()
  const isBuilder = (FORM_BUILDERS as readonly string[]).includes(role)

  const formRes = await query(`SELECT * FROM forms WHERE id = $1`, [formId])
  const form = formRes.rows[0] as Record<string, unknown> | undefined
  if (!form) return badRequest("Form not found")

  const url = new URL(req.url)
  const mine = url.searchParams.get("mine") === "1"
  const responseId = url.searchParams.get("response_id")

  if (responseId) {
    const { rows } = await query(
      `SELECT r.*,
              f.title AS form_title,
              f.description AS form_description,
              f.fields AS form_fields,
              f.verify_role,
              u.display_name AS submitter_name,
              u.email AS submitter_email,
              u.reg_no AS submitter_reg
         FROM form_responses r
         JOIN forms f ON f.id = r.form_id
         LEFT JOIN users u ON u.id = r.submitted_by
        WHERE r.id = $1 AND r.form_id = $2`,
      [Number(responseId), formId],
    )
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return Response.json({ error: "Not found" }, { status: 404 })
    const own = Number(row.submitted_by) === user.id
    const canVerify = canVerifyForm(String(form.verify_role), role)
    if (!own && !canVerify && !isBuilder) return unauthorized()
    return Response.json({ response: row, form })
  }

  if (mine || (!isBuilder && !canVerifyForm(String(form.verify_role), role))) {
    const { rows } = await query(
      `SELECT * FROM form_responses
        WHERE form_id = $1 AND submitted_by = $2
        ORDER BY submitted_at DESC`,
      [formId, user.id],
    )
    return Response.json({ responses: rows, form })
  }

  // Builder or verifier: all responses
  if (!isBuilder && !canVerifyForm(String(form.verify_role), role)) {
    return unauthorized()
  }

  const { rows } = await query(
    `SELECT r.*,
            u.display_name AS submitter_name,
            u.email AS submitter_email,
            u.reg_no AS submitter_reg,
            u.role AS submitter_role
       FROM form_responses r
       LEFT JOIN users u ON u.id = r.submitted_by
      WHERE r.form_id = $1
      ORDER BY r.submitted_at DESC`,
    [formId],
  )
  return Response.json({ responses: rows, form })
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureFormsSchema()
  const { id } = await params
  const formId = Number(id)
  if (!Number.isFinite(formId)) return badRequest("Invalid form id")

  const b = await req.json().catch(() => null)
  if (!b?.answers || typeof b.answers !== "object") return badRequest("answers are required")

  const formRes = await query(`SELECT * FROM forms WHERE id = $1`, [formId])
  const form = formRes.rows[0] as Record<string, unknown> | undefined
  if (!form) return badRequest("Form not found")
  if (String(form.status) !== "open") return badRequest("This form is closed")

  if (!canAudienceFill(String(form.audience), user.role)) {
    return unauthorized("This form is not for your role")
  }

  // Block if already pending or verified
  const existing = await query(
    `SELECT id, status FROM form_responses
      WHERE form_id = $1 AND submitted_by = $2
        AND status IN ('pending', 'verified')
      ORDER BY submitted_at DESC LIMIT 1`,
    [formId, user.id],
  )
  if (existing.rows[0]) {
    const st = String((existing.rows[0] as { status: string }).status)
    if (st === "verified") return badRequest("You already submitted and it was verified")
    if (st === "pending") return badRequest("Your submission is already pending verification")
  }

  // Validate required fields + file size limits
  const fields = parseFormFields(form.fields)
  const answers = b.answers as Record<string, unknown>
  const fileErr = validateAnswers(fields, answers)
  if (fileErr) return badRequest(fileErr)

  const verifyRole = normalizeVerifyRole(form.verify_role)
  const autoOk = verifyRole === "none"
  const status = autoOk ? "verified" : "pending"
  const verifiedAt = autoOk ? new Date().toISOString() : null
  const verifiedName = autoOk ? "Auto-accepted" : null

  const { rows } = await query(
    `INSERT INTO form_responses
       (form_id, answers, submitted_by, status, verified_by_name, verified_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6)
     RETURNING *`,
    [formId, JSON.stringify(answers), user.id, status, verifiedName, verifiedAt],
  )
  return Response.json({ ok: true, response: rows[0] })
}

/**
 * PATCH actions:
 * - verify | approve | reject  (verifier)
 * - edit  (form owner / admin / principal) — update answers; student sees new data
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureFormsSchema()
  const { id } = await params
  const formId = Number(id)
  if (!Number.isFinite(formId)) return badRequest("Invalid form id")

  const b = await req.json().catch(() => null)
  if (!b?.response_id) return badRequest("response_id is required")
  const action = String(b.action || b.status || "").toLowerCase()

  const formRes = await query(`SELECT * FROM forms WHERE id = $1`, [formId])
  const form = formRes.rows[0] as Record<string, unknown> | undefined
  if (!form) return badRequest("Form not found")

  const role = String(user.role || "").toLowerCase()
  const isOwner =
    (FORM_BUILDERS as readonly string[]).includes(role) ||
    Number(form.created_by) === user.id

  // --- Owner edits answers ---
  if (action === "edit" || action === "update") {
    if (!isOwner) return unauthorized("Only form owner / admin can edit responses")
    if (!b.answers || typeof b.answers !== "object") return badRequest("answers are required")
    const fields = parseFormFields(form.fields)
    const answers = b.answers as Record<string, unknown>
    const err = validateAnswers(fields, answers, { skipRequired: true })
    if (err) return badRequest(err)
    const editNote = b.edit_note != null ? String(b.edit_note).trim() : b.note != null ? String(b.note).trim() : ""
    const { rows } = await query(
      `UPDATE form_responses
          SET answers = $3::jsonb,
              edited_by = $4,
              edited_by_name = $5,
              edited_at = now(),
              edit_note = $6
        WHERE id = $1 AND form_id = $2
        RETURNING *`,
      [
        Number(b.response_id),
        formId,
        JSON.stringify(answers),
        user.id,
        String(user.display_name || user.email || user.role),
        editNote || null,
      ],
    )
    if (!rows[0]) return badRequest("Response not found")
    return Response.json({ ok: true, response: rows[0] })
  }

  if (action !== "verify" && action !== "approve" && action !== "reject") {
    return badRequest("action must be verify, reject, or edit")
  }

  if (!canVerifyForm(String(form.verify_role), user.role)) {
    return unauthorized("You are not the verifier for this form")
  }

  const nextStatus = action === "reject" ? "rejected" : "verified"
  const note = b.note != null ? String(b.note).trim() : b.verifier_note != null ? String(b.verifier_note).trim() : ""

  const { rows } = await query(
    `UPDATE form_responses
        SET status = $3,
            verified_by = $4,
            verified_by_name = $5,
            verified_at = now(),
            verifier_note = $6
      WHERE id = $1 AND form_id = $2 AND status = 'pending'
      RETURNING *`,
    [
      Number(b.response_id),
      formId,
      nextStatus,
      user.id,
      String(user.display_name || user.email || user.role),
      note || null,
    ],
  )
  if (!rows[0]) return badRequest("Pending response not found")
  return Response.json({ ok: true, response: rows[0] })
}

function validateAnswers(
  fields: FormField[],
  answers: Record<string, unknown>,
  opts?: { skipRequired?: boolean },
): string | null {
  for (const f of fields) {
    const type = String(f.type || "").toLowerCase()
    if (type === "section") continue
    const key = fieldLabel(f)
    const val = answers[key] ?? (f.id ? answers[f.id] : undefined)

    if (!opts?.skipRequired && f.required) {
      if (val == null || (typeof val === "string" && !val.trim())) {
        return `Please answer: ${key}`
      }
      if (type === "file" && typeof val === "object" && val) {
        const o = val as { data?: string; name?: string }
        if (!o.data && !o.name) return `Please upload a file for: ${key}`
      }
    }

    if (type === "file" && val && typeof val === "object") {
      const o = val as { data?: string; name?: string; size?: number; mime?: string }
      const data = String(o.data || "")
      if (data) {
        const bytes = approxBase64Bytes(data)
        const maxMb = fieldMaxMb(f)
        const maxBytes = maxMb * 1024 * 1024
        if (bytes > maxBytes) {
          return `File for "${key}" exceeds max size (${maxMb} MB)`
        }
        // Hard server cap ~4MB decoded to stay under typical body limits
        if (bytes > 4 * 1024 * 1024) {
          return `File for "${key}" is too large (server max 4 MB)`
        }
      }
    }
  }
  return null
}
