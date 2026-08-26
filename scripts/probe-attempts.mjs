import fs from "fs"
import pg from "pg"

for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, "utf8").split(/\n/)) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()
try {
  const r = await c.query(`
    SELECT status, COALESCE(attempt_kind, 'regular') AS kind, count(*)::int AS n
    FROM student_exam_attempts
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)
  console.log("by status/kind:", r.rows)
  const r2 = await c.query(`SELECT count(*)::int AS n FROM student_exam_attempts`)
  console.log("total:", r2.rows[0])
  const r3 = await c.query(`
    SELECT reg_no, status, subject_code, left(exam_session,40) as sess, COALESCE(attempt_kind,'regular') kind
    FROM student_exam_attempts
    ORDER BY id DESC LIMIT 12
  `)
  console.log("latest:", r3.rows)
} catch (e) {
  console.error("ERR", e.message)
}
await c.end()
