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
c.on("error", (e) => console.warn("pg", e.message))
await c.connect()
const session = "Apr/May-2026"
const sem = 4

const pub = await c.query(
  `SELECT COUNT(*)::int n, COUNT(DISTINCT reg_no)::int students FROM results WHERE session=$1 AND sem=$2`,
  [session, sem],
)
const att = await c.query(
  `SELECT COUNT(*)::int n, COUNT(DISTINCT reg_no)::int students FROM student_exam_attempts WHERE exam_session=$1 AND status='verified'`,
  [session],
)
const att4 = await c.query(
  `SELECT COUNT(*)::int n, COUNT(DISTINCT reg_no)::int students FROM student_exam_attempts WHERE exam_session=$1 AND semester=$2 AND status='verified'`,
  [session, sem],
)
const byBranch = await c.query(
  `SELECT branch, COUNT(*)::int n FROM results WHERE session=$1 AND sem=$2 GROUP BY branch ORDER BY branch`,
  [session, sem],
)
const sample = await c.query(
  `SELECT reg_no, name, sgpa, result FROM results WHERE session=$1 AND sem=$2 AND reg_no LIKE '171CS22%' ORDER BY reg_no LIMIT 3`,
  [session, sem],
)
const parsed = JSON.parse(readFileSync(path.join(root, "tmp-c20/result-sheets/parsed-c20-sem4.json"), "utf8"))
const { rows: have } = await c.query(
  `SELECT UPPER(reg_no) AS reg FROM results WHERE session=$1 AND sem=$2`,
  [session, sem],
)
const haveSet = new Set(have.map((r) => r.reg))
const missing = parsed.filter((r) => !haveSet.has(r.reg)).map((r) => ({ reg: r.reg, name: r.name }))

console.log(JSON.stringify({ published: pub.rows[0], attempts_all: att.rows[0], attempts_sem4: att4.rows[0], byBranch: byBranch.rows, sample: sample.rows, ledger: parsed.length, missing_results: missing }, null, 2))
await c.end()
