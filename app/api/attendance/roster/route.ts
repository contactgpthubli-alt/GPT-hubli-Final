/**
 * Lightweight attendance roster — reg, name, year, branch only.
 * Avoids students.extra (photos) and heavy joins that hang the UI.
 */
import { query } from "@/lib/db"
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/roles"
import { normalizeBranch, isOfficialBranch } from "@/lib/branches"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"
import { parseStudyYear } from "@/lib/academic-year"

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!STAFF_ROLES.includes(user.role)) return unauthorized()

  const url = new URL(req.url)
  let branch = normalizeBranch(url.searchParams.get("branch"))
  const yearFilter = parseStudyYear(url.searchParams.get("year") || url.searchParams.get("study_year"))
  // Batch 1–4 for practical periods; empty = all batches (regular class)
  const batchRaw = url.searchParams.get("batch")
  const batchNum = batchRaw != null && String(batchRaw).trim() !== ""
    ? Number(String(batchRaw).replace(/[^0-9]/g, ""))
    : null
  const filterBatch =
    batchNum === 1 || batchNum === 2 || batchNum === 3 || batchNum === 4 ? batchNum : null

  const hodBranch = user.role === "hod" ? hodBranchOf(user) : null
  if (user.role === "hod") {
    if (!hodBranch) {
      return Response.json({
        students: [],
        count: 0,
        error: "HOD account has no branch assigned",
        scope: { role: "hod", branch: null },
      })
    }
    if (branch && !branchesMatch(branch, hodBranch)) {
      return badRequest(`You can only load roster for ${hodBranch}`)
    }
    branch = hodBranch
  }

  if (!branch || !isOfficialBranch(branch)) {
    return badRequest("Valid official branch is required")
  }

  const loose =
    branch.includes("Computer")
      ? "%Computer%"
      : branch.includes("Civil")
        ? "%Civil%"
        : branch.includes("Electron")
          ? "%Electron%"
          : branch.includes("Mech")
            ? "%Mech%"
            : `%${branch}%`

  const params: unknown[] = [branch, loose]
  let yearSql = ""
  if (yearFilter) {
    params.push(yearFilter)
    const yi = params.length
    yearSql = ` AND (
      s.current_study_year = $${yi}
      OR (
        s.current_study_year IS NULL AND (
          ($${yi} = 1 AND (s.year ILIKE '%1st%' OR s.year ~* '(^|\\s)I(\\s|$)'))
          OR ($${yi} = 2 AND (s.year ILIKE '%2nd%' OR s.year ILIKE '%II%'))
          OR ($${yi} = 3 AND (s.year ILIKE '%3rd%' OR s.year ILIKE '%III%'))
        )
      )
    )`
  }
  let batchSql = ""
  if (filterBatch) {
    params.push(filterBatch)
    // Include unassigned in Batch 1 only so first practical group isn't empty by default
    if (filterBatch === 1) {
      batchSql = ` AND (s.attendance_batch = $${params.length} OR s.attendance_batch IS NULL)`
    } else {
      batchSql = ` AND s.attendance_batch = $${params.length}`
    }
  }

  try {
    // Ensure batch columns exist (lightweight)
    try {
      await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS attendance_batch INT`)
      await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_name TEXT`)
      await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_mobile TEXT`)
    } catch {
      /* ignore */
    }

    const { rows } = await query(
      `SELECT
          s.reg_no,
          COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(u.display_name), ''), s.reg_no) AS name,
          COALESCE(NULLIF(s.dept, ''), u.branch) AS dept,
          s.year,
          s.current_study_year,
          COALESCE(s.academic_status, 'active') AS academic_status,
          s.admission_academic_year,
          COALESCE(s.entry_type, 'regular') AS entry_type,
          s.attendance_batch,
          s.parent_name,
          s.parent_mobile
         FROM students s
         INNER JOIN users u
           ON u.reg_no = s.reg_no
          AND u.role = 'student'
          AND u.deleted_at IS NULL
          AND (u.status IS DISTINCT FROM 'deleted')
          AND (u.status IS DISTINCT FROM 'rejected')
        WHERE COALESCE(s.academic_status, 'active') <> 'passed_out'
          AND (
            COALESCE(NULLIF(s.dept, ''), u.branch, '') = $1
            OR COALESCE(NULLIF(s.dept, ''), u.branch, '') ILIKE $2
          )
          ${yearSql}
          ${batchSql}
        ORDER BY s.reg_no
        LIMIT 800`,
      params,
    )

    const students = rows
      .map((r) => ({
        reg_no: String(r.reg_no || "").trim(),
        name: String(r.name || r.reg_no || "—"),
        dept: normalizeBranch(r.dept) || String(r.dept || branch),
        year: r.year,
        current_study_year: r.current_study_year != null ? Number(r.current_study_year) : null,
        academic_status: String(r.academic_status || "active"),
        admission_academic_year: r.admission_academic_year || null,
        entry_type: r.entry_type === "lateral" ? "lateral" : "regular",
        attendance_batch: r.attendance_batch != null ? Number(r.attendance_batch) : null,
        parent_name: r.parent_name || null,
        parent_mobile: r.parent_mobile || null,
      }))
      .filter((s) => s.reg_no && branchesMatch(branch, s.dept))

    return Response.json(
      {
        students,
        count: students.length,
        scope: { role: user.role, branch },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      },
    )
  } catch (e) {
    console.error("[attendance/roster]", e)
    return Response.json({ error: "Failed to load roster", students: [], count: 0 }, { status: 500 })
  }
}
