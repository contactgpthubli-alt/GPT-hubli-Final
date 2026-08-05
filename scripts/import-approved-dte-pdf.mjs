/**
 * Import DTE "Approved Candidates" PDF (2026-27 Non-Interactive admission list).
 *
 * Rules:
 *  - Appln ID → temporary register number (and login ID)
 *  - When real reg nos arrive, update reg_no later
 *  - Default password: Test@123, force_password_change = true
 *  - Status: approved (can login immediately)
 *  - admission_academic_year = 2026-27, current_study_year = 1, entry_type regular/lateral
 *  - Profile fields from PDF: name, father, DOB, gender, category, income, mobile, mode
 *
 * Usage:
 *   node scripts/import-approved-dte-pdf.mjs --dry-run "c:/Users/aksha/Downloads/APPROVED-....pdf"
 *   node scripts/import-approved-dte-pdf.mjs "c:/Users/aksha/Downloads/APPROVED-....pdf"
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

const DEFAULT_PASSWORD = "Test@123"
const ADMISSION_AY = "2026-27"
const DRY_RUN = process.argv.includes("--dry-run")
const pdfArg = process.argv.find((a) => !a.startsWith("-") && a.toLowerCase().endsWith(".pdf"))
const PDF_PATH =
  pdfArg ||
  path.join("C:/Users/aksha/Downloads", "APPROVED-2026-07-08-07-21-53-list.pdf")

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
  const lower = String(input).toLowerCase()
  if (lower.includes("civil")) return "Civil Engineering"
  if (lower.includes("electron") || lower.includes("ece") || lower.includes("communication")) {
    return "Electronics and Communication Engineering"
  }
  if (lower.includes("computer") || lower.includes("cse")) {
    return "Computer Science and Engineering"
  }
  if (lower.includes("mech")) return "Mechanical Engineering"
  return null
}

function normalizeApplId(raw) {
  if (!raw) return ""
  // Join split cells: "DTE262700000\n422" → DTE262700000422
  const s = String(raw).replace(/\s+/g, "").toUpperCase()
  if (!/^DTE\d{10,}$/.test(s)) return ""
  return s
}

function cleanCell(c) {
  return String(c ?? "")
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function formatDob(raw) {
  const s = cleanCell(raw).replace(/\s*12:00:00\s*AM/i, "").trim()
  if (!s) return ""
  // M/D/YYYY or MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const dd = m[2].padStart(2, "0")
    const mm = m[1].padStart(2, "0")
    // PDF uses US-style M/D/YYYY
    return `${dd}-${mm}-${m[3]}`
  }
  return s
}

function genderLabel(g) {
  const x = cleanCell(g).toUpperCase()
  if (x === "M") return "Male"
  if (x === "F") return "Female"
  return cleanCell(g)
}

/**
 * Parse PDF line-by-line in reading order.
 * Critical: when "Course :" appears mid-page, only LATER students get that branch.
 * Table-based parse was wrong (used last header for whole page).
 */
