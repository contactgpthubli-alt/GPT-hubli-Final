import { query } from "@/lib/db"
import {
  getCurrentUser,
  hashPassword,
  verifyPassword,
  unauthorized,
  badRequest,
} from "@/lib/auth"

/**
 * First-time student setup (no OTP):
 * After first password login with a temporary password, the student must set
 * a real email and a new password before using the rest of the portal.
 *
 * Body: { email, newPassword, currentPassword }
 */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  if (user.role !== "student") {
    return Response.json(
      { error: "First-time setup is only for student accounts" },
      { status: 403 },
    )
  }

  if (!user.force_password_change) {
    return Response.json(
      { error: "Account setup is already complete. Use Change Password if needed." },
      { status: 400 },
    )
  }

  const body = await req.json().catch(() => null)
  const email = String(body?.email || "")
    .trim()
    .toLowerCase()
  const newPassword = String(body?.newPassword || "")
  const currentPassword = String(body?.currentPassword || "")

  if (!email || !newPassword || !currentPassword) {
    return badRequest("Email, current password, and new password are required")
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return badRequest("Enter a valid email address")
  }
  if (newPassword.length < 8) {
    return badRequest("New password must be at least 8 characters")
  }
  if (newPassword === currentPassword) {
    return badRequest("New password must be different from the temporary password")
  }

  const { rows } = await query(
    `SELECT id, email, password_hash, force_password_change
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [user.id],
  )
  const row = rows[0]
  if (!row) return unauthorized()
  if (!row.force_password_change) {
    return badRequest("Account setup is already complete")
  }
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    return Response.json({ error: "Current password is incorrect" }, { status: 403 })
  }

  // Email must be unique across active accounts
  const taken = await query(
    `SELECT id FROM users
      WHERE lower(email) = lower($1)
        AND id <> $2
        AND deleted_at IS NULL
      LIMIT 1`,
    [email, user.id],
  )
  if ((taken.rowCount || 0) > 0) {
    return Response.json(
      { error: "This email is already used by another account" },
      { status: 409 },
    )
  }

  const newHash = await hashPassword(newPassword)
  const { rows: updated } = await query(
    `UPDATE users
        SET email = $1,
            password_hash = $2,
            force_password_change = FALSE
      WHERE id = $3
      RETURNING id, email, role, display_name, reg_no, force_password_change, is_demo`,
    [email, newHash, user.id],
  )

  const u = updated[0]
  return Response.json({
    ok: true,
    message: "Email and password updated. You can use the student app now.",
    user: {
      id: u.id,
      email: u.email,
      role: u.role,
      display_name: u.display_name,
      reg_no: u.reg_no,
      force_password_change: !!u.force_password_change,
      is_demo: !!u.is_demo,
      requires_setup: false,
    },
  })
}
