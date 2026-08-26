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
const c = new Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()
await c.query("BEGIN")
const before = await c.query(`SELECT year, current_study_year FROM students WHERE reg_no=$1`, ["171CS25001"])
const up = await c.query(
  `UPDATE students SET current_study_year=3, year='3rd Year', academic_updated_at=now()
    WHERE UPPER(reg_no)=$1 RETURNING year, current_study_year`,
  ["171CS25001"],
)
console.log(JSON.stringify({ before: before.rows[0], after: up.rows[0], rowCount: up.rowCount }, null, 2))
await c.query("ROLLBACK")
const back = await c.query(`SELECT year, current_study_year FROM students WHERE reg_no=$1`, ["171CS25001"])
console.log("restored", back.rows[0])
await c.end()
