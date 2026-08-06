/**
 * Create the 13 C-25 students who appeared on May 2026 Sem-2 ledgers
 * but were missing from students/users, then import their results.
 *
 * Login: reg_no  |  Password: Student@123  |  force_password_change = false
 *
 * Usage:
 *   node scripts/add-missing-c25-students.mjs --dry-run
 *   node scripts/add-missing-c25-students.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { Client } from "pg"
import bcrypt from "bcryptjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

const DRY_RUN = process.argv.includes("--dry-run")
const DEFAULT_PASSWORD = "Student@123"
const ADMISSION_AY = "2025-26"
const STUDY_YEAR = 1
const YEAR_LABEL = "1st Year"

const BRANCH_FULL = {
  CE: "Civil Engineering",
  CS: "Computer Science and Engineering",
  EC: "Electronics and Communication Engineering",
  ME: "Mechanical Engineering",
}

const MISSING = [
  { reg: "171CE24045", name: "PREETAMKUMAR NEELAKANTH HONAGEKAR", branch: "CE" },
  { reg: "171CE25013", name: "HOORE AIEN GABBUR", branch: "CE" },
  { reg: "171CE25019", name: "KEERTANA KIRANKUMAR GURAL", branch: "CE" },
  { reg: "171CE25020", name: "KHAZI KHAJA MOINUDDIN ZIYA AHMED QUADRI", branch: "CE" },
  { reg: "171CE25021", name: "KRISHNA VEERAPPA SAVADATTI", branch: "CE" },
  { reg: "171CS25016", name: "GOVARDHAN KATHARE N", branch: "CS" },
  { reg: "171CS25017", name: "HARSHIT B DODMANI", branch: "CS" },
  { reg: "171CS25030", name: "PAVITRA", branch: "CS" },
  { reg: "171EC24014", name: "BHARATKUMAR PRABHU BADIGER", branch: "EC" },
  { reg: "171EC24015", name: "CHANDRAPPA ALAVANDI", branch: "EC" },
  { reg: "171EC24027", name: "MALLIKARJUN F ARER", branch: "EC" },
  { reg: "171ME25021", name: "MAHMADSIYAN INTYAJSAB TAMBAKAD", branch: "ME" },
  { reg: "171ME25052", name: "SHIVANAND SADEV SAMBHOJI", branch: "ME" },
]

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
    ...parseEnvFile(path.join(projectRoot, ".env")),
    ...parseEnvFile(path.join(projectRoot, ".env.local")),
    ...process.env,
  }
  const pick = (...keys) => {
    for (const k of keys) {
      const v = env[k]
      if (v && String(v).trim()) return String(v).trim()
    }
    return null
  }
  return pick(
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
  )
}

function syntheticEmail(reg) {
  return `${String(reg).toLowerCase()}@student.gpthubli.ac.in`
}

function branchFromReg(reg) {
  const m = String(reg).toUpperCase().match(/^171([A-Z]{2})/)
  return m ? m[1] : null
}

async function main() {
  const dbUrl = resolveDb()
  if (!dbUrl) {
    console.error("No DATABASE_URL")
    process.exit(1)
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    query_timeout: 60000,
  })
  await client.connect()
  console.log("Connected")

  // Enrich names from parsed ledger if available
  const ledgerPath = path.join(projectRoot, "tmp-c25", "result-sheets", "parsed-all.json")
  const ledgerByReg = new Map()
  if (existsSync(ledgerPath)) {
    for (const row of JSON.parse(readFileSync(ledgerPath, "utf8"))) {
      ledgerByReg.set(String(row.reg).toUpperCase(), row)
    }
  }

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)
  console.log(`Password: ${DEFAULT_PASSWORD} (bcrypt ready)`)

  const created = []
  const skipped = []

  for (const item of MISSING) {
    const reg = item.reg.toUpperCase()
    const ledger = ledgerByReg.get(reg)
    const name = (ledger?.name || item.name).replace(/\s+/g, " ").trim()
    const bc = item.branch || branchFromReg(reg)
    const dept = BRANCH_FULL[bc] || bc
    const email = syntheticEmail(reg)

    const stu = await client.query(`SELECT reg_no, name FROM students WHERE UPPER(reg_no) = $1`, [reg])
    const usr = await client.query(
      `SELECT id, email, reg_no, status FROM users WHERE UPPER(reg_no) = $1 OR lower(email) = lower($2)`,
      [reg, email],
    )

    if (DRY_RUN) {
      console.log(
        `[dry-run] ${reg} | ${name} | ${dept} | student=${stu.rows.length ? "exists" : "NEW"} user=${usr.rows.length ? "exists" : "NEW"}`,
      )
      created.push({ reg, name, dept, dry: true })
      continue
    }

    await client.query("BEGIN")
    try {
      if (!stu.rows.length) {
        await client.query(
          `INSERT INTO students (
             reg_no, name, dept, year, cgpa, att, father, extra,
             admission_academic_year, entry_type, entry_study_year,
             current_study_year, academic_status, progress_locked
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8::jsonb,
             $9,'regular',1,
             $10,'active',FALSE
           )`,
          [
            reg,
            name,
            dept,
            YEAR_LABEL,
            ledger?.cgpa != null ? String(Number(ledger.cgpa).toFixed(2)) : null,
            null,
            "",
            JSON.stringify({
              source: "c25-sem2-ledger-backfill",
              scheme: "C-25",
              admission_type: ledger ? "Regular" : "Regular",
            }),
            ADMISSION_AY,
            STUDY_YEAR,
          ],
        )
      } else {
        await client.query(
          `UPDATE students SET
             name = COALESCE(NULLIF(TRIM(name), ''), $2),
             dept = COALESCE(NULLIF(TRIM(dept), ''), $3),
             year = COALESCE(year, $4),
             admission_academic_year = COALESCE(admission_academic_year, $5),
             current_study_year = COALESCE(current_study_year, $6),
             academic_status = COALESCE(academic_status, 'active')
           WHERE UPPER(reg_no) = $1`,
          [reg, name, dept, YEAR_LABEL, ADMISSION_AY, STUDY_YEAR],
        )
      }

      if (!usr.rows.length) {
        await client.query(
          `INSERT INTO users (
             email, password_hash, role, display_name, reg_no, branch,
             status, force_password_change, is_demo
           ) VALUES (
             $1,$2,'student',$3,$4,$5,
             'approved',FALSE,FALSE
           )`,
          [email, passwordHash, name, reg, dept],
        )
      } else {
        // Ensure login works with Student@123 and approved status
        await client.query(
          `UPDATE users SET
             password_hash = $2,
             force_password_change = FALSE,
             status = 'approved',
             display_name = COALESCE(NULLIF(TRIM(display_name), ''), $3),
             reg_no = COALESCE(reg_no, $4),
             branch = COALESCE(NULLIF(TRIM(branch), ''), $5),
             deleted_at = NULL
           WHERE id = $1`,
          [usr.rows[0].id, passwordHash, name, reg, dept],
        )
      }

      await client.query("COMMIT")
      created.push({ reg, name, dept, email })
      console.log(`OK ${reg} | ${name}`)
    } catch (e) {
      await client.query("ROLLBACK")
      console.error(`FAIL ${reg}:`, e.message || e)
      skipped.push({ reg, error: String(e.message || e) })
    }
  }

  await client.end()

  const outDir = path.join(projectRoot, "tmp-c25", "result-sheets")
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    path.join(outDir, "backfill-students-summary.json"),
    JSON.stringify(
      {
        dry_run: DRY_RUN,
        password: DEFAULT_PASSWORD,
        created,
        skipped,
        count: created.length,
      },
      null,
      2,
    ),
    "utf8",
  )

  console.log("\nStudent create summary:", { created: created.length, skipped: skipped.length, dry_run: DRY_RUN })

  if (DRY_RUN) {
    console.log("Dry-run only — no DB writes, no result import.")
    return
  }

  // Re-run result import so the new students get Sem-2 results + CGPA
  console.log("\nRe-importing May 2026 Sem-2 results for all matched students...")
  const r = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "import-c25-sem2-results.mjs"), "--update-cgpa"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    },
  )
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  if (r.status !== 0) {
    console.error("Result import exited with", r.status)
    process.exit(r.status || 1)
  }
  console.log("\nAll done. Login ID = register number, password = Student@123")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
