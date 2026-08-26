/** Smoke: same aggregates as /api/results/analysis (no auth). */
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
const env = { ...pe(path.join(root, ".env")), ...pe(path.join(root, ".env.local")), ...process.env }
const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || env.POSTGRES_URL
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const bySem = await c.query(`
  SELECT sem,
         count(*)::int AS total,
         count(*) FILTER (WHERE upper(result) NOT LIKE '%FAIL%')::int AS passish,
         count(*) FILTER (WHERE upper(result) LIKE '%FAIL%')::int AS fail
    FROM results
   WHERE session = 'Nov/Dec-2025'
   GROUP BY sem ORDER BY sem`)

const bySub = await c.query(`
  SELECT a.subject_code, a.subject_name, a.semester, a.branch_code,
         count(*)::int AS total,
         count(*) FILTER (WHERE lower(a.result)='pass')::int AS pass,
         count(*) FILTER (WHERE lower(a.result)<>'pass')::int AS fail
    FROM student_exam_attempts a
   WHERE a.status='verified' AND a.exam_session='Nov/Dec-2025'
   GROUP BY a.subject_code, a.subject_name, a.semester, a.branch_code
   ORDER BY total DESC LIMIT 12`)

const sessions = await c.query(`
  SELECT session AS s, count(*)::int n FROM results GROUP BY session
  UNION ALL
  SELECT exam_session, count(*)::int FROM student_exam_attempts WHERE status='verified' GROUP BY exam_session
`)

console.log(JSON.stringify({ bySem: bySem.rows, topSubjects: bySub.rows, sessions: sessions.rows }, null, 2))
await c.end()
