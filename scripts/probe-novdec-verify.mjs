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
const sessions = await c.query(
  `SELECT session, count(*)::int n, count(DISTINCT reg_no)::int regs FROM results GROUP BY session ORDER BY session`,
)
const att = await c.query(
  `SELECT exam_session, count(*)::int n FROM student_exam_attempts
    WHERE exam_session IN ('Nov/Dec-2025','Apr/May-2026') GROUP BY exam_session`,
)
const passfail = await c.query(
  `SELECT result, count(*)::int n FROM results WHERE session='Nov/Dec-2025' GROUP BY result ORDER BY n DESC`,
)
const created = await c.query(
  `SELECT reg_no, name, dept FROM students WHERE extra::text LIKE '%nov-dec-2025%' ORDER BY reg_no`,
)
const sample = await c.query(
  `SELECT r.reg_no, r.sem, r.sgpa, r.result, s.grade, s.code
     FROM results r
     JOIN result_subjects s ON s.result_id=r.id
    WHERE r.session='Nov/Dec-2025' AND r.reg_no='171CS20060'`,
)
console.log(JSON.stringify({ sessions: sessions.rows, attempts: att.rows, passfail: passfail.rows, created: created.rows, sample_cs20060: sample.rows }, null, 2))
await c.end()
