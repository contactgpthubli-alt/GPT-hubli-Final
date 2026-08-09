/**
 * Makeup cycle declare / open / close.
 * GET — any auth: list cycles + open cycle
 * POST — Exam/Admin/Principal create cycle
 * PATCH — open / close / edit fees & month
 */
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureMakeupExamSchema,
  listMakeupCycles,
  getOpenMakeupCycle,
  getMakeupCycleById,
  mapMakeupCycle,
  canManageMakeup,
  cleanLabel,
  declareStamp,
  type MakeupCycleStatus,
} from "@/lib/makeup-exam"
import { stripEmoji } from "@/lib/no-emoji"

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureMakeupExamSchema()

  const url = new URL(req.url)
  const status = (url.searchParams.get("status") || "").trim() || null
  const id = url.searchParams.get("id")
  if (id) {
    const c = await getMakeupCycleById(Number(id))
    if (!c) return badRequest("Cycle not found")
    return Response.json({ cycle: c, can_manage: canManageMakeup(user.role) })
  }

  const cycles = await listMakeupCycles({ status, limit: 50 })
  const open = await getOpenMakeupCycle()
  return Response.json({
    cycles,
    open,
    can_manage: canManageMakeup(user.role),
    note: "Exam Section declares makeup month (e.g. July/August 2026). Students use Results → Makeup and Fees → Makeup while open.",
  })
}

/**
 * POST body: { month_label, session_name?, label?, fee_per_subject?, fee_base?, note?,
 *              even_sems_only?, semesters?, status? }
 */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canManageMakeup(user.role)) return unauthorized()
  await ensureMakeupExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")

  const month = cleanLabel(b.month_label || b.month || b.label, 80)
  if (!month) return badRequest("month_label required (e.g. July / August 2026)")

  const session =
    cleanLabel(b.session_name, 80) ||
    `Makeup ${month}`.slice(0, 80)
  const label = cleanLabel(b.label, 100) || `Makeup · ${month}`
  const feePer = Math.max(0, Math.floor(Number(b.fee_per_subject ?? 250) || 0))
  const feeBase = Math.max(0, Math.floor(Number(b.fee_base ?? 0) || 0))
  const note = b.note != null ? stripEmoji(String(b.note)).slice(0, 500) : null
  const evenOnly = b.even_sems_only !== false
  let semesters = [2, 4, 6]
  if (Array.isArray(b.semesters)) {
    semesters = b.semesters.map((n) => Number(n)).filter((n) => n >= 1 && n <= 6)
    if (!semesters.length) semesters = [2, 4, 6]
  }
  let status: MakeupCycleStatus = "draft"
  if (b.status === "open" || b.status === "draft" || b.status === "closed") {
    status = b.status
  }

  // Only one open at a time
  if (status === "open") {
    await query(
      `UPDATE makeup_cycles SET status = 'closed', closed_at = now(), updated_at = now()
        WHERE status = 'open'`,
    )
  }

  const stamp = declareStamp(user, status === "open" ? "created" : "created")
  const { rows } = await query(
    `INSERT INTO makeup_cycles (
       label, month_label, session_name, status, even_sems_only, semesters,
       fee_per_subject, fee_base, note,
       declared_by, declared_by_name, declared_by_role, declared_at,
       opened_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,
       $10,$11,$12,now(),
       CASE WHEN $4 = 'open' THEN now() ELSE NULL END,
       now(), now()
     ) RETURNING *`,
    [
      label,
      month,
      session,
      status,
      evenOnly,
      JSON.stringify(semesters),
      feePer,
      feeBase,
      note,
      stamp.by_id,
      stamp.by_name,
      stamp.by_role,
    ],
  )

  return Response.json({
    ok: true,
    cycle: mapMakeupCycle(rows[0] as Record<string, unknown>),
    stamp,
  })
}

/**
 * PATCH body: { id, status?, month_label?, session_name?, fee_per_subject?, fee_base?, note?, semesters? }
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canManageMakeup(user.role)) return unauthorized()
  await ensureMakeupExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const id = Number(b.id)
  if (!id) return badRequest("id required")

  const existing = await getMakeupCycleById(id)
  if (!existing) return badRequest("Cycle not found")

  const statusRaw = b.status != null ? String(b.status).toLowerCase() : null
  if (statusRaw && !["draft", "open", "closed"].includes(statusRaw)) {
    return badRequest("status must be draft | open | closed")
  }

  if (statusRaw === "open") {
    await query(
      `UPDATE makeup_cycles SET status = 'closed', closed_at = COALESCE(closed_at, now()), updated_at = now()
        WHERE status = 'open' AND id <> $1`,
      [id],
    )
  }

  const month =
    b.month_label != null ? cleanLabel(b.month_label, 80) : existing.month_label
  const session =
    b.session_name != null ? cleanLabel(b.session_name, 80) : existing.session_name
  const label =
    b.label != null ? cleanLabel(b.label, 100) : existing.label || `Makeup · ${month}`
  const feePer =
    b.fee_per_subject != null
      ? Math.max(0, Math.floor(Number(b.fee_per_subject) || 0))
      : existing.fee_per_subject
  const feeBase =
    b.fee_base != null
      ? Math.max(0, Math.floor(Number(b.fee_base) || 0))
      : existing.fee_base
  const note =
    b.note !== undefined
      ? b.note == null
        ? null
        : stripEmoji(String(b.note)).slice(0, 500)
      : existing.note
  let semesters = existing.semesters
  if (Array.isArray(b.semesters)) {
    semesters = b.semesters.map((n) => Number(n)).filter((n) => n >= 1 && n <= 6)
    if (!semesters.length) semesters = [2, 4, 6]
  }
  const status = (statusRaw as MakeupCycleStatus) || existing.status
  const stamp = declareStamp(
    user,
    status === "open" ? "updated" : status === "closed" ? "cancelled" : "updated",
  )

  const { rows } = await query(
    `UPDATE makeup_cycles SET
       label = $2,
       month_label = $3,
       session_name = $4,
       status = $5,
       semesters = $6::jsonb,
       fee_per_subject = $7,
       fee_base = $8,
       note = $9,
       declared_by = $10,
       declared_by_name = $11,
       declared_by_role = $12,
       declared_at = now(),
       opened_at = CASE
         WHEN $5 = 'open' AND status <> 'open' THEN now()
         WHEN $5 = 'open' THEN COALESCE(opened_at, now())
         ELSE opened_at END,
       closed_at = CASE
         WHEN $5 = 'closed' THEN now()
         WHEN $5 = 'open' THEN NULL
         ELSE closed_at END,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      label,
      month,
      session,
      status,
      JSON.stringify(semesters),
      feePer,
      feeBase,
      note,
      stamp.by_id,
      stamp.by_name,
      stamp.by_role,
    ],
  )

  return Response.json({
    ok: true,
    cycle: mapMakeupCycle(rows[0] as Record<string, unknown>),
    stamp,
  })
}
