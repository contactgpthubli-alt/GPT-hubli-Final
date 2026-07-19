import { getPool, query } from "@/lib/db"
import { requireRole, getCurrentUser, unauthorized, badRequest } from "@/lib/auth"

/** Map profile field labels → core students table columns. */
const STUDENT_LABEL_TO_COLUMN: Record<string, "name" | "dept" | "year" | "father"> = {
  "Current Year": "year",
  Branch: "dept",
  "Father Name": "father",
  "Student (As per SSLC)": "name",
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

// Any logged-in user can submit a profile edit request for themselves.
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b?.targetType || !b?.targetId || !b?.changes || typeof b.changes !== "object") {
    return badRequest("targetType, targetId and changes are required")
  }
  if (!["student", "staff"].includes(b.targetType)) {
    return badRequest("targetType must be 'student' or 'staff'")
  }
  if (Object.keys(b.changes).length === 0) {
    return badRequest("changes cannot be empty")
  }

  // Block submissions when admin locked further edits after a prior approval.
  if (b.targetType === "student") {
    const regNo = String(b.targetId)
    // Ensure a students row exists so a later approval can merge into it
    await query(
      `INSERT INTO students (reg_no, name, dept, extra)
       VALUES (
         $1,
         COALESCE((SELECT display_name FROM users WHERE reg_no = $1 AND role = 'student' LIMIT 1), $1),
         'Not set',
         '{}'::jsonb
       )
       ON CONFLICT (reg_no) DO NOTHING`,
      [regNo],
    )
    const { rows } = await query("SELECT extra FROM students WHERE reg_no = $1", [regNo])
    const extra = asRecord(rows[0]?.extra)
    if (extra.profile_edit_locked === true || extra.profile_edit_locked === "true") {
      return badRequest("Profile editing is locked by Admin. Contact the office to request changes.")
    }
  } else {
    const { rows } = await query("SELECT extra FROM staff WHERE id = $1", [Number(b.targetId)])
    const extra = asRecord(rows[0]?.extra)
    if (extra.profile_edit_locked === true || extra.profile_edit_locked === "true") {
      return badRequest("Profile editing is locked by Admin. Contact the office to request changes.")
    }
  }

  // Only one pending request at a time — profile stays view-only until Admin reviews it.
  const { rows: pendingRows } = await query(
    `SELECT id FROM profile_requests
      WHERE requester_id = $1 AND status = 'pending'
      LIMIT 1`,
    [user.id],
  )
  if (pendingRows.length > 0) {
    return badRequest("You already have a profile update request pending approval.")
  }

  const { rows } = await query(
    `INSERT INTO profile_requests (requester_id, target_type, target_id, changes)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, target_type, target_id, changes, status, created_at`,
    [user.id, b.targetType, String(b.targetId), JSON.stringify(b.changes)],
  )
  return Response.json({ ok: true, request: rows[0] })
}

