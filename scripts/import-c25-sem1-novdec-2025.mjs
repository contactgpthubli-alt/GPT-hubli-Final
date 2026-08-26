/**
 * Import C-25 Semester 1 official result ledgers (Nov/Dec 2025)
 * into results / result_subjects, then ready for seed-exam-attempts.
 *
 * Sources: tmp-c25/result-sheets/nov-dec-2025/{CE,CS,EC,ME}_result.txt
 * (PDF text extracts; currently EC provided: ExamResult EC C25 DEC_2025.pdf)
 *
 * Session = "Nov/Dec-2025", sem = 1, scheme = C-25.
 *
 * Usage:
 *   node scripts/import-c25-sem1-novdec-2025.mjs --dry-run
 *   node scripts/import-c25-sem1-novdec-2025.mjs
 *   node scripts/import-c25-sem1-novdec-2025.mjs --update-cgpa
 *   node scripts/import-c25-sem1-novdec-2025.mjs --create-missing
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"
import bcrypt from "bcryptjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

const DRY_RUN = process.argv.includes("--dry-run")
const UPDATE_CGPA = process.argv.includes("--update-cgpa")
const CREATE_MISSING = process.argv.includes("--create-missing")
const BRANCH_ONLY = (() => {
  const i = process.argv.indexOf("--branch")
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).toUpperCase()
  const eq = process.argv.find((a) => a.startsWith("--branch="))
  return eq ? eq.split("=")[1].toUpperCase() : null
})()
const SEM = 1
const SESSION = "Nov/Dec-2025"
const SCHEME = "C-25"
const DEFAULT_PASSWORD = "Student@123"

const BRANCH_FULL = {
  CE: "Civil Engineering",
  CS: "Computer Science and Engineering",
  EC: "Electronics and Communication Engineering",
  ME: "Mechanical Engineering",
}

/** Full subject credits (applied) when student passed / from ledger. */
const SUBJECT_CREDITS = {
  "25SC11I": 6, // Engineering Mathematics-I
  "25CS01I": 5, // IT Skills
  "25EE01I": 5, // Fundamentals of Electrical & Electronics Engineering
  "25EC11I": 6, // Digital Electronics-1
  "25EC12I": 2, // Environmental Sustainability
  "25CE11I": 6,
  "25CE12I": 2,
  "25CE12T": 2,
  "25ME01I": 5, // Computer Aided Engineering Drawing
  "25ME11I": 6, // Concepts of Mechanical Engineering -I
  "25ME12I": 2,
  "25ME12T": 2, // Environmental Sustainability (ME ledger)
  "25CS11I": 6,
  "25CS12I": 2,
  "25CS12T": 2,
  "25EG01I": 6, // Essential English Communication
  "25ME02I": 5,
}

const SUBJECT_NAMES = {
  "25SC11I": "Engineering Mathematics-I",
  "25CS01I": "IT Skills",
  "25EE01I": "Fundamentals of Electrical & Electronics Engineering",
  "25EC11I": "Digital Electronics-1",
  "25EC12I": "Environmental Sustainability",
  "25EG01I": "Essential English Communication",
  "25ME01I": "Computer Aided Engineering Drawing",
  "25ME11I": "Concepts of Mechanical Engineering -I",
  "25ME12T": "Environmental Sustainability",
  "25CS11I": "Basics of Digital Logic and Computer Organisation",
  "25CS12T": "Environmental Sustainability",
  "25CS12I": "Environmental Sustainability",
}

const GRADE_RE = /^(S|A\+|A|B\+|B|C\+|C|D|E|P|O|F|F\*|F\*\*|Ab|AB|NE|W|X)$/i

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

function makeClient(dbUrl) {
  const c = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    keepAlive: true,
  })
  c.on("error", (err) => console.warn("pg error:", err.message || err))
  return c
}

function normName(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function nameTokens(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
}

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) row[j] = j
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = tmp
    }
  }
  return row[b.length]
}

