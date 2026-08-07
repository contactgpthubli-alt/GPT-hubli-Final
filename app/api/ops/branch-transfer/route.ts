import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import { hodBranchOf, branchesMatch } from "@/lib/account-approvals"
import { normalizeBranch } from "@/lib/branches"
import {
  ensureStudentOpsSchema,
  acceptBranchTransfer,
  canWriteBranchTransfer,
  OPS_TRANSFER_READ_ROLES,
} from "@/lib/student-ops"

function canRead(role: string) {
  return (OPS_TRANSFER_READ_ROLES as readonly string[]).includes(role)
}

/**
 * GET — list transfers (ACM/Exam/HOD/Principal/Admin). ACM read-only.
 * POST — create transfer draft / release
 *   { action: 'create'|'release'|'accept'|'cancel', ... }
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canRead(user.role)) return unauthorized()
  await ensureStudentOpsSchema()

  const url = new URL(req.url)
  const status = (url.searchParams.get("status") || "").trim()
  const params: unknown[] = []
  let sql = `SELECT * FROM branch_transfers WHERE 1=1`
  if (status) {
    params.push(status)
    sql += ` AND status = $${params.length}`
  }
  if (user.role === "hod") {
    const my = hodBranchOf(user)
    if (my) {
      params.push(`%${my.toLowerCase()}%`)
      // see transfers out of or into my branch
      sql += ` AND (lower(from_branch) LIKE $${params.length} OR lower(to_branch) LIKE $${params.length})`
    }
  }
  sql += ` ORDER BY updated_at DESC LIMIT 500`
  const { rows } = await query(sql, params)
  return Response.json({
    transfers: rows,
    can_write: canWriteBranchTransfer(user.role),
    // ACM has full write like HOD for academic documentation
    read_only: false,
  })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canRead(user.role)) return unauthorized()
  await ensureStudentOpsSchema()

  const b = await req.json().catch(() => null)
  if (!b?.action) return badRequest("action required")
  const action = String(b.action).toLowerCase()

  if (!canWriteBranchTransfer(user.role) && action !== "list") {
    return unauthorized("Not allowed to change branch transfers")
  }

  if (action === "create") {
    const oldReg = String(b.old_reg_no || b.reg_no || "")
      .trim()
      .toUpperCase()
    const newReg = String(b.new_reg_no || "")
      .trim()
      .toUpperCase()
    const toBranch = normalizeBranch(b.to_branch) || String(b.to_branch || "").trim()
    if (!oldReg || !newReg || !toBranch) {
      return badRequest("old_reg_no, new_reg_no and to_branch are required")
    }
    if (!/^[A-Z0-9]{8,20}$/i.test(newReg)) {
      return badRequest("new_reg_no looks invalid")
    }

    const { rows: st } = await query(
      `SELECT reg_no, name, dept FROM students WHERE UPPER(reg_no)=$1`,
      [oldReg],
    )
    if (!st[0]) return badRequest("Student not found for old register number")
    const fromBranch = normalizeBranch(st[0].dept) || String(st[0].dept || "")

    if (user.role === "hod") {
      const my = hodBranchOf(user)
      if (!my || !branchesMatch(my, fromBranch)) {
        return badRequest("HOD can only create transfer for students in your branch")
      }
    }

    const { rows: clash } = await query(
      `SELECT reg_no, name FROM students WHERE UPPER(reg_no)=$1 AND UPPER(reg_no)<>$2`,
      [newReg, oldReg],
    )
    if (clash[0]) {
      return badRequest(`New reg ${newReg} already used by ${clash[0].name}`)
    }

    const { rows } = await query(
      `INSERT INTO branch_transfers (
         old_reg_no, new_reg_no, student_name, from_branch, to_branch, status, notes,
         created_by, created_by_name
       ) VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8)
       RETURNING *`,
      [
        oldReg,
        newReg,
        st[0].name,
        fromBranch,
        toBranch,
        b.notes != null ? String(b.notes) : null,
        user.id,
        user.display_name || user.role,
      ],
    )
    return Response.json({
      ok: true,
      transfer: rows[0],
      by: user.display_name,
      by_role: user.role,
      at: new Date().toISOString(),
    })
  }

  if (action === "release") {
    const id = Number(b.id || b.transfer_id)
    if (!id) return badRequest("id required")
    const { rows } = await query(`SELECT * FROM branch_transfers WHERE id=$1`, [id])
    const t = rows[0]
    if (!t) return badRequest("Transfer not found")
    if (t.status !== "draft" && t.status !== "released") {
      return badRequest("Only draft transfers can be released")
    }
    if (user.role === "hod") {
      const my = hodBranchOf(user)
      if (!my || !branchesMatch(my, t.from_branch)) {
        return badRequest("Only outgoing branch HOD (or Exam/Admin/Principal) can release")
      }
    }
    const { rows: up } = await query(
      `UPDATE branch_transfers SET
         status = 'released',
         released_by = $2,
         released_by_name = $3,
         released_at = now(),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, user.id, user.display_name || user.role],
    )
    return Response.json({
      ok: true,
      transfer: up[0],
      by: user.display_name,
      by_role: user.role,
      at: new Date().toISOString(),
    })
  }

  if (action === "accept") {
    const id = Number(b.id || b.transfer_id)
    if (!id) return badRequest("id required")
    try {
      await acceptBranchTransfer(id, {
        id: user.id,
        role: user.role,
        display_name: user.display_name,
        branch: user.branch,
      })
    } catch (e) {
      return badRequest(e instanceof Error ? e.message : "Accept failed")
    }
    const { rows } = await query(`SELECT * FROM branch_transfers WHERE id=$1`, [id])
    return Response.json({
      ok: true,
      transfer: rows[0],
      by: user.display_name,
      by_role: user.role,
      at: new Date().toISOString(),
    })
  }

  if (action === "cancel") {
    const id = Number(b.id || b.transfer_id)
    if (!id) return badRequest("id required")
    const { rows: up } = await query(
      `UPDATE branch_transfers SET
         status = 'cancelled',
         cancelled_by = $2,
         cancelled_by_name = $3,
         cancelled_at = now(),
         cancel_reason = $4,
         updated_at = now()
       WHERE id = $1 AND status IN ('draft','released')
       RETURNING *`,
      [id, user.id, user.display_name || user.role, b.reason != null ? String(b.reason) : null],
    )
    if (!up[0]) return badRequest("Cannot cancel this transfer")
    return Response.json({
      ok: true,
      transfer: up[0],
      by: user.display_name,
      by_role: user.role,
      at: new Date().toISOString(),
    })
  }

  return badRequest("Unknown action")
}