// Admin/HOD: all pending requests. Students/staff: own pending count via ?mine=1
// Admin filters (query string for shareable verification URLs):
//   ?branch=CSE&year=2nd%20Year&q=akshay&target_type=student&role=student
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const mine = searchParams.get("mine") === "1"

  if (mine) {
    const { rows } = await query(
      `SELECT id, target_type, target_id, changes, status, remarks, created_at
         FROM profile_requests
        WHERE requester_id = $1 AND status = 'pending'
        ORDER BY created_at`,
      [user.id],
    )
    return Response.json({ pending: rows, mine_pending: rows.length })
  }

  // Admin, HOD, and ACM (scoped admin for profile approvals + students)
  if (user.role !== "admin" && user.role !== "hod" && user.role !== "acm") {
    return unauthorized()
  }

  const branch = (searchParams.get("branch") || "").trim()
  const year = (searchParams.get("year") || "").trim()
  const admissionYear = (
    searchParams.get("admission_year") ||
    searchParams.get("adm_year") ||
    ""
  ).trim()
  const q = (searchParams.get("q") || "").trim()
  const targetType = (searchParams.get("target_type") || "").trim().toLowerCase()
  const role = (searchParams.get("role") || "").trim().toLowerCase()

  const params: unknown[] = []
  const where: string[] = [`pr.status = 'pending'`]

  if (targetType === "student" || targetType === "staff") {
    params.push(targetType)
    where.push(`pr.target_type = $${params.length}`)
  }
  if (role) {
    params.push(role)
    where.push(`u.role = $${params.length}`)
  }
  // Branch: students.dept, users.branch, or changes->>'Branch'
  if (branch) {
    params.push(`%${branch}%`)
    where.push(`(
      COALESCE(s.dept, '') ILIKE $${params.length}
      OR COALESCE(u.branch, '') ILIKE $${params.length}
      OR COALESCE(pr.changes->>'Branch', '') ILIKE $${params.length}
    )`)
  }
  // Year: students.year or changes->>'Current Year'
  if (year) {
    params.push(`%${year}%`)
    where.push(`(
      COALESCE(s.year, '') ILIKE $${params.length}
      OR COALESCE(pr.changes->>'Current Year', '') ILIKE $${params.length}
    )`)
  }
  // Admission year: students.extra or profile changes
  if (admissionYear) {
    params.push(`%${admissionYear}%`)
    where.push(`(
      COALESCE(s.extra->>'Year of Admission', '') ILIKE $${params.length}
      OR COALESCE(s.extra->>'Year Of Admission', '') ILIKE $${params.length}
      OR COALESCE(s.extra->>'Admission Year', '') ILIKE $${params.length}
      OR COALESCE(pr.changes->>'Year of Admission', '') ILIKE $${params.length}
      OR COALESCE(pr.changes->>'Year Of Admission', '') ILIKE $${params.length}
      OR COALESCE(pr.changes->>'Admission Year', '') ILIKE $${params.length}
    )`)
  }
  if (q) {
    params.push(`%${q}%`)
    where.push(`(
      COALESCE(u.display_name, '') ILIKE $${params.length}
      OR COALESCE(u.email, '') ILIKE $${params.length}
      OR COALESCE(pr.target_id, '') ILIKE $${params.length}
      OR COALESCE(u.reg_no, '') ILIKE $${params.length}
      OR COALESCE(pr.changes::text, '') ILIKE $${params.length}
    )`)
  }

  const { rows } = await query(
    `SELECT pr.id, pr.target_type, pr.target_id, pr.changes, pr.status,
            pr.remarks, pr.created_at,
            u.display_name AS requester_name, u.role AS requester_role, u.email AS requester_email,
            u.reg_no AS requester_reg_no,
            s.dept AS student_dept, s.year AS student_year,
            CASE
              WHEN s.dept IS NOT NULL AND btrim(s.dept) <> '' AND s.dept <> 'Not set' THEN s.dept
              WHEN u.branch IS NOT NULL AND btrim(u.branch) <> '' THEN u.branch
              ELSE pr.changes->>'Branch'
            END AS branch,
            CASE
              WHEN s.year IS NOT NULL AND btrim(s.year) <> '' THEN s.year
              ELSE pr.changes->>'Current Year'
            END AS year
       FROM profile_requests pr
       JOIN users u ON u.id = pr.requester_id
       LEFT JOIN students s
         ON pr.target_type = 'student' AND s.reg_no = pr.target_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        COALESCE(
          NULLIF(CASE WHEN s.dept IS NOT NULL AND btrim(s.dept) <> '' AND s.dept <> 'Not set' THEN s.dept END, ''),
          pr.changes->>'Branch',
          'zzz'
        ),
        COALESCE(
          NULLIF(CASE WHEN s.year IS NOT NULL AND btrim(s.year) <> '' THEN s.year END, ''),
          pr.changes->>'Current Year',
          'zzz'
        ),
        pr.created_at`,
    params,
  )

  // Facet lists for filter dropdowns (from unfiltered pending set)
  const { rows: facetRows } = await query(
    `SELECT
        CASE
          WHEN s.dept IS NOT NULL AND btrim(s.dept) <> '' AND s.dept <> 'Not set' THEN s.dept
          ELSE pr.changes->>'Branch'
        END AS branch,
        CASE
          WHEN s.year IS NOT NULL AND btrim(s.year) <> '' THEN s.year
          ELSE pr.changes->>'Current Year'
        END AS year,
        COALESCE(
          NULLIF(btrim(s.extra->>'Year of Admission'), ''),
          NULLIF(btrim(s.extra->>'Year Of Admission'), ''),
          NULLIF(btrim(s.extra->>'Admission Year'), ''),
          NULLIF(btrim(pr.changes->>'Year of Admission'), ''),
          NULLIF(btrim(pr.changes->>'Year Of Admission'), ''),
          NULLIF(btrim(pr.changes->>'Admission Year'), '')
        ) AS admission_year
       FROM profile_requests pr
       LEFT JOIN students s
         ON pr.target_type = 'student' AND s.reg_no = pr.target_id
      WHERE pr.status = 'pending'`,
  )
  const branches = Array.from(
    new Set(
      facetRows
        .map((r) => (r.branch && String(r.branch).trim() && r.branch !== "Not set" ? String(r.branch) : null))
        .filter(Boolean) as string[],
    ),
  ).sort()
  const years = Array.from(
    new Set(
      facetRows
        .map((r) => (r.year && String(r.year).trim() ? String(r.year) : null))
        .filter(Boolean) as string[],
    ),
  ).sort()
  const admissionYears = Array.from(
    new Set(
      facetRows
        .map((r) =>
          r.admission_year && String(r.admission_year).trim() ? String(r.admission_year).trim() : null,
        )
        .filter(Boolean) as string[],
    ),
  ).sort()

  // Total pending without filters (for "showing X of Y")
  const { rows: totalRows } = await query(
    `SELECT COUNT(*)::int AS n FROM profile_requests WHERE status = 'pending'`,
  )

  return Response.json({
    pending: rows,
    total_pending: totalRows[0]?.n ?? rows.length,
    filters: { branch, year, admission_year: admissionYear, q, target_type: targetType, role },
    facets: { branches, years, admission_years: admissionYears },
  })
}

