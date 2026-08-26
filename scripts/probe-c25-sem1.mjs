import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

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
const env = { ...pe(path.join(root, ".env")), ...pe(path.join(root, ".env.local")) }
const url =
  env.DATABASE_URL_UNPOOLED ||
  env.POSTGRES_URL_NON_POOLING ||
  env.DATABASE_URL ||
  env.POSTGRES_URL
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const r1 = await c.query(
  `SELECT session, sem, count(*)::int n
     FROM results
    WHERE UPPER(reg_no) LIKE '171EC25%'
    GROUP BY session, sem
    ORDER BY session, sem`,
)
console.log("EC25 results by session/sem:", r1.rows)

const r2 = await c.query(
  `SELECT count(*)::int n FROM students WHERE UPPER(reg_no) LIKE '171EC25%'`,
)
console.log("EC25 students in DB:", r2.rows[0])

const r3 = await c.query(
  `SELECT reg_no, name, dept, current_study_year, admission_academic_year
     FROM students
    WHERE UPPER(reg_no) LIKE '171EC25%'
    ORDER BY reg_no
    LIMIT 10`,
)
console.log("Sample EC25:", r3.rows)

const r4 = await c.query(
  `SELECT count(*)::int n FROM students WHERE UPPER(reg_no) LIKE '171%25%'`,
)
console.log("All *25* students:", r4.rows[0])

const r5 = await c.query(
  `SELECT LEFT(UPPER(reg_no),5) prefix, count(*)::int n
     FROM students
    WHERE UPPER(reg_no) ~ '^171(CE|CS|EC|ME)25'
    GROUP BY 1 ORDER BY 1`,
)
console.log("C25 by branch prefix:", r5.rows)

await c.end()
