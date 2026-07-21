import { query } from "@/lib/db"

let schemaReady = false

/** Ensure audit columns + notifications table exist (safe on every deploy). */
export async function ensureAccountApprovalSchema(): Promise<void> {
  if (schemaReady) return
  try {
    await query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by BIGINT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by_name TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by_role TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_by BIGINT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_by_name TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_by_role TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
    `)
    await query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        kind       TEXT NOT NULL DEFAULT 'info',
        meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        read_at    TIMESTAMPTZ
      )
    `)
    await query(`
      CREATE INDEX IF NOT EXISTS idx_user_notifications_user
        ON user_notifications (user_id, created_at DESC)
    `)
    schemaReady = true
  } catch (e) {
    console.error("[user-notifications] ensure schema failed", e)
  }
}

export type ApproverInfo = {
  id: number
  display_name?: string | null
  role?: string | null
}

export type ApprovedUserRow = {
  id: number
  email: string
  role: string
  display_name: string
  reg_no: string | null
  branch: string | null
  status: string
  approved_by: number | null
  approved_by_name: string | null
  approved_by_role: string | null
  approved_at: string | null
}

export function formatApproverLabel(actor: ApproverInfo): string {
  const name = String(actor.display_name || "").trim() || "Staff"
  const role = String(actor.role || "").trim().toLowerCase()
  const roleLabel =
    role === "admin"
      ? "Root Admin"
      : role === "principal"
        ? "Principal"
        : role === "hod"
          ? "HOD"
          : role
            ? role.toUpperCase()
            : "Approver"
  return `${name} (${roleLabel})`
}

/**
 * Approve a pending account, store who approved it, and send an in-app notification
 * the student will see in the mobile/web app on next login.
 */
export async function approveAccountWithAudit(
  targetUserId: number,
  actor: ApproverInfo,
): Promise<ApprovedUserRow | null> {
  await ensureAccountApprovalSchema()
  const label = formatApproverLabel(actor)
  const { rows } = await query(
    `UPDATE users
        SET status = 'approved',
            approved_by = $2,
            approved_by_name = $3,
            approved_by_role = $4,
            approved_at = now(),
            rejected_by = NULL,
            rejected_by_name = NULL,
            rejected_by_role = NULL,
            rejected_at = NULL
      WHERE id = $1 AND status = 'pending' AND deleted_at IS NULL
      RETURNING id, email, role, display_name, reg_no, branch, status,
                approved_by, approved_by_name, approved_by_role, approved_at`,
    [targetUserId, actor.id, String(actor.display_name || label), String(actor.role || "")],
  )
  const approved = (rows[0] as ApprovedUserRow) || null
  if (!approved) return null

  const isStudent = String(approved.role || "").toLowerCase() === "student"
  const title = "✅ Account Approved"
  const body = isStudent
    ? `Your student account has been approved by ${label}. You can now log in to the GPT Hubli Student app and portal.`
    : `Your account has been approved by ${label}. You can now log in to the GPT Hubli portal.`

  try {
    const { rows: existing } = await query(
      `SELECT id FROM user_notifications
        WHERE user_id = $1 AND kind = 'account_approved'
        LIMIT 1`,
      [targetUserId],
    )
    if (!existing[0]) {
      await query(
        `INSERT INTO user_notifications (user_id, title, body, kind, meta)
         VALUES ($1, $2, $3, 'account_approved', $4::jsonb)`,
        [
          targetUserId,
          title,
          body,
          JSON.stringify({
            approved_by: actor.id,
            approved_by_name: actor.display_name || null,
            approved_by_role: actor.role || null,
            approved_at: approved.approved_at,
          }),
        ],
      )
    }
  } catch (e) {
    console.error("[user-notifications] insert failed", e)
  }

  return approved
}

/** Reject a pending account and record who rejected it. */
export async function rejectAccountWithAudit(
  targetUserId: number,
  actor: ApproverInfo,
): Promise<{ id: number; email: string; role: string; status: string } | null> {
  await ensureAccountApprovalSchema()
  const { rows } = await query(
    `UPDATE users
        SET status = 'rejected',
            rejected_by = $2,
            rejected_by_name = $3,
            rejected_by_role = $4,
            rejected_at = now()
      WHERE id = $1 AND status = 'pending' AND deleted_at IS NULL
      RETURNING id, email, role, status`,
    [targetUserId, actor.id, String(actor.display_name || "Staff"), String(actor.role || "")],
  )
  return (rows[0] as { id: number; email: string; role: string; status: string }) || null
}

export async function listUserNotifications(
  userId: number,
  limit = 20,
): Promise<
  Array<{
    id: number
    title: string
    body: string
    kind: string
    created_at: string
    read_at: string | null
    meta?: unknown
  }>
> {
  await ensureAccountApprovalSchema()
  const { rows } = await query(
    `SELECT id, title, body, kind, created_at, read_at, meta
       FROM user_notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit],
  )
  return rows as Array<{
    id: number
    title: string
    body: string
    kind: string
    created_at: string
    read_at: string | null
    meta?: unknown
  }>
}

export async function markUserNotificationsRead(
  userId: number,
  ids?: number[],
): Promise<number> {
  await ensureAccountApprovalSchema()
  if (ids && ids.length) {
    const { rowCount } = await query(
      `UPDATE user_notifications
          SET read_at = COALESCE(read_at, now())
        WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
      [userId, ids],
    )
    return rowCount
  }
  const { rowCount } = await query(
    `UPDATE user_notifications
        SET read_at = COALESCE(read_at, now())
      WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  )
  return rowCount
}
