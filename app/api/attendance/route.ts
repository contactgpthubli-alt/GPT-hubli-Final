import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/roles"
import { normalizeBranch, isOfficialBranch } from "@/lib/branches"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"

type AttEntry = {
  reg: string
  name?: string
  status: "P" | "A" | "W" | string
  present?: boolean
}

async function ensureAttendanceSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id        BIGSERIAL PRIMARY KEY,
      class_id  TEXT NOT NULL,
      att_date  DATE NOT NULL DEFAULT CURRENT_DATE,
      entries   JSONB NOT NULL DEFAULT '[]'::jsonb,
      marked_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (class_id, att_date)
    )
  `)
  await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS branch TEXT`)
  await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS subject TEXT`)
  await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS year_label TEXT`)
  await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS class_type TEXT`)
  await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS batch TEXT`)
  await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_attendance_branch_date ON attendance (branch, att_date DESC)`,
  )
}

function slugPart(v: string | null | undefined): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_&+-]/g, "")
    .slice(0, 80)
}

/** Stable class key for a session (branch + subject + year + batch + type). */
function makeClassId(input: {
  branch: string
  subject: string
  year?: string | null
  batch?: string | null
  class_type?: string | null
}): string {
  return [
    slugPart(input.branch),
    slugPart(input.subject),
    slugPart(input.year || "all"),
    slugPart(input.batch || "all"),
    slugPart(input.class_type || "regular"),
  ].join("__")
}

function normalizeEntries(raw: unknown): AttEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => {
      const row = e as Record<string, unknown>
      const reg = String(row.reg || row.reg_no || "").trim().toUpperCase()
      if (!reg) return null
      let status = String(row.status || "").trim().toUpperCase()
      if (!status) {
        if (row.present === true) status = "P"
        else if (row.present === false) status = "A"
        else status = "A"
      }
      if (status === "PRESENT") status = "P"
      if (status === "ABSENT") status = "A"
      if (status === "WAIT") status = "W"
      if (!["P", "A", "W"].includes(status)) status = "A"
      return {
        reg,
        name: row.name != null ? String(row.name) : undefined,
        status,
        present: status === "P",
      } as AttEntry
    })
    .filter(Boolean) as AttEntry[]
}

/** Recompute students.att % from all attendance rows for the given regs. */
async function recomputeStudentAttendance(regs: string[]) {
  const unique = [...new Set(regs.map((r) => r.toUpperCase()).filter(Boolean))]
  if (!unique.length) return

  for (const reg of unique) {
    const { rows } = await query(
      `SELECT entries FROM attendance
        WHERE entries @> $1::jsonb
           OR entries::text ILIKE $2`,
      [JSON.stringify([{ reg }]), `%"reg":"${reg}"%`],
    )
    let present = 0
    let total = 0
    for (const row of rows) {
      const entries = normalizeEntries(row.entries)
      const hit = entries.find((e) => e.reg.toUpperCase() === reg)
      if (!hit) continue
      // Wait counts as absent for percentage
      if (hit.status === "W") continue // skip incomplete wait sessions from %
      total += 1
      if (hit.status === "P") present += 1
    }
    if (total === 0) continue
    const pct = Math.round((present / total) * 1000) / 10
    const label = `${pct}%`
    await query(
      `UPDATE students SET att = $2 WHERE UPPER(reg_no) = $1`,
      [reg, label],
    )
  }
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  // Students: own summary only
  if (user.role === "student") {
    await ensureAttendanceSchema()
    const reg = String(user.reg_no || "").toUpperCase()
    if (!reg) return Response.json({ sessions: [], summary: null })
    const { rows } = await query(
      `SELECT id, class_id, att_date, branch, subject, year_label, class_type, batch, entries, marked_by, created_at
         FROM attendance
        WHERE entries::text ILIKE $1
        ORDER BY att_date DESC
        LIMIT 60`,
      [`%"reg":"${reg}"%`],
    )
    let present = 0
    let total = 0
    const days = rows.map((r) => {
      const entries = normalizeEntries(r.entries)
      const hit = entries.find((e) => e.reg.toUpperCase() === reg)
      const status = hit?.status || "A"
      if (status === "P" || status === "A") {
        total += 1
        if (status === "P") present += 1
      }
      return {
        date: r.att_date,
        branch: r.branch,
        subject: r.subject,
        status,
        present: status === "P",
      }
    })
    const pct = total ? Math.round((present / total) * 1000) / 10 : null
    return Response.json({
      sessions: days,
      summary: { present, total, percent: pct, label: pct != null ? `${pct}%` : null },
    })
  }

  if (!STAFF_ROLES.includes(user.role)) return unauthorized()
  await ensureAttendanceSchema()

  const url = new URL(req.url)
  const qBranch = normalizeBranch(url.searchParams.get("branch"))
  const qDate = url.searchParams.get("date")
  const qClassId = url.searchParams.get("class_id")
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50) || 50))

  const hodBranch = user.role === "hod" ? hodBranchOf(user) : null
  // HOD always scoped; others may filter
  let branchFilter = hodBranch || qBranch
  if (user.role === "hod" && !hodBranch) {
    return Response.json({
      attendance: [],
      sessions: [],
      scope: { role: user.role, branch: null },
      error: "HOD account has no branch assigned",
    })
  }
  // HOD cannot request another branch
  if (hodBranch && qBranch && !branchesMatch(hodBranch, qBranch)) {
    branchFilter = hodBranch
  }

  const params: unknown[] = []
  const where: string[] = []
  if (branchFilter) {
    params.push(branchFilter)
    where.push(`(branch ILIKE $${params.length} OR class_id ILIKE $${params.length + 1})`)
    params.push(`%${slugPart(branchFilter)}%`)
  }
  if (qDate) {
    params.push(qDate)
    where.push(`att_date = $${params.length}::date`)
  }
  if (qClassId) {
    params.push(qClassId)
    where.push(`class_id = $${params.length}`)
  }

  params.push(limit)
  const sql = `
    SELECT id, class_id, att_date, branch, subject, year_label, class_type, batch,
           entries, marked_by, created_at, updated_at
      FROM attendance
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY att_date DESC, id DESC
     LIMIT $${params.length}`

  const { rows } = await query(sql, params)

  const sessions = rows.map((r) => {
    const entries = normalizeEntries(r.entries)
    const present = entries.filter((e) => e.status === "P").length
    const absent = entries.filter((e) => e.status === "A").length
    const wait = entries.filter((e) => e.status === "W").length
    return {
      id: r.id,
      class_id: r.class_id,
      att_date: r.att_date,
      branch: r.branch,
      subject: r.subject,
      year: r.year_label,
      class_type: r.class_type,
      batch: r.batch,
      entries,
      marked_by: r.marked_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
      stats: { total: entries.length, present, absent, wait },
    }
  })

  return Response.json(
    {
      attendance: sessions,
      sessions,
      scope: {
        role: user.role,
        branch: hodBranch,
      },
      branches: hodBranch ? [hodBranch] : undefined,
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
  const user = await requireRole("admin", "principal", "hod", "faculty")
  if (!user) return unauthorized()

  await ensureAttendanceSchema()

  const b = await req.json().catch(() => null)
  if (!b) return badRequest("Invalid JSON body")

  const hodBranch = user.role === "hod" ? hodBranchOf(user) : null
  if (user.role === "hod" && !hodBranch) {
    return badRequest("Your HOD account has no branch assigned. Contact Root Admin.")
  }

  let branch = normalizeBranch(b.branch) || hodBranch
  if (user.role === "hod" && hodBranch) {
    // Force HOD branch — never allow marking another department
    if (b.branch && !branchesMatch(b.branch, hodBranch)) {
      return badRequest(`You can only mark attendance for your branch (${hodBranch}).`)
    }
    branch = hodBranch
  }
  if (!branch || !isOfficialBranch(branch)) {
    return badRequest("Valid official branch is required")
  }

  const subject = String(b.subject || "").trim()
  if (!subject) return badRequest("Subject is required")

  const year = b.year != null && String(b.year).trim() ? String(b.year).trim() : null
  const classType = String(b.class_type || b.classType || "Regular Class").trim() || "Regular Class"
  const batch =
    String(classType).toLowerCase().includes("batch") && b.batch
      ? String(b.batch).trim()
      : b.batch
        ? String(b.batch).trim()
        : null

  const entries = normalizeEntries(b.entries)
  if (!entries.length) return badRequest("entries[] with at least one student is required")

  const classId =
    (b.class_id && String(b.class_id).trim()) ||
    makeClassId({ branch, subject, year, batch, class_type: classType })

  const attDate = b.date || b.att_date || null

  const { rows } = await query(
    `INSERT INTO attendance (
        class_id, att_date, entries, marked_by,
        branch, subject, year_label, class_type, batch, updated_at
     ) VALUES (
        $1, COALESCE($2::date, CURRENT_DATE), $3::jsonb, $4,
        $5, $6, $7, $8, $9, now()
     )
     ON CONFLICT (class_id, att_date) DO UPDATE SET
       entries = EXCLUDED.entries,
       marked_by = EXCLUDED.marked_by,
       branch = EXCLUDED.branch,
       subject = EXCLUDED.subject,
       year_label = EXCLUDED.year_label,
       class_type = EXCLUDED.class_type,
       batch = EXCLUDED.batch,
       updated_at = now()
     RETURNING *`,
    [
      classId,
      attDate,
      JSON.stringify(entries),
      user.id,
      branch,
      subject,
      year,
      classType,
      batch,
    ],
  )

  // Best-effort % update on student rows
  try {
    await recomputeStudentAttendance(entries.map((e) => e.reg))
  } catch (e) {
    console.warn("[attendance] recompute att % failed", e)
  }

  const row = rows[0]
  return Response.json({
    ok: true,
    attendance: {
      id: row.id,
      class_id: row.class_id,
      att_date: row.att_date,
      branch: row.branch,
      subject: row.subject,
      year: row.year_label,
      class_type: row.class_type,
      batch: row.batch,
      entries: normalizeEntries(row.entries),
      marked_by: row.marked_by,
    },
  })
}
