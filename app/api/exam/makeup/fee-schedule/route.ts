/**
 * Makeup fine schedule windows for a cycle.
 * GET — any auth; PUT — Exam/Admin/Principal
 */
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureMakeupExamSchema,
  getOpenMakeupCycle,
  getMakeupCycleById,
  loadMakeupFineSchedule,
  resolveMakeupFine,
  canManageMakeup,
} from "@/lib/makeup-exam"
import { stripEmoji } from "@/lib/no-emoji"
import { stampFromSession } from "@/lib/signature-stamp"

function parseDate(v: unknown): string | null {
  const s = String(v || "").trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  }
  return null
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureMakeupExamSchema()

  const url = new URL(req.url)
  const cycleId =
    Number(url.searchParams.get("cycle_id") || 0) ||
    (await getOpenMakeupCycle())?.id ||
    0
  if (!cycleId) {
    return Response.json({ cycle: null, tiers: [], resolved: null })
  }
  const cycle = await getMakeupCycleById(cycleId)
  const tiers = await loadMakeupFineSchedule(cycleId)
  const resolved = resolveMakeupFine(tiers)
  return Response.json({
    cycle,
    tiers,
    resolved,
    can_manage: canManageMakeup(user.role),
  })
}

export async function PUT(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canManageMakeup(user.role)) return unauthorized()
  await ensureMakeupExamSchema()

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return badRequest("JSON required")
  const cycleId =
    Number(b.cycle_id || 0) || (await getOpenMakeupCycle())?.id || 0
  if (!cycleId) return badRequest("cycle_id required (or open a makeup cycle first)")
  const cycle = await getMakeupCycleById(cycleId)
  if (!cycle) return badRequest("Cycle not found")

  const raw = Array.isArray(b.tiers) ? b.tiers : []
  const tiers: {
    from_date: string
    to_date: string
    fine_amount: number
    ord: number
    label: string | null
  }[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as Record<string, unknown>
    if (!row) continue
    const from = parseDate(row.from_date)
    const to = parseDate(row.to_date)
    if (!from || !to) {
      return badRequest(`Row ${i + 1}: from_date and to_date required`)
    }
    if (to < from) return badRequest(`Row ${i + 1}: to_date before from_date`)
    tiers.push({
      from_date: from,
      to_date: to,
      fine_amount: Math.max(0, Math.floor(Number(row.fine_amount) || 0)),
      ord: i,
      label:
        row.label != null && String(row.label).trim()
          ? stripEmoji(String(row.label)).slice(0, 120)
          : null,
    })
  }

  await query(`DELETE FROM makeup_fee_fine_schedule WHERE makeup_cycle_id = $1`, [cycleId])
  const stamp = stampFromSession(user, "updated")
  for (const t of tiers) {
    await query(
      `INSERT INTO makeup_fee_fine_schedule
         (makeup_cycle_id, from_date, to_date, fine_amount, ord, label,
          created_by, created_by_name, created_by_role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        cycleId,
        t.from_date,
        t.to_date,
        t.fine_amount,
        t.ord,
        t.label,
        stamp.by_id,
        stamp.by_name,
        stamp.by_role,
      ],
    )
  }

  const saved = await loadMakeupFineSchedule(cycleId)
  return Response.json({
    ok: true,
    cycle,
    tiers: saved,
    resolved: resolveMakeupFine(saved),
    stamp,
  })
}
