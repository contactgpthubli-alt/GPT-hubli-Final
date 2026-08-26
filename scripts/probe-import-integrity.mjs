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
const c = new Client({
  connectionString: env.DATABASE_URL || env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
})
await c.connect()

// 1) C-25 coverage
const c25 = await c.query(
  `SELECT COUNT(DISTINCT reg_no)::int students, COUNT(*)::int rows
     FROM results WHERE session='May 2026' AND sem=2`,
)
const c25a = await c.query(
  `SELECT COUNT(DISTINCT reg_no)::int students, COUNT(*)::int rows
     FROM student_exam_attempts WHERE exam_session='May 2026' AND status='verified'`,
)

// 2) C-20 coverage
const c20 = await c.query(
  `SELECT COUNT(DISTINCT reg_no)::int students, COUNT(*)::int rows
     FROM results WHERE session='Apr/May-2026' AND sem=4`,
)
const c20a = await c.query(
  `SELECT COUNT(DISTINCT reg_no)::int students, COUNT(*)::int rows
     FROM student_exam_attempts WHERE exam_session='Apr/May-2026' AND status='verified'`,
)

// 3) Wrong-name risk: result name vs student name very different for C-20
const mismatches = await c.query(
  `SELECT r.reg_no, r.name AS result_name, s.name AS student_name
     FROM results r
     JOIN students s ON UPPER(s.reg_no)=UPPER(r.reg_no)
    WHERE r.session='Apr/May-2026' AND r.sem=4
      AND regexp_replace(upper(r.name),'[^A-Z]','','g')
          <> regexp_replace(upper(s.name),'[^A-Z]','','g')
    ORDER BY r.reg_no
    LIMIT 30`,
)

// 4) Sample spot-check known good
const spot = await c.query(
  `SELECT reg_no, name, sem, session, sgpa, result FROM results
    WHERE reg_no IN ('171CE25013','171CS22032','171CE25004')
    ORDER BY reg_no, sem, session`,
)

// 5) Skipped C-20 conflict reg
const conflict = await c.query(
  `SELECT reg_no, name FROM students WHERE UPPER(reg_no)='171ME21304'`,
)

// 6) No accidental C-25 scheme on C-20 attempts or vice versa (sample)
const schemeMix = await c.query(
  `SELECT scheme, exam_session, COUNT(*)::int n
     FROM student_exam_attempts
    WHERE exam_session IN ('May 2026','Apr/May-2026')
    GROUP BY 1,2 ORDER BY 2,1`,
)

console.log(
  JSON.stringify(
    {
      c25_results: c25.rows[0],
      c25_attempts: c25a.rows[0],
      c20_results: c20.rows[0],
      c20_attempts: c20a.rows[0],
      c20_name_diff_count: mismatches.rowCount,
      c20_name_diff_sample: mismatches.rows.slice(0, 10),
      spot_checks: spot.rows,
      conflict_reg_171ME21304: conflict.rows,
      scheme_by_session: schemeMix.rows,
    },
    null,
    2,
  ),
)
await c.end()
