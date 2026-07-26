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

/** Insert one in-app notification for a user (student or staff account). */
export async function createUserNotification(input: {
  userId: number
  title: string
  body?: string
  kind?: string
  meta?: Record<string, unknown>
}): Promise<number | null> {
  await ensureAccountApprovalSchema()
  const uid = Number(input.userId)
  if (!Number.isFinite(uid) || uid <= 0) return null
  try {
    const { rows } = await query(
      `INSERT INTO user_notifications (user_id, title, body, kind, meta)
       VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))
       RETURNING id`,
      [
        uid,
        String(input.title || "Notification").slice(0, 200),
        String(input.body || ""),
        String(input.kind || "info").slice(0, 64),
        JSON.stringify(input.meta || {}),
      ],
    )
    return rows[0]?.id != null ? Number(rows[0].id) : null
  } catch (e) {
    console.error("[user-notifications] create failed", e)
    return null
  }
}

/**
 * Notify student account (and parent-facing copy) that they were marked absent.
 * Same login is used for Student/Parent app modes — one user_id, two notification kinds.
 */

/** Normalize any date-ish value to YYYY-MM-DD (never rely on Date string slice). */
export function toCanonicalDate(input?: string | Date | null): string {
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    // Use UTC for pg DATE (stored as UTC midnight)
    const y = input.getUTCFullYear()
    const m = String(input.getUTCMonth() + 1).padStart(2, "0")
    const d = String(input.getUTCDate()).padStart(2, "0")
    // Guard absurd years from bad parses
    if (y >= 2015 && y <= 2040) return `${y}-${m}-${d}`
  }
  const s = String(input ?? "").trim()
  // YYYY-MM-DD or ISO
  let m = s.match(/^(20\d{2})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // DD-MM-YYYY or DD/MM/YYYY
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})$/)
  if (m) {
    const da = m[1].padStart(2, "0")
    const mo = m[2].padStart(2, "0")
    return `${m[3]}-${mo}-${da}`
  }
  // Fallback: today (IST-ish via local)
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, "0")
  const da = String(now.getDate()).padStart(2, "0")
  return `${y}-${mo}-${da}`
}

/** Format time for notifications — accepts HH:mm, HH:mm:ss; fallback now (en-IN 12h). */
export function formatAttTime(input?: string | null): string {
  const raw = String(input || "").trim()
  if (raw) {
    const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (m) {
      let h = Number(m[1])
      const min = m[2]
      if (h >= 0 && h <= 23) {
        const ampm = h >= 12 ? "PM" : "AM"
        const h12 = h % 12 === 0 ? 12 : h % 12
        return `${h12}:${min} ${ampm}`
      }
    }
  }
  const now = new Date()
  let h = now.getHours()
  const min = String(now.getMinutes()).padStart(2, "0")
  const ampm = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${min} ${ampm}`
}

/** Display date DD-MM-YYYY for India (never ambiguous Date.parse). */
export function formatAttDateLabel(input?: string | Date | null): string {
  const iso = toCanonicalDate(input)
  const [y, mo, da] = iso.split("-")
  return `${da}-${mo}-${y}`
}

export async function notifyStudentAbsent(input: {
  regNo: string
  studentName?: string | null
  subject: string
  attDate: string
  /** Session time e.g. 15:32 or 03:32 PM */
  attTime?: string | null
  branch?: string | null
  batch?: string | null
  markedByName?: string | null
}): Promise<{ student: boolean; parent: boolean }> {
  await ensureAccountApprovalSchema()
  const reg = String(input.regNo || "").trim().toUpperCase()
  if (!reg) return { student: false, parent: false }

  const { rows: users } = await query(
    `SELECT id, display_name FROM users
      WHERE role = 'student' AND deleted_at IS NULL
        AND upper(reg_no) = $1
      LIMIT 1`,
    [reg],
  )
  const u = users[0]
  if (!u) return { student: false, parent: false }

  const name = String(input.studentName || u.display_name || reg).trim()
  const isoDate = toCanonicalDate(input.attDate)
  const dateLabel = formatAttDateLabel(isoDate)
  const timeLabel = formatAttTime(input.attTime)
  const subj = String(input.subject || "Class").trim()
  const batchPart = input.batch ? ` · ${input.batch}` : ""
  const byStaff = input.markedByName
    ? `marked by ${String(input.markedByName).trim()}`
    : "marked by staff"

  // Canonical line: Absent: [Subject] on [date] at [time] · marked by staff
  const coreLine = `Absent: ${subj} on ${dateLabel} at ${timeLabel}${batchPart} · ${byStaff}`

  const studentTitle = "⚠️ Marked Absent"
  const studentBody = coreLine

  const parentTitle = "⚠️ Your ward is Absent"
  const parentBody = `${name} (${reg}) — ${coreLine}`

  const meta = {
    reg_no: reg,
    subject: subj,
    att_date: isoDate,
    att_time: timeLabel,
    branch: input.branch || null,
    batch: input.batch || null,
    marked_by: input.markedByName || "staff",
    audience: "both",
  }

  const sId = await createUserNotification({
    userId: Number(u.id),
    title: studentTitle,
    body: studentBody,
    kind: "attendance_absent",
    meta: { ...meta, for: "student" },
  })
  const pId = await createUserNotification({
    userId: Number(u.id),
    title: parentTitle,
    body: parentBody,
    kind: "attendance_absent_parent",
    meta: { ...meta, for: "parent" },
  })

  return { student: sId != null, parent: pId != null }
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
