/**
 * Study-year transfer (I / II / III) — single + bulk + remove from roster.
 * HOD scoping: reg-no branch codes (CS/CE/EC/ME), not only users.branch field.
 */
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  hodBranchOf,
  hodBranchCodeOf,
  branchCodeFromRegNo,
  branchCodeFromLabel,
  studentBelongsToHod,
  branchFullName,
} from "@/lib/account-approvals"
import { ensureStudentOpsSchema, OPS_CATEGORY_ROLES } from "@/lib/student-ops"
import { logAcademicEvent } from "@/lib/student-academic"

function canUse(role: string) {
  return (OPS_CATEGORY_ROLES as readonly string[]).includes(role)
}

function canWrite(role: string) {
  return ["admin", "principal", "exam", "hod"].includes(role)
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

function yearRomanFromRow(cy: unknown, year: unknown): string {
  const n = cy != null ? Number(cy) : parseYear(year)
  if (n === 1) return "I"
  if (n === 2) return "II"
  if (n === 3) return "III"
  return "—"
}

type SessionUser = {
  id: number
  role: string
  display_name: string
  branch?: string | null
  reg_no?: string | null
  email?: string
}

async function assertBranchAccess(
  user: SessionUser,
  reg: string,
): Promise<
  | {
      ok: true
      dept: string | null
      name: string
      fromYear: number | null
      yearLabel: string | null
    }
  | { ok: false; error: string }
> {
  const { rows } = await query(
    `SELECT s.reg_no, s.name, s.dept, s.year, s.current_study_year, u.branch
       FROM students s
       LEFT JOIN users u ON UPPER(u.reg_no) = UPPER(s.reg_no) AND u.role = 'student' AND u.deleted_at IS NULL
      WHERE UPPER(s.reg_no) = $1
      LIMIT 1`,
    [reg.toUpperCase()],
  )
  if (!rows[0]) return { ok: false, error: "Student not found" }

  if (user.role === "hod") {
    const hodCode = hodBranchCodeOf(user)
    if (!hodCode) {
      return {
        ok: false,
        error:
          "Could not detect HOD branch from account (set branch, or use HODCS/HODCE/HODEC/HODME username).",
      }
    }
    const belongs = studentBelongsToHod(String(rows[0].reg_no), rows[0].dept || rows[0].branch, user)
    if (!belongs) {
      const stuCode =
        branchCodeFromRegNo(String(rows[0].reg_no)) ||
        branchCodeFromLabel(rows[0].dept) ||
        "unknown"
      return {
        ok: false,
        error: `Not your branch (HOD=${hodCode}, student=${stuCode} via reg ${rows[0].reg_no})`,
      }
    }
  } else if (!["admin", "principal", "exam", "acm"].includes(user.role)) {
    return { ok: false, error: "Not allowed" }
  }

  const cy = rows[0].current_study_year != null ? Number(rows[0].current_study_year) : null
  return {
    ok: true,
    dept: rows[0].dept != null ? String(rows[0].dept) : null,
    name: String(rows[0].name || ""),
    fromYear: cy === 1 || cy === 2 || cy === 3 ? cy : parseYear(rows[0].year),
    yearLabel: rows[0].year != null ? String(rows[0].year) : null,
  }
}

async function applyYear(
  reg: string,
  toYear: 1 | 2 | 3,
  user: SessionUser,
  note: string | null,
): Promise<{ reg_no: string; ok: boolean; error?: string; from?: number | null; to?: number }> {
  const access = await assertBranchAccess(user, reg)
  if (!access.ok) return { reg_no: reg, ok: false, error: access.error }

  const fromY = access.fromYear
  const labelRoman = yearLabel(toYear)
  const labelLong = yearLabelLong(toYear)

  const { rowCount } = await query(
    `UPDATE students SET
       current_study_year = $2,
       year = $3,
       academic_updated_at = now()
     WHERE UPPER(reg_no) = $1`,
    [reg.toUpperCase(), toYear, labelLong],
  )
  if (!rowCount) return { reg_no: reg, ok: false, error: "Update affected 0 rows" }

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
    /* trail optional */
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
    /* optional */
  }

  return { reg_no: reg, ok: true, from: fromY, to: toYear }
}

async function removeFromList(
  reg: string,
  user: SessionUser,
  note: string | null,
): Promise<{ reg_no: string; ok: boolean; error?: string }> {
  const access = await assertBranchAccess(user, reg)
  if (!access.ok) return { reg_no: reg, ok: false, error: access.error }

  await query(
    `UPDATE students SET
       academic_status = 'removed',
       progress_locked = TRUE,
       academic_updated_at = now(),
       ops_flags = COALESCE(ops_flags, '{}'::jsonb) || $2::jsonb
     WHERE UPPER(reg_no) = $1`,
    [
      reg.toUpperCase(),
      JSON.stringify({
        removed_from_list: true,
        removed_by: user.display_name,
        removed_at: new Date().toISOString(),
        removed_note: note || null,
      }),
    ],
  )

  try {
    await logAcademicEvent({
      reg_no: reg.toUpperCase(),
      event_type: "removed_from_list",
      from_status: "active",
      to_status: "removed",
      reason: note || "Removed from HOD roster list",
      actor_user_id: user.id,
      meta: { actor: user.display_name, actor_role: user.role },
    })
  } catch {
    /* optional */
  }

  return { reg_no: reg, ok: true }
}

