/**
 * Strict bulk import of students from Excel.
 *
 * Rules (per user request):
 *  - Create login account + My Profile from Register Number
 *  - If reg already exists in DB → SKIP (list for manual work)
 *  - If reg is duplicated inside the Excel → SKIP all copies of that reg
 *  - If data is invalid / branch mismatch / bad email → SKIP (do not create)
 *
 * Usage:
 *   node scripts/import-students-excel.mjs "path/to/Student Data.xlsx"
 *   node scripts/import-students-excel.mjs --dry-run "path/to/file.xlsx"
 *
 * Default password for new accounts: Student@123 (force change on first login)
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { Client } from "pg"
import bcrypt from "bcryptjs"

const require = createRequire(import.meta.url)
const XLSX = require("xlsx")

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

const DEFAULT_PASSWORD = "Student@123"
const DRY_RUN = process.argv.includes("--dry-run")
const excelArg = process.argv.find((a) => !a.startsWith("-") && a.endsWith(".xlsx"))
const EXCEL_PATH =
  excelArg ||
  path.join(projectRoot, "scripts", "data", "Student Data.xlsx") ||
  path.join("C:/Users/aksha/Downloads", "Student Data.xlsx")

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
    lower.includes("computer") ||
    lower === "cse" ||
    lower.includes("cs &") ||
    lower.includes("cs and")
  ) {
    return "Computer Science and Engineering"
  }
  if (
    lower.includes("electron") ||
    lower.includes("ece") ||
    lower.includes("e&c") ||
    lower.includes("e & c")
  ) {
    return "Electronics and Communication Engineering"
  }
  if (lower.includes("mech")) return "Mechanical Engineering"
  return null // unknown = mismatch → skip
}

function str(v) {
  if (v == null) return ""
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel stores long IDs as numbers — keep full digits
    if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9) {
      return String(Math.round(v))
    }
    return String(v)
  }
  return String(v).replace(/\s+/g, " ").trim()
}

function cleanAadhar(v) {
  if (v == null || v === "") return ""
  let s = ""
  if (typeof v === "number" && Number.isFinite(v)) s = Math.round(v).toString()
  else s = String(v).replace(/\D/g, "")
  if (s.length !== 12) return "" // invalid / corrupted — omit field, don't invent
  return s
}

function cleanId(v) {
  if (v == null || v === "") return ""
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v).toString()
  const s = String(v).trim()
  if (/e\+/i.test(s)) return "" // scientific notation string = corrupted
  return s
}

function isValidEmail(email) {
  if (!email) return false
  // simple strict check
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false
  if (/@e\s*mail\.com/i.test(email)) return false
  if ((email.match(/@/g) || []).length !== 1) return false
  return true
}

function isValidReg(reg) {
  return /^[A-Z0-9]{6,20}$/.test(reg)
}

function formatDob(v) {
  const s = str(v)
  if (!s) return ""
  // already dd-mm-yyyy or similar
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(s)) return s.replace(/\//g, "-")
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-")
    return `${d}-${m}-${y}`
  }
  return s
}

function rowToProfile(row, reg, branch) {
  const nameSslc = str(row["Student Name As per SSLC Marks Card"])
  const nameAadhar = str(row["Student Name As Per Aadhar"])
  const father = str(row["Father Name"])
  const mother = str(row["Mother Name"])
  const aadhar = cleanAadhar(row["Aadhar Number"])
  const extra = {
    "Register Number": reg,
    Branch: branch,
    "Student (As per SSLC)": nameSslc,
    "Student (As per Aadhar)": nameAadhar || nameSslc,
    "Father Name": father,
    "Mother Name": mother,
    "Date of Birth": formatDob(row["Date Of Birth"]),
    Gender: str(row["Gender"]),
    "Aadhar Number": aadhar,
    "Aadhar Registered Mobile": str(row["Aadhar Registerd Mobile Number"]),
    "APAAR ID": cleanId(row["APAAR ID"]),
    "SSP ID": cleanId(row["SSP ID"]),
    "NSP ID": cleanId(row["NSP ID"]),
    "RD Number (Caste)": cleanId(row["RD Number caste"]),
    "RD Number (Income)": cleanId(row["RD Number Income"]),
    "Income (Annual)": cleanId(row["Income"]),
    Category: str(row["Category"]),
    Religion: str(row["Religion"]),
    Caste: str(row["Caste"]),
    "Physically Challenged?": str(row["Physically challenged ?"]),
    "WhatsApp Number": str(row["Student whatsapp Mobile Number"]),
    "Parents Mobile Number": str(row["Parents Mobile Number"]),
    "Valid E-mail ID": str(row["Valid E-mail ID"]).toLowerCase(),
    "Staying in Hostel?": str(row["Are you staying in Hostel ?"]),
    "Hostel Name": str(row["If yes mention Hostel Name"]),
    "Home Address": str(row["Home address"]).replace(/\r\n/g, "\n"),
    "Date of Admission": formatDob(row["Date and Year Of Admission"]),
    "Year of Admission": str(row["Year Of Admission"]),
    // Imported profiles are view-locked until admin unlocks edit
    profile_edit_locked: true,
    imported_from_excel: true,
    imported_at: new Date().toISOString(),
  }
  // Drop empty string keys (except locks)
  for (const k of Object.keys(extra)) {
    if (extra[k] === "" || extra[k] == null) delete extra[k]
  }
  return { name: nameSslc, father, mother, extra }
}

function loadRows(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Excel not found: ${filePath}`)
  }
  const wb = XLSX.readFile(filePath, { cellDates: true })
  const sheetName = wb.SheetNames.includes("Master") ? "Master" : wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    defval: "",
    raw: true,
  })
  return { sheetName, rows }
}

async function main() {
  console.log("=== Student Excel Import (strict) ===")
  console.log(DRY_RUN ? "MODE: DRY-RUN (no DB writes)" : "MODE: LIVE import")
  console.log("Excel:", EXCEL_PATH)

  const conn = resolveDb()
  if (!conn) {
    console.error("Missing DATABASE_URL in .env.local")
    process.exit(1)
  }

  const { sheetName, rows } = loadRows(EXCEL_PATH)
  console.log(`Sheet "${sheetName}": ${rows.length} rows`)

  // Detect duplicates inside file
  const regCounts = new Map()
  for (const row of rows) {
    const reg = str(row["Register Number"]).toUpperCase()
    if (!reg) continue
    regCounts.set(reg, (regCounts.get(reg) || 0) + 1)
  }
  const fileDupRegs = new Set(
    [...regCounts.entries()].filter(([, c]) => c > 1).map(([r]) => r),
  )

  const report = {
    created: [],
    skipped_duplicate_db: [],
    skipped_duplicate_file: [],
    skipped_invalid: [],
    errors: [],
  }

  // Pre-validate all rows
  const candidates = []
  const emailSeen = new Map()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const excelRow = i + 2 // header is row 1
    const reg = str(row["Register Number"]).toUpperCase()
    const name = str(row["Student Name As per SSLC Marks Card"])
    const branchRaw = str(row["Branch"])
    const branch = normalizeBranch(branchRaw)
    const emailRaw = str(row["Valid E-mail ID"]).toLowerCase()

    if (!reg) {
      report.skipped_invalid.push({
        excelRow,
        reg: "",
        reason: "Missing Register Number",
      })
      continue
    }
    if (!isValidReg(reg)) {
      report.skipped_invalid.push({
        excelRow,
        reg,
        reason: "Invalid Register Number format",
      })
      continue
    }
    if (fileDupRegs.has(reg)) {
      report.skipped_duplicate_file.push({
        excelRow,
        reg,
        reason: "Register Number repeated in Excel — handle manually",
        name,
      })
      continue
    }
    if (!name || name.length < 2) {
      report.skipped_invalid.push({
        excelRow,
        reg,
        reason: "Missing / invalid student name",
      })
      continue
    }
    if (!branch) {
      report.skipped_invalid.push({
        excelRow,
        reg,
        reason: `Branch mismatch / unknown: "${branchRaw}"`,
        name,
      })
      continue
    }
    if (!isValidEmail(emailRaw)) {
      report.skipped_invalid.push({
        excelRow,
        reg,
        reason: `Invalid email: "${emailRaw || "(empty)"}"`,
        name,
      })
      continue
    }
    if (emailSeen.has(emailRaw)) {
      report.skipped_invalid.push({
        excelRow,
        reg,
        reason: `Duplicate email in Excel (also used by ${emailSeen.get(emailRaw)})`,
        name,
      })
      continue
    }
    emailSeen.set(emailRaw, reg)

    const profile = rowToProfile(row, reg, branch)
    candidates.push({
      excelRow,
      reg,
      email: emailRaw,
      branch,
      name: profile.name,
      father: profile.father,
      extra: profile.extra,
    })
  }

  console.log(`Validated candidates: ${candidates.length}`)
  console.log(`Skipped (file dups): ${report.skipped_duplicate_file.length}`)
  console.log(`Skipped (invalid): ${report.skipped_invalid.length}`)

  const needsSsl = /neon\.tech|sslmode=require/i.test(conn)
  const client = new Client({
    connectionString: conn,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()

  try {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

    // Existing regs / emails
    const { rows: existingUsers } = await client.query(
      `SELECT lower(reg_no) AS reg, lower(email) AS email
         FROM users
        WHERE deleted_at IS NULL
          AND (reg_no IS NOT NULL OR email IS NOT NULL)`,
    )
    const existingRegs = new Set(
      existingUsers.map((r) => (r.reg || "").toUpperCase()).filter(Boolean),
    )
    const existingEmails = new Set(
      existingUsers.map((r) => (r.email || "").toLowerCase()).filter(Boolean),
    )

    const { rows: existingStudents } = await client.query(
      `SELECT upper(reg_no) AS reg FROM students`,
    )
    for (const r of existingStudents) {
      if (r.reg) existingRegs.add(String(r.reg).toUpperCase())
    }

    // Filter to rows we will actually insert
    const toInsert = []
    for (const c of candidates) {
      if (existingRegs.has(c.reg)) {
        report.skipped_duplicate_db.push({
          excelRow: c.excelRow,
          reg: c.reg,
          name: c.name,
          reason: "Register Number already exists in system",
        })
        continue
      }
      if (existingEmails.has(c.email)) {
        report.skipped_invalid.push({
          excelRow: c.excelRow,
          reg: c.reg,
          name: c.name,
          reason: `Email already used by another account: ${c.email}`,
        })
        continue
      }
      toInsert.push(c)
      existingRegs.add(c.reg)
      existingEmails.add(c.email)
    }

    console.log(`Will create: ${toInsert.length}`)

    if (DRY_RUN) {
      for (const c of toInsert) {
        report.created.push({
          excelRow: c.excelRow,
          reg: c.reg,
          name: c.name,
          email: c.email,
          branch: c.branch,
          dry_run: true,
        })
      }
    } else {
      // Batch insert (faster, fewer round-trips)
      const BATCH = 40
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const batch = toInsert.slice(i, i + BATCH)
        try {
          await client.query("BEGIN")
          for (const c of batch) {
            await client.query(
              `INSERT INTO users (
                 email, password_hash, role, display_name, reg_no, branch,
                 status, force_password_change, is_demo
               ) VALUES (
                 $1, $2, 'student', $3, $4, $5,
                 'approved', TRUE, FALSE
               )`,
              [c.email, passwordHash, c.name, c.reg, c.branch],
            )
            await client.query(
              `INSERT INTO students (reg_no, name, dept, year, father, extra)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)
               ON CONFLICT (reg_no) DO NOTHING`,
              [
                c.reg,
                c.name,
                c.branch,
                c.extra["Year of Admission"] || null,
                c.father || null,
                JSON.stringify(c.extra),
              ],
            )
            report.created.push({
              excelRow: c.excelRow,
              reg: c.reg,
              name: c.name,
              email: c.email,
              branch: c.branch,
            })
          }
          await client.query("COMMIT")
          console.log(`  … created ${Math.min(i + batch.length, toInsert.length)} / ${toInsert.length}`)
        } catch (err) {
          await client.query("ROLLBACK")
          // Fall back: insert this batch one-by-one so good rows still land
          for (const c of batch) {
            try {
              await client.query("BEGIN")
              await client.query(
                `INSERT INTO users (
                   email, password_hash, role, display_name, reg_no, branch,
                   status, force_password_change, is_demo
                 ) VALUES (
                   $1, $2, 'student', $3, $4, $5,
                   'approved', TRUE, FALSE
                 )`,
                [c.email, passwordHash, c.name, c.reg, c.branch],
              )
              await client.query(
                `INSERT INTO students (reg_no, name, dept, year, father, extra)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                 ON CONFLICT (reg_no) DO NOTHING`,
                [
                  c.reg,
                  c.name,
                  c.branch,
                  c.extra["Year of Admission"] || null,
                  c.father || null,
                  JSON.stringify(c.extra),
                ],
              )
              await client.query("COMMIT")
              report.created.push({
                excelRow: c.excelRow,
                reg: c.reg,
                name: c.name,
                email: c.email,
                branch: c.branch,
              })
            } catch (e2) {
              await client.query("ROLLBACK")
              report.errors.push({
                excelRow: c.excelRow,
                reg: c.reg,
                name: c.name,
                reason: e2.message || String(e2),
              })
            }
          }
          console.log(`  … batch ${i}-${i + batch.length} had errors; continued one-by-one`)
        }
      }
    }

    console.log("\n=== SUMMARY ===")
    console.log("Created:", report.created.length)
    console.log("Skipped (already in DB):", report.skipped_duplicate_db.length)
    console.log("Skipped (dup in Excel):", report.skipped_duplicate_file.length)
    console.log("Skipped (invalid/mismatch):", report.skipped_invalid.length)
    console.log("Errors:", report.errors.length)
    if (!DRY_RUN) {
      console.log(`\nDefault password for new accounts: ${DEFAULT_PASSWORD}`)
      console.log("Students must change password on first login.")
      console.log("Login with Register Number or Email.")
    }

    const outDir = path.join(projectRoot, "scripts", "data")
    mkdirSync(outDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const outPath = path.join(
      outDir,
      `import-report-${DRY_RUN ? "dryrun-" : ""}${stamp}.json`,
    )
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          when: new Date().toISOString(),
          dry_run: DRY_RUN,
          excel: EXCEL_PATH,
          default_password: DRY_RUN ? undefined : DEFAULT_PASSWORD,
          summary: {
            created: report.created.length,
            skipped_duplicate_db: report.skipped_duplicate_db.length,
            skipped_duplicate_file: report.skipped_duplicate_file.length,
            skipped_invalid: report.skipped_invalid.length,
            errors: report.errors.length,
          },
          ...report,
        },
        null,
        2,
      ),
    )
    console.log("\nFull report written to:", outPath)

    // Compact CSV of skipped for manual work
    const skipCsv = path.join(outDir, `import-skipped-${stamp}.csv`)
    const skipLines = [
      "reason_group,excel_row,reg_no,name,reason",
      ...report.skipped_duplicate_db.map(
        (r) =>
          `already_in_db,${r.excelRow},${r.reg},"${(r.name || "").replace(/"/g, '""')}",${r.reason}`,
      ),
      ...report.skipped_duplicate_file.map(
        (r) =>
          `dup_in_excel,${r.excelRow},${r.reg},"${(r.name || "").replace(/"/g, '""')}",${r.reason}`,
      ),
      ...report.skipped_invalid.map(
        (r) =>
          `invalid,${r.excelRow},${r.reg},"${(r.name || "").replace(/"/g, '""')}","${(r.reason || "").replace(/"/g, '""')}"`,
      ),
      ...report.errors.map(
        (r) =>
          `error,${r.excelRow},${r.reg},"${(r.name || "").replace(/"/g, '""')}","${(r.reason || "").replace(/"/g, '""')}"`,
      ),
    ]
    writeFileSync(skipCsv, skipLines.join("\n"), "utf8")
    console.log("Skipped list (manual):", skipCsv)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