function namesMatch(pdfName, dbName) {
  const a = normName(pdfName)
  const b = normName(dbName)
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  const maxLen = Math.max(a.length, b.length)
  const dist = levenshtein(a, b)
  if (maxLen >= 8 && dist <= Math.max(2, Math.floor(maxLen * 0.12))) return true
  const ta = new Set(nameTokens(pdfName))
  const tb = new Set(nameTokens(dbName))
  if (!ta.size || !tb.size) return false
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = new Set([...ta, ...tb]).size
  const jaccard = inter / union
  const shorter = Math.min(ta.size, tb.size)
  const cover = inter / shorter
  if (jaccard >= 0.55 || cover >= 0.7) return true
  let soft = 0
  for (const t of ta) {
    if (tb.has(t)) {
      soft++
      continue
    }
    for (const u of tb) {
      if (Math.abs(t.length - u.length) <= 2 && levenshtein(t, u) <= 2) {
        soft++
        break
      }
    }
  }
  return soft / shorter >= 0.8
}

function syntheticEmail(reg) {
  return `${String(reg).toLowerCase()}@student.gpthubli.ac.in`
}

/**
 * Parse ledger text. Handles:
 *  - Register Number : 171EC25001  (full)
 *  - Register Number : + 171 / EC / 25001 (split lines, May-style)
 *  - Credit+grade same line: "6 B" / "5 C+" / "0 F"
 *  - Credit and grade on separate lines
 */
function parseLedgerText(text, branchCode) {
  const blocks = text.split(/Register Number\s*:\s*/i)
  const students = []
  for (const block of blocks.slice(1)) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)

    // reg full or split
    let reg = null
    const head = lines[0] || ""
    const fullM = head.match(/^(\d{3}[A-Z]{2}\d{5})\b/i)
    if (fullM) {
      reg = fullM[1].toUpperCase()
    } else {
      const parts = []
      for (const ln of lines) {
        if (/^Student Name/i.test(ln)) break
        if (/^\d{3}$/.test(ln) || /^[A-Z]{2}$/.test(ln) || /^\d{5}$/.test(ln) || /^\d{3}[A-Z]{2}\d{5}$/i.test(ln)) {
          parts.push(ln)
        }
        if (parts.length >= 3) break
      }
      if (parts.length >= 3 && /^\d{3}$/.test(parts[0]) && /^[A-Z]{2}$/.test(parts[1]) && /^\d{5}$/.test(parts[2])) {
        reg = (parts[0] + parts[1] + parts[2]).toUpperCase()
      } else if (parts[0] && /^\d{3}[A-Z]{2}\d{5}$/i.test(parts[0])) {
        reg = parts[0].toUpperCase()
      }
    }
    if (!reg) continue

    const nameM = block.match(/Student Name\s*:\s*([\s\S]+?)(?:Admission Type|Total Credit|Register Number|$)/i)
    const name = nameM ? nameM[1].replace(/\s+/g, " ").trim() : ""

    const grab = (label) => {
      const m = block.match(new RegExp(label + "\\s*:\\s*([0-9.]+)", "i"))
      return m ? m[1] : null
    }
    const sgpa = grab("SGPA")
    const cgpa = grab("CGPA")
    const earned = grab("Total Credit Earned")
    const applied = grab("Total Credit Applied")

    const subjects = []
    const re = /(\d{2}[A-Z]{2}\d{2}[A-Z]?)\s*\|\s*/g
    let m
    while ((m = re.exec(block))) {
      const code = m[1].toUpperCase()
      const tail = block.slice(m.index + m[0].length)
      const tlines = tail
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      const nameParts = []
      let j = 0
      while (
        j < tlines.length &&
        !/^\d+(\s+[A-Za-z+*]+)?$/.test(tlines[j]) &&
        !GRADE_RE.test(tlines[j])
      ) {
        if (/^Register Number/i.test(tlines[j]) || /^Student Name/i.test(tlines[j])) break
        if (/^(May|Nov|Dec)\s/i.test(tlines[j])) break
        if (/^Program\s*:/i.test(tlines[j])) break
        if (/^\d{2}[A-Z]{2}\d{2}/i.test(tlines[j])) break
        nameParts.push(tlines[j])
        j++
      }
      let credit = 0
      let grade = ""
      let result = ""

      // "6 B" / "5 C+" / "0 F" on one line
      if (j < tlines.length) {
        const combined = tlines[j].match(/^(\d+)\s+([A-Za-z+*]+)$/)
        if (combined && GRADE_RE.test(combined[2])) {
          credit = Number(combined[1])
          grade = combined[2]
          j++
        } else if (/^\d+$/.test(tlines[j])) {
          credit = Number(tlines[j])
          j++
          if (j < tlines.length && GRADE_RE.test(tlines[j])) {
            grade = tlines[j]
            j++
          }
        } else if (GRADE_RE.test(tlines[j])) {
          grade = tlines[j]
          j++
        }
      }
      if (j < tlines.length && /^(PASS|FAIL|NE|ABSENT)$/i.test(tlines[j])) {
        result = tlines[j].toUpperCase()
      }
      if (!grade) continue
      grade = grade.toUpperCase() === "AB" ? "Ab" : grade
      const sname =
        SUBJECT_NAMES[code] ||
        nameParts.join(" ").replace(/\s+/g, " ").replace(/\.+\s*$/, "").trim()
      const passFail =
        result ||
        (["F", "F*", "F**", "AB", "NE", "W", "X"].includes(String(grade).toUpperCase()) || grade === "Ab"
          ? "FAIL"
          : "PASS")
      subjects.push({
        code,
        name: sname,
        credit_earned: credit,
        credits: SUBJECT_CREDITS[code] ?? (credit > 0 ? credit : 0),
        grade,
        result: passFail,
      })
    }

    if (subjects.length) {
      // fix credits when fail (earned 0) but catalog has full credit
      for (const sub of subjects) {
        if (sub.credits === 0 && SUBJECT_CREDITS[sub.code]) {
          sub.credits = SUBJECT_CREDITS[sub.code]
        }
      }
      students.push({
        reg: reg.toUpperCase(),
        name,
        branch_code: branchCode,
        branch: BRANCH_FULL[branchCode] || branchCode,
        sgpa: sgpa != null ? Number(sgpa) : null,
        cgpa: cgpa != null ? Number(cgpa) : null,
        earned: earned != null ? Number(earned) : null,
        applied: applied != null ? Number(applied) : null,
        subjects,
      })
    }
  }
  return students
}

