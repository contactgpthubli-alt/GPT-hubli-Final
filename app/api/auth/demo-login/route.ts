import { query } from "@/lib/db"
import { createSession, badRequest } from "@/lib/auth"

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const role = body?.role

  if (!role) {
    return badRequest("Role is required")
  }

  // Find a demo user for the given role
  const { rows } = await query(
    `SELECT id, email, role, display_name, reg_no, force_password_change, is_demo
       FROM users
      WHERE is_demo = TRUE AND role = $1
      LIMIT 1`,
    [role],
  )

  const user = rows[0]

  if (!user) {
    return Response.json({ error: "Demo user for this role not found" }, { status: 404 })
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
