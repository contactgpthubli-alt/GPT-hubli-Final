import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import {
  getInstituteAcademicSettings,
  setInstituteAcademicYear,
  applyProgressionBulk,
  ensureAcademicSchema,
} from "@/lib/student-academic"
import { normalizeAcademicYear } from "@/lib/academic-year"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureAcademicSchema()
  const academic = await getInstituteAcademicSettings()
  return Response.json(
    {
      academic,
      can_edit: user.role === "admin" || user.role === "principal",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    },
  )
}

/**
 * PATCH { active_academic_year: "2026-27", apply_progression?: boolean, academic_year_start_month?: number }
 * Root Admin + Principal only.
 */
export async function PATCH(req: Request) {
  const user = await requireRole("admin", "principal")
  if (!user) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON body required")

  const ay = normalizeAcademicYear(b.active_academic_year ?? b.academic_year)
  if (!ay) return badRequest("active_academic_year is required (e.g. 2026-27)")

  const month =
    b.academic_year_start_month != null ? Number(b.academic_year_start_month) : undefined

  try {
    const academic = await setInstituteAcademicYear(ay, user.id, month)
    let progression = null
    if (b.apply_progression === true || b.applyProgression === true) {
      progression = await applyProgressionBulk(user.id)
    }
    return Response.json({ ok: true, academic, progression })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save"
    return badRequest(msg)
  }
}

/**
 * POST { action: "apply_progression" } — recompute all students against current active AY.
 */
export async function POST(req: Request) {
  const user = await requireRole("admin", "principal")
  if (!user) return unauthorized()
  const b = await req.json().catch(() => ({}))
  const action = String(b?.action || "apply_progression")
  if (action !== "apply_progression") return badRequest("Unknown action")
  const progression = await applyProgressionBulk(user.id)
  const academic = await getInstituteAcademicSettings()
  return Response.json({ ok: true, academic, progression })
}
