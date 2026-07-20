import { getPool, query } from "@/lib/db"
import { requireRole, getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"
import { normalizeBranch } from "@/lib/branches"

/** Map profile field labels → core students table columns. */
const STUDENT_LABEL_TO_COLUMN: Record<string, "name" | "dept" | "year" | "father"> = {
  "Current Year": "year",
  Branch: "dept",
  "Father Name": "father",
  "Student (As per SSLC)": "name",
}

const PHOTO_KEYS = ["Profile Photo", "profile_photo", "ProfilePhoto", "photo", "Photo"]

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function isPhotoKey(key: string) {
  return PHOTO_KEYS.some((k) => k.toLowerCase() === key.toLowerCase()) || /profile\s*photo|^photo$/i.test(key)
}

function isDataImage(v: unknown): v is string {
  return typeof v === "string" && v.indexOf("data:image/") === 0
}

function extractPhoto(extra: Record<string, unknown>): string {
  for (const k of PHOTO_KEYS) {
    const v = extra[k]
    if (isDataImage(v)) return v
  }
  for (const [k, v] of Object.entries(extra)) {
    if (isPhotoKey(k) && isDataImage(v)) return v
  }
  return ""
}

function normalizeComparable(key: string, value: unknown): string {
  if (value == null) return ""
  if (isPhotoKey(key) || isDataImage(value)) {
    return isDataImage(value) ? String(value) : ""
  }
  return String(value).replace(/\s+/g, " ").trim()
}

/** Ensure previous column exists (Neon may not have run migration 010 yet). */
async function ensurePreviousColumn() {
  await query(
    `ALTER TABLE profile_requests
       ADD COLUMN IF NOT EXISTS previous JSONB NOT NULL DEFAULT '{}'::jsonb`,
  )
}

/**
 * Build flat current profile map for a student (extra + core columns + aliases).
 */
function studentProfileMap(row: {
  name?: unknown
  dept?: unknown
  year?: unknown
  father?: unknown
  extra?: unknown
  email?: unknown
}): Record<string, unknown> {
  const extra = asRecord(row.extra)
  const map: Record<string, unknown> = { ...extra }
  if (row.name != null && String(row.name).trim()) {
    map["Student (As per SSLC)"] = map["Student (As per SSLC)"] || row.name
    map.Name = map.Name || row.name
  }
  if (row.dept != null && String(row.dept).trim()) map.Branch = map.Branch || row.dept
  if (row.year != null && String(row.year).trim()) map["Current Year"] = map["Current Year"] || row.year
  if (row.father != null && String(row.father).trim()) map["Father Name"] = map["Father Name"] || row.father
  if (row.email != null && String(row.email).trim()) {
    map.Email = map.Email || row.email
    map["Valid E-mail ID"] = map["Valid E-mail ID"] || row.email
  }
  const photo = extractPhoto(extra)
  if (photo) {
    map["Profile Photo"] = photo
  }
  delete map.profile_edit_locked
  delete map.imported_from_excel
  delete map.imported_at
  delete map.imported_missing_ece
  delete map.email_source
  return map
}

function staffProfileMap(row: { name?: unknown; extra?: unknown }): Record<string, unknown> {
  const extra = asRecord(row.extra)
  const map: Record<string, unknown> = { ...extra }
  if (row.name != null) map.Name = map.Name || row.name
  const photo = extractPhoto(extra)
  if (photo) map["Profile Photo"] = photo
  delete map.profile_edit_locked
  return map
}

/** Read previous value for a change key from a profile map (aliases for photo). */
function previousForKey(profile: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(profile, key)) return profile[key]
  if (isPhotoKey(key)) return extractPhoto(profile) || ""
  // loose match (case/spacing)
  const lower = key.toLowerCase().replace(/\s+/g, " ")
  for (const [k, v] of Object.entries(profile)) {
    if (k.toLowerCase().replace(/\s+/g, " ") === lower) return v
  }
  return ""
}

/**
 * Keep only fields that actually differ from current profile.
 * Returns { changes, previous } both as flat label → value maps.
 */
function diffAgainstProfile(
  proposed: Record<string, unknown>,
  profile: Record<string, unknown>,
): { changes: Record<string, unknown>; previous: Record<string, unknown> } {
  const changes: Record<string, unknown> = {}
  const previous: Record<string, unknown> = {}
  for (const [key, rawNew] of Object.entries(proposed)) {
    if (key === "profile_edit_locked") continue
    const prevRaw = previousForKey(profile, key)
    const a = normalizeComparable(key, prevRaw)
    const b = normalizeComparable(key, rawNew)
    if (a === b) continue
    // Store display-friendly previous (empty string if none)
    if (isPhotoKey(key) || isDataImage(rawNew)) {
      changes[isPhotoKey(key) ? "Profile Photo" : key] = isDataImage(rawNew) ? rawNew : ""
      previous["Profile Photo"] = isDataImage(prevRaw) ? prevRaw : ""
    } else {
      changes[key] = rawNew == null ? "" : rawNew
      previous[key] = prevRaw == null || prevRaw === "" ? "" : prevRaw
    }
  }
  return { changes, previous }
}

