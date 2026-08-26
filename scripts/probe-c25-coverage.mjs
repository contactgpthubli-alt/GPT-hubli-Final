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
const url = env.DATABASE_URL || env.POSTGRES_URL
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const session = "May 2026"
const sem = 2

const pub = await c.query(
  `SELECT COUNT(*)::int AS n, COUNT(DISTINCT reg_no)::int AS students
     FROM results WHERE session = $1 AND sem = $2`,
  [session, sem],
)
const att = await c.query(
  `SELECT COUNT(*)::int AS n, COUNT(DISTINCT reg_no)::int AS students
     FROM student_exam_attempts
    WHERE exam_session = $1 AND semester = $2 AND status = 'verified'`,
  [session, sem],
)
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
const byBranch = await c.query(
  `SELECT COALESCE(NULLIF(TRIM(branch), ''), '?') AS branch,
          COUNT(*)::int AS students
     FROM results WHERE session = $1 AND sem = $2
     GROUP BY 1 ORDER BY 1`,
  [session, sem],
)
const subCounts = await c.query(
  `SELECT a.reg_no, COUNT(*)::int AS n
     FROM student_exam_attempts a
    WHERE a.exam_session = $1 AND a.semester = $2 AND a.status = 'verified'
    GROUP BY a.reg_no
   HAVING COUNT(*) <> 5
    ORDER BY n, a.reg_no
    LIMIT 20`,
  [session, sem],
)

console.log("Published results:", pub.rows[0])
console.log("Verified attempts:", att.rows[0])
console.log("Students missing verified attempts:", missing.rows.length)
if (missing.rows.length) console.log(missing.rows)
console.log("By branch (published):", byBranch.rows)
console.log("Students with subject count != 5:", subCounts.rows.length, subCounts.rows.slice(0, 10))

await c.end()
