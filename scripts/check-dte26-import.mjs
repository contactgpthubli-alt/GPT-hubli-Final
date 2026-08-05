import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
function env(f) {
  if (!existsSync(f)) return {}
  const o = {}
  for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = l.trim()
    if (!t || t.startsWith("#")) continue
    const e = t.indexOf("=")
    if (e < 0) continue
    let v = t.slice(e + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    o[t.slice(0, e).trim()] = v
  }
  return o
}
const e = { ...env(path.join(root, ".env")), ...env(path.join(root, ".env.local")), ...process.env }
const url = e.DATABASE_URL || e.POSTGRES_URL
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const u = await c.query(
  `SELECT count(*)::int n FROM users WHERE role='student' AND reg_no LIKE 'DTE26%' AND deleted_at IS NULL`,
)
const s = await c.query(`SELECT count(*)::int n FROM students WHERE reg_no LIKE 'DTE26%'`)
const by = await c.query(
  `SELECT dept, count(*)::int n FROM students WHERE reg_no LIKE 'DTE26%' GROUP BY dept ORDER BY dept`,
)
const force = await c.query(
  `SELECT count(*)::int n FROM users WHERE role='student' AND reg_no LIKE 'DTE26%' AND force_password_change = TRUE`,
)
console.log({ users: u.rows[0].n, students: s.rows[0].n, force_pw: force.rows[0].n, by_dept: by.rows })
await c.end()
