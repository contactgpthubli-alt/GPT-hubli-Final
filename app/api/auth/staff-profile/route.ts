import { query } from "@/lib/db"
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"

/** Desk roles that share static accounts and need "who is using this seat" profile. */
const DESK_PROFILE_ROLES = ["principal", "hod", "acm", "exam"] as const

async function ensureStaffProfileColumns() {
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS qualification TEXT`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS designation TEXT`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile TEXT`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kgid TEXT`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS home_address TEXT`)
}

function profileFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    display_name: row.display_name || "",
    qualification: row.qualification || "",
    designation: row.designation || "",
    mobile: row.mobile || "",
    kgid: row.kgid || "",
    home_address: row.home_address || "",
    branch: row.branch || null,
  }
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  try {
    await ensureStaffProfileColumns()
  } catch (e) {
    console.warn("[staff-profile] ensure columns", e)
  }

  const { rows } = await query(
    `SELECT id, email, role, display_name, qualification, designation, mobile, kgid, home_address, branch
       FROM users WHERE id = $1`,
    [user.id],
  )
  const row = rows[0]
  if (!row) return unauthorized()

  return Response.json(
    {
      profile: profileFromRow(row),
      can_edit: DESK_PROFILE_ROLES.includes(row.role as (typeof DESK_PROFILE_ROLES)[number]) ||
        ["admin", "faculty"].includes(String(row.role)),
      required: ["display_name", "qualification", "designation"],
      optional: ["mobile", "kgid", "home_address"],
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  // Any logged-in staff can update their own seat profile
  if (user.role === "student") {
    return badRequest("Students use My Profile on the student portal.")
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body")

  const display_name = String(body.display_name ?? body.name ?? "").trim()
  const qualification = String(body.qualification ?? "").trim()
  const designation = String(body.designation ?? "").trim()
  const mobile = String(body.mobile ?? "").trim()
  const kgid = String(body.kgid ?? "").trim()
  const home_address = String(body.home_address ?? body.address ?? "").trim()

  if (!display_name) return badRequest("Name is required")
  if (!qualification) return badRequest("Qualification is required")
  if (!designation) return badRequest("Designation is required")

  if (mobile && !/^\d{10}$/.test(mobile.replace(/\s+/g, ""))) {
    // allow optional formatting; soft check 10 digits if provided
    const digits = mobile.replace(/\D/g, "")
    if (digits.length > 0 && digits.length !== 10) {
      return badRequest("Mobile number must be 10 digits when provided")
    }
  }

  try {
    await ensureStaffProfileColumns()
  } catch (e) {
    console.warn("[staff-profile] ensure columns", e)
  }

  const mobileClean = mobile.replace(/\D/g, "").slice(0, 15) || null

  const { rows } = await query(
    `UPDATE users SET
        display_name = $2,
        qualification = $3,
        designation = $4,
        mobile = $5,
        kgid = $6,
        home_address = $7
      WHERE id = $1
      RETURNING id, email, role, display_name, qualification, designation, mobile, kgid, home_address, branch`,
    [
      user.id,
      display_name,
      qualification,
      designation,
      mobileClean,
      kgid || null,
      home_address || null,
    ],
  )

  const row = rows[0]
  return Response.json({
    ok: true,
    profile: profileFromRow(row),
  })
}
