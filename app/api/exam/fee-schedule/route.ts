/**
 * Exam Cell fine schedule: date windows + fine amount (0 = without fine).
 * GET — any authenticated user (students need it for fee display)
 * PUT — exam / admin / principal replace full tier list for a cycle
 */
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureExamResultsSchema,
  loadFineSchedule,
  resolveFineFromSchedule,
  EXAM_FEE_MANAGERS,
  type FineScheduleTier,
} from "@/lib/exam-results"
import { stripEmoji } from "@/lib/no-emoji"

function parseDate(v: unknown): string | null {
  const s = String(v || "").trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) {
    const d = m[1].padStart(2, "0")
    const mo = m[2].padStart(2, "0")
    return `${m[3]}-${mo}-${d}`
  }
  return null
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const url = new URL(req.url)
  const cycle = (url.searchParams.get("exam_cycle") || "current").trim() || "current"
  const tiers = await loadFineSchedule(cycle)
  const resolved = resolveFineFromSchedule(tiers)

  return Response.json({
    exam_cycle: cycle,
    tiers,
    resolved,
    as_of: resolved.as_of,
    note:
      "Fine is applied by calendar date (India). Amount 0 = without fine. After the last window ends, the last fine amount stays until Exam updates the schedule.",
  })
}

/**
 * PUT body:
 * {
 *   exam_cycle?: "current",
 *   tiers: [{ from_date, to_date, fine_amount, label? }, ...]
 * }
 */
export async function PUT(req: Request) {
  const user = await requireRole(...EXAM_FEE_MANAGERS)
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")

  const cycle = stripEmoji(String(b.exam_cycle || "current")).trim() || "current"
  const raw = Array.isArray(b.tiers) ? b.tiers : []
  if (!raw.length) {
    return badRequest("Add at least one date range (e.g. without-fine window).")
  }

  const tiers: FineScheduleTier[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    if (!row || typeof row !== "object") continue
    const from = parseDate((row as { from_date?: unknown }).from_date)
    const to = parseDate((row as { to_date?: unknown }).to_date)
    if (!from || !to) {
      return badRequest(`Row ${i + 1}: from_date and to_date required (YYYY-MM-DD or DD-MM-YYYY)`)
    }
    if (to < from) {
      return badRequest(`Row ${i + 1}: to_date must be on or after from_date`)
    }
    const amt = Math.max(0, Math.floor(Number((row as { fine_amount?: unknown }).fine_amount) || 0))
    const labelRaw = (row as { label?: unknown }).label
    const label =
      labelRaw != null && String(labelRaw).trim()
        ? stripEmoji(String(labelRaw)).slice(0, 120)
        : null
    tiers.push({
      from_date: from,
      to_date: to,
      fine_amount: amt,
      ord: i,
      label,
    })
  }

  if (!tiers.length) {
    return badRequest("No valid tiers")
  }

  // Soft overlap check (warn only via message; still save if sequential)
  const sorted = tiers.slice().sort((a, b) => a.from_date.localeCompare(b.from_date))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from_date <= sorted[i - 1].to_date) {
      // allow equal boundary? prefer next starts after previous end
      if (sorted[i].from_date < sorted[i - 1].to_date) {
        return badRequest(
          `Overlapping ranges: ${sorted[i - 1].from_date}–${sorted[i - 1].to_date} and ${sorted[i].from_date}–${sorted[i].to_date}`,
        )
      }
    }
  }

  await query(`DELETE FROM exam_fee_fine_schedule WHERE exam_cycle = $1`, [cycle])

  for (const t of tiers) {
    await query(
      `INSERT INTO exam_fee_fine_schedule
         (exam_cycle, from_date, to_date, fine_amount, ord, label,
          created_by, created_by_name, created_by_role, updated_at)
       VALUES ($1,$2::date,$3::date,$4,$5,$6,$7,$8,$9,now())`,
      [
        cycle,
        t.from_date,
        t.to_date,
        t.fine_amount,
        t.ord,
        t.label,
        user.id ?? null,
        user.display_name || user.email || null,
        user.role,
      ],
    )
  }

  const saved = await loadFineSchedule(cycle)
  const resolved = resolveFineFromSchedule(saved)

  return Response.json({
    ok: true,
    exam_cycle: cycle,
    tiers: saved,
    resolved,
    message: `Saved ${saved.length} fee window(s). Today's fine: ₹${resolved.fine} (${resolved.label}).`,
  })
}
