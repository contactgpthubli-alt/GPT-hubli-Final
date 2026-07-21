/**
 * Create / update Exam Cell account.
 * Username: EXAMGPTH
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

const ACCOUNT = {
  username: "EXAMGPTH",
  email: "examgpth@gpthubli.edu",
  name: "Exam Cell — GPT Hubli",
  role: "exam",
}

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

  const client = new pg.Client({
    connectionString: conn,
    ssl: conn.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()
  const hash = await bcrypt.hash(PASSWORD, 10)

  console.log("Seeding Exam Cell account…")
  const { rows: existing } = await client.query(
    `SELECT id, email, reg_no, role, status FROM users
      WHERE deleted_at IS NULL
        AND (
          lower(reg_no) = lower($1)
          OR lower(email) = lower($2)
          OR lower(split_part(email, '@', 1)) = lower($1)
        )
      LIMIT 1`,
    [ACCOUNT.username, ACCOUNT.email],
  )

  if (existing[0]) {
    const id = existing[0].id
    await client.query(
      `UPDATE users SET
          email = $2,
          password_hash = $3,
          role = $4,
          display_name = $5,
          reg_no = $6,
          status = 'approved',
          force_password_change = FALSE,
          is_demo = FALSE,
          deleted_at = NULL,
          prev_status = NULL
        WHERE id = $1`,
      [id, ACCOUNT.email, hash, ACCOUNT.role, ACCOUNT.name, ACCOUNT.username],
    )
    console.log("  UPDATED", ACCOUNT.username, "(id=" + id + ")")
  } else {
    const { rows } = await client.query(
      `INSERT INTO users (
         email, password_hash, role, display_name, reg_no,
         status, force_password_change, is_demo
       ) VALUES ($1, $2, $3, $4, $5, 'approved', FALSE, FALSE)
       RETURNING id`,
      [ACCOUNT.email, hash, ACCOUNT.role, ACCOUNT.name, ACCOUNT.username],
    )
    console.log("  CREATED", ACCOUNT.username, "(id=" + rows[0].id + ")")
  }

  const { rows: check } = await client.query(
    `SELECT id, email, reg_no, role, status, force_password_change, is_demo
       FROM users
      WHERE lower(reg_no) = lower($1) OR lower(email) = lower($2)
      LIMIT 1`,
    [ACCOUNT.username, ACCOUNT.email],
  )
  console.log("  Verify:", check[0])
  console.log("Done. Login: EXAMGPTH / Test@123 (or", ACCOUNT.email + ")")
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
