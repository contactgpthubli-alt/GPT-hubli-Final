/**
 * Import C-20 Nov/Dec-2025 provisional marks cards → results + verified exam attempts.
 *
 * Source: tmp-c20/result-sheets/nov-dec-2025/parsed-marks-cards.json
 * (built by parse_marks_cards.py from BTE provisional marks-card PDFs)
 *
 * Usage:
 *   node scripts/import-c20-novdec-2025-results.mjs --dry-run
 *   node scripts/import-c20-novdec-2025-results.mjs --create-missing --update-cgpa
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"
import bcrypt from "bcryptjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, "..")

const DRY_RUN = process.argv.includes("--dry-run")
const CREATE_MISSING = process.argv.includes("--create-missing")
const UPDATE_CGPA = process.argv.includes("--update-cgpa")
const RESUME = process.argv.includes("--resume") || process.argv.includes("--skip-done")
const DEFAULT_PASSWORD = "Student@123"
const SESSION = "Nov/Dec-2025"
const SCHEME = "C-20"
const BATCH = 5

const BRANCH_FULL = {
  CE: "Civil Engineering",
  CS: "Computer Science and Engineering",
  EC: "Electronics and Communication Engineering",
  ME: "Mechanical Engineering",
}
const BRANCH_CODE = { CE: "CE", CS: "CSE", EC: "ECE", ME: "ME" }

const DATA = path.join(
  projectRoot,
  "tmp-c20",
  "result-sheets",
  "nov-dec-2025",
  "parsed-marks-cards.json",
)

function pe(p) {
  if (!existsSync(p)) return {}
  const o = {}
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = l.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    o[t.slice(0, i).trim()] = v
  }
  return o
}

function resolveDb() {
  const env = { ...pe(path.join(projectRoot, ".env")), ...pe(path.join(projectRoot, ".env.local")), ...process.env }
  for (const k of [
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
  ]) {
    if (env[k] && String(env[k]).trim()) return String(env[k]).trim()
  }
  return null
}

function makeClient(url) {
  const c = new Client({
    connectionString: url,
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
  if (a === b || a.includes(b) || b.includes(a)) return true
  const maxLen = Math.max(a.length, b.length)
  if (maxLen >= 8 && levenshtein(a, b) <= Math.max(2, Math.floor(maxLen * 0.12))) return true
  if (levenshtein(a, b) <= 4) return true
  const ta = new Set(nameTokens(pdfName))
  const tb = new Set(nameTokens(dbName))
  if (!ta.size || !tb.size) return false
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.min(ta.size, tb.size) >= 0.7
}

function syntheticEmail(reg) {
  return `${String(reg).toLowerCase()}@student.gpthubli.ac.in`
}

function cleanOverall(s) {
  return String(s || "")
    .replace(/^#+\s*/, "")
    .trim()
}

function mapSemResult(subjects) {
  if (!subjects.length) return "Fail"
  return subjects.some((s) => s.result === "fail") ? "Fail" : "Pass"
}

function admissionYearFromReg(reg) {
  const m = String(reg).match(/^\d{3}[A-Z]{2}(\d{2})/)
  if (!m) return "2022-23"
  const yy = Number(m[1])
  if (yy >= 19 && yy <= 30) {
    const start = 2000 + yy
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
  }
  return "2022-23"
}

function yearLabelFromReg(reg) {
  const m = String(reg).match(/^\d{3}[A-Z]{2}(\d{2})/)
  const yy = m ? Number(m[1]) : 22
  // as of AY 2025-26 / results Nov-Dec 2025: 2023 batch ≈ 2nd year, older ≈ 3rd
  if (yy >= 24) return "1st Year"
  if (yy === 23) return "2nd Year"
  return "3rd Year"
}

function studyYearFromReg(reg) {
  const y = yearLabelFromReg(reg)
  if (y.startsWith("1")) return 1
  if (y.startsWith("2")) return 2
  return 3
}

