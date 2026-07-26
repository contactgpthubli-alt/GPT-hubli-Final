/**
 * Quick check: HOD branches + student counts per branch.
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

function loadEnv() {
  const envPath = path.join(root, ".env.local")
  const env = { ...process.env }
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2]
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1)
      }
      if (env[m[1]] == null) env[m[1]] = v
    }
  }
  return env
}

async function main() {
  const env = loadEnv()
  const conn =
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    env.POSTGRES_PRISMA_URL ||
    env.DATABASE_URL_UNPOOLED
  if (!conn) {
    console.error("Missing DATABASE_URL")
    process.exit(1)
  }
  const client = new pg.Client({
    connectionString: conn,
    ssl: conn.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()

  const hods = await client.query(
    `SELECT reg_no, display_name, branch, role, status
       FROM users
      WHERE role = 'hod' AND deleted_at IS NULL
      ORDER BY reg_no`,
  )
  console.log("HOD accounts:")
  for (const r of hods.rows) {
    console.log(`  ${r.reg_no || r.display_name} | ${r.branch} | ${r.status}`)
  }

  const counts = await client.query(
    `SELECT
        COALESCE(NULLIF(s.dept, ''), NULLIF(u.branch, ''), '?') AS branch,
        COUNT(*)::int AS n
       FROM users u
       LEFT JOIN students s ON s.reg_no = u.reg_no
      WHERE u.role = 'student'
        AND u.deleted_at IS NULL
        AND (u.status IS DISTINCT FROM 'deleted')
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 20`,
  )
  console.log("\nStudent accounts by branch:")
  for (const r of counts.rows) {
    console.log(`  ${r.n}\t${r.branch}`)
  }

  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
