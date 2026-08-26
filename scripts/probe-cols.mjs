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
const r = await c.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='student_exam_attempts' ORDER BY 1`,
)
console.log(r.rows.map((x) => x.column_name).join(", "))
await c.end()
