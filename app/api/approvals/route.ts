import { query } from "@/lib/db"
import { requireRole, unauthorized, badRequest } from "@/lib/auth"
import { normalizeBranch } from "@/lib/branches"

/**
 * Pending account registrations.
 * Filters: ?role=student&q=akshay&branch=Civil%20Engineering
 */
export async function GET(req: Request) {
  const user = await requireRole("admin")
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const role = (searchParams.get("role") || "").trim().toLowerCase()
  const q = (searchParams.get("q") || "").trim()
  const branch = (searchParams.get("branch") || "").trim()

  const params: unknown[] = []
  const where: string[] = [`status = 'pending'`]

  if (role) {
    params.push(role)
    where.push(`role = $${params.length}`)
  }
  if (branch) {
    params.push(`%${branch}%`)
    where.push(`COALESCE(branch, '') ILIKE $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    where.push(`(
      COALESCE(display_name, '') ILIKE $${params.length}
      OR COALESCE(email, '') ILIKE $${params.length}
      OR COALESCE(reg_no, '') ILIKE $${params.length}
    )`)
  }

  const { rows } = await query(
    `SELECT id, email, role, display_name, reg_no, branch, status, created_at
       FROM users
      WHERE ${where.join(" AND ")}
      ORDER BY role, branch NULLS LAST, created_at`,
    params,
  )

  const { rows: totalRows } = await query(
    `SELECT COUNT(*)::int AS n FROM users WHERE status = 'pending'`,
  )
  const { rows: roleRows } = await query(
    `SELECT role, COUNT(*)::int AS n FROM users WHERE status = 'pending' GROUP BY role ORDER BY role`,
  )

  return Response.json({
    pending: rows,
    total_pending: totalRows[0]?.n ?? rows.length,
    filters: { role, q, branch },
    facets: { roles: roleRows },
  })
}

export async function POST(req: Request) {
  const user = await requireRole("admin")
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.id || !["approved", "rejected"].includes(b.action)) {
    return badRequest("id and action (approved|rejected) are required")
  }
  const { rows } = await query(
    `UPDATE users SET status = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING id, email, role, display_name, reg_no, branch, status`,
    [b.id, b.action],
  )
  if (rows.length === 0) return badRequest("Pending user not found")

  const approved = rows[0]
  // Ensure every approved student has a students academic row with branch (dept).
  // First-time profile edit stays unlocked (no profile_edit_locked flag).
  if (approved.status === "approved" && approved.role === "student" && approved.reg_no) {
    const dept = normalizeBranch(approved.branch) || "Not set"
    await query(
      `INSERT INTO students (reg_no, name, dept, year, extra)
       VALUES ($1, $2, $3, NULL, '{}'::jsonb)
       ON CONFLICT (reg_no) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, students.name),
         dept = CASE
           WHEN EXCLUDED.dept IS NOT NULL AND EXCLUDED.dept <> 'Not set' THEN EXCLUDED.dept
           ELSE students.dept
         END`,
      [String(approved.reg_no), approved.display_name || String(approved.reg_no), dept],
    )
  }

  return Response.json({ ok: true, user: approved })
}