// Admin, HOD, or ACM approves/rejects a request.
// Body: { id, action: 'approved'|'rejected', remarks?, lockEdit?: boolean }
export async function PATCH(req: Request) {
  const user = await requireRole("admin", "hod", "acm")
  if (!user) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b?.id || !["approved", "rejected"].includes(b.action)) {
    return badRequest("id and action (approved|rejected) are required")
  }

  // Default: lock student editing after any approval so fields stay view-only
  // unless Admin explicitly chooses "Approve (keep edit open)".
  const lockEdit = b.lockEdit !== false

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const { rows: reqRows } = await client.query(
      `UPDATE profile_requests
          SET status = $2, reviewed_by = $3, reviewed_at = now(), remarks = $4
        WHERE id = $1 AND status = 'pending'
        RETURNING id, target_type, target_id, changes, status`,
      [b.id, b.action, user.id, b.remarks ?? null],
    )

    if (reqRows.length === 0) {
      await client.query("ROLLBACK")
      return badRequest("Pending request not found")
    }

    const reqRow = reqRows[0]

    if (b.action === "approved") {
      const changes = asRecord(reqRow.changes)
      // Never persist control flags that may have been submitted as field labels
      const profileFields: Record<string, unknown> = { ...changes }
      delete profileFields.profile_edit_locked

      if (reqRow.target_type === "student") {
        const core: { name?: string; dept?: string; year?: string; father?: string } = {}
        for (const [label, value] of Object.entries(profileFields)) {
          const col = STUDENT_LABEL_TO_COLUMN[label]
          if (col && value != null && String(value).trim() !== "") {
            core[col] = String(value)
          }
        }

        // Always set lock flag explicitly so "Approve" can re-open editing
        // and "Approve & Lock Edit" closes it.
        const extraMerge: Record<string, unknown> = {
          ...profileFields,
          profile_edit_locked: lockEdit,
        }

        const regNo = String(reqRow.target_id)
        // Prefer display_name from users if name not in changes
        if (!core.name) {
          const { rows: urows } = await client.query(
            `SELECT display_name FROM users WHERE reg_no = $1 AND role = 'student' LIMIT 1`,
            [regNo],
          )
          if (urows[0]?.display_name) core.name = String(urows[0].display_name)
        }

        const name = core.name || regNo
        const dept = core.dept || "Not set"
        const year = core.year ?? null
        const father = core.father ?? null

        // UPSERT: registered students often have a users.reg_no but no students row yet.
        // A plain UPDATE would silently match 0 rows and approved data would never appear.
        await client.query(
          `INSERT INTO students (reg_no, name, dept, year, father, extra)
           VALUES ($2, $3, $4, $5, $6, $1::jsonb)
           ON CONFLICT (reg_no) DO UPDATE SET
             extra  = COALESCE(students.extra, '{}'::jsonb) || EXCLUDED.extra,
             name   = COALESCE($3, students.name),
             dept   = CASE WHEN $4 = 'Not set' THEN students.dept ELSE COALESCE($4, students.dept) END,
             year   = COALESCE($5, students.year),
             father = COALESCE($6, students.father)`,
          [JSON.stringify(extraMerge), regNo, name, dept, year, father],
        )

        // Keep login display name in sync when SSLC name was updated
        if (core.name) {
          await client.query(
            `UPDATE users SET display_name = $1
              WHERE reg_no = $2 AND role = 'student'`,
            [core.name, regNo],
          )
        }
      } else {
        const extraMerge: Record<string, unknown> = {
          ...profileFields,
          profile_edit_locked: lockEdit,
        }
        await client.query(
          `UPDATE staff SET extra = COALESCE(extra, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
          [JSON.stringify(extraMerge), Number(reqRow.target_id)],
        )
      }
    }

    await client.query("COMMIT")
    return Response.json({
      ok: true,
      request: reqRow,
      lockEdit: b.action === "approved" ? lockEdit : false,
    })
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
