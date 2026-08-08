import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES, STUDENT_WRITERS } from "@/lib/roles"
import { normalizeBranch, OFFICIAL_BRANCHES } from "@/lib/branches"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"
import {
  ensureAcademicSchema,
  getInstituteAcademicSettings,
  applyProgressionToStudent,
  rowToSnapshot,
} from "@/lib/student-academic"
import { parseStudyYear, parseAcademicStatus } from "@/lib/academic-year"

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** How complete is the My Profile data for admin listing. */
function profileCompleteness(extra: Record<string, unknown>, hasStudentRow: boolean): "not_updated" | "partial" | "updated" {
  const keys = Object.keys(extra).filter((k) => k !== "profile_edit_locked")
  if (!hasStudentRow && keys.length === 0) return "not_updated"
  // Meaningful profile: several filled fields beyond empty strings
  const filled = keys.filter((k) => {
    const v = extra[k]
    return v != null && String(v).trim() !== ""
  })
  if (filled.length === 0) return "not_updated"
  if (filled.length < 6) return "partial"
  return "updated"
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  await ensureAcademicSchema().catch(() => null)
  const academicSettings = await getInstituteAcademicSettings().catch(() => null)
  const url = new URL(req.url)
  // lite=1: list views (Student Data / Attendance) — no huge profile photos, no N+1 pending counts
  const lite =
    url.searchParams.get("lite") === "1" ||
    url.searchParams.get("lite") === "true" ||
    url.searchParams.get("mode") === "lite"
  const filterStudyYear = parseStudyYear(url.searchParams.get("study_year") || url.searchParams.get("year"))
  const filterStatusRaw = url.searchParams.get("academic_status") || url.searchParams.get("status")
  const filterStatus =
    filterStatusRaw && filterStatusRaw !== "all" ? parseAcademicStatus(filterStatusRaw) : null
  // Default staff lists: exclude alumni unless status=all or status=passed_out
  const includeAlumni =
    url.searchParams.get("include_alumni") === "1" ||
    filterStatusRaw === "all" ||
    filterStatusRaw === "passed_out" ||
    filterStatus === "passed_out"

  // Student sees only own academic row (+ branch from account if needed)
  if (user.role === "student") {
    if (user.reg_no) {
      await applyProgressionToStudent(user.reg_no, { eventType: "login_recompute" }).catch(() => null)
    }
    // Case-insensitive reg match (DTE / mixed case imports)
    const { rows } = await query(
      `SELECT * FROM students WHERE UPPER(TRIM(reg_no)) = UPPER(TRIM($1)) LIMIT 1`,
      [user.reg_no],
    )
    if (rows.length) {
      const row = rows[0]
      // Prefer normalized dept; fall back to users.branch
      if (!row.dept || row.dept === "Not set") {
        const { rows: urows } = await query(
          `SELECT branch FROM users WHERE id = $1`,
          [user.id],
        )
        const b = normalizeBranch(urows[0]?.branch)
        if (b) row.dept = b
      } else {
        row.dept = normalizeBranch(row.dept) || row.dept
      }
      // Keep users.branch in sync with students.dept so HOD filters + sidebar stay correct
      if (row.dept && row.dept !== "Not set") {
        await query(
          `UPDATE users SET branch = $2 WHERE id = $1 AND (branch IS NULL OR btrim(branch) = '' OR branch = 'Not set' OR branch IS DISTINCT FROM $2)`,
          [user.id, row.dept],
        ).catch(() => null)
      }
      const academic = rowToSnapshot(row)
      return Response.json({
        students: [
          {
            ...row,
            ...academic,
            academic,
            year_label: academic.year_label || row.year,
            current_study_year: academic.current_study_year,
          },
        ],
        branches: OFFICIAL_BRANCHES,
        academic_settings: academicSettings,
      })
    }
    // No students row yet — synthesize from user so My Profile can show branch
    const { rows: urows } = await query(
      `SELECT display_name, reg_no, branch FROM users WHERE id = $1`,
      [user.id],
    )
    const u = urows[0]
    return Response.json({
      students: u
        ? [
            {
              reg_no: u.reg_no,
              name: u.display_name,
              dept: normalizeBranch(u.branch) || "Not set",
              year: null,
              cgpa: null,
              att: null,
              father: null,
              extra: {},
              academic_status: "active",
              is_alumni: false,
              read_only_portal: false,
            },
          ]
        : [],
      branches: OFFICIAL_BRANCHES,
      academic_settings: academicSettings,
    })
  }

  if (!STAFF_ROLES.includes(user.role)) return unauthorized()

  // HOD: only students of their official branch
  const hodBranch = user.role === "hod" ? hodBranchOf(user) : null

  // Admin / principal / staff: ALL student accounts (complete + incomplete profiles)
  // LEFT JOIN students so accounts without a profile row still appear.
  // HOD: filter in SQL when branch is known; fallback filter in map below.
  const params: unknown[] = []
  let branchSql = ""
  if (hodBranch) {
    // Prefer exact official branch match (fast). Keep one loose pattern for legacy labels.
    params.push(hodBranch)
    const loose =
      hodBranch.includes("Computer")
        ? "%Computer%"
        : hodBranch.includes("Civil")
          ? "%Civil%"
          : hodBranch.includes("Electron")
            ? "%Electron%"
            : hodBranch.includes("Mech")
              ? "%Mech%"
              : `%${hodBranch}%`
    params.push(loose)
    branchSql = ` AND (
      COALESCE(NULLIF(s.dept, ''), NULLIF(u.branch, ''), '') = $1
      OR COALESCE(NULLIF(s.dept, ''), NULLIF(u.branch, ''), '') ILIKE $2
      OR COALESCE(s.extra->>'Branch', '') = $1
      OR COALESCE(s.extra->>'Branch', '') ILIKE $2
    )`
  }

  // lite: never load full students.extra (profile photos make multi-MB responses)
  // but still return profile_edit_locked so Unlock/Lock buttons show correctly.
  // full list: still strip data:image values so View/list stays usable
  const extraSelect = lite
    ? `jsonb_build_object(
         'profile_edit_locked',
         CASE
           WHEN lower(COALESCE(s.extra->>'profile_edit_locked', '')) IN ('true', 't', '1') THEN true
           ELSE false
         END
       ) AS extra`
    : `COALESCE(
         (SELECT jsonb_object_agg(e.key, e.value)
            FROM jsonb_each(COALESCE(s.extra, '{}'::jsonb)) AS e
           WHERE left(e.value::text, 11) <> '"data:image'),
         '{}'::jsonb
       ) AS extra`

  // Avoid N+1 correlated COUNT — was a major cause of multi-minute loads
  const pendingSelect = lite
    ? `0::int AS pending_profile_requests`
    : `COALESCE(pr.pending_count, 0)::int AS pending_profile_requests`

  const pendingJoin = lite
    ? ``
    : `LEFT JOIN (
         SELECT target_id, COUNT(*)::int AS pending_count
           FROM profile_requests
          WHERE target_type = 'student' AND status = 'pending'
          GROUP BY target_id
       ) pr ON pr.target_id = u.reg_no`

  const { rows } = await query(
    `SELECT
        u.id              AS user_id,
        u.email,
        u.display_name,
        u.reg_no,
        u.branch          AS user_branch,
        u.status          AS account_status,
        u.created_at      AS account_created_at,
        s.reg_no          AS student_reg_no,
        s.name            AS student_name,
        s.dept,
        s.year,
        s.cgpa,
        s.att,
        s.father,
        ${extraSelect},
        s.admission_academic_year,
        s.entry_type,
        s.entry_study_year,
        s.current_study_year,
        s.academic_status,
        s.progress_locked,
        s.pass_out_academic_year,
        s.needs_admission_year_review,
        ${pendingSelect}
       FROM users u
       LEFT JOIN students s ON s.reg_no = u.reg_no
       ${pendingJoin}
      WHERE u.role = 'student'
        AND u.deleted_at IS NULL
        AND (u.status IS DISTINCT FROM 'deleted')
        ${branchSql}
      ORDER BY
        COALESCE(NULLIF(s.dept, ''), NULLIF(u.branch, ''), 'zzz'),
        COALESCE(NULLIF(s.name, ''), u.display_name),
        u.reg_no NULLS LAST,
        u.id`,
    params,
  )

  const students = rows.map((r) => {
    const extra = asRecord(r.extra)
    const hasStudentRow = !!r.student_reg_no
    const profile_status = profileCompleteness(extra, hasStudentRow)
    const name =
      (r.student_name && String(r.student_name).trim()) ||
      (typeof extra["Student (As per SSLC)"] === "string" && String(extra["Student (As per SSLC)"]).trim()) ||
      r.display_name ||
      "—"
    const dept =
      normalizeBranch(
        (r.dept && String(r.dept).trim() && r.dept !== "Not set" ? r.dept : null) ||
          (typeof extra["Branch"] === "string" ? extra["Branch"] : null) ||
          r.user_branch ||
          null,
      ) || "—"
    const academic = hasStudentRow
      ? rowToSnapshot({
          reg_no: r.reg_no || r.student_reg_no,
          year: r.year,
          admission_academic_year: r.admission_academic_year,
          entry_type: r.entry_type,
          entry_study_year: r.entry_study_year,
          current_study_year: r.current_study_year,
          academic_status: r.academic_status,
          progress_locked: r.progress_locked,
          pass_out_academic_year: r.pass_out_academic_year,
          needs_admission_year_review: r.needs_admission_year_review,
        })
      : {
          admission_academic_year: null,
          entry_type: "regular" as const,
          entry_study_year: 1 as const,
          current_study_year: parseStudyYear(r.year),
          academic_status: "active" as const,
          progress_locked: false,
          pass_out_academic_year: null,
          year: r.year || "—",
          year_label: r.year || "—",
          needs_admission_year_review: true,
          is_alumni: false,
          read_only_portal: false,
        }
    const year =
      academic.year_label ||
      (r.year && String(r.year).trim()) ||
      (typeof extra["Current Year"] === "string" ? extra["Current Year"] : null) ||
      "—"
    const locked = extra.profile_edit_locked === true || extra.profile_edit_locked === "true"
    // First-time: never locked until admin approves a profile request with lock
    const first_time_edit = !locked && profile_status === "not_updated"

    return {
      user_id: r.user_id,
      email: r.email,
      reg_no: r.reg_no || r.student_reg_no || null,
      display_name: r.display_name,
      name,
      dept: String(dept),
      year: String(year),
      father: r.father ?? (typeof extra["Father Name"] === "string" ? extra["Father Name"] : null),
      cgpa: r.cgpa,
      att: r.att,
      account_status: r.account_status,
      first_time_edit,
      account_created_at: r.account_created_at,
      profile_status,
      pending_profile_requests: r.pending_profile_requests || 0,
      profile_edit_locked: extra.profile_edit_locked === true || extra.profile_edit_locked === "true",
      extra,
      // Keep full row shape for any older consumers
      has_student_row: hasStudentRow,
      // Academic progression fields
      admission_academic_year: academic.admission_academic_year,
      entry_type: academic.entry_type,
      entry_study_year: academic.entry_study_year,
      current_study_year: academic.current_study_year,
      academic_status: academic.academic_status,
      progress_locked: academic.progress_locked,
      pass_out_academic_year: academic.pass_out_academic_year,
      needs_admission_year_review: academic.needs_admission_year_review,
      is_alumni: academic.is_alumni,
      academic,
    }
  })

  // Defense in depth: HOD must never receive other branches even if SQL aliases slip
  let scoped =
    user.role === "hod" && hodBranch
      ? students.filter((s) => branchesMatch(hodBranch, s.dept))
      : students

  // If HOD has no branch assigned, return empty rather than all students
  if (user.role === "hod" && !hodBranch) scoped = []

  // Year / status filters
  let finalList = scoped
  if (!includeAlumni && !filterStatus) {
    finalList = finalList.filter((s) => s.academic_status !== "passed_out")
  }
  if (filterStatus) {
    finalList = finalList.filter((s) => s.academic_status === filterStatus)
  }
  if (filterStudyYear) {
    finalList = finalList.filter((s) => {
      if (s.academic_status === "passed_out") return false
      return s.current_study_year === filterStudyYear
    })
  }

  return Response.json(
    {
      students: finalList,
      branches:
        user.role === "hod" && hodBranch ? [hodBranch] : OFFICIAL_BRANCHES,
      scope: {
        role: user.role,
        branch: user.role === "hod" ? hodBranch : null,
      },
      academic_settings: academicSettings,
      filters: {
        study_year: filterStudyYear,
        academic_status: filterStatusRaw || (includeAlumni ? "all" : "active_default"),
        include_alumni: includeAlumni,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    },
  )
}

export async function POST(req: Request) {
  const user = await requireRole(...STUDENT_WRITERS)
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.reg_no || !b?.name || !b?.dept) return badRequest("reg_no, name and dept are required")
  await query(
    `INSERT INTO students (reg_no, name, dept, year, cgpa, att, father, extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::jsonb,'{}'::jsonb))
     ON CONFLICT (reg_no) DO UPDATE SET
       name=EXCLUDED.name, dept=EXCLUDED.dept, year=EXCLUDED.year, cgpa=EXCLUDED.cgpa,
       att=EXCLUDED.att, father=EXCLUDED.father, extra=EXCLUDED.extra`,
    [
      b.reg_no,
      b.name,
      b.dept,
      b.year ?? null,
      b.cgpa ?? null,
      b.att ?? null,
      b.father ?? null,
      JSON.stringify(b.extra ?? {}),
    ],
  )
  return Response.json({ ok: true })
}

