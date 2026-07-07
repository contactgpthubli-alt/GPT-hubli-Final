import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES, STUDENT_WRITERS } from "@/lib/roles"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (user.role === "student") {
    const { rows } = await query("SELECT * FROM students WHERE reg_no = $1", [user.reg_no])
    return Response.json({ students: rows })
  }
  if (!STAFF_ROLES.includes(user.role)) return unauthorized()
  const { rows } = await query("SELECT * FROM students ORDER BY reg_no")
  return Response.json({ students: rows })
}

export async function POST(req: Request) {
  const user = await requireRole(...STUDENT_WRITERS)
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.reg_no || !b?.name || !b?.dept) return badRequest("reg_no, name and dept are required")
  await query(
    `INSERT INTO students (reg_no, name, dept, year, cgpa, att, father, extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::jsonb,'{}'::jsonb))
     ON CONFLICT (reg_no) DO UPDATE SET
       name=EXCLUDED.name, dept=EXCLUDED.dept, year=EXCLUDED.year, cgpa=EXCLUDED.cgpa,
       att=EXCLUDED.att, father=EXCLUDED.father, extra=EXCLUDED.extra`,
    [b.reg_no, b.name, b.dept, b.year ?? null, b.cgpa ?? null, b.att ?? null, b.father ?? null, JSON.stringify(b.extra ?? {})],
  )
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const user = await requireRole("admin")
  if (!user) return unauthorized()
  const { searchParams } = new URL(req.url)
  const regNo = searchParams.get("reg_no")
  if (!regNo) return badRequest("reg_no is required")
  await query("DELETE FROM students WHERE reg_no = $1", [regNo])
  return Response.json({ ok: true })
}
