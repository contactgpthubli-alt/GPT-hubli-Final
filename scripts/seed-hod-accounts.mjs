/**
 * Create / update the 4 branch HOD accounts.
 * Usernames: HODCEGPTH, HODCSGPTH, HODECGPTH, HODMEGPTH
 * Password: Test@123 (approved, no forced change)
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import bcrypt from "bcryptjs"
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

const HODS = [
  {
    username: "HODCEGPTH",
    branch: "Civil Engineering",
    name: "HOD — Civil Engineering",
    email: "hodcegpth@gpthubli.edu",
  },
  {
    username: "HODCSGPTH",
    branch: "Computer Science and Engineering",
    name: "HOD — Computer Science and Engineering",
    email: "hodcsgpth@gpthubli.edu",
  },
  {
    username: "HODECGPTH",
    branch: "Electronics and Communication Engineering",
    name: "HOD — Electronics and Communication Engineering",
    email: "hodecgpth@gpthubli.edu",
  },
  {
    username: "HODMEGPTH",
    branch: "Mechanical Engineering",
    name: "HOD — Mechanical Engineering",
    email: "hodmegpth@gpthubli.edu",
  },
]

const PASSWORD = "Test@123"

async function main() {
  const env = loadEnv()
  const conn =
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    env.POSTGRES_PRISMA_URL ||
    env.DATABASE_URL_UNPOOLED
  if (!conn) {
    console.error("Missing DATABASE_URL in .env.local")
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: conn, ssl: conn.includes("neon.tech") ? { rejectUnauthorized: false } : undefined })
  await client.connect()
  const hash = await bcrypt.hash(PASSWORD, 10)

  console.log("Seeding 4 HOD accounts…")
  for (const h of HODS) {
    const { rows: existing } = await client.query(
      `SELECT id, email, reg_no, role, status, branch FROM users
        WHERE deleted_at IS NULL
          AND (
            lower(reg_no) = lower($1)
            OR lower(email) = lower($2)
            OR lower(split_part(email, '@', 1)) = lower($1)
          )
        LIMIT 1`,
      [h.username, h.email],
    )

    if (existing[0]) {
      const id = existing[0].id
      await client.query(
        `UPDATE users SET
            email = $2,
            password_hash = $3,
            role = 'hod',
            display_name = $4,
            reg_no = $5,
            branch = $6,
            status = 'approved',
            force_password_change = FALSE,
            is_demo = FALSE,
            deleted_at = NULL,
            prev_status = NULL
          WHERE id = $1`,
        [id, h.email, hash, h.name, h.username, h.branch],
      )
      console.log("  UPDATED", h.username, "→", h.branch, "(id=" + id + ")")
    } else {
      const { rows } = await client.query(
        `INSERT INTO users (
           email, password_hash, role, display_name, reg_no, branch,
           status, force_password_change, is_demo
         ) VALUES ($1, $2, 'hod', $3, $4, $5, 'approved', FALSE, FALSE)
         RETURNING id`,
        [h.email, hash, h.name, h.username, h.branch],
      )
      console.log("  CREATED", h.username, "→", h.branch, "(id=" + rows[0].id + ")")
    }
  }

  await client.end()
  console.log("\nDone. Login with username + password:")
  for (const h of HODS) {
    console.log(" ", h.username, "/", PASSWORD, "—", h.branch)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
