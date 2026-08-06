/**
 * Study-year transfer (I / II / III) — single + bulk.
 * HOD: own branch only. Admin / Principal / Exam: all.
 */
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import { hodBranchOf, branchesMatch } from "@/lib/account-approvals"
import { normalizeBranch } from "@/lib/branches"
import {
  ensureStudentOpsSchema,
  OPS_CATEGORY_ROLES,
} from "@/lib/student-ops"
import { logAcademicEvent } from "@/lib/student-academic"

function canUse(role: string) {
  return (OPS_CATEGORY_ROLES as readonly string[]).includes(role)
}

function parseYear(v: unknown): 1 | 2 | 3 | null {
  if (v === 1 || v === 2 || v === 3) return v
  const s = String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s*YEAR\s*/g, "")
    .replace(/\./g, "")
  if (s === "1" || s === "I" || s === "1ST" || s === "FIRST") return 1
  if (s === "2" || s === "II" || s === "2ND" || s === "SECOND") return 2
  if (s === "3" || s === "III" || s === "3RD" || s === "THIRD") return 3
  const n = Number(s)
  if (n === 1 || n === 2 || n === 3) return n as 1 | 2 | 3
  return null
}

function yearLabel(n: 1 | 2 | 3): string {
  if (n === 1) return "I"
  if (n === 2) return "II"
  return "III"
}

function yearLabelLong(n: 1 | 2 | 3): string {
  if (n === 1) return "1st Year"
  if (n === 2) return "2nd Year"
  return "3rd Year"
}

async function assertBranchAccess(
  user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null },
  reg: string,
): Promise<{ ok: true; dept: string | null; name: string; fromYear: number | null; yearLabel: string | null } | { ok: false; error: string }> {
  const { rows } = await query(
    `SELECT s.reg_no, s.name, s.dept, s.year, s.current_study_year, u.branch
       FROM students s
       LEFT JOIN users u ON u.reg_no = s.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
      WHERE UPPER(s.reg_no) = $1
      LIMIT 1`,
    [reg.toUpperCase()],
  )
  if (!rows[0]) return { ok: false, error: "Student not found" }
  const dept = normalizeBranch(rows[0].dept) || normalizeBranch(rows[0].branch)
  if (user.role === "hod") {
    const my = hodBranchOf(user)
    if (!my || !branchesMatch(my, dept)) {
      return { ok: false, error: "Not your branch" }
    }
  } else if (!["admin", "principal", "exam", "acm"].includes(user.role)) {
    return { ok: false, error: "Not allowed" }
  }
  const cy = rows[0].current_study_year != null ? Number(rows[0].current_study_year) : null
  return {
    ok: true,
    dept,
    name: String(rows[0].name || ""),
    fromYear: cy === 1 || cy === 2 || cy === 3 ? cy : parseYear(rows[0].year),
    yearLabel: rows[0].year != null ? String(rows[0].year) : null,
  }
}

async function applyYear(
  reg: string,
  toYear: 1 | 2 | 3,
  user: { id: number; role: string; display_name: string },
  note: string | null,
): Promise<{ reg_no: string; ok: boolean; error?: string; from?: number | null; to?: number }> {
  const access = await assertBranchAccess(user, reg)
  if (!access.ok) return { reg_no: reg, ok: false, error: access.error }

  const fromY = access.fromYear
  if (fromY === toYear) {
    return { reg_no: reg, ok: true, from: fromY, to: toYear }
  }

  const labelRoman = yearLabel(toYear)
  const labelLong = yearLabelLong(toYear)

  await query(
    `UPDATE students SET
       current_study_year = $2,
       year = $3,
       updated_at = now()
     WHERE UPPER(reg_no) = $1`,
    [reg.toUpperCase(), toYear, labelLong],
  )

  // Keep user.branch year-agnostic; mirror year on extra for audit trail
  try {
    await query(
      `UPDATE students SET extra =
         COALESCE(extra, '{}'::jsonb) || $2::jsonb
       WHERE UPPER(reg_no) = $1`,
      [
        reg.toUpperCase(),
        JSON.stringify({
          year_transfer_last: {
            from: fromY,
            to: toYear,
            to_roman: labelRoman,
            by: user.display_name,
            role: user.role,
            at: new Date().toISOString(),
            note: note || null,
          },
        }),
      ],
    )
  } catch {
    /* extra may be text on some rows — ignore trail failure */
  }

  try {
    await logAcademicEvent({
      reg_no: reg.toUpperCase(),
      event_type: "year_transfer",
      from_year: fromY,
      to_year: toYear,
      reason: note || `Moved to Year ${labelRoman}`,
      actor_user_id: user.id,
      meta: {
        from_year: fromY,
        to_year: toYear,
        to_label: labelLong,
        actor: user.display_name,
        actor_role: user.role,
      },
    })
  } catch {
    /* event log optional if table missing */
  }

  return { reg_no: reg, ok: true, from: fromY, to: toYear }
}