function enrich(card) {
  const tag = card.branch_tag || "CS"
  return {
    ...card,
    name: String(card.name || "").replace(/\s+/g, " ").trim(),
    overall_result: cleanOverall(card.overall_result),
    branch: BRANCH_FULL[tag] || tag,
    branch_code: BRANCH_CODE[tag] || tag,
  }
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
       ) VALUES ($1,$2,$3,$4,$5,'',$6::jsonb,$7,'regular',1,$8,'active',FALSE)`,
      [
        reg,
        rec.name,
        rec.branch,
        yearLabelFromReg(reg),
        rec.cgpa != null ? String(Number(rec.cgpa).toFixed(2)) : null,
        JSON.stringify({ source: "c20-nov-dec-2025-marks-card", scheme: "C-20" }),
        admissionYearFromReg(reg),
        studyYearFromReg(reg),
      ],
    )
  }
  const usr = await client.query(
    `SELECT id FROM users WHERE UPPER(reg_no)=$1 OR lower(email)=lower($2)`,
    [reg, email],
  )
  if (!usr.rows.length) {
    await client.query(
      `INSERT INTO users (
         email, password_hash, role, display_name, reg_no, branch,
         status, force_password_change, is_demo
       ) VALUES ($1,$2,'student',$3,$4,$5,'approved',FALSE,FALSE)`,
      [email, passwordHash, rec.name, reg, rec.branch],
    )
  }
}

async function importOne(client, rec, db, passwordHash, byReg, stats) {
  const reg = rec.reg
  if (CREATE_MISSING && !byReg.has(reg)) {
    await ensureStudent(client, rec, passwordHash)
    stats.createdStudents++
    byReg.set(reg, { reg_no: reg, name: rec.name })
  }

  const displayName = db.name || rec.name
  const bySem = new Map()
  for (const sub of rec.subjects || []) {
    const sem = Number(sub.semester)
    if (!sem || sem < 1 || sem > 6) continue
    if (!bySem.has(sem)) bySem.set(sem, [])
    bySem.get(sem).push(sub)
  }

  const sgpaMap = rec.sgpa_by_sem || {}

  for (const [sem, subjects] of bySem) {
    const sgpaRaw = sgpaMap[String(sem)] ?? sgpaMap[sem]
    const sgpa = sgpaRaw != null && !Number.isNaN(Number(sgpaRaw)) ? Number(sgpaRaw) : null
    const resultLabel = mapSemResult(subjects)
    const { rows } = await client.query(
      `INSERT INTO results (reg_no, name, branch, sem, session, sgpa, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (reg_no, sem, session) DO UPDATE SET
         name=EXCLUDED.name, branch=EXCLUDED.branch, sgpa=EXCLUDED.sgpa, result=EXCLUDED.result
       RETURNING id`,
      [reg, displayName, rec.branch, sem, SESSION, sgpa, resultLabel],
    )
    const resultId = rows[0].id
    stats.resultsUpserted++

    await client.query(`DELETE FROM result_subjects WHERE result_id=$1`, [resultId])
    let ord = 0
    for (const sub of subjects) {
      ord++
      await client.query(
        `INSERT INTO result_subjects (result_id, name, code, internal, external, credits, grade, ord)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          resultId,
          sub.name || sub.code,
          sub.code,
          0,
          0,
          sub.credits ?? 0,
          sub.grade,
          ord,
        ],
      )
      stats.subjectRows++
    }
  }

  for (const sub of rec.subjects || []) {
    const sem = Number(sub.semester) || 0
    if (!sem) continue
    // Partial unique index: (reg_no, subject_code, exam_session) WHERE status <> rejected
    const up = await client.query(
      `INSERT INTO student_exam_attempts (
         reg_no, scheme, branch_code, semester, subject_code, subject_name,
         exam_session, result, grade, status,
         submitted_at, verified_at, verified_by_name, verifier_role
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified', now(), now(), 'Official Marks Card Nov/Dec-2025', 'exam')
       ON CONFLICT (reg_no, subject_code, exam_session) WHERE status IS DISTINCT FROM 'rejected'
       DO UPDATE SET
         scheme=EXCLUDED.scheme, branch_code=EXCLUDED.branch_code, semester=EXCLUDED.semester,
         subject_name=EXCLUDED.subject_name, result=EXCLUDED.result, grade=EXCLUDED.grade,
         status='verified', reject_note=NULL,
         submitted_at=COALESCE(student_exam_attempts.submitted_at, now()),
         verified_at=now(), verified_by_name=EXCLUDED.verified_by_name,
         verifier_role='exam', updated_at=now()
       RETURNING (xmax = 0) AS inserted`,
      [reg, SCHEME, rec.branch_code, sem, sub.code, sub.name || sub.code, SESSION, sub.result, sub.grade],
    )
    if (up.rows[0]?.inserted) stats.attemptsIns++
    else stats.attemptsUpd++
  }

  if (UPDATE_CGPA && rec.cgpa != null && !Number.isNaN(Number(rec.cgpa))) {
    await client.query(`UPDATE students SET cgpa=$2 WHERE UPPER(reg_no)=$1`, [
      reg,
      String(Number(rec.cgpa).toFixed(2)),
    ])
    stats.cgpaUpdates++
  }
}

