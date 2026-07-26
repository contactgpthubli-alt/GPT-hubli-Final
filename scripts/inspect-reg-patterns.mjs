import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import pg from "pg"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
function loadEnv() {
  const env = { ...process.env }
  const p = path.join(root, ".env.local")
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (env[m[1]] == null) env[m[1]] = v
    }
  }
  return env
}

const env = loadEnv()
const client = new pg.Client({
  connectionString: env.DATABASE_URL || env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

const samples = await client.query(
  `SELECT reg_no, admission_academic_year, year, academic_status, entry_type
     FROM students WHERE reg_no ILIKE '171CS%' ORDER BY reg_no LIMIT 40`,
)
console.log("CS samples:", samples.rows)

const lengths = await client.query(
  `SELECT length(reg_no) len, COUNT(*) n FROM students GROUP BY 1 ORDER BY 2 DESC`,
)
console.log("reg lengths:", lengths.rows)

const with702 = await client.query(
  `SELECT reg_no FROM students WHERE reg_no ~ '702' ORDER BY reg_no LIMIT 30`,
)
console.log("contains 702:", with702.rows)

const with301 = await client.query(
  `SELECT reg_no FROM students WHERE reg_no ~ '301' ORDER BY reg_no LIMIT 30`,
)
console.log("contains 301:", with301.rows)

const adm = await client.query(
  `SELECT admission_academic_year, COUNT(*)::int n FROM students GROUP BY 1 ORDER BY 2 DESC LIMIT 40`,
)
console.log("adm years:", adm.rows)

// Pattern: after branch letters, what digits look like
const dig = await client.query(
  `SELECT reg_no,
          substring(upper(regexp_replace(reg_no,'[^A-Za-z0-9]','','g')) from '^171[A-Z]{2,4}([0-9]+)$') AS tail
     FROM students
    WHERE reg_no ILIKE '171%'
    ORDER BY reg_no
    LIMIT 50`,
)
console.log("tails sample:", dig.rows)

await client.end()
