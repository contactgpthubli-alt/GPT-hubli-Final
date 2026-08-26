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

const session = "Nov/Dec-2025"
const sem = 1

const pub = await c.query(
  `SELECT COUNT(*)::int AS n, COUNT(DISTINCT reg_no)::int AS students,
          COUNT(*) FILTER (WHERE result ILIKE 'pass')::int AS pass,
          COUNT(*) FILTER (WHERE result ILIKE 'fail')::int AS fail
     FROM results WHERE session = $1 AND sem = $2`,
  [session, sem],
)
console.log("Published results (all branches):", pub.rows[0])

const byBranch = await c.query(
  `SELECT COALESCE(NULLIF(TRIM(branch), ''), '?') AS branch,
          COUNT(*)::int AS students,
          COUNT(*) FILTER (WHERE result ILIKE 'pass')::int AS pass,
          COUNT(*) FILTER (WHERE result ILIKE 'fail')::int AS fail,
          ROUND(AVG(sgpa)::numeric, 2) AS avg_sgpa
     FROM results WHERE session = $1 AND sem = $2
     GROUP BY 1 ORDER BY 1`,
  [session, sem],
)
console.log("By branch:", byBranch.rows)

const att = await c.query(
  `SELECT COUNT(*)::int AS n, COUNT(DISTINCT reg_no)::int AS students
     FROM student_exam_attempts
    WHERE exam_session = $1 AND semester = $2 AND status = 'verified'`,
  [session, sem],
)
console.log("Verified attempts:", att.rows[0])

const sample = await c.query(
  `SELECT r.reg_no, r.name, r.sgpa, r.result,
          (SELECT string_agg(rs.code || ':' || rs.grade, ', ' ORDER BY rs.ord)
             FROM result_subjects rs WHERE rs.result_id = r.id) AS subjects
     FROM results r
    WHERE r.session = $1 AND r.sem = $2 AND UPPER(r.reg_no) LIKE '171EC25%'
    ORDER BY r.reg_no
    LIMIT 5`,
  [session, sem],
)
console.log("Sample EC cards:")
for (const row of sample.rows) console.log(row)

const one = await c.query(
  `SELECT a.reg_no, a.subject_code, a.subject_name, a.grade, a.result, a.status
     FROM student_exam_attempts a
    WHERE UPPER(a.reg_no) = '171EC25001' AND a.exam_session = $1 AND a.semester = $2
    ORDER BY a.subject_code`,
  [session, sem],
)
console.log("Student UI attempts for 171EC25001:", one.rows)

const missing = await c.query(
  `SELECT r.reg_no, r.name
     FROM results r
    WHERE r.session = $1 AND r.sem = $2
      AND NOT EXISTS (
        SELECT 1 FROM student_exam_attempts a
         WHERE UPPER(a.reg_no) = UPPER(r.reg_no)
           AND a.exam_session = $1 AND a.semester = $2 AND a.status = 'verified'
      )
    ORDER BY r.reg_no`,
  [session, sem],
)
console.log("Results missing verified attempts:", missing.rows.length, missing.rows.slice(0, 10))

const c25ec = await c.query(
  `SELECT count(*)::int n,
          count(*) FILTER (WHERE result ILIKE 'pass')::int pass,
          count(*) FILTER (WHERE result ILIKE 'fail')::int fail
     FROM results
    WHERE session = $1 AND sem = $2 AND UPPER(reg_no) LIKE '171EC25%'`,
  [session, sem],
)
console.log("C-25 EC batch only (171EC25*):", c25ec.rows[0])

const codes = await c.query(
  `SELECT rs.code, count(*)::int n
     FROM result_subjects rs
     JOIN results r ON r.id = rs.result_id
    WHERE r.session = $1 AND r.sem = $2 AND UPPER(r.reg_no) LIKE '171EC25%'
    GROUP BY rs.code ORDER BY rs.code`,
  [session, sem],
)
console.log("C-25 EC subject codes:", codes.rows)

const noResult = await c.query(
  `SELECT s.reg_no, s.name
     FROM students s
    WHERE UPPER(s.reg_no) LIKE '171EC25%'
      AND NOT EXISTS (
        SELECT 1 FROM results r
         WHERE UPPER(r.reg_no) = UPPER(s.reg_no)
           AND r.session = $1 AND r.sem = $2
      )
    ORDER BY s.reg_no`,
  [session, sem],
)
console.log("EC25 students without this Sem1 result:", noResult.rows.length)
for (const row of noResult.rows) console.log(" ", row.reg_no, row.name)

await c.end()
