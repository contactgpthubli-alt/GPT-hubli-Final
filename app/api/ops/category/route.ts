import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import { hodBranchOf, branchesMatch } from "@/lib/account-approvals"
import { normalizeBranch } from "@/lib/branches"
import {
  ensureStudentOpsSchema,
  applyOpsFlags,
  parseOpsFlags,
  type OpsFlags,
  type OpsFlagKey,
  OPS_CATEGORY_ROLES,
} from "@/lib/student-ops"

function canCategory(role: string) {
  return (OPS_CATEGORY_ROLES as readonly string[]).includes(role)
}

async function assertBranchAccess(
  user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null },
  reg: string,
) {
  if (user.role === "admin" || user.role === "principal" || user.role === "exam" || user.role === "acm") {
    return true
  }
  if (user.role !== "hod") return false
  const my = hodBranchOf(user)
  if (!my) return false
  const { rows } = await query(
    `SELECT s.dept, u.branch FROM students s
     LEFT JOIN users u ON u.reg_no = s.reg_no AND u.role='student'
     WHERE UPPER(s.reg_no)=$1 LIMIT 1`,
    [reg.toUpperCase()],
  )
  if (!rows[0]) return false
  const dept = normalizeBranch(rows[0].dept) || normalizeBranch(rows[0].branch)
  return branchesMatch(my, dept)
}

/**
 * GET ?reg_no= — auto-fetch student + ops flags
 * POST { reg_no, flags: { iti?, puc?, ... }, reason? }
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canCategory(user.role)) return unauthorized()
  await ensureStudentOpsSchema()

  const reg = (new URL(req.url).searchParams.get("reg_no") || "").trim().toUpperCase()
  if (!reg) return badRequest("reg_no required")
  if (!(await assertBranchAccess(user, reg))) return unauthorized("Not your branch")

  const { rows } = await query(
    `SELECT s.reg_no, s.name, s.dept, s.year, s.father, s.entry_type, s.current_study_year,
            s.academic_status, s.progress_locked, s.ops_flags, s.previous_reg_no, s.alt_reg_no,
            s.admission_academic_year, s.extra, s.academic_updated_at
       FROM students s WHERE UPPER(s.reg_no)=$1 LIMIT 1`,
    [reg],
  )
  if (!rows[0]) return badRequest("Student not found")
  const flags = parseOpsFlags(rows[0].ops_flags)
  const extra =
    rows[0].extra && typeof rows[0].extra === "object" ? (rows[0].extra as Record<string, unknown>) : {}
  return Response.json({
    student: {
      ...rows[0],
      ops_flags: flags,
      last_change: (flags as { last_change?: unknown }).last_change || extra.category_last || null,
      year_transfer_last: extra.year_transfer_last || null,
    },
  })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canCategory(user.role)) return unauthorized()
  await ensureStudentOpsSchema()

  const b = await req.json().catch(() => null)
  if (!b?.reg_no) return badRequest("reg_no required")
  const reg = String(b.reg_no).trim().toUpperCase()
  if (!(await assertBranchAccess(user, reg))) return unauthorized("Not your branch")

  const flagsIn = b.flags && typeof b.flags === "object" ? b.flags : b
  const flags: OpsFlags = {}
  for (const k of [
    "iti",
    "puc",
    "repeater",
    "not_eligible",
    "year_back",
    "change_of_branch",
  ] as OpsFlagKey[]) {
    if (flagsIn[k] === true || flagsIn[k] === false) flags[k] = !!flagsIn[k]
    if (b[k] === true || b[k] === false) flags[k] = !!b[k]
  }
  if (typeof b.notes === "string") flags.notes = b.notes
  if (typeof flagsIn.notes === "string") flags.notes = flagsIn.notes

  if (!Object.keys(flags).length) return badRequest("No flags to update")

  try {
    await applyOpsFlags(
      reg,
      flags,
      { id: user.id, role: user.role, display_name: user.display_name },
      b.reason != null ? String(b.reason) : null,
    )
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Update failed")
  }

  const { rows } = await query(
    `SELECT reg_no, name, dept, entry_type, academic_status, progress_locked, ops_flags
       FROM students WHERE UPPER(reg_no)=$1`,
    [reg],
  )
  const flagsOut = rows[0] ? parseOpsFlags(rows[0].ops_flags) : null
  return Response.json({
    ok: true,
    by: user.display_name,
    by_role: user.role,
    at: new Date().toISOString(),
    student: rows[0]
      ? {
          ...rows[0],
          ops_flags: flagsOut,
          last_change: (flagsOut as { last_change?: unknown } | null)?.last_change || null,
        }
      : null,
  })
}