function parsePdfStudents(pdfPath) {
  const scriptPath = path.join(projectRoot, "tmp-c20", "_import_parse_pdf.py")
  mkdirSync(path.dirname(scriptPath), { recursive: true })
  writeFileSync(
    scriptPath,
    `import pdfplumber, re, json, sys
fp = sys.argv[1]

def norm_branch(c):
    if not c: return None
    l = c.lower()
    if "civil" in l: return "Civil Engineering"
    if "electron" in l or "communication" in l: return "Electronics and Communication Engineering"
    if "computer" in l: return "Computer Science and Engineering"
    if "mech" in l: return "Mechanical Engineering"
    return None

students = []
course = None
adm_type = "REGULAR"
pending = None
pat = re.compile(
    r"^(\\d+)\\s+(DTE\\d+)\\s+(.+?)\\s+(\\d{1,2}/\\d{1,2}/\\d{4})\\s+([MF])\\s+(\\S+)\\s+(\\d*)\\s*(\\d{10})\\s+(ONLINE|OFFLINE)\\s*$"
)

def flush():
    global pending
    if pending and pending.get("appl_id") and pending.get("branch"):
        students.append(pending)
    pending = None

with pdfplumber.open(fp) as doc:
    for pg in doc.pages:
        for ln in (pg.extract_text() or "").splitlines():
            m = re.search(r"Course\\s*:\\s*(.+)", ln, re.I)
            if m:
                flush()
                course = m.group(1).strip()
                continue
            m2 = re.search(r"Admission Type\\s*:\\s*(.+)", ln, re.I)
            if m2:
                adm_type = m2.group(1).strip()
                continue
            m = pat.match(ln.strip())
            if m:
                flush()
                pending = {
                    "sno": m.group(1),
                    "appl_prefix": m.group(2),
                    "mid": m.group(3).strip(),
                    "dob": m.group(4),
                    "gender": m.group(5),
                    "category": m.group(6),
                    "income": m.group(7),
                    "mobile": m.group(8),
                    "admission_mode": m.group(9),
                    "branch": norm_branch(course),
                    "course_raw": course,
                    "admission_type": adm_type,
                }
                continue
            if pending is not None and "appl_id" not in pending:
                if re.search(r"DTE|ONLINE|OFFLINE|Course|Admission|Gender|Generated|Candidate", ln, re.I):
                    continue
                m3 = re.match(r"^(\\d{2,4})(?:\\s+(.*?))?\\s*(?:12:00:00\\s*AM)?\\s*$", ln.strip(), re.I)
                if m3 and re.match(r"^\\d{2,4}\\b", ln.strip()):
                    pending["appl_id"] = pending["appl_prefix"] + m3.group(1)
                    cont = (m3.group(2) or "").replace("12:00:00 AM", "").strip()
                    pending["name"] = re.sub(r"\\s+", " ", pending["mid"] + ((" " + cont) if cont else "")).strip()
                    pending["father"] = ""
                    continue
flush()

out = []
seen = set()
for s in students:
    aid = s.get("appl_id") or ""
    if not re.match(r"^DTE\\d{12}$", aid) or aid in seen:
        continue
    if not s.get("branch") or not s.get("name"):
        continue
    seen.add(aid)
    out.append(s)
print(json.dumps({"count": len(out), "students": out}, ensure_ascii=False))
`,
    "utf8",
  )
  const r = spawnSync("python", [scriptPath, pdfPath], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  })
  if (r.status !== 0) {
    throw new Error(`PDF parse failed: ${r.stderr || r.stdout || r.status}`)
  }
  const raw = (r.stdout || "").trim()
  const line = raw.split(/\r?\n/).filter(Boolean).pop()
  const data = JSON.parse(line)
  return data.students || []
}

function syntheticEmail(applId) {
  // Unique, valid-format email; login also works with reg_no (Appln ID)
  const local = applId.toLowerCase().replace(/[^a-z0-9]/g, "")
  return `${local}@student.gpthubli.ac.in`
}

function buildExtra(s) {
  const reg = s.appl_id
  const extra = {
    "Register Number": reg,
    "Application ID": reg,
    "Temporary Reg No": true,
    Branch: s.branch,
    "Student (As per SSLC)": s.name,
    "Father Name": s.father || "",
    "Date of Birth": formatDob(s.dob),
    Gender: genderLabel(s.gender),
    Category: s.category || "",
    "Income (Annual)": s.income || "",
    "WhatsApp Number": s.mobile || "",
    "Aadhar Registered Mobile": s.mobile || "",
    "Parents Mobile Number": s.mobile || "",
    "Admission Mode": s.admission_mode || "",
    "Admission Type": s.admission_type || "REGULAR",
    "Year of Admission": ADMISSION_AY,
    "Admission Academic Year": ADMISSION_AY,
    "Date of Admission": "2026-07",
    "Current Year": "1st Year",
    profile_edit_locked: true,
    imported_from_dte_pdf: true,
    imported_at: new Date().toISOString(),
    source_pdf: path.basename(PDF_PATH),
    syllabus_scheme: "C-25", // 2026-27 batch → C-25 (subjects to be loaded later)
  }
  for (const k of Object.keys(extra)) {
    if (extra[k] === "" || extra[k] == null) delete extra[k]
  }
  return extra
}

