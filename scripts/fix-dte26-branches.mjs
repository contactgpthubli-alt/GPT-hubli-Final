/**
 * Fix DTE26 student branches using text-order PDF parse
 * (Course header switches mid-page must apply only to rows AFTER the header).
 *
 * Usage:
 *   node scripts/fix-dte26-branches.mjs --dry-run
 *   node scripts/fix-dte26-branches.mjs
 *   node scripts/fix-dte26-branches.mjs --import-missing
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { Client } from "pg"
import bcrypt from "bcryptjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const DRY = process.argv.includes("--dry-run")
const IMPORT_MISSING = process.argv.includes("--import-missing")
const PDF =
  process.argv.find((a) => a.toLowerCase().endsWith(".pdf") && !a.startsWith("-")) ||
  path.join("C:/Users/aksha/Downloads", "APPROVED-2026-07-08-07-21-53-list.pdf")
const DEFAULT_PASSWORD = "Test@123"
const ADMISSION_AY = "2026-27"

function parseEnv(f) {
  if (!existsSync(f)) return {}
  const o = {}
  for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = l.trim()
    if (!t || t.startsWith("#")) continue
    const e = t.indexOf("=")
    if (e < 0) continue
    let v = t.slice(e + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    o[t.slice(0, e).trim()] = v
  }
  return o
}

function resolveDb() {
  const e = { ...parseEnv(path.join(root, ".env")), ...parseEnv(path.join(root, ".env.local")), ...process.env }
  return e.DATABASE_URL || e.POSTGRES_URL || e.POSTGRES_PRISMA_URL || null
}

function parsePdfTextOrder(pdfPath) {
  const scriptPath = path.join(root, "tmp-c20", "_parse_pdf_text_order.py")
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
            m = pat.match(ln.strip())
            if m:
                flush()
                pending = {
                    "sno": int(m.group(1)),
                    "appl_prefix": m.group(2),
                    "mid": m.group(3).strip(),
                    "dob": m.group(4),
                    "gender": m.group(5),
                    "category": m.group(6),
                    "income": m.group(7),
                    "mobile": m.group(8),
                    "mode": m.group(9),
                    "branch": norm_branch(course),
                    "course_raw": course,
                }
                continue
            if pending is not None and "appl_id" not in pending:
                if re.search(r"DTE|ONLINE|OFFLINE|Course|Admission|Gender|Generated|Candidate", ln, re.I):
                    continue
                m3 = re.match(r"^(\\d{2,4})(?:\\s+(.*?))?\\s*(?:12:00:00\\s*AM)?\\s*$", ln.strip(), re.I)
                if m3 and re.match(r"^\\d{2,4}\\b", ln.strip()):
                    pending["appl_id"] = pending["appl_prefix"] + m3.group(1)
                    cont = (m3.group(2) or "").replace("12:00:00 AM", "").strip()
                    pending["name_raw"] = pending["mid"] + ((" " + cont) if cont else "")
                    continue
flush()

out = []
seen = set()
for s in students:
    aid = s.get("appl_id") or ""
    if not re.match(r"^DTE\\d{12}$", aid) or aid in seen:
        continue
    if not s.get("branch"):
        continue
    name = re.sub(r"\\s+", " ", (s.get("name_raw") or s.get("mid") or "")).strip()
    if not name:
        continue
    # Prefer candidate name before father: keep full mid for profile (admin can clean)
    # Strip trailing father-ish duplication is hard; store mid as name source
    seen.add(aid)
    out.append({
        "appl_id": aid,
        "name": name,
        "branch": s["branch"],
        "course_raw": s["course_raw"],
        "sno": s["sno"],
        "dob": s.get("dob") or "",
        "gender": s.get("gender") or "",
        "category": s.get("category") or "",
        "income": s.get("income") or "",
        "mobile": s.get("mobile") or "",
        "mode": s.get("mode") or "",
    })
print(json.dumps(out, ensure_ascii=False))
`,
    "utf8",
  )
  const r = spawnSync("python", [scriptPath, pdfPath], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || String(r.status))
  const line = (r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop()
  return JSON.parse(line)
}

function formatDob(raw) {
  const s = String(raw || "").replace(/\s*12:00:00\s*AM/i, "").trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}-${m[3]}`
  return s
}

function genderLabel(g) {
  if (g === "M") return "Male"
  if (g === "F") return "Female"
  return g || ""
}

function buildExtra(s) {
  const reg = s.appl_id
  const extra = {
    "Register Number": reg,
    "Application ID": reg,
    "Temporary Reg No": true,
    Branch: s.branch,
    "Student (As per SSLC)": s.name,
    "Date of Birth": formatDob(s.dob),
    Gender: genderLabel(s.gender),
    Category: s.category || "",
    "Income (Annual)": s.income || "",
    "WhatsApp Number": s.mobile || "",
    "Aadhar Registered Mobile": s.mobile || "",
    "Admission Mode": s.mode || "",
    "Year of Admission": ADMISSION_AY,
    "Admission Academic Year": ADMISSION_AY,
    "Current Year": "1st Year",
    profile_edit_locked: true,
    imported_from_dte_pdf: true,
    branch_source: "pdf_text_order",
    branch_fixed_at: new Date().toISOString(),
    syllabus_scheme: "C-25",
  }
  for (const k of Object.keys(extra)) {
    if (extra[k] === "" || extra[k] == null) delete extra[k]
  }
  return extra
}

async function main() {
  console.log(DRY ? "=== DRY-RUN branch fix ===" : "=== LIVE branch fix ===")
  console.log("PDF:", PDF)
  const pdfStudents = parsePdfTextOrder(PDF)
  console.log("PDF (text-order) students:", pdfStudents.length)
  const byPdf = {}
  for (const s of pdfStudents) byPdf[s.branch] = (byPdf[s.branch] || 0) + 1
  console.log("PDF by branch:", byPdf)

  const map = new Map(pdfStudents.map((s) => [s.appl_id.toUpperCase(), s]))
  const dbUrl = resolveDb()
  if (!dbUrl) throw new Error("No DATABASE_URL")
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const { rows } = await client.query(
    `SELECT u.id, u.reg_no, u.display_name, u.branch AS user_branch, s.dept AS student_dept
       FROM users u
       LEFT JOIN students s ON s.reg_no = u.reg_no
      WHERE u.role = 'student' AND u.deleted_at IS NULL AND u.reg_no LIKE 'DTE26%'
      ORDER BY u.reg_no`,
  )
  console.log("DB DTE26:", rows.length)

  const mismatches = []
  for (const r of rows) {
    const pdf = map.get(String(r.reg_no).toUpperCase())
    if (!pdf) continue
    const dbBranch = (r.student_dept || r.user_branch || "").trim()
    if (dbBranch !== pdf.branch || (r.user_branch || "").trim() !== pdf.branch) {
      mismatches.push({
        reg: r.reg_no,
        name: r.display_name,
        db_dept: r.student_dept,
        db_user_branch: r.user_branch,
        pdf_branch: pdf.branch,
        pdf_name: pdf.name,
        course: pdf.course_raw,
      })
    }
  }

  const missingInDb = pdfStudents.filter(
    (s) => !rows.find((r) => String(r.reg_no).toUpperCase() === s.appl_id),
  )
  const missingInPdf = rows.filter((r) => !map.has(String(r.reg_no).toUpperCase()))

  console.log("Branch mismatches:", mismatches.length)
  if (mismatches.length) {
    const sample = mismatches.slice(0, 15)
    for (const m of sample) {
      console.log(
        `  ${m.reg}: DB="${m.db_dept}" / user.branch="${m.db_user_branch}" → PDF="${m.pdf_branch}" (${m.course})`,
      )
    }
  }
  console.log("In PDF not in DB:", missingInDb.length)
  console.log("In DB not in PDF:", missingInPdf.length)

  let fixed = 0
  if (!DRY) {
    for (const m of mismatches) {
      await client.query(`UPDATE users SET branch = $1 WHERE reg_no = $2 AND role = 'student'`, [
        m.pdf_branch,
        m.reg,
      ])
      await client.query(
        `UPDATE students SET
           dept = $1,
           extra = COALESCE(extra, '{}'::jsonb)
             || jsonb_build_object(
                  'Branch', $1::text,
                  'branch_fixed_at', $3::text,
                  'branch_fixed_from', COALESCE(extra->>'Branch', $4::text),
                  'branch_source', 'pdf_text_order'
                )
         WHERE reg_no = $2`,
        [m.pdf_branch, m.reg, new Date().toISOString(), m.db_dept || ""],
      )
      fixed++
    }

    // Ensure user.branch always equals students.dept for DTE26
    await client.query(
      `UPDATE users u
         SET branch = s.dept
        FROM students s
       WHERE u.reg_no = s.reg_no
         AND u.role = 'student'
         AND u.deleted_at IS NULL
         AND u.reg_no LIKE 'DTE26%'
         AND s.dept IS NOT NULL
         AND u.branch IS DISTINCT FROM s.dept`,
    )
  }

  // Import missing PDF students
  let imported = 0
  if (!DRY && IMPORT_MISSING && missingInDb.length) {
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10)
    for (const s of missingInDb) {
      const email = `${s.appl_id.toLowerCase()}@student.gpthubli.ac.in`
      const extra = buildExtra(s)
      try {
        await client.query("BEGIN")
        await client.query(
          `INSERT INTO users (
             email, password_hash, role, display_name, reg_no, branch,
             status, force_password_change, is_demo
           ) VALUES ($1,$2,'student',$3,$4,$5,'approved',TRUE,FALSE)
           ON CONFLICT DO NOTHING`,
          [email, hash, s.name, s.appl_id, s.branch],
        )
        // if email conflict, try insert by reg only path
        await client.query(
          `INSERT INTO students (
             reg_no, name, dept, year, extra,
             admission_academic_year, entry_type, entry_study_year,
             current_study_year, academic_status, progress_locked
           ) VALUES ($1,$2,$3,'1st Year',$4::jsonb,$5,'regular',1,1,'active',FALSE)
           ON CONFLICT (reg_no) DO UPDATE SET
             dept = EXCLUDED.dept,
             name = EXCLUDED.name,
             extra = COALESCE(students.extra,'{}'::jsonb) || EXCLUDED.extra`,
          [s.appl_id, s.name, s.branch, JSON.stringify(extra), ADMISSION_AY],
        )
        // ensure user exists
        const { rows: urows } = await client.query(`SELECT id FROM users WHERE reg_no = $1`, [s.appl_id])
        if (!urows[0]) {
          await client.query(
            `INSERT INTO users (
               email, password_hash, role, display_name, reg_no, branch,
               status, force_password_change, is_demo
             ) VALUES ($1,$2,'student',$3,$4,$5,'approved',TRUE,FALSE)`,
            [email, hash, s.name, s.appl_id, s.branch],
          )
        } else {
          await client.query(`UPDATE users SET branch = $1, display_name = $2 WHERE reg_no = $3`, [
            s.branch,
            s.name,
            s.appl_id,
          ])
        }
        await client.query("COMMIT")
        imported++
      } catch (e) {
        await client.query("ROLLBACK")
        console.warn("import fail", s.appl_id, e.message)
      }
    }
  }

  // Final verification
  const { rows: after } = await client.query(
    `SELECT u.reg_no, u.branch AS user_branch, s.dept
       FROM users u JOIN students s ON s.reg_no = u.reg_no
      WHERE u.role='student' AND u.deleted_at IS NULL AND u.reg_no LIKE 'DTE26%'`,
  )
  let still = 0
  const stillList = []
  for (const r of after) {
    const pdf = map.get(String(r.reg_no).toUpperCase())
    if (!pdf) continue
    if (r.dept !== pdf.branch || r.user_branch !== pdf.branch) {
      still++
      stillList.push({ reg: r.reg_no, dept: r.dept, user_branch: r.user_branch, pdf: pdf.branch })
    }
  }
  const { rows: counts } = await client.query(
    `SELECT s.dept, count(*)::int n FROM students s
      WHERE s.reg_no LIKE 'DTE26%' GROUP BY s.dept ORDER BY s.dept`,
  )
  await client.end()

  const report = {
    dry_run: DRY,
    pdf_count: pdfStudents.length,
    pdf_by_branch: byPdf,
    mismatches: mismatches.length,
    fixed,
    imported,
    still_wrong: still,
    stillList,
    missingInDb: missingInDb.length,
    missingInPdf: missingInPdf.length,
    final_counts: counts,
  }
  mkdirSync(path.join(root, "tmp-c20"), { recursive: true })
  writeFileSync(path.join(root, "tmp-c20/pdf-branch-map-correct.json"), JSON.stringify(Object.fromEntries(map), null, 2))
  writeFileSync(path.join(root, "tmp-c20/branch-fix-report.json"), JSON.stringify(report, null, 2))
  console.log("Fixed:", fixed, "Imported missing:", imported, "Still wrong:", still)
  console.log("Final DB counts:", counts)
  console.log("Report: tmp-c20/branch-fix-report.json")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
