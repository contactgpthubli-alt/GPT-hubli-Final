/**
 * Purge multi-role demo accounts; keep / create only the student demo.
 *
 * Login (any identifier):
 *   email:    demo.student@gpthubli.ac.in
 *   username: DEMOSTUDENT  (reg_no / email local-part also work)
 *   reg_no:   GP2023CSE041
 *   password: demo1234
 *
 * Usage: node scripts/seed-demo-student.mjs
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import bcrypt from "bcryptjs"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

const DEMO = {
  email: "demo.student@gpthubli.ac.in",
  password: "demo1234",
  role: "student",
  display_name: "Demo Student",
  reg_no: "GP2023CSE041",
  branch: "computer",
  dept: "Computer Science Engineering",
  year: "2nd Year",
}

function loadEnv() {
  const env = { ...process.env }
  for (const name of [".env.local", ".env"]) {
    const envPath = path.join(root, name)
    if (!fs.existsSync(envPath)) continue
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
    ssl: conn.includes("neon.tech") || conn.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  })
  await client.connect()
  console.log("Connected:", new URL(conn).hostname)

  const { rows: before } = await client.query(
    `SELECT id, email, role, is_demo FROM users
      WHERE is_demo = TRUE OR email ILIKE 'demo.%'
      ORDER BY email`,
  )
  console.log("Before: %d demo-like user(s)", before.length)
  before.forEach((r) => console.log("  -", r.role, r.email, "is_demo=" + r.is_demo))

  // Drop every demo account except the student we will keep/create
  const delSessions = await client.query(
    `DELETE FROM sessions
      WHERE user_id IN (
        SELECT id FROM users
         WHERE (is_demo = TRUE OR email ILIKE 'demo.%')
           AND lower(email) <> lower($1)
      )`,
    [DEMO.email],
  )
  const delUsers = await client.query(
    `DELETE FROM users
      WHERE (is_demo = TRUE OR email ILIKE 'demo.%')
        AND lower(email) <> lower($1)
      RETURNING email, role`,
    [DEMO.email],
  )
  console.log(
    "Removed %d other demo user(s) (%d sessions cleared)",
    delUsers.rowCount,
    delSessions.rowCount,
  )
  delUsers.rows.forEach((r) => console.log("  deleted", r.role, r.email))

  // Student academic row
  await client.query(
    `INSERT INTO students (reg_no, name, dept, year, cgpa, att, father, extra, current_study_year, academic_status)
     VALUES ($1, $2, $3, $4, NULL, NULL, NULL, '{}'::jsonb, 2, 'active')
     ON CONFLICT (reg_no) DO UPDATE SET
       name = EXCLUDED.name,
       dept = EXCLUDED.dept,
       year = EXCLUDED.year,
       current_study_year = COALESCE(students.current_study_year, EXCLUDED.current_study_year),
       academic_status = COALESCE(students.academic_status, EXCLUDED.academic_status)`,
    [DEMO.reg_no, DEMO.display_name, DEMO.dept, DEMO.year],
  )

  const hash = await bcrypt.hash(DEMO.password, 10)

  const { rows: existing } = await client.query(
    `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [DEMO.email],
  )

  let id
  if (existing[0]) {
    id = existing[0].id
    await client.query(
      `UPDATE users SET
          password_hash = $2,
          role = $3,
          display_name = $4,
          reg_no = $5,
          branch = $6,
          status = 'approved',
          force_password_change = FALSE,
          is_demo = TRUE,
          deleted_at = NULL,
          prev_status = NULL
        WHERE id = $1`,
      [id, hash, DEMO.role, DEMO.display_name, DEMO.reg_no, DEMO.branch],
    )
    console.log("Updated student demo id=" + id)
  } else {
    const { rows } = await client.query(
      `INSERT INTO users (
         email, password_hash, role, display_name, reg_no, branch,
         status, force_password_change, is_demo
       ) VALUES ($1, $2, $3, $4, $5, $6, 'approved', FALSE, TRUE)
       RETURNING id`,
      [
        DEMO.email,
        hash,
        DEMO.role,
        DEMO.display_name,
        DEMO.reg_no,
        DEMO.branch,
      ],
    )
    id = rows[0].id
    console.log("Created student demo id=" + id)
  }

  const { rows: after } = await client.query(
    `SELECT id, email, role, reg_no, branch, status, is_demo, force_password_change
       FROM users
      WHERE is_demo = TRUE OR email ILIKE 'demo.%'
      ORDER BY email`,
  )
  console.log("After: %d demo-like user(s)", after.length)
  after.forEach((r) => console.log(" ", r))

  console.log("\nLogin as student demo:")
  console.log("  Email / username:", DEMO.email, "or", DEMO.reg_no)
  console.log("  Password:", DEMO.password)
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
