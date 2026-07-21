import { query } from "@/lib/db"
import {
  requireRole,
  unauthorized,
  badRequest,
  hashPassword,
  clearUserSessions,
} from "@/lib/auth"
import { normalizeBranch } from "@/lib/branches"
import {
  canApproveTarget,
  hodBranchOf,
  isAccountApproverRole,
} from "@/lib/account-approvals"
import {
  approveAccountWithAudit,
  ensureAccountApprovalSchema,
  rejectAccountWithAudit,
} from "@/lib/user-notifications"

/**
 * Account control / listings.
 * GET  ?status=all|pending|approved|rejected|deleted&role=&q=&branch=
 * Access: admin (full), principal (full list for approvals), hod (own-branch students only)
 * PATCH actions:
 *   approve | reject — admin, principal, hod (scoped)
 *   reset_password | set_status | soft_delete | restore | bulk_soft_delete — admin only
 * DELETE ?id=  → soft-delete (admin). Hard purge only for trash: ?hard=1&id=
 */
export async function GET(req: Request) {
  const user = await requireRole("admin", "principal", "hod")
  if (!user || !isAccountApproverRole(user.role)) return unauthorized()
  await ensureAccountApprovalSchema()

  const { searchParams } = new URL(req.url)
  let status = (searchParams.get("status") || "all").trim().toLowerCase()
  let role = (searchParams.get("role") || "").trim().toLowerCase()
  const q = (searchParams.get("q") || "").trim()
  let branch = (searchParams.get("branch") || "").trim()

  // HOD: only students of their branch (default pending for the queue)
  const hodBranch = user.role === "hod" ? hodBranchOf(user) : null
  if (user.role === "hod") {
    role = "student"
    if (hodBranch) branch = hodBranch
    // HOD does not browse trash / full directory
    if (status === "deleted" || status === "all") status = "pending"
  }

  // Principal uses the approval queue primarily; allow full list like admin
  // but never manage trash from principal UI (still filterable if needed).

  const params: unknown[] = []
  const where: string[] = ["1=1"]

  // Default list excludes trash; status=deleted shows only trash; all excludes deleted too
  if (status === "deleted") {
    if (user.role !== "admin") {
      return unauthorized("Only Root Admin can view trash")
    }
    where.push(`(u.status = 'deleted' OR u.deleted_at IS NOT NULL)`)
  } else if (status === "all") {
    where.push(`(u.status IS DISTINCT FROM 'deleted' AND u.deleted_at IS NULL)`)
  } else if (status) {
    params.push(status)
    where.push(`u.status = $${params.length}`)
    where.push(`u.deleted_at IS NULL`)
  }

  if (role) {
    params.push(role)
    where.push(`u.role = $${params.length}`)
  }
  if (branch) {
    const nb = normalizeBranch(branch) || branch
    params.push(nb)
    params.push(`%${branch}%`)
    where.push(`(
      COALESCE(u.branch, s.dept, '') ILIKE $${params.length - 1}
      OR COALESCE(u.branch, s.dept, '') ILIKE $${params.length}
    )`)
  }
  if (q) {
    params.push(`%${q}%`)
    where.push(`(
      COALESCE(u.display_name, '') ILIKE $${params.length}
      OR COALESCE(u.email, '') ILIKE $${params.length}
      OR COALESCE(u.reg_no, '') ILIKE $${params.length}
      OR COALESCE(u.branch, '') ILIKE $${params.length}
    )`)
  }

  const { rows } = await query(
    `SELECT
        u.id, u.email, u.role, u.display_name, u.reg_no, u.branch,
        u.status, u.force_password_change, u.is_demo, u.created_at,
        u.deleted_at, u.prev_status,
        u.approved_by, u.approved_by_name, u.approved_by_role, u.approved_at,
        u.rejected_by, u.rejected_by_name, u.rejected_by_role, u.rejected_at,
        s.dept AS student_dept, s.year AS student_year, s.name AS student_name
       FROM users u
       LEFT JOIN students s ON s.reg_no = u.reg_no
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE
          WHEN u.status = 'pending' THEN 0
          WHEN u.status = 'approved' THEN 1
          WHEN u.status = 'rejected' THEN 2
          ELSE 3
        END,
        u.deleted_at DESC NULLS LAST,
        u.role, u.display_name`,
    params,
  )

  // Counts: global for admin/principal; branch-scoped for HOD
  let c0: Record<string, number> = {}
  if (user.role === "hod" && hodBranch) {
    const { rows: counts } = await query(
      `SELECT
          COUNT(*) FILTER (
            WHERE status IS DISTINCT FROM 'deleted' AND deleted_at IS NULL
              AND role = 'student'
              AND (
                COALESCE(branch, '') ILIKE $1
                OR COALESCE(branch, '') ILIKE $2
              )
          )::int AS active_total,
          COUNT(*) FILTER (
            WHERE status = 'pending' AND deleted_at IS NULL
              AND role = 'student'
              AND (
                COALESCE(branch, '') ILIKE $1
                OR COALESCE(branch, '') ILIKE $2
              )
          )::int AS pending,
          COUNT(*) FILTER (
            WHERE status = 'approved' AND deleted_at IS NULL
              AND role = 'student'
              AND (
                COALESCE(branch, '') ILIKE $1
                OR COALESCE(branch, '') ILIKE $2
              )
          )::int AS approved,
          COUNT(*) FILTER (
            WHERE status = 'rejected' AND deleted_at IS NULL
              AND role = 'student'
              AND (
                COALESCE(branch, '') ILIKE $1
                OR COALESCE(branch, '') ILIKE $2
              )
          )::int AS rejected,
          0::int AS deleted
         FROM users`,
      [hodBranch, `%${hodBranch}%`],
    )
    c0 = counts[0] || {}
  } else {
    const { rows: counts } = await query(
      `SELECT
          COUNT(*) FILTER (WHERE status IS DISTINCT FROM 'deleted' AND deleted_at IS NULL)::int AS active_total,
          COUNT(*) FILTER (WHERE status = 'pending' AND deleted_at IS NULL)::int AS pending,
          COUNT(*) FILTER (WHERE status = 'approved' AND deleted_at IS NULL)::int AS approved,
          COUNT(*) FILTER (WHERE status = 'rejected' AND deleted_at IS NULL)::int AS rejected,
          COUNT(*) FILTER (WHERE status = 'deleted' OR deleted_at IS NOT NULL)::int AS deleted
         FROM users`,
    )
    c0 = counts[0] || {}
  }

  // Profile pending count for Approvals sidebar badge
  let profile_pending = 0
  try {
    if (user.role === "admin" || user.role === "principal" || user.role === "hod") {
      const { rows: pr } = await query(
        `SELECT COUNT(*)::int AS n FROM profile_requests WHERE status = 'pending'`,
      )
      profile_pending = pr[0]?.n || 0
    }
  } catch {
    profile_pending = 0
  }

  const accounts = rows.map((r) => ({
    id: Number(r.id),
    email: r.email,
    role: r.role,
    display_name: r.display_name,
    reg_no: r.reg_no,
    branch: normalizeBranch(r.branch || r.student_dept) || r.branch || r.student_dept || null,
    year: r.student_year || null,
    status: r.deleted_at || r.status === "deleted" ? "deleted" : r.status,
    force_password_change: !!r.force_password_change,
    is_demo: !!r.is_demo,
    created_at: r.created_at,
    deleted_at: r.deleted_at,
    prev_status: r.prev_status,
    approved_by: r.approved_by != null ? Number(r.approved_by) : null,
    approved_by_name: r.approved_by_name || null,
    approved_by_role: r.approved_by_role || null,
    approved_at: r.approved_at || null,
    rejected_by: r.rejected_by != null ? Number(r.rejected_by) : null,
    rejected_by_name: r.rejected_by_name || null,
    rejected_by_role: r.rejected_by_role || null,
    rejected_at: r.rejected_at || null,
  }))

  return Response.json(
    {
      accounts,
      counts: {
        pending: c0.pending || 0,
        approved: c0.approved || 0,
        rejected: c0.rejected || 0,
        deleted: c0.deleted || 0,
        total_users: c0.active_total || 0,
        profile_pending,
      },
      filters: { status, role, q, branch },
      scope: {
        role: user.role,
        branch: user.role === "hod" ? hodBranch : null,
        capabilities:
          user.role === "admin"
            ? "full"
            : user.role === "principal"
              ? "approve_all"
              : "approve_branch_students",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    },
  )
}

async function softDeleteUser(id: number, adminId: number) {
  // Coerce to number — pg may return bigint ids as strings
  const uid = Number(id)
  const aid = Number(adminId)
  if (!Number.isFinite(uid) || uid <= 0) {
    return { error: "Invalid user id" as const }
  }
  if (uid === aid) {
    return { error: "You cannot delete your own admin account" as const }
  }
  const { rows } = await query(
    `UPDATE users
        SET prev_status = CASE
              WHEN status = 'deleted' THEN COALESCE(prev_status, 'approved')
              ELSE status
            END,
            status = 'deleted',
            deleted_at = COALESCE(deleted_at, now())
      WHERE id = $1
        AND status IS DISTINCT FROM 'deleted'
        AND deleted_at IS NULL
      RETURNING id, email, role, display_name, status, deleted_at`,
    [uid],
  )
  if (!rows[0]) {
    // Distinguish already-trashed vs missing
    const { rows: check } = await query(
      `SELECT id, status, deleted_at FROM users WHERE id = $1`,
      [uid],
    )
    if (!check[0]) return { error: "User not found" as const }
    return { error: "Already in trash" as const }
  }
  // Kill sessions so they cannot stay logged in
  await query(`DELETE FROM sessions WHERE user_id = $1`, [uid])
  return { user: rows[0] }
}

/** Shared mutation handler (PATCH preferred; POST accepted as fallback). */
async function mutateUsers(req: Request) {
  const actor = await requireRole("admin", "principal", "hod")
  if (!actor || !isAccountApproverRole(actor.role)) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b?.action) return badRequest("action is required")

  const isAdmin = actor.role === "admin"
  const canApprove = isAdmin || actor.role === "principal" || actor.role === "hod"

  // ── Bulk soft-delete (admin only) ──
  if (b.action === "bulk_soft_delete") {
    if (!isAdmin) return unauthorized("Only Root Admin can bulk-delete accounts")
    const rawIds = Array.isArray(b.ids) ? b.ids : []
    const ids = rawIds
      .map((x: unknown) => Number(x))
      .filter((n: number) => Number.isFinite(n) && n > 0)
    if (!ids.length) {
      return badRequest("ids array is required (got: " + JSON.stringify(rawIds).slice(0, 200) + ")")
    }
    const results: { id: number; ok: boolean; error?: string }[] = []
    for (const id of ids) {
      try {
        const r = await softDeleteUser(id, Number(actor.id))
        if ("error" in r && r.error) results.push({ id, ok: false, error: r.error })
        else results.push({ id, ok: true })
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: err instanceof Error ? err.message : "server error",
        })
      }
    }
    const okCount = results.filter((r) => r.ok).length
    // Still return ok:true if at least one succeeded; client shows partial failures
    return Response.json({
      ok: okCount > 0,
      deleted: okCount,
      results,
      error: okCount === 0 ? results.map((r) => r.error).filter(Boolean).join("; ") || "No accounts deleted" : undefined,
    })
  }

  if (!b?.id) return badRequest("id and action are required")
  const id = Number(b.id)
  if (!Number.isFinite(id)) return badRequest("invalid id")

  const { rows: targetRows } = await query(
    `SELECT id, email, role, display_name, reg_no, branch, status, is_demo, deleted_at, prev_status
       FROM users WHERE id = $1`,
    [id],
  )
  if (!targetRows[0]) return badRequest("User not found")
  const target = targetRows[0]

  if (b.action === "soft_delete") {
    if (!isAdmin) return unauthorized("Only Root Admin can delete accounts")
    const r = await softDeleteUser(id, Number(actor.id))
    if ("error" in r && r.error) return badRequest(r.error)
    return Response.json({ ok: true, user: r.user })
  }

  if (b.action === "restore") {
    if (!isAdmin) return unauthorized("Only Root Admin can restore accounts")
    if (target.status !== "deleted" && !target.deleted_at) {
      return badRequest("Account is not in trash")
    }
    const restoreTo = ["pending", "approved", "rejected"].includes(String(target.prev_status))
      ? target.prev_status
      : "approved"
    const { rows } = await query(
      `UPDATE users
          SET status = $2, deleted_at = NULL, prev_status = NULL
        WHERE id = $1
        RETURNING id, email, role, display_name, status`,
      [id, restoreTo],
    )
    // Restored-but-not-approved accounts must not regain a session
    if (String(restoreTo) !== "approved") {
      await clearUserSessions(id)
    }
    return Response.json({ ok: true, user: rows[0], restored_to: restoreTo })
  }

  if (b.action === "hard_delete") {
    if (!isAdmin) return unauthorized("Only Root Admin can permanently delete accounts")
    // Permanent delete — only from trash
    if (Number(target.id) === Number(actor.id)) {
      return badRequest("You cannot delete your own admin account")
    }
    if (target.status !== "deleted" && !target.deleted_at) {
      return badRequest("Move account to trash first, then permanently delete")
    }
    const { rows } = await query(
      `DELETE FROM users WHERE id = $1 RETURNING id, email, display_name`,
      [id],
    )
    if (!rows[0]) return badRequest("User not found")
    return Response.json({ ok: true, deleted: rows[0], permanent: true })
  }

  // Block other actions on trashed accounts
  if (target.status === "deleted" || target.deleted_at) {
    return badRequest("Restore the account from trash before modifying it")
  }

  if (b.action === "approve") {
    if (!canApprove) return unauthorized()
    const gate = canApproveTarget(actor, target)
    if (!gate.ok) return unauthorized(gate.error)
    const approved = await approveAccountWithAudit(id, {
      id: Number(actor.id),
      display_name: actor.display_name,
      role: actor.role,
    })
    if (!approved) return badRequest("Pending user not found (already processed?)")
    if (approved.role === "student" && approved.reg_no) {
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
    return Response.json({
      ok: true,
      user: approved,
      approved_by: {
        id: actor.id,
        name: actor.display_name,
        role: actor.role,
      },
    })
  }

  if (b.action === "reject") {
    if (!canApprove) return unauthorized()
    const gate = canApproveTarget(actor, target)
    if (!gate.ok) return unauthorized(gate.error)
    if (Number(target.id) === Number(actor.id)) {
      return badRequest("You cannot reject your own account")
    }
    const rejected = await rejectAccountWithAudit(id, {
      id: Number(actor.id),
      display_name: actor.display_name,
      role: actor.role,
    })
    if (!rejected) return badRequest("Pending user not found (already processed?)")
    // Ensure they cannot remain signed in if a session somehow exists
    await clearUserSessions(id)
    return Response.json({
      ok: true,
      user: rejected,
      rejected_by: {
        id: actor.id,
        name: actor.display_name,
        role: actor.role,
      },
    })
  }

  // Remaining admin-only account management
  if (!isAdmin) {
    return unauthorized("Only Root Admin can perform this account action")
  }

  if (b.action === "set_status") {
    if (!["approved", "rejected", "pending"].includes(b.status)) {
      return badRequest("status must be approved|rejected|pending")
    }
    if (Number(target.id) === Number(actor.id) && b.status !== "approved") {
      return badRequest("You cannot disable your own admin account")
    }
    const { rows } = await query(
      `UPDATE users SET status = $2 WHERE id = $1
       RETURNING id, email, role, status`,
      [id, b.status],
    )
    // Deactivate / return to pending must immediately end any live sessions
    if (b.status !== "approved") {
      await clearUserSessions(id)
    }
    return Response.json({ ok: true, user: rows[0] })
  }

  if (b.action === "reset_password") {
    const newPassword = String(b.newPassword || "TemporaryPassword123!")
    if (newPassword.length < 8) return badRequest("Password must be at least 8 characters")
    const hash = await hashPassword(newPassword)
    await query(
      `UPDATE users SET password_hash = $1, force_password_change = TRUE WHERE id = $2`,
      [hash, id],
    )
    return Response.json({
      ok: true,
      message: "Password reset. User must change it on next login.",
      temporary_password: b.newPassword ? undefined : newPassword,
    })
  }

  if (b.action === "update") {
    const displayName = b.display_name != null ? String(b.display_name).trim() : null
    const branch = b.branch != null ? normalizeBranch(String(b.branch)) : null
    const regNo = b.reg_no != null ? String(b.reg_no).trim() || null : undefined
    if (displayName) {
      await query(`UPDATE users SET display_name = $1 WHERE id = $2`, [displayName, id])
    }
    if (branch !== null) {
      await query(`UPDATE users SET branch = $1 WHERE id = $2`, [branch, id])
    }
    if (regNo !== undefined) {
      await query(`UPDATE users SET reg_no = $1 WHERE id = $2`, [regNo, id])
    }
    const { rows } = await query(
      `SELECT id, email, role, display_name, reg_no, branch, status FROM users WHERE id = $1`,
      [id],
    )
    return Response.json({ ok: true, user: rows[0] })
  }

  return badRequest("Unknown action")
}