/**
 * GET ?roster=1&year=1|2|3&q=
 * POST { action?: 'set_year'|'remove', reg_no | reg_nos, to_year?, note? }
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
  const hodCode = user.role === "hod" ? hodBranchCodeOf(user) : null

  const params: unknown[] = []
  let where = ` (s.name IS NULL OR s.name NOT LIKE '[MOVED]%')
    AND (s.academic_status IS NULL OR lower(trim(s.academic_status)) NOT IN (
      'passed_out','alumni','discontinued','removed'
    ))
    AND COALESCE((s.ops_flags->>'removed_from_list')::boolean, false) IS NOT TRUE`

  // HOD: filter by reg branch code (CS/CE/EC/ME). DTE students use dept name.
  if (user.role === "hod") {
    if (!hodCode) {
      return unauthorized(
        "Could not detect HOD branch. Use account with branch set or username HODCS/HODCE/HODEC/HODME.",
      )
    }
    if (hodCode === "CSE") {
      // 171CS… or DTE with computer dept — exclude 171ME/CE/EC even if dept wrong
      where += ` AND (
        UPPER(s.reg_no) ~ '171CS[0-9]'
        OR (
          UPPER(s.reg_no) NOT SIMILAR TO '171(CE|EC|ME)[0-9]%'
          AND (
            lower(COALESCE(s.dept,'')) LIKE '%computer%'
            OR lower(COALESCE(u.branch,'')) LIKE '%computer%'
          )
        )
      )`
    } else if (hodCode === "CE") {
      where += ` AND (
        UPPER(s.reg_no) ~ '171CE[0-9]'
        OR (
          UPPER(s.reg_no) NOT SIMILAR TO '171(CS|EC|ME)[0-9]%'
          AND (
            lower(COALESCE(s.dept,'')) LIKE '%civil%'
            OR lower(COALESCE(u.branch,'')) LIKE '%civil%'
          )
        )
      )`
    } else if (hodCode === "ECE") {
      where += ` AND (
        UPPER(s.reg_no) ~ '171EC[0-9]'
        OR (
          UPPER(s.reg_no) NOT SIMILAR TO '171(CS|CE|ME)[0-9]%'
          AND (
            lower(COALESCE(s.dept,'')) LIKE '%electron%'
            OR lower(COALESCE(u.branch,'')) LIKE '%electron%'
          )
        )
      )`
    } else if (hodCode === "ME") {
      where += ` AND (
        UPPER(s.reg_no) ~ '171ME[0-9]'
        OR (
          UPPER(s.reg_no) NOT SIMILAR TO '171(CS|CE|EC)[0-9]%'
          AND (
            lower(COALESCE(s.dept,'')) LIKE '%mech%'
            OR lower(COALESCE(u.branch,'')) LIKE '%mech%'
          )
        )
      )`
    }
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
    `SELECT s.reg_no, s.name, s.dept, s.year, s.current_study_year, s.admission_academic_year, s.entry_type,
            s.academic_status
       FROM students s
       LEFT JOIN users u ON UPPER(u.reg_no) = UPPER(s.reg_no) AND u.role = 'student' AND u.deleted_at IS NULL
      WHERE ${where}
      ORDER BY s.current_study_year NULLS LAST, s.name
      LIMIT 3000`,
    params,
  )

  // Final in-app filter (belt + suspenders): drop wrong reg codes
  const filtered = rows.filter((r) => {
    if (user.role !== "hod") return true
    return studentBelongsToHod(String(r.reg_no), r.dept, user)
  })

  return Response.json({
    ok: true,
    hod_branch: hodCode ? branchFullName(hodCode) : hodBranchOf(user),
    hod_code: hodCode,
    students: filtered.map((r) => ({
      reg_no: r.reg_no,
      name: r.name,
      dept: r.dept,
      year: r.year,
      current_study_year: r.current_study_year != null ? Number(r.current_study_year) : null,
      year_roman: yearRomanFromRow(r.current_study_year, r.year),
      admission_academic_year: r.admission_academic_year,
      entry_type: r.entry_type,
      academic_status: r.academic_status,
      reg_branch: branchCodeFromRegNo(String(r.reg_no)),
    })),
  })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canWrite(user.role)) {
    return unauthorized("Only HOD / Exam / Principal / Admin can change study year or remove students")
  }
  await ensureStudentOpsSchema()

  const b = await req.json().catch(() => null)
  if (!b) return badRequest("Invalid body")

  const action = String(b.action || "set_year").toLowerCase()
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

  const actor: SessionUser = {
    id: user.id,
    role: user.role,
    display_name: user.display_name,
    branch: user.branch,
    reg_no: user.reg_no,
    email: user.email,
  }

  if (action === "remove") {
    const results: { reg_no: string; ok: boolean; error?: string }[] = []
    for (const reg of regs) {
      try {
        results.push(await removeFromList(reg, actor, note))
      } catch (e) {
        results.push({
          reg_no: reg,
          ok: false,
          error: e instanceof Error ? e.message : "Remove failed",
        })
      }
    }
    const ok = results.filter((r) => r.ok).length
    return Response.json({
      ok: ok === results.length,
      action: "remove",
      updated: ok,
      failed: results.length - ok,
      results,
    })
  }

  const toYear = parseYear(b.to_year ?? b.year ?? b.toYear)
  if (!toYear) return badRequest("to_year must be I / II / III (or 1 / 2 / 3)")

  const results: { reg_no: string; ok: boolean; error?: string; from?: number | null; to?: number }[] =
    []
  for (const reg of regs) {
    try {
      results.push(await applyYear(reg, toYear, actor, note))
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
  const sampleErrors = results
    .filter((r) => !r.ok)
    .slice(0, 8)
    .map((r) => `${r.reg_no}: ${r.error}`)

  return Response.json({
    ok: fail === 0,
    action: "set_year",
    to_year: toYear,
    to_roman: yearLabel(toYear),
    updated: ok,
    failed: fail,
    errors: sampleErrors,
    results,
  })
}
