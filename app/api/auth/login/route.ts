import { query } from "@/lib/db"
import { verifyPassword, createSession, badRequest } from "@/lib/auth"

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body?.email || !body?.password) return badRequest("Email and password are required")

  // Accept full email, email local-part (e.g. "admin"), or a student
  // registration number as the login identifier.
  const { rows } = await query(
    `SELECT id, email, password_hash, role, display_name, reg_no, status, force_password_change, is_demo
       FROM users
      WHERE lower(email) = lower($1)
         OR lower(split_part(email, '@', 1)) = lower($1)
         OR (reg_no IS NOT NULL AND upper(reg_no) = upper($1))
      ORDER BY (lower(email) = lower($1)) DESC
      LIMIT 1`,
    [body.email],
  )
  const user = rows[0]
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 })
  }
  if (user.status === "pending") {
    return Response.json({ error: "Your account is awaiting admin approval" }, { status: 403 })
  }
  if (user.status === "rejected") {
    return Response.json({ error: "Your registration was rejected. Contact the office." }, { status: 403 })
  }

  await createSession(user.id)
  return Response.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      display_name: user.display_name,
      reg_no: user.reg_no,
      force_password_change: user.force_password_change,
      is_demo: user.is_demo,
    },
  })
}