function loadAllFromExtracts() {
  const dir = path.join(projectRoot, "tmp-c25", "result-sheets", "nov-dec-2025")
  const tags = ["CE", "CS", "EC", "ME"].filter((t) => !BRANCH_ONLY || t === BRANCH_ONLY)
  const all = []
  for (const tag of tags) {
    // Prefer structured JSON from pdfplumber table extract (needed for CS
    // Nov/Dec sheets where text layout collapses credit/grade onto name lines).
    const jsonPath = path.join(dir, `${tag}_parsed.json`)
    if (existsSync(jsonPath)) {
      const list = JSON.parse(readFileSync(jsonPath, "utf8")).map((s) => ({
        ...s,
        reg: String(s.reg || "").toUpperCase(),
        branch_code: s.branch_code || tag,
        branch: s.branch || BRANCH_FULL[tag] || tag,
        subjects: (s.subjects || []).map((sub) => ({
          ...sub,
          code: String(sub.code || "").toUpperCase(),
          name: sub.name || SUBJECT_NAMES[String(sub.code || "").toUpperCase()] || sub.code,
          credits:
            Number(sub.credits) ||
            SUBJECT_CREDITS[String(sub.code || "").toUpperCase()] ||
            0,
          credit_earned: Number(sub.credit_earned ?? sub.credits ?? 0),
          grade: sub.grade,
          result: sub.result,
        })),
      }))
      console.log(`Parsed ${tag} (JSON): ${list.length} students`)
      all.push(...list)
      continue
    }
    const p = path.join(dir, `${tag}_result.txt`)
    if (!existsSync(p)) {
      console.warn("Missing extract (skip):", p)
      continue
    }
    const list = parseLedgerText(readFileSync(p, "utf8"), tag)
    console.log(`Parsed ${tag}: ${list.length} students`)
    all.push(...list)
  }
  return all
}

function overallResult(subjects) {
  const bad = subjects.some(
    (s) =>
      s.result === "FAIL" ||
      s.result === "NE" ||
      s.result === "ABSENT" ||
      ["F", "F*", "F**", "AB", "NE", "W", "X"].includes(String(s.grade).toUpperCase()) ||
      s.grade === "Ab",
  )
  return bad ? "Fail" : "Pass"
}

