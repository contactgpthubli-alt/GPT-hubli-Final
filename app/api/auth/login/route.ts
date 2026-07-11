import { query } from "@/lib/db"
import { verifyPassword, createSession, badRequest } from "@/lib/auth"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.email || !body?.password) {
      return badRequest("Email and password are required")
    }

    const identifier = String(body.email).trim()
    const password = String(body.password)

    // Accept full email, email local-part (e.g. "akshay"), student reg no,
    // or display_name (e.g. "Akshay") as the login identifier.
    const { rows } = await query(
      `SELECT id, email, password_hash, role, display_name, reg_no, status, force_password_change, is_demo
         FROM users
        WHERE lower(email) = lower($1)
           OR lower(split_part(email, '@', 1)) = lower($1)
           OR (reg_no IS NOT NULL AND upper(reg_no) = upper($1))
           OR lower(display_name) = lower($1)
        ORDER BY
          CASE
            WHEN lower(email) = lower($1) THEN 0
            WHEN lower(split_part(email, '@', 1)) = lower($1) THEN 1
            WHEN reg_no IS NOT NULL AND upper(reg_no) = upper($1) THEN 2
            ELSE 3
          END
        LIMIT 1`,
      [identifier],
    )

    const user = rows[0]
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 })
    }
    if (user.status === "pending") {
      return Response.json({ error: "Your account is awaiting admin approval" }, { status: 403 })
    }
    if (user.status === "rejected") {
      return Response.json(
        { error: "Your registration was rejected. Contact the office." },
        { status: 403 },
      )
    }
    if (user.status !== "approved") {
      return Response.json({ error: "Account is not active" }, { status: 403 })
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
    console.error("[login]", err)
    return Response.json(
      { error: "Login service unavailable. Check server/database configuration." },
      { status: 500 },
    )
  }
}