export async function PATCH(req: Request) {
  return mutateUsers(req)
}

/** POST fallback for environments that block PATCH */
export async function POST(req: Request) {
  return mutateUsers(req)
}

export async function DELETE(req: Request) {
  const admin = await requireRole("admin")
  if (!admin) return unauthorized()

  const { searchParams } = new URL(req.url)
  const id = Number(searchParams.get("id"))
  const hard = searchParams.get("hard") === "1"
  if (!Number.isFinite(id)) return badRequest("id is required")

  if (hard) {
    // Permanent delete from trash only
    const { rows: t } = await query(`SELECT id, status, deleted_at FROM users WHERE id = $1`, [id])
    if (!t[0]) return badRequest("User not found")
    if (Number(id) === Number(admin.id)) return badRequest("You cannot delete your own admin account")
    if (t[0].status !== "deleted" && !t[0].deleted_at) {
      return badRequest("Move to trash first, then permanently delete")
    }
    const { rows } = await query(
      `DELETE FROM users WHERE id = $1 RETURNING id, email, display_name`,
      [id],
    )
    return Response.json({ ok: true, deleted: rows[0], permanent: true })
  }

  // Soft-delete (undoable)
  const r = await softDeleteUser(id, Number(admin.id))
  if ("error" in r && r.error) return badRequest(r.error)
  return Response.json({ ok: true, user: r.user, soft: true })
}
