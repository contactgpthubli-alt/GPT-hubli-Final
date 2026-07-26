import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { OFFICIAL_BRANCHES, normalizeBranch, isOfficialBranch } from "@/lib/branches"
import { hodBranchOf, branchesMatch } from "@/lib/account-approvals"

const MAX_BYTES = 3.5 * 1024 * 1024 // keep under typical serverless body limits
const WRITERS = ["admin", "principal", "hod", "faculty"] as const

async function ensureTimetableSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS timetables (
      id                BIGSERIAL PRIMARY KEY,
      branch            TEXT NOT NULL,
      study_year        INT NOT NULL CHECK (study_year IN (1, 2, 3)),
      file_name         TEXT NOT NULL,
      mime_type         TEXT NOT NULL DEFAULT 'application/pdf',
      file_data         TEXT NOT NULL,
      uploaded_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
      uploaded_by_name  TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (branch, study_year)
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_timetables_branch ON timetables (branch, study_year)`,
  )
}

function parseYear(v: unknown): number | null {
  const n = Number(v)
  if (n === 1 || n === 2 || n === 3) return n
  return null
}

function staffBranchScope(user: {
  role: string
  branch?: string | null
  reg_no?: string | null
  display_name?: string | null
}): string | null {
  const role = String(user.role || "").toLowerCase()
  if (role === "admin" || role === "principal") return null // all branches
  if (role === "hod") return hodBranchOf(user)
  // faculty: prefer users.branch
  const b = normalizeBranch(user.branch)
  return b && isOfficialBranch(b) ? b : null
}

function parseStudyYearLoose(v: unknown): number | null {
  if (v === 1 || v === 2 || v === 3) return v
  const n = Number(v)
  if (n === 1 || n === 2 || n === 3) return n
  const s = String(v || "").toLowerCase()
  if (!s) return null
  if (/alumni|pass/.test(s)) return null
  if (/\b3\b|iii|third|3rd/.test(s)) return 3
  if (/\b2\b|ii|second|2nd/.test(s)) return 2
  if (/\b1\b|i\b|first|1st/.test(s)) return 1
  return null
}

/** Student branch + study year (1/2/3) from users + students row. */
async function studentScope(user: {
  role: string
  branch?: string | null
  reg_no?: string | null
}): Promise<{ branch: string | null; study_year: number | null }> {
  if (String(user.role || "").toLowerCase() !== "student") {
    return { branch: null, study_year: null }
  }
  let branch = normalizeBranch(user.branch)
  let studyYear: number | null = null

  if (user.reg_no) {
    try {
      const { rows } = await query(
        `SELECT dept, year, current_study_year
           FROM students
          WHERE UPPER(TRIM(reg_no)) = UPPER(TRIM($1))
          LIMIT 1`,
        [user.reg_no],
      )
      const row = rows[0] as
        | { dept?: string; year?: string | null; current_study_year?: number | null }
        | undefined
      if (row) {
        const fromDept = normalizeBranch(row.dept)
        if (fromDept) branch = fromDept
        studyYear =
          parseStudyYearLoose(row.current_study_year) ?? parseStudyYearLoose(row.year)
      }
    } catch {
      /* ignore */
    }
  }

  if (!branch || !isOfficialBranch(branch)) {
    branch = normalizeBranch(user.branch)
  }
  return { branch, study_year: studyYear }
}

function stripDataUrl(data: string): { mime: string; base64: string } | null {
  const raw = String(data || "").trim()
  if (!raw) return null
  const m = raw.match(/^data:([^;]+);base64,(.+)$/i)
  if (m) {
    return { mime: m[1].trim().toLowerCase(), base64: m[2].replace(/\s/g, "") }
  }
  // bare base64
  return { mime: "application/octet-stream", base64: raw.replace(/\s/g, "") }
}

function approxBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

function rowPublic(row: Record<string, unknown>, includeData: boolean) {
  const out: Record<string, unknown> = {
    id: row.id,
    branch: row.branch,
    study_year: row.study_year,
    file_name: row.file_name,
    mime_type: row.mime_type,
    uploaded_by: row.uploaded_by,
    uploaded_by_name: row.uploaded_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
  if (includeData) {
    const mime = String(row.mime_type || "application/octet-stream")
    const data = String(row.file_data || "")
    out.file_data = data.startsWith("data:") ? data : `data:${mime};base64,${data}`
  }
  return out
}

/** List or fetch one timetable. Auth required. Branch-scoped for HOD/faculty/student. */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureTimetableSchema()

  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  const includeData =
    url.searchParams.get("include_data") === "1" ||
    url.searchParams.get("include") === "file"
  let year = parseYear(url.searchParams.get("year"))
  let branchFilter = normalizeBranch(url.searchParams.get("branch"))

  const role = String(user.role || "").toLowerCase()
  let scope: string | null = null
  let studentStudyYear: number | null = null

  if (role === "student") {
    const stu = await studentScope(user)
    scope = stu.branch
    studentStudyYear = stu.study_year
    // Students may only see their own study year (1st / 2nd / 3rd)
    if (studentStudyYear) {
      year = studentStudyYear
    }
  } else {
    scope = staffBranchScope(user)
  }

  if (scope) {
    // Force scope for HOD / faculty / student
    if (branchFilter && !branchesMatch(branchFilter, scope)) {
      return Response.json({
        timetables: [],
        branch: scope,
        study_year: studentStudyYear,
        branches: [scope],
      })
    }
    branchFilter = scope
  }

  if (id) {
    const { rows } = await query(`SELECT * FROM timetables WHERE id = $1`, [Number(id)])
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return Response.json({ error: "Not found" }, { status: 404 })
    if (scope && !branchesMatch(String(row.branch), scope)) {
      return unauthorized("Not allowed for this branch")
    }
    // Students cannot open another year's file by id
    if (
      role === "student" &&
      studentStudyYear &&
      Number(row.study_year) !== studentStudyYear
    ) {
      return unauthorized("You can only view your study year timetable")
    }
    return Response.json({
      timetable: rowPublic(row, includeData),
      study_year: studentStudyYear,
    })
  }

  const params: unknown[] = []
  const where: string[] = []
  if (branchFilter) {
    params.push(branchFilter)
    where.push(`branch = $${params.length}`)
  }
  if (year) {
    params.push(year)
    where.push(`study_year = $${params.length}`)
  }
  const sql = `
    SELECT id, branch, study_year, file_name, mime_type,
           uploaded_by, uploaded_by_name, created_at, updated_at
           ${includeData ? ", file_data" : ""}
      FROM timetables
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY branch, study_year`
  const { rows } = await query(sql, params)

  return Response.json({
    timetables: rows.map((r) => rowPublic(r as Record<string, unknown>, includeData)),
    branch: branchFilter || scope || null,
    study_year: studentStudyYear,
    branches: scope ? [scope] : [...OFFICIAL_BRANCHES],
  })
}

/** Upload / replace timetable for branch + year. */
export async function POST(req: Request) {
  const user = await requireRole(...WRITERS)
  if (!user) return unauthorized()
  await ensureTimetableSchema()

  const b = await req.json().catch(() => null)
  if (!b) return badRequest("Invalid JSON body")

  const year = parseYear(b.year ?? b.study_year)
  if (!year) return badRequest("year must be 1, 2, or 3")

  let branch = normalizeBranch(b.branch)
  if (!branch || !isOfficialBranch(branch)) {
    return badRequest("Valid official branch is required")
  }

  const scope = staffBranchScope(user)
  if (scope && !branchesMatch(branch, scope)) {
    return unauthorized(`You can only upload timetable for ${scope}`)
  }
  if (scope) branch = scope

  const fileName = String(b.file_name || b.filename || "timetable.pdf")
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .slice(0, 120)
  const parsed = stripDataUrl(String(b.file_data || b.data || b.src || ""))
  if (!parsed || !parsed.base64) return badRequest("file_data (base64) is required")

  const bytes = approxBytes(parsed.base64)
  if (bytes <= 0) return badRequest("Empty file")
  if (bytes > MAX_BYTES) {
    return badRequest("File too large (max ~3.5 MB). Compress PDF or use a smaller image.")
  }

  let mime = String(b.mime_type || parsed.mime || "").toLowerCase()
  if (!mime || mime === "application/octet-stream") {
    if (/\.pdf$/i.test(fileName)) mime = "application/pdf"
    else if (/\.png$/i.test(fileName)) mime = "image/png"
    else if (/\.jpe?g$/i.test(fileName)) mime = "image/jpeg"
    else mime = parsed.mime
  }
  const allowed = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"]
  if (!allowed.includes(mime)) {
    return badRequest("Only PDF, JPG, PNG (or WebP) files are accepted")
  }
  if (mime === "image/jpg") mime = "image/jpeg"

  const displayName = String(user.display_name || user.email || "Staff").trim()

  const { rows } = await query(
    `INSERT INTO timetables
       (branch, study_year, file_name, mime_type, file_data, uploaded_by, uploaded_by_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (branch, study_year) DO UPDATE SET
       file_name = EXCLUDED.file_name,
       mime_type = EXCLUDED.mime_type,
       file_data = EXCLUDED.file_data,
       uploaded_by = EXCLUDED.uploaded_by,
       uploaded_by_name = EXCLUDED.uploaded_by_name,
       updated_at = now()
     RETURNING id, branch, study_year, file_name, mime_type,
               uploaded_by, uploaded_by_name, created_at, updated_at`,
    [branch, year, fileName, mime, parsed.base64, user.id, displayName],
  )

  return Response.json({ ok: true, timetable: rowPublic(rows[0] as Record<string, unknown>, false) })
}

/** Delete a timetable by id, or by branch+year. */
export async function DELETE(req: Request) {
  const user = await requireRole(...WRITERS)
  if (!user) return unauthorized()
  await ensureTimetableSchema()

  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  const year = parseYear(url.searchParams.get("year"))
  let branch = normalizeBranch(url.searchParams.get("branch"))

  const scope = staffBranchScope(user)

  if (id) {
    const { rows } = await query(`SELECT id, branch FROM timetables WHERE id = $1`, [Number(id)])
    const row = rows[0]
    if (!row) return Response.json({ error: "Not found" }, { status: 404 })
    if (scope && !branchesMatch(String(row.branch), scope)) {
      return unauthorized("Not allowed for this branch")
    }
    await query(`DELETE FROM timetables WHERE id = $1`, [Number(id)])
    return Response.json({ ok: true })
  }

  if (!branch || !year) return badRequest("id, or branch+year, is required")
  if (scope) {
    if (!branchesMatch(branch, scope)) return unauthorized(`Only ${scope}`)
    branch = scope
  }
  await query(`DELETE FROM timetables WHERE branch = $1 AND study_year = $2`, [branch, year])
  return Response.json({ ok: true })
}
