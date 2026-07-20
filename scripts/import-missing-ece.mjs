/**
 * Import the few ECE students skipped by the strict bulk import
 * (invalid emails, file-duplicate regs, shared emails).
 *
 * For bad/duplicate emails uses: {reg_lower}@student.gpthubli.local
 * For file-duplicate regs keeps the first Excel row only.
 *
 * Usage: node scripts/import-missing-ece.mjs [--dry-run]
 */
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { Client } from "pg"
import bcrypt from "bcryptjs"

const require = createRequire(import.meta.url)
const XLSX = require("xlsx")

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, "..")
const DRY_RUN = process.argv.includes("--dry-run")
const EXCEL_PATH = path.join(projectRoot, "scripts", "data", "Student Data.xlsx")
const DEFAULT_PASSWORD = "Student@123"
const ECE = "Electronics and Communication Engineering"

const MISSING = [
  "171EC19052",
  "171EC20001",
  "171EC20007",
  "171EC20018",
  "171EC20029",
  "171EC21021",
  "171EC21055",
  "171EC21305",
  "171EC22063",
  "171EC24060",
  "171EC25012",
  "171EC25026",
  "171EC25056",
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
  return env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || null
}

function str(v) {
  if (v == null) return ""
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
    return String(v)
  }
  return String(v).replace(/\s+/g, " ").trim()
}

function isValidEmail(email) {
  if (!email) return false
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false
  if (/@e\s*mail\.com/i.test(email)) return false
  if ((email.match(/@/g) || []).length !== 1) return false
  // reject known-bad domains used as placeholders in Excel
  if (/@email\.com$/i.test(email)) return false
  if (/@gamil/i.test(email)) return false
  return true
}

function cleanEmail(raw) {
  let e = str(raw).toLowerCase().replace(/\s+/g, "")
  e = e.replace(/,com$/, ".com").replace(/@gmail$/, "@gmail.com")
  return e
}

function formatDob(v) {
  const s = str(v)
  if (!s) return ""
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(s)) return s.replace(/\//g, "-")
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-")
    return `${d}-${m}-${y}`
  }
  return s
}

async function main() {
  console.log("=== Import missing ECE students ===")
  console.log(DRY_RUN ? "MODE: DRY-RUN" : "MODE: LIVE")
  const want = new Set(MISSING)
  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Master"] || wb.Sheets[wb.SheetNames[0]], {
    defval: "",
    raw: true,
  })

  // first occurrence wins for duplicate regs
  const byReg = new Map()
  for (const row of rows) {
    const reg = str(row["Register Number"]).toUpperCase()
    if (!want.has(reg) || byReg.has(reg)) continue
    byReg.set(reg, row)
  }

  const conn = resolveDb()
  if (!conn) {
    console.error("Missing DATABASE_URL")
    process.exit(1)
  }
  const client = new Client({
    connectionString: conn,
    ssl: /neon\.tech|sslmode=require/i.test(conn) ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

  const { rows: existing } = await client.query(
    `SELECT upper(reg_no) AS reg, lower(email) AS email FROM users WHERE deleted_at IS NULL`,
  )
  const haveReg = new Set(existing.map((r) => r.reg).filter(Boolean))
  const haveEmail = new Set(existing.map((r) => r.email).filter(Boolean))

  let created = 0
  for (const reg of MISSING) {
    if (haveReg.has(reg)) {
      console.log("skip already exists", reg)
      continue
    }
    const row = byReg.get(reg)
    if (!row) {
      console.log("skip not in excel", reg)
      continue
    }
    const name = str(row["Student Name As per SSLC Marks Card"])
    let email = cleanEmail(row["Valid E-mail ID"])
    let emailNote = "excel"
    if (!isValidEmail(email) || haveEmail.has(email)) {
      email = `${reg.toLowerCase()}@student.gpthubli.local`
      emailNote = "fallback-local"
    }
    if (haveEmail.has(email)) {
      email = `${reg.toLowerCase()}.${Date.now()}@student.gpthubli.local`
      emailNote = "fallback-unique"
    }

    const father = str(row["Father Name"])
    const mother = str(row["Mother Name"])
    const extra = {
      "Register Number": reg,
      Branch: ECE,
      "Student (As per SSLC)": name,
      "Student (As per Aadhar)": str(row["Student Name As Per Aadhar"]) || name,
      "Father Name": father,
      "Mother Name": mother,
      "Date of Birth": formatDob(row["Date Of Birth"]),
      Gender: str(row["Gender"]),
      "Valid E-mail ID": email,
      "WhatsApp Number": str(row["Student whatsapp Mobile Number"]),
      "Parents Mobile Number": str(row["Parents Mobile Number"]),
      "Home Address": str(row["Home address"]).replace(/\r\n/g, "\n"),
      "Year of Admission": str(row["Year Of Admission"]),
      profile_edit_locked: true,
      imported_from_excel: true,
      imported_missing_ece: true,
      email_source: emailNote,
      imported_at: new Date().toISOString(),
    }
    for (const k of Object.keys(extra)) {
      if (extra[k] === "" || extra[k] == null) delete extra[k]
    }

    console.log(`${DRY_RUN ? "would create" : "create"}`, reg, name, email, `(${emailNote})`)
    if (DRY_RUN) {
      created++
      continue
    }

    await client.query("BEGIN")
    try {
      await client.query(
        `INSERT INTO users (
           email, password_hash, role, display_name, reg_no, branch,
           status, force_password_change, is_demo
         ) VALUES ($1, $2, 'student', $3, $4, $5, 'approved', TRUE, FALSE)`,
        [email, hash, name, reg, ECE],
      )
      await client.query(
        `INSERT INTO students (reg_no, name, dept, year, father, extra)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (reg_no) DO UPDATE SET
           name = EXCLUDED.name,
           dept = EXCLUDED.dept,
           year = COALESCE(EXCLUDED.year, students.year),
           father = COALESCE(EXCLUDED.father, students.father),
           extra = EXCLUDED.extra`,
        [reg, name, ECE, str(row["Year Of Admission"]) || null, father || null, JSON.stringify(extra)],
      )
      await client.query("COMMIT")
      created++
      haveReg.add(reg)
      haveEmail.add(email)
    } catch (err) {
      await client.query("ROLLBACK")
      console.error("FAIL", reg, err.message)
    }
  }

  const { rows: eceCount } = await client.query(
    `SELECT count(*)::int AS n FROM users
      WHERE role='student' AND deleted_at IS NULL
        AND branch = $1`,
    [ECE],
  )
  console.log("Created:", created)
  console.log("ECE users total now:", eceCount[0].n)
  console.log("Default password:", DEFAULT_PASSWORD, "(force change on first login)")
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
