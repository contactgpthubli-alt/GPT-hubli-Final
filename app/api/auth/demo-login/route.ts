import { query } from "@/lib/db"
import { createSession, badRequest } from "@/lib/auth"

/**
 * Instant session for seeded demo accounts (is_demo = TRUE).
 * Disabled unless NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true.
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN !== "true") {
    return Response.json({ error: "Demo login is disabled" }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => null)
    const role = body?.role ? String(body.role) : ""
    if (!role) return badRequest("Role is required")

    const { rows } = await query(
      `SELECT id, email, role, display_name, reg_no, force_password_change, is_demo
         FROM users
        WHERE is_demo = TRUE AND role = $1 AND status = 'approved'
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
  } catch (err) {
    console.error("[demo-login]", err)
    return Response.json(
      { error: "Login service unavailable. Check server/database configuration." },
      { status: 500 },
    )
  }
}