async function ensureStudent(client, rec, passwordHash) {
  const reg = rec.reg
  const email = syntheticEmail(reg)
  const stu = await client.query(`SELECT reg_no FROM students WHERE UPPER(reg_no)=$1`, [reg])
  if (!stu.rows.length) {
    await client.query(
      `INSERT INTO students (
         reg_no, name, dept, year, cgpa, father, extra,
         admission_academic_year, entry_type, entry_study_year,
         current_study_year, academic_status, progress_locked
       ) VALUES ($1,$2,$3,$4,$5,'',$6::jsonb,$7,'regular',1,1,'active',FALSE)`,
      [
        reg,
        rec.name,
        rec.branch,
        "1st Year",
        rec.cgpa != null ? String(rec.cgpa.toFixed(2)) : "0.00",
        JSON.stringify({ created_from: "c25-sem1-novdec-2025-import", scheme: SCHEME }),
        "2025-26",
      ],
    )
  }
  const u = await client.query(`SELECT id FROM users WHERE UPPER(reg_no)=$1 OR LOWER(email)=$2`, [
    reg,
    email.toLowerCase(),
  ])
  if (!u.rows.length) {
    await client.query(
      `INSERT INTO users (email, password_hash, role, display_name, reg_no, branch, status, force_password_change, is_demo)
       VALUES ($1,$2,'student',$3,$4,$5,'approved',TRUE,FALSE)
       ON CONFLICT DO NOTHING`,
      [email, passwordHash, rec.name, reg, rec.branch],
    )
  }
}