/**
 * Admin/HOD: lock or unlock student My Profile editing.
 * Single: { reg_no: string, profile_edit_locked: boolean }
 * Bulk:   { reg_nos: string[], profile_edit_locked: boolean }
 *         or { action: "bulk_set_lock", reg_nos: string[], profile_edit_locked: boolean }
 */
async function setProfileEditLock(regNo: string, lockFlag: boolean) {
  const { rows: urows } = await query(
    `SELECT display_name FROM users
      WHERE reg_no = $1 AND role = 'student'
        AND deleted_at IS NULL
        AND (status IS DISTINCT FROM 'deleted')
      LIMIT 1`,
    [regNo],
  )
  // Still allow lock when student row exists even if account lookup is odd
  const displayName = urows[0]?.display_name || regNo

  // When staff locks, also mark first-filled so import-seed first-time mode does not reopen.
  await query(
    `INSERT INTO students (reg_no, name, dept, extra)
     VALUES (
       $1, $2, 'Not set',
       jsonb_build_object(
         'profile_edit_locked', $3::boolean,
         'profile_first_filled', CASE WHEN $3::boolean THEN true ELSE false END
       )
     )
     ON CONFLICT (reg_no) DO UPDATE SET
       extra = COALESCE(students.extra, '{}'::jsonb) ||
         CASE
           WHEN $3::boolean THEN jsonb_build_object('profile_edit_locked', true, 'profile_first_filled', true)
           ELSE jsonb_build_object('profile_edit_locked', false)
         END`,
    [regNo, displayName, lockFlag],
  )
  return { reg_no: regNo, profile_edit_locked: lockFlag }
}

