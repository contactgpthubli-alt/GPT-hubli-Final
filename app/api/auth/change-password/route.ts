import { query } from "@/lib/db"
import { getCurrentUser, hashPassword, verifyPassword, unauthorized, badRequest } from "@/lib/auth"

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => null)
  if (!body?.currentPassword || !body?.newPassword) {
    return badRequest("Current and new password are required")
  }
  if (String(body.newPassword).length < 8) {
    return badRequest("New password must be at least 8 characters")
  }

  const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [user.id])
  if (!rows[0] || !(await verifyPassword(body.currentPassword, rows[0].password_hash))) {
    return Response.json({ error: "Current password is incorrect" }, { status: 403 })
  }

  const newHash = await hashPassword(String(body.newPassword))
  await query("UPDATE users SET password_hash = $1, force_password_change = FALSE WHERE id = $2", [newHash, user.id])
  return Response.json({ ok: true })
}
