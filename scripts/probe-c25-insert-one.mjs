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
console.log("url host", url?.replace(/:[^:@/]+@/, ":***@").slice(0, 80))

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
c.on("error", (e) => console.error("client error", e))
await c.connect()
console.log("connected")

try {
  await c.query("BEGIN")
  console.log("begin")
  const { rows } = await c.query(
    `INSERT INTO results (reg_no, name, branch, sem, session, sgpa, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (reg_no, sem, session) DO UPDATE SET
       name = EXCLUDED.name, sgpa = EXCLUDED.sgpa, result = EXCLUDED.result
     RETURNING id`,
    ["171CE25004", "AKASH MOHAN BHUTE", "Civil Engineering", 2, "May 2026", 7.95, "Pass"],
  )
  console.log("result id", rows[0])
  await c.query("DELETE FROM result_subjects WHERE result_id = $1", [rows[0].id])
  await c.query(
    `INSERT INTO result_subjects (result_id, name, code, internal, external, credits, grade, ord)
     VALUES ($1,$2,$3,0,0,$4,$5,$6)`,
    [rows[0].id, "Engineering Mathematics-II", "25SC21I", 6, "A", 1],
  )
  console.log("subject ok")
  await c.query("COMMIT")
  console.log("committed")
} catch (e) {
  console.error("ERR", e)
  try {
    await c.query("ROLLBACK")
  } catch {}
}
await c.end()
console.log("done")
