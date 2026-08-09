/**
 * Regular exam declare — Exam / Admin / Principal.
 */
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureRegularExamSchema,
  listRegularCycles,
  getOpenRegularCycle,
  mapRegularCycle,
  canManageRegularExam,
  cleanLabel,
  declareStamp,
  type RegularCycleStatus,
} from "@/lib/regular-exam"
import { stripEmoji } from "@/lib/no-emoji"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureRegularExamSchema()
  const cycles = await listRegularCycles()
  const open = await getOpenRegularCycle()
  return Response.json({
    cycles,
    open,
    can_manage: canManageRegularExam(user.role),
    note: "Declare regular exam month/session (e.g. Apr/May 2026). Separate from Makeup declare.",
  })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canManageRegularExam(user.role)) return unauthorized()
  await ensureRegularExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const month = cleanLabel(b.month_label || b.month, 80)
  if (!month) return badRequest("month_label required (e.g. April / May 2026)")
  const session = cleanLabel(b.session_name, 80) || `Regular ${month}`.slice(0, 80)
  const label = cleanLabel(b.label, 100) || `Regular · ${month}`
  const examCycle = cleanLabel(b.exam_cycle, 40) || "current"
  const note = b.note != null ? stripEmoji(String(b.note)).slice(0, 500) : null
  let status: RegularCycleStatus = "draft"
  if (b.status === "open" || b.status === "draft" || b.status === "closed") status = b.status

  if (status === "open") {
    await query(
      `UPDATE regular_exam_cycles SET status = 'closed', closed_at = now(), updated_at = now()
        WHERE status = 'open'`,
    )
  }
  const stamp = declareStamp(user, "created")
  const { rows } = await query(
    `INSERT INTO regular_exam_cycles (
       label, month_label, session_name, exam_cycle, status, note,
       declared_by, declared_by_name, declared_by_role, declared_at,
       opened_at, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),
       CASE WHEN $5 = 'open' THEN now() ELSE NULL END, now(), now())
     RETURNING *`,
    [
      label,
      month,
      session,
      examCycle,
      status,
      note,
      stamp.by_id,
      stamp.by_name,
      stamp.by_role,
    ],
  )
  return Response.json({ ok: true, cycle: mapRegularCycle(rows[0] as Record<string, unknown>), stamp })
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canManageRegularExam(user.role)) return unauthorized()
  await ensureRegularExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const id = Number(b.id)
  if (!id) return badRequest("id required")
  const { rows: ex } = await query(`SELECT * FROM regular_exam_cycles WHERE id = $1`, [id])
  if (!ex[0]) return badRequest("Not found")
  const existing = mapRegularCycle(ex[0] as Record<string, unknown>)

  const statusRaw = b.status != null ? String(b.status).toLowerCase() : null
  if (statusRaw && !["draft", "open", "closed"].includes(statusRaw)) {
    return badRequest("status must be draft | open | closed")
  }
  if (statusRaw === "open") {
    await query(
      `UPDATE regular_exam_cycles SET status = 'closed', closed_at = COALESCE(closed_at, now()), updated_at = now()
        WHERE status = 'open' AND id <> $1`,
      [id],
    )
  }
  const month = b.month_label != null ? cleanLabel(b.month_label, 80) : existing.month_label
  const session =
    b.session_name != null ? cleanLabel(b.session_name, 80) : existing.session_name
  const label = b.label != null ? cleanLabel(b.label, 100) : existing.label
  const examCycle =
    b.exam_cycle != null ? cleanLabel(b.exam_cycle, 40) || "current" : existing.exam_cycle
  const note =
    b.note !== undefined
      ? b.note == null
        ? null
        : stripEmoji(String(b.note)).slice(0, 500)
      : existing.note
  const status = (statusRaw as RegularCycleStatus) || existing.status
  const stamp = declareStamp(user, status === "closed" ? "cancelled" : "updated")

  const { rows } = await query(
    `UPDATE regular_exam_cycles SET
       label = $2, month_label = $3, session_name = $4, exam_cycle = $5, status = $6, note = $7,
       declared_by = $8, declared_by_name = $9, declared_by_role = $10, declared_at = now(),
       opened_at = CASE WHEN $6 = 'open' THEN COALESCE(opened_at, now()) ELSE opened_at END,
       closed_at = CASE WHEN $6 = 'closed' THEN now() WHEN $6 = 'open' THEN NULL ELSE closed_at END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      label,
      month,
      session,
      examCycle,
      status,
      note,
      stamp.by_id,
      stamp.by_name,
      stamp.by_role,
    ],
  )
  return Response.json({ ok: true, cycle: mapRegularCycle(rows[0] as Record<string, unknown>), stamp })
}