async function main() {
  if (!existsSync(DATA)) {
    throw new Error(`Missing parsed data: ${DATA}\nRun parse_marks_cards.py first.`)
  }
  const raw = JSON.parse(readFileSync(DATA, "utf8"))
  const all = raw.map(enrich).filter((r) => r.reg && (r.subjects || []).length)
  console.log(`Ledger cards: ${all.length}`)
  console.log(
    `Subjects total: ${all.reduce((n, r) => n + r.subjects.length, 0)} | with CGPA: ${all.filter((r) => r.cgpa != null).length}`,
  )

  const dbUrl = resolveDb()
  if (!dbUrl) throw new Error("No DATABASE_URL")

  let client = makeClient(dbUrl)
  await client.connect()
  const { rows: dbStudents } = await client.query(`SELECT reg_no, name, dept FROM students`)
  const byReg = new Map()
  for (const s of dbStudents) byReg.set(String(s.reg_no).toUpperCase(), s)
  console.log(`DB students: ${dbStudents.length}`)

  const matched = []
  const toCreate = []
  const skipped = []
  for (const rec of all) {
    const db = byReg.get(rec.reg)
    if (!db) {
      if (CREATE_MISSING) toCreate.push(rec)
      else skipped.push({ ...rec, reason: "reg_not_found" })
      continue
    }
    if (!namesMatch(rec.name, db.name)) {
      skipped.push({ ...rec, reason: "name_mismatch", db_name: db.name })
      continue
    }
    matched.push({ rec, db })
  }
  console.log({ matched: matched.length, to_create: toCreate.length, skipped: skipped.length })

  let alreadyDone = new Set()
  if (RESUME && !DRY_RUN) {
    const doneQ = await client.query(
      `SELECT UPPER(reg_no) AS r, count(*)::int AS n
         FROM student_exam_attempts
        WHERE exam_session=$1 AND status IS DISTINCT FROM 'rejected'
        GROUP BY UPPER(reg_no)`,
      [SESSION],
    )
    const doneMap = new Map(doneQ.rows.map((x) => [x.r, x.n]))
    alreadyDone = new Set(
      all
        .filter((rec) => {
          const n = doneMap.get(rec.reg) || 0
          return n >= (rec.subjects || []).length && n > 0
        })
        .map((r) => r.reg),
    )
    console.log(`Resume: skipping ${alreadyDone.size} already-imported regs`)
  }

  if (DRY_RUN) {
    for (const { rec } of matched.slice(0, 10)) {
      const sems = [...new Set(rec.subjects.map((s) => s.semester))].sort()
      console.log(
        `  ${rec.reg} | ${rec.name} | CGPA=${rec.cgpa} | ${rec.overall_result} | subj=${rec.subjects.length} sems=${sems.join(",")}`,
      )
    }
    if (skipped.length) {
      console.log("Skips sample:")
      for (const s of skipped.slice(0, 20)) {
        console.log(`  ${s.reg} | ${s.name} | ${s.reason}${s.db_name ? " db=" + s.db_name : ""}`)
      }
    }
    const byReason = {}
    for (const s of skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1
    console.log("Skip reasons:", byReason)
    await client.end()
    return
  }
  await client.end()

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)
  const stats = {
    createdStudents: 0,
    resultsUpserted: 0,
    subjectRows: 0,
    attemptsIns: 0,
    attemptsUpd: 0,
    cgpaUpdates: 0,
  }
  let work = [...matched]
  for (const rec of toCreate) work.push({ rec, db: { name: rec.name, reg_no: rec.reg } })
  if (RESUME && alreadyDone.size) {
    const before = work.length
    work = work.filter((w) => !alreadyDone.has(w.rec.reg))
    console.log(`Resume filter: ${before} → ${work.length} remaining`)
  }

  console.log(`\n=== LIVE IMPORT ${work.length} students (batch ${BATCH}) ===`)
  // Unbuffered progress
  const log = (...a) => {
    console.log(...a)
    if (process.stdout.isTTY === false) {
      try {
        process.stdout.write("")
      } catch {}
    }
  }
  for (let start = 0; start < work.length; start += BATCH) {
    const batch = work.slice(start, start + BATCH)
    let ok = false
    for (let tryN = 1; tryN <= 4 && !ok; tryN++) {
      client = makeClient(dbUrl)
      try {
        await client.connect()
        await client.query("BEGIN")
        for (const item of batch) {
          await importOne(client, item.rec, item.db, passwordHash, byReg, stats)
        }
        await client.query("COMMIT")
        ok = true
        log(`  batch ${start + 1}-${start + batch.length}/${work.length} ok (try ${tryN})`)
      } catch (e) {
        try {
          await client.query("ROLLBACK")
        } catch {}
        console.error(`  batch ${start + 1} try ${tryN} FAIL:`, e.message || e)
        if (tryN === 4) throw e
        await new Promise((r) => setTimeout(r, 2000 * tryN))
      } finally {
        try {
          await client.end()
        } catch {}
      }
    }
  }

  const summary = {
    session: SESSION,
    scheme: SCHEME,
    ledger_students: all.length,
    matched: matched.length,
    created_students: stats.createdStudents,
    skipped: skipped.length,
    skipped_regs: skipped.map((s) => ({
      reg: s.reg,
      name: s.name,
      reason: s.reason,
      db_name: s.db_name || null,
    })),
    results_upserted: stats.resultsUpserted,
    subject_rows: stats.subjectRows,
    attempts_inserted: stats.attemptsIns,
    attempts_updated: stats.attemptsUpd,
    cgpa_updates: stats.cgpaUpdates,
    password_for_new: DEFAULT_PASSWORD,
  }
  const outDir = path.dirname(DATA)
  writeFileSync(path.join(outDir, "import-c20-novdec-2025-summary.json"), JSON.stringify(summary, null, 2), "utf8")
  console.log("\n=== DONE ===")
  console.log(summary)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
