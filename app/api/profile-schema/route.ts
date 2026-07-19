import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"

const KEY_STUDENT = "student"

function asSchema(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value
}

/** Anyone logged in can read the student form schema (students need it for My Profile). */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const key = (searchParams.get("key") || KEY_STUDENT).trim() || KEY_STUDENT

  const { rows } = await query(
    `SELECT key, schema_json, updated_at FROM profile_schemas WHERE key = $1 LIMIT 1`,
    [key],
  )

  if (!rows.length) {
    return Response.json(
      { key, schema: null, source: "default" },
      { headers: { "Cache-Control": "no-store" } },
    )
  }

  return Response.json(
    {
      key: rows[0].key,
      schema: asSchema(rows[0].schema_json),
      updated_at: rows[0].updated_at,
      source: "database",
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

/**
 * Admin saves the Google Form–style student My Profile structure.
 * Body: { key?: 'student', schema: Section[] }
 */
export async function PUT(req: Request) {
  const user = await requireRole("admin")
  if (!user) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b || !Array.isArray(b.schema)) {
    return badRequest("schema (array of sections) is required")
  }

  const key = String(b.key || KEY_STUDENT).trim() || KEY_STUDENT
  if (key !== KEY_STUDENT) {
    return badRequest("Only student schema is supported for now")
  }

  // Light validation
  for (const sec of b.schema) {
    if (!sec || typeof sec !== "object") return badRequest("Invalid section")
    if (!sec.title || typeof sec.title !== "string") {
      return badRequest("Each section needs a title")
    }
    if (sec.fields != null && !Array.isArray(sec.fields)) {
      return badRequest("section.fields must be an array")
    }
  }

  await query(
    `INSERT INTO profile_schemas (key, schema_json, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE SET
       schema_json = EXCLUDED.schema_json,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(b.schema), user.id],
  )

  return Response.json({
    ok: true,
    key,
    schema: b.schema,
    message: "Student My Profile form saved. Students will see the new sections/fields.",
  })
}
