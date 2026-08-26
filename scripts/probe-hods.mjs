import { readFileSync, existsSync } from "fs"
import { Client } from "pg"
import path from "path"
import { fileURLToPath } from "url"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
function pe(p) {
  if (!existsSync(p)) return {}
  const o = {}
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = l.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    o[t.slice(0, i).trim()] = v
  }
  return o
}
const env = { ...pe(path.join(root, ".env")), ...pe(path.join(root, ".env.local")), ...process.env }
const c = new Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || env.POSTGRES_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const hods = await c.query(`SELECT id, email, display_name, reg_no, branch, role FROM users WHERE role='hod' AND deleted_at IS NULL`)
console.log(JSON.stringify(hods.rows, null, 2))
const me = await c.query(`SELECT reg_no, dept FROM students WHERE UPPER(reg_no)='171ME24006'`)
console.log("ME student", me.rows)
const sample = await c.query(`SELECT reg_no, dept, current_study_year FROM students WHERE current_study_year=1 AND lower(dept) LIKE '%computer%' LIMIT 5`)
console.log("CSE year1 sample", sample.rows)
await c.end()