async function loadStudentProfile(regNo: string) {
  const { rows } = await query(
    `SELECT s.name, s.dept, s.year, s.father, s.extra, u.email
       FROM students s
       LEFT JOIN users u ON u.reg_no = s.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
      WHERE upper(s.reg_no) = upper($1)
      LIMIT 1`,
    [regNo],
  )
  if (rows[0]) return studentProfileMap(rows[0])
  // users-only (no students row yet)
  const { rows: urows } = await query(
    `SELECT display_name AS name, branch AS dept, email, NULL AS year, NULL AS father, '{}'::jsonb AS extra
       FROM users
      WHERE upper(reg_no) = upper($1) AND role = 'student' AND deleted_at IS NULL
      LIMIT 1`,
    [regNo],
  )
  if (urows[0]) return studentProfileMap(urows[0])
  return {}
}

async function loadStaffProfile(id: number) {
  const { rows } = await query(`SELECT name, extra FROM staff WHERE id = $1`, [id])
  if (!rows[0]) return {}
  return staffProfileMap(rows[0])
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

  await ensurePreviousColumn()

  let profile: Record<string, unknown> = {}

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
    profile = await loadStudentProfile(regNo)
    if (profile.profile_edit_locked === true || profile.profile_edit_locked === "true") {
      return badRequest("Profile editing is locked by Admin. Contact the office to request changes.")
    }
    // re-check lock from DB extra (may not be in flattened map after deletes)
    const { rows } = await query("SELECT extra FROM students WHERE reg_no = $1", [regNo])
    const extra = asRecord(rows[0]?.extra)
    if (extra.profile_edit_locked === true || extra.profile_edit_locked === "true") {
      return badRequest("Profile editing is locked by Admin. Contact the office to request changes.")
    }
  } else {
    const { rows } = await query("SELECT name, extra FROM staff WHERE id = $1", [Number(b.targetId)])
    const extra = asRecord(rows[0]?.extra)
    if (extra.profile_edit_locked === true || extra.profile_edit_locked === "true") {
      return badRequest("Profile editing is locked by Admin. Contact the office to request changes.")
    }
    profile = staffProfileMap(rows[0] || {})
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

  // Client may send previous; we always recompute from DB for accuracy
  const proposed = asRecord(b.changes)
  const { changes, previous } = diffAgainstProfile(proposed, profile)

  if (Object.keys(changes).length === 0) {
    return badRequest("No changes to submit — values match the current profile.")
  }

  const { rows } = await query(
    `INSERT INTO profile_requests (requester_id, target_type, target_id, changes, previous)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING id, target_type, target_id, changes, previous, status, created_at`,
    [
      user.id,
      b.targetType,
      String(b.targetId),
      JSON.stringify(changes),
      JSON.stringify(previous),
    ],
  )
  return Response.json({ ok: true, request: rows[0] })
}

