/**
 * Probe C-25 ME Sem1 Nov/Dec 2025 import coverage.
 */
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const values = {}
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    values[t.slice(0, eq).trim()] = v
  }
  return values
}

function resolveDb() {
  const env = {
    ...parseEnvFile(path.join(root, ".env")),
    ...parseEnvFile(path.join(root, ".env.local")),
    ...process.env,
  }
  for (const k of [
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
  ]) {
    if (env[k] && String(env[k]).trim()) return String(env[k]).trim()
  }
  return null
}

const client = new Client({
  connectionString: resolveDb(),
  ssl: { rejectUnauthorized: false },
})
await client.connect()

const { rows: me } = await client.query(
  `SELECT r.reg_no, r.name, r.sgpa, r.result,
          (SELECT COUNT(*)::int FROM result_subjects rs WHERE rs.result_id = r.id) AS nsub
     FROM results r
    WHERE r.sem = 1 AND r.session = 'Nov/Dec-2025'
      AND UPPER(r.reg_no) LIKE '171ME25%'
    ORDER BY r.reg_no`,
)
console.log("ME25 Sem1 Nov/Dec-2025 results:", me.length)
console.log("sample:", me.slice(0, 5))
console.log(
  "subject counts:",
  Object.fromEntries(
    Object.entries(
      me.reduce((a, r) => {
        a[r.nsub] = (a[r.nsub] || 0) + 1
        return a
      }, {}),
    ).sort(),
  ),
)
console.log(
  "regs:",
  me.map((r) => r.reg_no + ":" + r.nsub + ":" + r.sgpa).join(", "),
)

const { rows: miss } = await client.query(
  `SELECT s.reg_no, s.name FROM students s
    WHERE UPPER(s.reg_no) LIKE '171ME25%'
      AND NOT EXISTS (
        SELECT 1 FROM results r
         WHERE UPPER(r.reg_no) = UPPER(s.reg_no)
           AND r.sem = 1 AND r.session = 'Nov/Dec-2025'
      )
    ORDER BY s.reg_no
    LIMIT 20`,
)
console.log("ME25 students still missing Sem1 result:", miss.length, miss)

const { rows: one } = await client.query(
  `SELECT rs.code, rs.name, rs.grade, rs.credits
     FROM result_subjects rs
     JOIN results r ON r.id = rs.result_id
    WHERE UPPER(r.reg_no) = '171ME25002' AND r.sem = 1 AND r.session = 'Nov/Dec-2025'
    ORDER BY rs.ord`,
)
console.log("171ME25002 subjects:", one)

await client.end()
