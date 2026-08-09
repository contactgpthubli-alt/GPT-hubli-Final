import { query } from "@/lib/db"
import { createSession } from "@/lib/auth"

/**
 * Instant session for the single seeded student demo account (is_demo = TRUE).
 * Disabled unless NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true.
 * Only the student role is supported — multi-role demos were removed.
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN !== "true") {
    return Response.json({ error: "Demo login is disabled" }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => null)
    const role = body?.role ? String(body.role) : "student"
    if (role !== "student") {
      return Response.json(
        { error: "Only the student demo account is available" },
        { status: 404 },
      )
    }

    const { rows } = await query(
      `SELECT id, email, role, display_name, reg_no, force_password_change, is_demo
         FROM users
        WHERE is_demo = TRUE
          AND role = 'student'
          AND status = 'approved'
          AND deleted_at IS NULL
        ORDER BY id
        LIMIT 1`,
    )

    const user = rows[0]
    if (!user) {
      return Response.json(
        { error: "Student demo account not found. Run scripts/seed-demo-student.mjs" },
        { status: 404 },
      )
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