// Admin/HOD: all pending requests. Students/staff: own pending count via ?mine=1
// Admin filters (query string for shareable verification URLs):
//   ?branch=CSE&year=2nd%20Year&q=akshay&target_type=student&role=student
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  await ensurePreviousColumn()

  const { searchParams } = new URL(req.url)
  const mine = searchParams.get("mine") === "1"

  if (mine) {
    const { rows } = await query(
      `SELECT id, target_type, target_id, changes, previous, status, remarks, created_at
         FROM profile_requests
        WHERE requester_id = $1 AND status = 'pending'
        ORDER BY created_at`,
      [user.id],
    )
    return Response.json({ pending: rows, mine_pending: rows.length })
  }

  // Admin, Principal, HOD, ACM
  if (
    user.role !== "admin" &&
    user.role !== "principal" &&
    user.role !== "hod" &&
    user.role !== "acm"
  ) {
    return unauthorized()
  }

  let branch = (searchParams.get("branch") || "").trim()
  const year = (searchParams.get("year") || "").trim()
  const admissionYear = (
    searchParams.get("admission_year") ||
    searchParams.get("adm_year") ||
    ""
  ).trim()
  const q = (searchParams.get("q") || "").trim()
  let targetType = (searchParams.get("target_type") || "").trim().toLowerCase()
  const role = (searchParams.get("role") || "").trim().toLowerCase()

  // HOD: only student profile requests for their branch
  const hodBranch = user.role === "hod" ? hodBranchOf(user) : null
  if (user.role === "hod") {
    targetType = "student"
    if (hodBranch) branch = hodBranch
  }

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
    const nb = normalizeBranch(branch) || branch
    params.push(nb)
    params.push(`%${branch}%`)
    where.push(`(
      COALESCE(s.dept, '') ILIKE $${params.length - 1}
      OR COALESCE(s.dept, '') ILIKE $${params.length}
      OR COALESCE(u.branch, '') ILIKE $${params.length - 1}
      OR COALESCE(u.branch, '') ILIKE $${params.length}
      OR COALESCE(pr.changes->>'Branch', '') ILIKE $${params.length - 1}
      OR COALESCE(pr.changes->>'Branch', '') ILIKE $${params.length}
    )`)
  } else if (user.role === "hod" && !hodBranch) {
    // No branch on HOD → empty result set
    where.push(`FALSE`)
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
    `SELECT pr.id, pr.target_type, pr.target_id, pr.changes, pr.previous, pr.status,
            pr.remarks, pr.created_at,
            u.display_name AS requester_name, u.role AS requester_role, u.email AS requester_email,
            u.reg_no AS requester_reg_no,
            s.dept AS student_dept, s.year AS student_year, s.extra AS student_extra,
            s.name AS student_name, s.father AS student_father,
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

  // Enrich previous for older rows that lack a snapshot
  const pending = rows.map((r) => {
    let previous = asRecord(r.previous)
    const changes = asRecord(r.changes)
    const needsLive =
      Object.keys(previous).length === 0 && Object.keys(changes).length > 0 && r.target_type === "student"
    if (needsLive) {
      const live = studentProfileMap({
        name: r.student_name,
        dept: r.student_dept,
        year: r.student_year,
        father: r.student_father,
        extra: r.student_extra,
        email: r.requester_email,
      })
      for (const key of Object.keys(changes)) {
        previous[key] = previousForKey(live, key) ?? ""
      }
    }
    // Strip heavy extra from response
    const {
      student_extra: _se,
      student_name: _sn,
      student_father: _sf,
      student_dept: _sd,
      student_year: _sy,
      ...rest
    } = r as Record<string, unknown>
    return { ...rest, previous, changes }
  })

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
    pending,
    total_pending: totalRows[0]?.n ?? pending.length,
    filters: { branch, year, admission_year: admissionYear, q, target_type: targetType, role },
    facets: { branches, years, admission_years: admissionYears },
  })
}

// Admin, Principal, HOD, or ACM approves/rejects a request.
// Body: { id, action: 'approved'|'rejected', remarks?, lockEdit?: boolean }
export async function PATCH(req: Request) {
  const user = await requireRole("admin", "principal", "hod", "acm")
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

    // Load pending request first for HOD branch gate
    const { rows: pendingCheck } = await client.query(
      `SELECT pr.id, pr.target_type, pr.target_id, pr.changes,
              s.dept AS student_dept, u.branch AS user_branch
         FROM profile_requests pr
         LEFT JOIN students s ON pr.target_type = 'student' AND s.reg_no = pr.target_id
         LEFT JOIN users u ON pr.target_type = 'student' AND u.reg_no = pr.target_id AND u.role = 'student'
        WHERE pr.id = $1 AND pr.status = 'pending'`,
      [b.id],
    )
    if (!pendingCheck[0]) {
      await client.query("ROLLBACK")
      return badRequest("Pending request not found")
    }
    const pre = pendingCheck[0]
    if (user.role === "hod") {
      if (String(pre.target_type) !== "student") {
        await client.query("ROLLBACK")
        return unauthorized("HOD can only approve student profile requests for their branch")
      }
      const myBranch = hodBranchOf(user)
      const targetBranch =
        normalizeBranch(pre.student_dept) ||
        normalizeBranch(pre.user_branch) ||
        normalizeBranch(asRecord(pre.changes).Branch as string)
      if (!myBranch || !branchesMatch(myBranch, targetBranch)) {
        await client.query("ROLLBACK")
        return unauthorized("This student is not in your branch")
      }
    }

    const { rows: reqRows } = await client.query(
      `UPDATE profile_requests
          SET status = $2, reviewed_by = $3, reviewed_at = now(), remarks = $4
        WHERE id = $1 AND status = 'pending'
        RETURNING id, target_type, target_id, changes, previous, status`,
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
        // Keep users.branch in sync when Branch changed
        if (core.dept && core.dept !== "Not set") {
          await client.query(
            `UPDATE users SET branch = $1 WHERE reg_no = $2 AND role = 'student'`,
            [core.dept, regNo],
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
