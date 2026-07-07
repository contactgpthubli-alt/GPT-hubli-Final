import { query } from "@/lib/db"
import { hashPassword, badRequest } from "@/lib/auth"

const ALLOWED_ROLES = [
  "student",
  "faculty",
  "principal",
  "admin",
  "hod",
  "registrar",
  "acm",
  "exam",
  "est",
  "library",
  "placement",
  "nss",
  "yrc",
  "alumni",
  "sports",
  "welfare",
  "cash",
  "accounts",
  "stores",
  "studentassoc",
]

// Faculty/office registration forms don't collect a password — a default is
// assigned and the user must change it on first login after approval.
const DEFAULT_PASSWORD = "TemporaryPassword123!"

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body?.email || !body?.name) {
    return badRequest("Name and email are required")
  }
  const usedDefaultPassword = !body.password
  const password = String(body.password || DEFAULT_PASSWORD)
  if (password.length < 8) {
    return badRequest("Password must be at least 8 characters")
  }
  const role = ALLOWED_ROLES.includes(body.role) ? body.role : "student"

  const existing = await query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [body.email])
  if (existing.rowCount > 0) {
    return Response.json({ error: "An account with this email already exists" }, { status: 409 })
  }

  const passwordHash = await hashPassword(password)
  await query(
    `INSERT INTO users (email, password_hash, role, display_name, reg_no, status, force_password_change)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
    [body.email, passwordHash, role, body.name, body.regNo ?? null, usedDefaultPassword],
  )
  return Response.json({
    ok: true,
    message:
      "Registration submitted. An admin must approve your account before you can log in." +
      (usedDefaultPassword ? " A temporary password will be assigned after approval and must be changed on first login." : ""),
  })
}
