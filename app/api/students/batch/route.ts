/**
 * Assign practical attendance batch (1–4) and parent contact for a student.
 * HOD / faculty / admin / principal.
 */
import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { normalizeBranch } from "@/lib/branches"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"
import { ensureAcademicSchema } from "@/lib/student-academic"

async function assertCanManage(
  user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null },
  regNo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (user.role === "admin" || user.role === "principal" || user.role === "faculty") return { ok: true }
  if (user.role !== "hod") return { ok: false, error: "Not authorized" }
  const myBranch = hodBranchOf(user)
  if (!myBranch) return { ok: false, error: "HOD has no branch" }
  const { rows } = await query(
    `SELECT COALESCE(NULLIF(s.dept, ''), u.branch) AS dept
       FROM users u
       LEFT JOIN students s ON s.reg_no = u.reg_no
      WHERE u.reg_no = $1 AND u.role = 'student' AND u.deleted_at IS NULL
      LIMIT 1`,
    [regNo],
  )
  if (!rows[0]) {
    const { rows: srows } = await query(`SELECT dept FROM students WHERE reg_no = $1`, [regNo])
    if (!srows[0]) return { ok: false, error: "Student not found" }
    if (!branchesMatch(myBranch, normalizeBranch(srows[0].dept))) {
      return { ok: false, error: "Student not in your branch" }
    }
    return { ok: true }
  }
  if (!branchesMatch(myBranch, normalizeBranch(rows[0].dept))) {
    return { ok: false, error: "Student not in your branch" }
  }
  return { ok: true }
}

/**
 * GET ?branch= — list students with batch + parent fields (lite)
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!["admin", "principal", "hod", "faculty"].includes(user.role)) return unauthorized()

  await ensureAcademicSchema().catch(() => null)
  const url = new URL(req.url)
  let branch = normalizeBranch(url.searchParams.get("branch"))
  if (user.role === "hod") {
    branch = hodBranchOf(user) || branch
  }
  if (!branch) return badRequest("branch is required")

  const loose = `%${branch.split(" ")[0]}%`
  const { rows } = await query(
    `SELECT s.reg_no,
            COALESCE(NULLIF(s.name,''), u.display_name, s.reg_no) AS name,
            COALESCE(NULLIF(s.dept,''), u.branch) AS dept,
            s.year,
            s.current_study_year,
            s.attendance_batch,
            s.parent_name,
            s.parent_mobile
       FROM students s
       INNER JOIN users u ON u.reg_no = s.reg_no AND u.role = 'student'
        AND u.deleted_at IS NULL AND (u.status IS DISTINCT FROM 'deleted')
      WHERE COALESCE(s.academic_status, 'active') <> 'passed_out'
        AND (
          COALESCE(NULLIF(s.dept,''), u.branch, '') = $1
          OR COALESCE(NULLIF(s.dept,''), u.branch, '') ILIKE $2
        )
      ORDER BY s.reg_no
      LIMIT 800`,
    [branch, loose],
  )

  return Response.json({
    students: rows.map((r) => ({
      reg_no: r.reg_no,
      name: r.name,
      dept: r.dept,
      year: r.year,
      current_study_year: r.current_study_year,
      attendance_batch: r.attendance_batch != null ? Number(r.attendance_batch) : null,
      parent_name: r.parent_name || "",
      parent_mobile: r.parent_mobile || "",
    })),
    scope: { branch, role: user.role },
  })
}

/**
 * POST { reg_no, attendance_batch?: 1|2|3|4|null, parent_name?, parent_mobile? }
 * Bulk: { updates: [{ reg_no, attendance_batch, parent_name?, parent_mobile? }] }
 */
export async function POST(req: Request) {
  const user = await requireRole("admin", "principal", "hod", "faculty")
  if (!user) return unauthorized()
  await ensureAcademicSchema().catch(() => null)

  const b = await req.json().catch(() => null)
  if (!b) return badRequest("JSON required")

  const list: Array<{
    reg_no: string
    attendance_batch?: number | null
    parent_name?: string | null
    parent_mobile?: string | null
  }> = Array.isArray(b.updates)
    ? b.updates
    : b.reg_no
      ? [b]
      : []

  if (!list.length) return badRequest("reg_no or updates[] required")

  const results: Array<{ reg_no: string; ok: boolean; error?: string }> = []

  for (const item of list) {
    const reg = String(item.reg_no || "").trim().toUpperCase()
    if (!reg) {
      results.push({ reg_no: "", ok: false, error: "missing reg" })
      continue
    }
    const gate = await assertCanManage(user, reg)
    if (!gate.ok) {
      results.push({ reg_no: reg, ok: false, error: gate.error })
      continue
    }

    let batch: number | null | undefined = undefined
    if (item.attendance_batch === null) {
      batch = null
    } else if (item.attendance_batch != null && item.attendance_batch !== ("" as unknown as number)) {
      const n = Number(item.attendance_batch)
      if (![1, 2, 3, 4].includes(n)) {
        results.push({ reg_no: reg, ok: false, error: "batch must be 1–4 or null" })
        continue
      }
      batch = n
    }

    try {
      await query(
        `INSERT INTO students (reg_no, name, dept)
         SELECT u.reg_no, u.display_name, COALESCE(u.branch, 'Not set')
           FROM users u WHERE u.reg_no = $1 AND u.role = 'student'
         ON CONFLICT (reg_no) DO NOTHING`,
        [reg],
      )

      const sets: string[] = []
      const params: unknown[] = [reg]
      if (batch !== undefined) {
        params.push(batch)
        sets.push(`attendance_batch = $${params.length}`)
      }
      if (item.parent_name !== undefined) {
        params.push(String(item.parent_name || "").trim() || null)
        sets.push(`parent_name = $${params.length}`)
      }
      if (item.parent_mobile !== undefined) {
        params.push(String(item.parent_mobile || "").trim() || null)
        sets.push(`parent_mobile = $${params.length}`)
      }
      if (!sets.length) {
        results.push({ reg_no: reg, ok: false, error: "nothing to update" })
        continue
      }
      await query(`UPDATE students SET ${sets.join(", ")} WHERE reg_no = $1`, params)
      await query(
        `UPDATE students SET
           extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object(
             'Attendance Batch', COALESCE(attendance_batch::text, ''),
             'Parent Mobile', COALESCE(parent_mobile, ''),
             'Parent Name', COALESCE(parent_name, '')
           )
         WHERE reg_no = $1`,
        [reg],
      )
      results.push({ reg_no: reg, ok: true })
    } catch (e) {
      results.push({
        reg_no: reg,
        ok: false,
        error: e instanceof Error ? e.message : "update failed",
      })
    }
  }

  return Response.json({
    ok: results.some((r) => r.ok),
    updated: results.filter((r) => r.ok).length,
    results,
  })
}
