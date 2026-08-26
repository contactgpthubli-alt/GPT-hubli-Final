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
const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || env.POSTGRES_URL
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const sessions = await c.query(
  `SELECT session, count(*)::int n FROM results WHERE lower(branch) LIKE '%computer%' GROUP BY session ORDER BY n DESC`,
)
const codes = await c.query(
  `SELECT left(upper(rs.code),2) pref, count(*)::int n
     FROM result_subjects rs JOIN results r ON r.id=rs.result_id
    WHERE r.session ILIKE '%May%2026%' AND lower(r.branch) LIKE '%computer%'
    GROUP BY 1`,
)
const allSess = await c.query(`SELECT DISTINCT session FROM results ORDER BY 1`)
const y = await c.query(
  `SELECT current_study_year, year, count(*)::int n FROM students
    WHERE lower(dept) LIKE '%computer%' GROUP BY 1,2 ORDER BY n DESC LIMIT 20`,
)
const one = await c.query(
  `SELECT reg_no, year, current_study_year, pg_typeof(extra)::text AS extra_type
     FROM students WHERE reg_no='171CS25001'`,
)
// test update path
const cols = await c.query(
  `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='students' AND column_name IN ('year','current_study_year','extra','updated_at')`,
)
// scheme filter simulation
const c20May = await c.query(
  `SELECT count(*)::int n FROM results r
    WHERE r.session = 'May 2026' AND lower(r.branch) LIKE '%computer%'
      AND EXISTS (SELECT 1 FROM result_subjects rs WHERE rs.result_id=r.id AND upper(rs.code) LIKE '20%')`,
)
const c25May = await c.query(
  `SELECT count(*)::int n FROM results r
    WHERE r.session = 'May 2026' AND lower(r.branch) LIKE '%computer%'
      AND EXISTS (SELECT 1 FROM result_subjects rs WHERE rs.result_id=r.id AND upper(rs.code) LIKE '25%')`,
)
const anyMay = await c.query(
  `SELECT count(*)::int n FROM results r
    WHERE r.session = 'May 2026' AND lower(r.branch) LIKE '%computer%'`,
)
const mayLoose = await c.query(
  `SELECT session, count(*)::int n FROM results
    WHERE session ILIKE '%may%2026%' AND lower(branch) LIKE '%computer%' GROUP BY session`,
)

console.log(
  JSON.stringify(
    {
      sessions: sessions.rows,
      allSessions: allSess.rows.map((r) => r.session),
      codesMay: codes.rows,
      years: y.rows,
      one: one.rows,
      cols: cols.rows,
      c20May: c20May.rows[0],
      c25May: c25May.rows[0],
      anyMay: anyMay.rows[0],
      mayLoose: mayLoose.rows,
    },
    null,
    2,
  ),
)
const allCols = await c.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='students' ORDER BY 1`,
)
console.log("all student cols:", allCols.rows.map((r) => r.column_name).join(", "))
await c.end()
