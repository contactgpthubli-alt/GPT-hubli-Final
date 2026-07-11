import { getPool, query } from "@/lib/db"
import { requireRole, getCurrentUser, unauthorized, badRequest } from "@/lib/auth"

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

  const { rows } = await query(
    `INSERT INTO profile_requests (requester_id, target_type, target_id, changes)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, target_type, target_id, changes, status, created_at`,
    [user.id, b.targetType, String(b.targetId), JSON.stringify(b.changes)],
  )
  return Response.json({ ok: true, request: rows[0] })
}

// Admin or HOD can view pending requests.
export async function GET() {
  const user = await requireRole("admin", "hod")
  if (!user) return unauthorized()

  const { rows } = await query(
    `SELECT pr.id, pr.target_type, pr.target_id, pr.changes, pr.status,
            pr.remarks, pr.created_at,
            u.display_name AS requester_name, u.role AS requester_role, u.email AS requester_email
       FROM profile_requests pr
       JOIN users u ON u.id = pr.requester_id
      WHERE pr.status = 'pending'
      ORDER BY pr.created_at`,
  )
  return Response.json({ pending: rows })
}

// Admin or HOD approves/rejects a request.
export async function PATCH(req: Request) {
  const user = await requireRole("admin", "hod")
  if (!user) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b?.id || !["approved", "rejected"].includes(b.action)) {
    return badRequest("id and action (approved|rejected) are required")
  }

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
      if (reqRow.target_type === "student") {
        await client.query(
          `UPDATE students SET extra = COALESCE(extra, '{}'::jsonb) || $1::jsonb WHERE reg_no = $2`,
          [JSON.stringify(reqRow.changes), reqRow.target_id],
        )
      } else {
        await client.query(
          `UPDATE staff SET extra = COALESCE(extra, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
          [JSON.stringify(reqRow.changes), Number(reqRow.target_id)],
        )
      }
    }

    await client.query("COMMIT")
    return Response.json({ ok: true, request: reqRow })
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