/**
 * GET ?roster=1&year=1|2|3 — HOD roster for bulk picker
 * POST { reg_no, to_year } | { reg_nos: [], to_year, note? }
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canUse(user.role)) return unauthorized()
  await ensureStudentOpsSchema()

  const url = new URL(req.url)
  if (url.searchParams.get("roster") !== "1") {
    return badRequest("Use ?roster=1 for year-transfer roster")
  }

  const yearF = parseYear(url.searchParams.get("year") || "")
  const q = (url.searchParams.get("q") || "").trim().toLowerCase()

  const params: unknown[] = []
  let where = ` (s.name IS NULL OR s.name NOT LIKE '[MOVED]%')
    AND (s.academic_status IS NULL OR lower(s.academic_status) NOT IN ('passed_out','alumni','discontinued'))`

  if (user.role === "hod") {
    const my = hodBranchOf(user)
    if (!my) return unauthorized("HOD branch not set")
    const code = String(my).toLowerCase()
    let like = `%${code}%`
    if (/computer|cse/.test(code)) like = "%computer%"
    else if (/civil/.test(code)) like = "%civil%"
    else if (/electron|ece/.test(code)) like = "%electron%"
    else if (/mech/.test(code)) like = "%mech%"
    params.push(like)
    where += ` AND (lower(COALESCE(s.dept,'')) LIKE $${params.length} OR lower(COALESCE(u.branch,'')) LIKE $${params.length})`
  }

  if (yearF) {
    const ordinal = yearF === 1 ? "%1st%" : yearF === 2 ? "%2nd%" : "%3rd%"
    const roman = yearF === 1 ? "i" : yearF === 2 ? "ii" : "iii"
    params.push(yearF)
    const iN = params.length
    params.push(ordinal)
    const iOrd = params.length
    params.push(roman)
    const iRom = params.length
    where += ` AND (
      s.current_study_year = $${iN}
      OR lower(COALESCE(s.year,'')) LIKE $${iOrd}
      OR lower(trim(COALESCE(s.year,''))) = $${iRom}
    )`
  }

  if (q) {
    params.push(`%${q}%`)
    const iQ = params.length
    where += ` AND (lower(s.reg_no) LIKE $${iQ} OR lower(COALESCE(s.name,'')) LIKE $${iQ})`
  }

  const { rows } = await query(
    `SELECT s.reg_no, s.name, s.dept, s.year, s.current_study_year, s.admission_academic_year, s.entry_type
       FROM students s
       LEFT JOIN users u ON u.reg_no = s.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
      WHERE ${where}
      ORDER BY s.current_study_year NULLS LAST, s.name
      LIMIT 3000`,
    params,
  )

  return Response.json({
    ok: true,
    students: rows.map((r) => ({
      reg_no: r.reg_no,
      name: r.name,
      dept: r.dept,
      year: r.year,
      current_study_year: r.current_study_year != null ? Number(r.current_study_year) : null,
      year_roman:
        Number(r.current_study_year) === 1
          ? "I"
          : Number(r.current_study_year) === 2
            ? "II"
            : Number(r.current_study_year) === 3
              ? "III"
              : parseYear(r.year) === 1
                ? "I"
                : parseYear(r.year) === 2
                  ? "II"
                  : parseYear(r.year) === 3
                    ? "III"
                    : "—",
      admission_academic_year: r.admission_academic_year,
      entry_type: r.entry_type,
    })),
  })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canUse(user.role)) return unauthorized()
  // ACM view category but year move is write — allow HOD/exam/admin/principal
  if (!["admin", "principal", "exam", "hod"].includes(user.role)) {
    return unauthorized("Only HOD / Exam / Principal / Admin can change study year")
  }
  await ensureStudentOpsSchema()

  const b = await req.json().catch(() => null)
  if (!b) return badRequest("Invalid body")
  const toYear = parseYear(b.to_year ?? b.year ?? b.toYear)
  if (!toYear) return badRequest("to_year must be I / II / III (or 1 / 2 / 3)")
  const note = b.note != null ? String(b.note) : b.reason != null ? String(b.reason) : null

  const regs: string[] = []
  if (Array.isArray(b.reg_nos)) {
    for (const r of b.reg_nos) {
      const x = String(r || "")
        .trim()
        .toUpperCase()
      if (x) regs.push(x)
    }
  } else if (b.reg_no) {
    regs.push(String(b.reg_no).trim().toUpperCase())
  }
  if (!regs.length) return badRequest("reg_no or reg_nos[] required")
  if (regs.length > 500) return badRequest("Max 500 students per bulk request")

  const results: { reg_no: string; ok: boolean; error?: string; from?: number | null; to?: number }[] = []
  for (const reg of regs) {
    try {
      results.push(
        await applyYear(reg, toYear, {
          id: user.id,
          role: user.role,
          display_name: user.display_name,
        }, note),
      )
    } catch (e) {
      results.push({
        reg_no: reg,
        ok: false,
        error: e instanceof Error ? e.message : "Update failed",
      })
    }
  }

  const ok = results.filter((r) => r.ok).length
  const fail = results.length - ok
  return Response.json({
    ok: fail === 0,
    to_year: toYear,
    to_roman: yearLabel(toYear),
    updated: ok,
    failed: fail,
    results,
  })
}
