/**
 * Fix students whose branch was mis-mapped ECE → CSE because
 * "electronics and communication" contains the substring "cs and".
 *
 * Re-reads the same Excel and updates users.branch + students.dept
 * (+ students.extra.Branch) to the correct official branch.
 *
 * Usage:
 *   node scripts/fix-ece-branches.mjs
 *   node scripts/fix-ece-branches.mjs --dry-run
 *   node scripts/fix-ece-branches.mjs "path/to/Student Data.xlsx"
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { Client } from "pg"

const require = createRequire(import.meta.url)
const XLSX = require("xlsx")

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

const DRY_RUN = process.argv.includes("--dry-run")
const excelArg = process.argv.find((a) => !a.startsWith("-") && a.endsWith(".xlsx"))
const EXCEL_PATH =
  excelArg || path.join(projectRoot, "scripts", "data", "Student Data.xlsx")

const OFFICIAL = [
  "Civil Engineering",
  "Computer Science and Engineering",
  "Electronics and Communication Engineering",
  "Mechanical Engineering",
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
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
  return (
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    env.POSTGRES_PRISMA_URL ||
    env.DATABASE_URL_UNPOOLED ||
    null
  )
}

function normalizeBranch(input) {
  if (!input) return null
  const raw = String(input).replace(/\s+/g, " ").trim()
  if (!raw) return null
  if (OFFICIAL.includes(raw)) return raw
  const lower = raw.toLowerCase()
  if (lower.includes("civil")) return "Civil Engineering"
  if (
    lower.includes("electron") ||
    lower.includes("ece") ||
    lower.includes("e&c") ||
    lower.includes("e & c") ||
    lower.includes("e and c")
  ) {
    return "Electronics and Communication Engineering"
  }
  if (
    lower.includes("computer") ||
    lower === "cse" ||
    lower.includes("cs &") ||
    lower.includes("cs and") ||
    lower.includes("cse ")
  ) {
    return "Computer Science and Engineering"
  }
  if (lower.includes("mech")) return "Mechanical Engineering"
  return null
}

function str(v) {
  if (v == null) return ""
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9) {
      return String(Math.round(v))
    }
    return String(v)
  }
  return String(v).replace(/\s+/g, " ").trim()
}

async function main() {
  console.log("=== Fix ECE / branch mis-maps from Excel ===")
  console.log(DRY_RUN ? "MODE: DRY-RUN" : "MODE: LIVE update")
  console.log("Excel:", EXCEL_PATH)

  if (!existsSync(EXCEL_PATH)) {
    console.error("Excel not found:", EXCEL_PATH)
    process.exit(1)
  }

  const conn = resolveDb()
  if (!conn) {
    console.error("Missing DATABASE_URL in .env.local")
    process.exit(1)
  }

  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true })
  const sheetName = wb.SheetNames.includes("Master") ? "Master" : wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", raw: true })
  console.log(`Sheet "${sheetName}": ${rows.length} rows`)

  // Build arrays of regs per correct branch (only ECE fixes needed primarily, but fix all mismatches)
  /** @type {Map<string, string>} */
  const correctByReg = new Map()
  const excelBranchCounts = {}
  for (const row of rows) {
    const reg = str(row["Register Number"]).toUpperCase()
    if (!reg) continue
    const branch = normalizeBranch(str(row["Branch"]))
    if (!branch) continue
    correctByReg.set(reg, branch)
    excelBranchCounts[branch] = (excelBranchCounts[branch] || 0) + 1
  }
  console.log("Excel branch counts (normalized):", excelBranchCounts)

  // Group regs by correct branch for bulk UPDATE
  /** @type {Map<string, string[]>} */
  const regsByBranch = new Map()
  for (const [reg, branch] of correctByReg) {
    if (!regsByBranch.has(branch)) regsByBranch.set(branch, [])
    regsByBranch.get(branch).push(reg)
  }

  const needsSsl = /neon\.tech|sslmode=require/i.test(conn)
  const client = new Client({
    connectionString: conn,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 30000,
    query_timeout: 120000,
  })
  await client.connect()
  console.log("DB connected")

  const report = {
    when: new Date().toISOString(),
    dry_run: DRY_RUN,
    users_updated: 0,
    students_updated: 0,
    by_branch: {},
    ece_missing_from_db: [],
    sample_fixes: [],
    errors: [],
  }

  try {
    // Snapshot current wrong ECE-as-CSE before fix (for report)
    const { rows: wrongEce } = await client.query(
      `SELECT upper(reg_no) AS reg, display_name, branch
         FROM users
        WHERE role = 'student'
          AND deleted_at IS NULL
          AND reg_no IS NOT NULL
          AND (
            upper(reg_no) LIKE '%EC%'
            OR COALESCE(branch,'') ILIKE '%electron%'
            OR COALESCE(branch,'') = 'Computer Science and Engineering'
          )
        LIMIT 20`,
    )
    report.sample_before = wrongEce.slice(0, 8)

    if (DRY_RUN) {
      for (const [branch, regs] of regsByBranch) {
        const { rows: u } = await client.query(
          `SELECT count(*)::int AS n FROM users
            WHERE role = 'student' AND deleted_at IS NULL
              AND upper(reg_no) = ANY($1::text[])
              AND COALESCE(branch,'') IS DISTINCT FROM $2`,
          [regs, branch],
        )
        const { rows: s } = await client.query(
          `SELECT count(*)::int AS n FROM students
            WHERE upper(reg_no) = ANY($1::text[])
              AND COALESCE(dept,'') IS DISTINCT FROM $2`,
          [regs, branch],
        )
        report.by_branch[branch] = { users_need_fix: u[0].n, students_need_fix: s[0].n }
        report.users_updated += u[0].n
        report.students_updated += s[0].n
      }
    } else {
      await client.query("BEGIN")
      try {
        for (const [branch, regs] of regsByBranch) {
          // Batch in chunks of 200 to keep query size reasonable
          let uTotal = 0
          let sTotal = 0
          for (let i = 0; i < regs.length; i += 200) {
            const chunk = regs.slice(i, i + 200)
            const uRes = await client.query(
              `UPDATE users SET branch = $1
                 WHERE role = 'student' AND deleted_at IS NULL
                   AND upper(reg_no) = ANY($2::text[])
                   AND COALESCE(branch,'') IS DISTINCT FROM $1`,
              [branch, chunk],
            )
            const sRes = await client.query(
              `UPDATE students
                  SET dept = $1,
                      extra = jsonb_set(COALESCE(extra, '{}'::jsonb), '{Branch}', to_jsonb($1::text), true)
                 WHERE upper(reg_no) = ANY($2::text[])
                   AND (
                     COALESCE(dept,'') IS DISTINCT FROM $1
                     OR COALESCE(extra->>'Branch','') IS DISTINCT FROM $1
                   )`,
              [branch, chunk],
            )
            uTotal += uRes.rowCount || 0
            sTotal += sRes.rowCount || 0
          }
          report.by_branch[branch] = { users_updated: uTotal, students_updated: sTotal }
          report.users_updated += uTotal
          report.students_updated += sTotal
          console.log(`  ${branch}: users=${uTotal} students=${sTotal}`)
        }
        await client.query("COMMIT")
        console.log("COMMIT ok")
      } catch (err) {
        await client.query("ROLLBACK")
        throw err
      }
    }

    // ECE in Excel not in DB
    const eceRegs = regsByBranch.get("Electronics and Communication Engineering") || []
    if (eceRegs.length) {
      const { rows: present } = await client.query(
        `SELECT upper(reg_no) AS reg FROM users
          WHERE role = 'student' AND deleted_at IS NULL
            AND upper(reg_no) = ANY($1::text[])`,
        [eceRegs],
      )
      const have = new Set(present.map((r) => r.reg))
      report.ece_missing_from_db = eceRegs.filter((r) => !have.has(r))
    }

    // Sample after
    const { rows: eceNow } = await client.query(
      `SELECT count(*)::int AS n FROM users
        WHERE role = 'student' AND deleted_at IS NULL
          AND branch = 'Electronics and Communication Engineering'`,
    )
    const { rows: byBranch } = await client.query(
      `SELECT COALESCE(branch,'(null)') AS branch, count(*)::int AS n
         FROM users WHERE role = 'student' AND deleted_at IS NULL
         GROUP BY 1 ORDER BY n DESC`,
    )
    report.ece_users_now = eceNow[0].n
    report.users_by_branch = byBranch

    console.log("Users updated:", report.users_updated)
    console.log("Students updated:", report.students_updated)
    console.log("ECE users now:", report.ece_users_now)
    console.log("Users by branch:", byBranch)
    console.log("ECE missing from DB:", report.ece_missing_from_db.length)
    if (report.ece_missing_from_db.length) {
      console.log("  ", report.ece_missing_from_db.join(", "))
    }

    const outDir = path.join(projectRoot, "scripts", "data")
    mkdirSync(outDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const outPath = path.join(outDir, `fix-branches-${DRY_RUN ? "dryrun-" : ""}${stamp}.json`)
    writeFileSync(outPath, JSON.stringify(report, null, 2))
    console.log("Report:", outPath)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
