import { query } from "@/lib/db"
import { hashPassword, badRequest } from "@/lib/auth"
import { isOfficialBranch, normalizeBranch } from "@/lib/branches"

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

  let branch: string | null = normalizeBranch(body.branch ?? body.dept ?? null)
  // Staff/office free-text department (ACM, EST, Library, …) when not an official diploma branch
  if (!branch && body.branch) {
    const raw = String(body.branch).replace(/\s+/g, " ").trim()
    if (raw) branch = raw
  }

  // Username for staff login (stored in reg_no). Students use register number.
  const usernameRaw =
    body.username != null
      ? String(body.username).trim()
      : body.userName != null
        ? String(body.userName).trim()
        : ""
  let regNo: string | null =
    body.regNo != null && String(body.regNo).trim()
      ? String(body.regNo).trim()
      : usernameRaw
        ? usernameRaw
        : null

  if (role === "student") {
    if (!regNo) return badRequest("Register Number is required for students")
    regNo = regNo.toUpperCase()
    if (!branch || !isOfficialBranch(branch)) {
      return badRequest(
        "Please select a valid Branch: Civil Engineering, Computer Science and Engineering, Electronics and Communication Engineering, or Mechanical Engineering",
      )
    }
    // Block double registration on the same register number
    const regTaken = await query(
      `SELECT 1 FROM users
        WHERE deleted_at IS NULL AND upper(reg_no) = upper($1)
        LIMIT 1`,
      [regNo],
    )
    if (regTaken.rowCount > 0) {
      return Response.json(
        { error: "An account with this Register Number already exists. Please sign in instead." },
        { status: 409 },
      )
    }
  } else if (regNo) {
    // Staff username: keep as typed (case-insensitive login match)
    regNo = regNo.trim()
    // Reject if username already taken (reg_no or email local-part collision)
    const taken = await query(
      `SELECT 1 FROM users
        WHERE deleted_at IS NULL
          AND (
            lower(reg_no) = lower($1)
            OR lower(split_part(email, '@', 1)) = lower($1)
          )
        LIMIT 1`,
      [regNo],
    )
    if (taken.rowCount > 0) {
      return Response.json({ error: "This username is already taken" }, { status: 409 })
    }
  }

  const existing = await query(
    `SELECT 1 FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
    [body.email],
  )
  if (existing.rowCount > 0) {
    return Response.json({ error: "An account with this email already exists" }, { status: 409 })
  }

  const passwordHash = await hashPassword(password)
  // Always insert as pending — login is blocked until Root Admin approves.
  // Never create a session here.
  const { rows: created } = await query(
    `INSERT INTO users (email, password_hash, role, display_name, reg_no, branch, status, force_password_change)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
     RETURNING id, email, role, display_name, reg_no, status`,
    [
      body.email,
      passwordHash,
      role,
      body.name,
      regNo,
      branch,
      usedDefaultPassword,
    ],
  )
  const u = created[0]
  return Response.json({
    ok: true,
    status: "pending",
    user: u
      ? {
          id: u.id,
          email: u.email,
          role: u.role,
          display_name: u.display_name,
          reg_no: u.reg_no,
          status: u.status,
        }
      : undefined,
    message:
      "Registration submitted. An admin must approve your account before you can log in." +
      (usedDefaultPassword
        ? " A temporary password will be assigned after approval and must be changed on first login."
        : ""),
  })
}
