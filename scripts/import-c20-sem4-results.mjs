/**
 * Import C-20 Apr/May-2026 (26A) Result Ledgers — Sem 4 published results + verified attempts.
 *
 * Sources: tmp-c20/result-sheets/{CE,CS,EC,ME}_sem4_result.txt
 *
 * Usage:
 *   node scripts/import-c20-sem4-results.mjs --dry-run
 *   node scripts/import-c20-sem4-results.mjs --create-missing --update-cgpa
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
const DEFAULT_PASSWORD = "Student@123"
const SESSION = "Apr/May-2026"
const TARGET_SEM = 4
const SCHEME = "C-20"
const BATCH = 8

const BRANCH_FULL = {
  CE: "Civil Engineering",
  CS: "Computer Science and Engineering",
  EC: "Electronics and Communication Engineering",
  ME: "Mechanical Engineering",
}
const BRANCH_CODE = { CE: "CE", CS: "CSE", EC: "ECE", ME: "ME" }

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

function parseLedger(text, branchTag) {
  const lines = text.split(/\r?\n/)
  const students = []
  const headerRe = /^(\d+)\s+(171[A-Z]{2}\d{5})\s+(.+?)\s*\[\s*S\/D\/O/i
  const subStartRe = /^([1-6])\s+(20[A-Z]{2}\d{2}[A-Z]?)\s+(.+)$/i
  let i = 0
  while (i < lines.length) {
    const m = lines[i].trim().match(headerRe)
    if (!m) {
      i++
      continue
    }
    const reg = m[2].toUpperCase()
    const name = m[3].replace(/\s+/g, " ").trim()
    i++
    if (i < lines.length && /^Sem\s+Code\s+Subject/i.test(lines[i].trim())) i++

    const subjects = []
    while (i < lines.length) {
      const ln = lines[i].trim()
      if (/^Semester\s+1\s+2\s+3\s+4\s+5\s+6/i.test(ln)) break
      if (headerRe.test(ln) || /^Page No/i.test(ln) || /^BOARD OF TECHNICAL/i.test(ln)) break
      const sm = ln.match(subStartRe)
      if (sm) {
        const sem = Number(sm[1])
        const code = sm[2].toUpperCase()
        const blobParts = [sm[3].trim()]
        let j = i + 1
        const fullRe =
          /^(.+?)\s+(\d+|AB|--)\s*\/\s*(\d+|AB|--)\s*\/\s*(\d+|AB|--)\s+([PF])\s+(\d+)\s+([A-F][+]?|Ab|AB|NE|W|X|O|P|S)$/i
        let matched = null
        for (let guard = 0; guard < 8; guard++) {
          matched = blobParts.join(" ").replace(/\s+/g, " ").trim().match(fullRe)
          if (matched) break
          if (j >= lines.length) break
          const nxt = lines[j].trim()
          if (!nxt || headerRe.test(nxt) || /^Semester\s+1/i.test(nxt) || subStartRe.test(nxt)) break
          blobParts.push(nxt)
          j++
        }
        if (matched) {
          subjects.push({
            semester: sem,
            code,
            name: matched[1].replace(/\s+/g, " ").trim(),
            ia_tr_pr: `${matched[2]}/${matched[3]}/${matched[4]}`,
            result: matched[5].toUpperCase() === "P" ? "pass" : "fail",
            credits: Number(matched[6]),
            grade: matched[7].toUpperCase() === "AB" ? "Ab" : matched[7],
          })
          i = j
          continue
        }
      }
      i++
    }

    const sgpaBySem = {}
    let cgpa = null
    let overall = null
    while (i < lines.length) {
      const ln = lines[i].trim()
      if (headerRe.test(ln)) break
      if (/^Page No/i.test(ln)) {
        i++
        break
      }
      if (/^BOARD OF TECHNICAL/i.test(ln)) break
      let mm = ln.match(/^SGPA \(Attempts\)\s+(.+)$/i)
      if (mm) {
        const nums = [...mm[1].matchAll(/([0-9]+\.[0-9]+)\s*\(\d+\)|--/g)]
        for (let s = 0; s < nums.length && s < 6; s++) {
          if (nums[s][1] != null) sgpaBySem[s + 1] = Number(nums[s][1])
        }
      }
      mm = ln.match(/^CGPA\s+([0-9]+\.[0-9]+)/i)
      if (mm) cgpa = Number(mm[1])
      mm = ln.match(/^Result\s+(.+)$/i)
      if (mm) {
        overall = mm[1].trim()
        i++
        break
      }
      i++
    }

    students.push({
      reg,
      name,
      branch_tag: branchTag,
      branch: BRANCH_FULL[branchTag] || branchTag,
      branch_code: BRANCH_CODE[branchTag] || branchTag,
      subjects,
      subjects_sem4: subjects.filter((s) => s.semester === TARGET_SEM),
      sgpa_sem4: sgpaBySem[TARGET_SEM] != null ? sgpaBySem[TARGET_SEM] : null,
      cgpa,
      overall_result: overall,
    })
  }
  return students
}

function mapSem4Result(rec) {
  const sem4 = rec.subjects_sem4 || []
  if (sem4.length) return sem4.some((s) => s.result === "fail") ? "Fail" : "Pass"
  if (rec.sgpa_sem4 != null && Number(rec.sgpa_sem4) > 0) return "Pass"
  const o = String(rec.overall_result || "").toUpperCase()
  if (o.includes("FAIL")) return "Fail"
  if (/DISTINCTION|FIRST|SECOND|PASS/.test(o)) return "Pass"
  return "Fail"
}

function admissionYearFromReg(reg) {
  const m = String(reg).match(/^171[A-Z]{2}(\d{2})/)
  if (!m) return "2022-23"
  const yy = Number(m[1])
  if (yy >= 20 && yy <= 30) {
    const start = 2000 + yy
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
  }
  return "2022-23"
}

function yearLabelFromReg(reg) {
  const m = String(reg).match(/^171[A-Z]{2}(\d{2})/)
  const yy = m ? Number(m[1]) : 22
  if (yy <= 22) return "3rd Year"
  if (yy === 23) return "2nd Year"
  return "3rd Year"
}

function studyYearFromReg(reg) {
  return yearLabelFromReg(reg).startsWith("2") ? 2 : 3
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
        rec.cgpa != null ? String(rec.cgpa.toFixed(2)) : null,
        JSON.stringify({ source: "c20-apr-may-2026-ledger", scheme: "C-20" }),
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
  const resultLabel = mapSem4Result(rec)
  const { rows } = await client.query(
    `INSERT INTO results (reg_no, name, branch, sem, session, sgpa, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (reg_no, sem, session) DO UPDATE SET
       name=EXCLUDED.name, branch=EXCLUDED.branch, sgpa=EXCLUDED.sgpa, result=EXCLUDED.result
     RETURNING id`,
    [reg, displayName, rec.branch, TARGET_SEM, SESSION, rec.sgpa_sem4, resultLabel],
  )
  const resultId = rows[0].id
  stats.resultsUpserted++

  await client.query(`DELETE FROM result_subjects WHERE result_id=$1`, [resultId])
  let ord = 0
  for (const sub of rec.subjects_sem4) {
    ord++
    const parts = String(sub.ia_tr_pr || "").split("/")
    const internal = /^\d+$/.test(parts[0]) ? Number(parts[0]) : 0
    const external = /^\d+$/.test(parts[1]) ? Number(parts[1]) : /^\d+$/.test(parts[2]) ? Number(parts[2]) : 0
    await client.query(
      `INSERT INTO result_subjects (result_id, name, code, internal, external, credits, grade, ord)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [resultId, sub.name, sub.code, internal, external, sub.credits ?? 0, sub.grade, ord],
    )
    stats.subjectRows++
  }

  for (const sub of rec.subjects) {
    const existing = await client.query(
      `SELECT id FROM student_exam_attempts
        WHERE UPPER(reg_no)=$1 AND UPPER(subject_code)=$2 AND exam_session=$3
          AND status IS DISTINCT FROM 'rejected'
        ORDER BY id DESC LIMIT 1`,
      [reg, sub.code, SESSION],
    )
    if (existing.rows.length) {
      await client.query(
        `UPDATE student_exam_attempts SET
           scheme=$2, branch_code=$3, semester=$4, subject_name=$5,
           result=$6, grade=$7, status='verified', reject_note=NULL,
           submitted_at=COALESCE(submitted_at, now()),
           verified_at=now(), verified_by_name='Official Result Ledger',
           verifier_role='exam', updated_at=now()
         WHERE id=$1`,
        [existing.rows[0].id, SCHEME, rec.branch_code, sub.semester, sub.name, sub.result, sub.grade],
      )
      stats.attemptsUpd++
    } else {
      await client.query(
        `INSERT INTO student_exam_attempts (
           reg_no, scheme, branch_code, semester, subject_code, subject_name,
           exam_session, result, grade, status,
           submitted_at, verified_at, verified_by_name, verifier_role
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified', now(), now(), 'Official Result Ledger', 'exam')`,
        [reg, SCHEME, rec.branch_code, sub.semester, sub.code, sub.name, SESSION, sub.result, sub.grade],
      )
      stats.attemptsIns++
    }
  }

  if (UPDATE_CGPA && rec.cgpa != null && !Number.isNaN(rec.cgpa)) {
    await client.query(`UPDATE students SET cgpa=$2 WHERE UPPER(reg_no)=$1`, [
      reg,
      String(rec.cgpa.toFixed(2)),
    ])
    stats.cgpaUpdates++
  }
}

async function main() {
  const dir = path.join(projectRoot, "tmp-c20", "result-sheets")
  const all = []
  for (const tag of ["CE", "CS", "EC", "ME"]) {
    const p = path.join(dir, `${tag}_sem4_result.txt`)
    if (!existsSync(p)) {
      console.warn("Missing", p)
      continue
    }
    const list = parseLedger(readFileSync(p, "utf8"), tag)
    console.log(
      `Parsed ${tag}: ${list.length} students, sem4-subj ${list.reduce((n, s) => n + s.subjects_sem4.length, 0)}, all-subj ${list.reduce((n, s) => n + s.subjects.length, 0)}`,
    )
    all.push(...list)
  }
  console.log(`Total ledger students: ${all.length}`)
  writeFileSync(path.join(dir, "parsed-c20-sem4.json"), JSON.stringify(all, null, 2), "utf8")

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

  if (DRY_RUN) {
    for (const { rec, db } of matched.slice(0, 8)) {
      console.log(
        `  ${rec.reg} | ${rec.name} | SGPA4=${rec.sgpa_sem4} | sem4=${rec.subjects_sem4.length} | all=${rec.subjects.length} | ${rec.overall_result}`,
      )
    }
    if (skipped.length) {
      console.log("Skips sample:")
      for (const s of skipped.slice(0, 15)) console.log(`  ${s.reg} | ${s.name} | ${s.reason}`)
    }
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
  const work = [...matched]
  for (const rec of toCreate) work.push({ rec, db: { name: rec.name, reg_no: rec.reg } })

  console.log(`\n=== LIVE IMPORT ${work.length} students (batch ${BATCH}) ===`)
  for (let start = 0; start < work.length; start += BATCH) {
    const batch = work.slice(start, start + BATCH)
    let ok = false
    for (let tryN = 1; tryN <= 3 && !ok; tryN++) {
      client = makeClient(dbUrl)
      try {
        await client.connect()
        await client.query("BEGIN")
        for (const item of batch) {
          await importOne(client, item.rec, item.db, passwordHash, byReg, stats)
        }
        await client.query("COMMIT")
        ok = true
        console.log(`  batch ${start + 1}-${start + batch.length} ok (try ${tryN})`)
      } catch (e) {
        try {
          await client.query("ROLLBACK")
        } catch {}
        console.error(`  batch ${start + 1} try ${tryN} FAIL:`, e.message || e)
        if (tryN === 3) throw e
        await new Promise((r) => setTimeout(r, 1500 * tryN))
      } finally {
        try {
          await client.end()
        } catch {}
      }
    }
  }

  const summary = {
    session: SESSION,
    sem: TARGET_SEM,
    ledger_students: all.length,
    matched: matched.length,
    created_students: stats.createdStudents,
    skipped: skipped.length,
    skipped_regs: skipped.map((s) => ({ reg: s.reg, name: s.name, reason: s.reason, db_name: s.db_name || null })),
    results_upserted: stats.resultsUpserted,
    sem4_subject_rows: stats.subjectRows,
    attempts_inserted: stats.attemptsIns,
    attempts_updated: stats.attemptsUpd,
    cgpa_updates: stats.cgpaUpdates,
    password_for_new: DEFAULT_PASSWORD,
  }
  writeFileSync(path.join(dir, "import-c20-sem4-summary.json"), JSON.stringify(summary, null, 2), "utf8")
  console.log("\n=== DONE ===")
  console.log(summary)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
