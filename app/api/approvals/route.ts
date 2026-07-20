import { query } from "@/lib/db"
import {
  requireRole,
  unauthorized,
  badRequest,
  clearUserSessions,
} from "@/lib/auth"
import { normalizeBranch } from "@/lib/branches"
import {
  canApproveTarget,
  hodBranchOf,
  isAccountApproverRole,
} from "@/lib/account-approvals"

/**
 * Pending account registrations.
 * Filters: ?role=student&q=akshay&branch=Civil%20Engineering
 *
 * Access:
 *  - admin / principal: all pending accounts
 *  - hod: only student accounts for their own branch
 */
export async function GET(req: Request) {
  const user = await requireRole("admin", "principal", "hod")
  if (!user || !isAccountApproverRole(user.role)) return unauthorized()

  const { searchParams } = new URL(req.url)
  let role = (searchParams.get("role") || "").trim().toLowerCase()
  const q = (searchParams.get("q") || "").trim()
  let branch = (searchParams.get("branch") || "").trim()

  const params: unknown[] = []
  const where: string[] = [`status = 'pending'`, `deleted_at IS NULL`]

  // HOD is locked to student + own branch
  if (user.role === "hod") {
    const myBranch = hodBranchOf(user)
    if (!myBranch) {
      return Response.json({
        pending: [],
        total_pending: 0,
        filters: { role: "student", q, branch: null },
        facets: { roles: [] },
        scope: { role: "hod", branch: null, error: "No branch assigned to this HOD account" },
      })
    }
    role = "student"
    branch = myBranch
  }

  if (role) {
    params.push(role)
    where.push(`role = $${params.length}`)
  }
  if (branch) {
    // Prefer exact official branch match after normalize, with ILIKE fallback
    const nb = normalizeBranch(branch) || branch
    params.push(nb)
    params.push(`%${branch}%`)
    where.push(`(
      COALESCE(branch, '') ILIKE $${params.length - 1}
      OR COALESCE(branch, '') ILIKE $${params.length}
    )`)
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

  // Counts: full for admin/principal; branch-scoped for HOD
  let totalPending = rows.length
  let roleRows: { role: string; n: number }[] = []
  if (user.role === "admin" || user.role === "principal") {
    const { rows: totalRows } = await query(
      `SELECT COUNT(*)::int AS n FROM users WHERE status = 'pending' AND deleted_at IS NULL`,
    )
    totalPending = totalRows[0]?.n ?? rows.length
    const { rows: rr } = await query(
      `SELECT role, COUNT(*)::int AS n FROM users
        WHERE status = 'pending' AND deleted_at IS NULL
        GROUP BY role ORDER BY role`,
    )
    roleRows = rr as { role: string; n: number }[]
  } else {
    totalPending = rows.length
    roleRows = [{ role: "student", n: rows.length }]
  }

  return Response.json({
    pending: rows,
    total_pending: totalPending,
    filters: { role, q, branch },
    facets: { roles: roleRows },
    scope: {
      role: user.role,
      branch: user.role === "hod" ? hodBranchOf(user) : null,
    },
  })
}

export async function POST(req: Request) {
  const user = await requireRole("admin", "principal", "hod")
  if (!user || !isAccountApproverRole(user.role)) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b?.id || !["approved", "rejected"].includes(b.action)) {
    return badRequest("id and action (approved|rejected) are required")
  }

  const { rows: targetRows } = await query(
    `SELECT id, email, role, display_name, reg_no, branch, status
       FROM users
      WHERE id = $1 AND status = 'pending' AND deleted_at IS NULL`,
    [b.id],
  )
  if (!targetRows[0]) return badRequest("Pending user not found")

  const gate = canApproveTarget(user, targetRows[0])
  if (!gate.ok) return unauthorized(gate.error)

  const { rows } = await query(
    `UPDATE users SET status = $2
      WHERE id = $1 AND status = 'pending' AND deleted_at IS NULL
      RETURNING id, email, role, display_name, reg_no, branch, status`,
    [b.id, b.action],
  )
  if (rows.length === 0) return badRequest("Pending user not found")

  const approved = rows[0]
  // Ensure every approved student has a students academic row with branch (dept).
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

  // Rejected accounts must never keep a live session
  if (approved.status === "rejected") {
    await clearUserSessions(Number(approved.id))
  }

  return Response.json({
    ok: true,
    user: approved,
    approved_by: { role: user.role, id: user.id, name: user.display_name },
  })
}