async function main() {
  console.log("=== DTE Approved Candidates PDF Import (2026-27) ===")
  console.log(DRY_RUN ? "MODE: DRY-RUN" : "MODE: LIVE")
  console.log("PDF:", PDF_PATH)
  console.log("Default password:", DEFAULT_PASSWORD, "| force change on first login")
  console.log("Login ID: Application ID (temporary reg_no)")

  if (!existsSync(PDF_PATH)) throw new Error("PDF not found: " + PDF_PATH)

  const parsed = parsePdfStudents(PDF_PATH)
  console.log(`Parsed students: ${parsed.length}`)

  // Branch counts
  const byBranch = {}
  for (const s of parsed) {
    byBranch[s.branch] = (byBranch[s.branch] || 0) + 1
  }
  console.log("By branch:", byBranch)

  const candidates = parsed.map((s) => {
    const reg = s.appl_id
    const entryType = /lateral/i.test(s.admission_type || "") ? "lateral" : "regular"
    return {
      reg,
      name: s.name,
      father: s.father || null,
      branch: s.branch,
      email: syntheticEmail(reg),
      entryType,
      mobile: s.mobile || null,
      extra: buildExtra(s),
      raw: s,
    }
  })

  const report = {
    source: PDF_PATH,
    admission_ay: ADMISSION_AY,
    password: DEFAULT_PASSWORD,
    dry_run: DRY_RUN,
    parsed: candidates.length,
    created: [],
    skipped: [],
    errors: [],
  }

  if (DRY_RUN) {
    for (const c of candidates.slice(0, 5)) {
      console.log(" sample:", c.reg, c.name, c.branch, c.email)
    }
    report.created = candidates.map((c) => ({
      reg: c.reg,
      name: c.name,
      branch: c.branch,
      email: c.email,
      dry_run: true,
    }))
    const outDir = path.join(projectRoot, "tmp-c20")
    mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, "import-2026-27-dry-run.json")
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8")
    console.log("Dry-run report:", outPath)
    console.log("Would create:", candidates.length)
    return
  }

  const dbUrl = resolveDb()
  if (!dbUrl) throw new Error("DATABASE_URL not found in .env / .env.local")

  const client = new Client({ connectionString: dbUrl, ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false } })
  await client.connect()
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

  try {
    // Existing regs / emails
    const { rows: existing } = await client.query(
      `SELECT reg_no, lower(email) AS email FROM users
        WHERE role = 'student' AND deleted_at IS NULL`,
    )
    const existingRegs = new Set(existing.map((r) => String(r.reg_no || "").toUpperCase()).filter(Boolean))
    const existingEmails = new Set(existing.map((r) => r.email).filter(Boolean))

    // Ensure academic columns
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_academic_year TEXT`)
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'regular'`)
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS entry_study_year INT DEFAULT 1`)
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS current_study_year INT`)
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_status TEXT DEFAULT 'active'`)

    let n = 0
    for (const c of candidates) {
      if (existingRegs.has(c.reg.toUpperCase())) {
        report.skipped.push({ reg: c.reg, name: c.name, reason: "reg_no already exists" })
        continue
      }
      if (existingEmails.has(c.email.toLowerCase())) {
        report.skipped.push({ reg: c.reg, name: c.name, reason: "email already exists" })
        continue
      }

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
          `INSERT INTO students (
             reg_no, name, dept, year, father, extra,
             admission_academic_year, entry_type, entry_study_year,
             current_study_year, academic_status, progress_locked
           ) VALUES (
             $1, $2, $3, $4, $5, $6::jsonb,
             $7, $8, $9,
             $10, 'active', FALSE
           )
           ON CONFLICT (reg_no) DO UPDATE SET
             name = EXCLUDED.name,
             dept = EXCLUDED.dept,
             year = EXCLUDED.year,
             father = COALESCE(EXCLUDED.father, students.father),
             extra = COALESCE(students.extra, '{}'::jsonb) || EXCLUDED.extra,
             admission_academic_year = EXCLUDED.admission_academic_year,
             entry_type = EXCLUDED.entry_type,
             entry_study_year = EXCLUDED.entry_study_year,
             current_study_year = EXCLUDED.current_study_year`,
          [
            c.reg,
            c.name,
            c.branch,
            "1st Year",
            c.father,
            JSON.stringify(c.extra),
            ADMISSION_AY,
            c.entryType,
            c.entryType === "lateral" ? 2 : 1,
            c.entryType === "lateral" ? 2 : 1,
          ],
        )
        await client.query("COMMIT")
        existingRegs.add(c.reg.toUpperCase())
        existingEmails.add(c.email.toLowerCase())
        report.created.push({ reg: c.reg, name: c.name, branch: c.branch, email: c.email })
        n++
        if (n % 25 === 0) console.log(`  … created ${n}`)
      } catch (e) {
        await client.query("ROLLBACK")
        report.errors.push({ reg: c.reg, name: c.name, error: e.message || String(e) })
      }
    }

    console.log("Created:", report.created.length)
    console.log("Skipped:", report.skipped.length)
    console.log("Errors:", report.errors.length)
  } finally {
    await client.end()
  }

  const outDir = path.join(projectRoot, "tmp-c20")
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `import-2026-27-${DRY_RUN ? "dry" : "live"}.json`)
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8")
  console.log("Report:", outPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