async function assertCanManageStudentReg(
  user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null },
  regNo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (user.role === "admin" || user.role === "principal" || user.role === "acm" || user.role === "exam") {
    return { ok: true }
  }
  if (user.role !== "hod") return { ok: false, error: "Not authorized" }
  const myBranch = hodBranchOf(user)
  if (!myBranch) return { ok: false, error: "HOD account has no branch assigned" }
  const { rows } = await query(
    `SELECT s.dept, u.branch AS user_branch
       FROM users u
       LEFT JOIN students s ON s.reg_no = u.reg_no
      WHERE u.reg_no = $1 AND u.role = 'student' AND u.deleted_at IS NULL
      LIMIT 1`,
    [regNo],
  )
  if (!rows[0]) return { ok: false, error: "Student not found" }
  const dept = normalizeBranch(rows[0].dept) || normalizeBranch(rows[0].user_branch)
  if (!branchesMatch(myBranch, dept)) {
    return { ok: false, error: "Student is not in your branch" }
  }
  return { ok: true }
}

export async function PATCH(req: Request) {
  // Principal / ACM / Exam / Admin / HOD (branch) lock-unlock student My Profile editing
  const user = await requireRole("admin", "principal", "hod", "acm", "exam")
  if (!user) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON body required")
  if (typeof b.profile_edit_locked !== "boolean") {
    return badRequest("profile_edit_locked (boolean) is required")
  }

  const lockFlag = b.profile_edit_locked === true
  const bulkList: string[] = Array.isArray(b.reg_nos)
    ? b.reg_nos.map((x: unknown) => String(x || "").trim()).filter(Boolean)
    : []

  // Bulk unlock / lock
  if (b.action === "bulk_set_lock" || bulkList.length > 0) {
    if (!bulkList.length) return badRequest("reg_nos array is required for bulk lock")
    const results = []
    for (const regNo of bulkList) {
      const gate = await assertCanManageStudentReg(user, regNo)
      if (!gate.ok) {
        results.push({ reg_no: regNo, ok: false, error: gate.error })
        continue
      }
      results.push({ ok: true, ...(await setProfileEditLock(regNo, lockFlag)) })
    }
    return Response.json(
      {
        ok: results.some((r) => r.ok),
        updated: results.filter((r) => r.ok).length,
        profile_edit_locked: lockFlag,
        results,
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  }

  if (!b.reg_no) return badRequest("reg_no is required")
  const regNo = String(b.reg_no).trim()
  if (!regNo) return badRequest("reg_no is required")

  const gate = await assertCanManageStudentReg(user, regNo)
  if (!gate.ok) return unauthorized(gate.error)

  const result = await setProfileEditLock(regNo, lockFlag)
  return Response.json(
    { ok: true, ...result },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export async function DELETE(req: Request) {
  const user = await requireRole("admin")
  if (!user) return unauthorized()
  const { searchParams } = new URL(req.url)
  const regNo = searchParams.get("reg_no")
  if (!regNo) return badRequest("reg_no is required")
  await query("DELETE FROM students WHERE reg_no = $1", [regNo])
  return Response.json({ ok: true })
}