async function main() {
  const records = loadAllFromExtracts()
  console.log(`Total ledger rows: ${records.length}`)
  if (!records.length) {
    console.error("No students parsed — check extracts under tmp-c25/result-sheets/nov-dec-2025/")
    process.exit(1)
  }

  const dbUrl = resolveDb()
  if (!dbUrl) {
    console.error("No DATABASE_URL found")
    process.exit(1)
  }

  let client = makeClient(dbUrl)
  await client.connect()
  console.log("DB connected")

  const { rows: dbStudents } = await client.query(
    `SELECT reg_no, name, dept, admission_academic_year, current_study_year, cgpa
       FROM students`,
  )
  const byReg = new Map()
  for (const s of dbStudents) {
    byReg.set(String(s.reg_no).toUpperCase(), s)
  }
  console.log(`DB students: ${dbStudents.length}`)

  const matched = []
  const skipped = []
  const toCreate = []

  for (const rec of records) {
    const db = byReg.get(rec.reg)
    if (!db) {
      if (CREATE_MISSING) {
        toCreate.push(rec)
        matched.push({ rec, db: { name: rec.name, reg_no: rec.reg }, created: true })
      } else {
        skipped.push({ ...rec, reason: "reg_not_found" })
      }
      continue
    }
    if (!namesMatch(rec.name, db.name)) {
      skipped.push({
        ...rec,
        reason: "name_mismatch",
        db_name: db.name,
      })
      continue
    }
    matched.push({ rec, db, created: false })
  }

  console.log(`Matched: ${matched.length}  Skipped: ${skipped.length}  Create: ${toCreate.length}`)
  const byReason = {}
  for (const s of skipped) {
    byReason[s.reason] = (byReason[s.reason] || 0) + 1
  }
  console.log("Skip reasons:", byReason)

  // subject count sanity
  const subDist = {}
  for (const { rec } of matched) {
    const n = rec.subjects.length
    subDist[n] = (subDist[n] || 0) + 1
  }
  console.log("Subject count distribution:", subDist)

  const outDir = path.join(projectRoot, "tmp-c25", "result-sheets", "nov-dec-2025")
  mkdirSync(outDir, { recursive: true })
  const report = {
    session: SESSION,
    sem: SEM,
    scheme: SCHEME,
    dry_run: DRY_RUN,
    total_ledger: records.length,
    matched: matched.length,
    skipped: skipped.length,
    skip_reasons: byReason,
    subject_dist: subDist,
    matched_sample: matched.slice(0, 5).map(({ rec, db }) => ({
      reg: rec.reg,
      pdf_name: rec.name,
      db_name: db.name,
      sgpa: rec.sgpa,
      subjects: rec.subjects.map((s) => `${s.code}:${s.grade}`),
    })),
    skipped_sample: skipped.slice(0, 40).map((s) => ({
      reg: s.reg,
      pdf_name: s.name,
      db_name: s.db_name || null,
      reason: s.reason,
    })),
  }
  writeFileSync(
    path.join(outDir, `import-report-${DRY_RUN ? "dryrun" : "live"}-${Date.now()}.json`),
    JSON.stringify(report, null, 2),
    "utf8",
  )
  writeFileSync(path.join(outDir, "parsed-all.json"), JSON.stringify(records, null, 2), "utf8")

  if (DRY_RUN) {
    console.log("\n=== DRY RUN — no DB writes ===")
    for (const { rec, db } of matched.slice(0, 10)) {
      console.log(
        `  ${rec.reg} | PDF: ${rec.name} | DB: ${db.name} | SGPA ${rec.sgpa} | ${overallResult(rec.subjects)} | ${rec.subjects.map((s) => s.code + ":" + s.grade).join(", ")}`,
      )
    }
    if (skipped.length) {
      console.log("\nSample skips:")
      for (const s of skipped.slice(0, 20)) {
        console.log(`  ${s.reg} | ${s.name} | ${s.reason}${s.db_name ? " | DB: " + s.db_name : ""}`)
      }
    }
    await client.end()
    return
  }

  await client.end()

  let inserted = 0
  let updated = 0
  let subjectRows = 0
  let cgpaUpdates = 0
  let createdStudents = 0
  const BATCH = 12
  const passwordHash = CREATE_MISSING ? await bcrypt.hash(DEFAULT_PASSWORD, 10) : null

  console.log(`\n=== LIVE IMPORT (${matched.length} students, batch ${BATCH}) ===`)

  for (let start = 0; start < matched.length; start += BATCH) {
    const batch = matched.slice(start, start + BATCH)
    client = makeClient(dbUrl)
    await client.connect()
    try {
      await client.query("BEGIN")
      for (const { rec, db, created } of batch) {
        if (created && CREATE_MISSING) {
          await ensureStudent(client, rec, passwordHash)
          createdStudents++
        }
        const resultLabel = overallResult(rec.subjects)
        const existing = await client.query(
          `SELECT id FROM results WHERE UPPER(reg_no) = $1 AND sem = $2 AND session = $3`,
          [rec.reg, SEM, SESSION],
        )
        const { rows } = await client.query(
          `INSERT INTO results (reg_no, name, branch, sem, session, sgpa, result)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (reg_no, sem, session) DO UPDATE SET
             name = EXCLUDED.name,
             branch = EXCLUDED.branch,
             sgpa = EXCLUDED.sgpa,
             result = EXCLUDED.result
           RETURNING id`,
          [rec.reg, db.name || rec.name, rec.branch, SEM, SESSION, rec.sgpa, resultLabel],
        )
        const resultId = rows[0].id
        if (existing.rows.length) updated++
        else inserted++

        await client.query("DELETE FROM result_subjects WHERE result_id = $1", [resultId])

        if (rec.subjects.length) {
          const vals = []
          const params = []
          let p = 1
          let ord = 0
          for (const sub of rec.subjects) {
            ord++
            vals.push(`($${p++},$${p++},$${p++},0,0,$${p++},$${p++},$${p++})`)
            params.push(resultId, sub.name, sub.code, sub.credits ?? 0, sub.grade, ord)
            subjectRows++
          }
          await client.query(
            `INSERT INTO result_subjects (result_id, name, code, internal, external, credits, grade, ord)
             VALUES ${vals.join(",")}`,
            params,
          )
        }

        if (UPDATE_CGPA && rec.cgpa != null && !Number.isNaN(rec.cgpa) && rec.cgpa > 0) {
          await client.query(`UPDATE students SET cgpa = $2 WHERE UPPER(reg_no) = $1`, [
            rec.reg,
            String(rec.cgpa.toFixed(2)),
          ])
          cgpaUpdates++
        }
      }
      await client.query("COMMIT")
      console.log(`  batch ${start + 1}-${start + batch.length} ok (ins ${inserted} upd ${updated})`)
    } catch (e) {
      try {
        await client.query("ROLLBACK")
      } catch {}
      console.error(`  batch ${start + 1} FAILED:`, e.message || e)
      await client.end().catch(() => {})
      throw e
    }
    await client.end().catch(() => {})
  }

  console.log("\n=== LIVE IMPORT DONE ===")
  const summary = {
    inserted,
    updated,
    subjectRows,
    cgpaUpdates,
    createdStudents,
    matched: matched.length,
    skipped: skipped.length,
    skipped_regs: skipped.map((s) => ({ reg: s.reg, name: s.name, reason: s.reason, db_name: s.db_name })),
    session: SESSION,
    sem: SEM,
    scheme: SCHEME,
  }
  console.log(summary)
  writeFileSync(path.join(outDir, "import-live-summary.json"), JSON.stringify(summary, null, 2), "utf8")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
