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
const r = await c.query(
  "SELECT COUNT(*)::int AS n FROM results WHERE session = $1 AND sem = $2",
  ["May 2026", 2],
)
console.log("may2026 sem2 results", r.rows[0])
const s = await c.query(
  `SELECT COUNT(*)::int AS n
     FROM result_subjects rs
     JOIN results r ON r.id = rs.result_id
    WHERE r.session = $1 AND r.sem = $2`,
  ["May 2026", 2],
)
console.log("subject rows", s.rows[0])
const sample = await c.query(
  `SELECT reg_no, name, sgpa, result FROM results WHERE session = $1 AND sem = $2 ORDER BY reg_no LIMIT 5`,
  ["May 2026", 2],
)
console.log("sample", sample.rows)
await c.end()
