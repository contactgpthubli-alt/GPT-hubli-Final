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
const url =
  env.DATABASE_URL_UNPOOLED ||
  env.POSTGRES_URL_NON_POOLING ||
  env.DATABASE_URL ||
  env.POSTGRES_URL
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const session = "Nov/Dec-2025"
const r = await c.query(`SELECT count(*)::int n FROM results WHERE session=$1`, [session])
const a = await c.query(`SELECT count(*)::int n FROM student_exam_attempts WHERE exam_session=$1`, [session])
const regs = await c.query(`SELECT count(DISTINCT reg_no)::int n FROM results WHERE session=$1`, [session])
const bySem = await c.query(
  `SELECT sem, count(*)::int n FROM results WHERE session=$1 GROUP BY sem ORDER BY sem`,
  [session],
)
const sample = await c.query(
  `SELECT reg_no, sem, sgpa, result FROM results WHERE session=$1 ORDER BY id DESC LIMIT 8`,
  [session],
)
const cards = JSON.parse(
  readFileSync(path.join(root, "tmp-c20/result-sheets/nov-dec-2025/parsed-marks-cards.json"), "utf8"),
)
const done = new Set(
  (await c.query(`SELECT DISTINCT UPPER(reg_no) r FROM results WHERE session=$1`, [session])).rows.map(
    (x) => x.r,
  ),
)
const missing = cards.filter((x) => x.reg && !done.has(String(x.reg).toUpperCase()))
console.log(
  JSON.stringify(
    {
      results: r.rows[0].n,
      attempts: a.rows[0].n,
      distinct_regs: regs.rows[0].n,
      by_sem: bySem.rows,
      sample: sample.rows,
      ledger: cards.length,
      remaining_regs: missing.length,
      remaining_sample: missing.slice(0, 10).map((m) => m.reg),
    },
    null,
    2,
  ),
)
for (const r of ["171CS20060", "171CE23013", "171CE20019", "171ME19060", "171CS24019"]) {
  const q = await c.query(
    `SELECT reg_no, sem, session, sgpa, result FROM results WHERE UPPER(reg_no)=$1 ORDER BY session, sem`,
    [r],
  )
  console.log(r, q.rows)
}
await c.end()
