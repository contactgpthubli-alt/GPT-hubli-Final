import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const values = {}
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    values[t.slice(0, eq).trim()] = v
  }
  return values
}
const env = { ...parseEnvFile(path.join(projectRoot, ".env")), ...parseEnvFile(path.join(projectRoot, ".env.local")), ...process.env }
const conn = env.DATABASE_URL || env.POSTGRES_URL || env.DATABASE_URL_UNPOOLED
const client = new Client({ connectionString: conn, ssl: /neon|sslmode=require/i.test(conn) ? { rejectUnauthorized: false } : undefined })
await client.connect()
const u = await client.query(`SELECT count(*)::int AS n FROM users WHERE role='student' AND deleted_at IS NULL`)
const s = await client.query(`SELECT count(*)::int AS n FROM students`)
const imp = await client.query(`SELECT count(*)::int AS n FROM students WHERE extra->>'imported_from_excel' = 'true'`)
console.log({ users_students: u.rows[0].n, students: s.rows[0].n, imported_flag: imp.rows[0].n })
await client.end()
