/**
 * Import C-25 Semester 2 official result ledgers (May 2026) into results / result_subjects.
 *
 * Sources (PDF text extracts or raw PDFs via pre-extracted txt):
 *   tmp-c25/result-sheets/{CE,CS,EC,ME}_result.txt
 *
 * Matching rules:
 *   - Register number must match students.reg_no (case-insensitive)
 *   - Name must match after normalization (spaces/punct stripped, uppercase)
 *     OR fuzzy: tokens of PDF name all appear in DB name / vice-versa (high overlap)
 *   - Unmatched rows are skipped and reported (never invent students)
 *
 * Upserts on (reg_no, sem, session). Session = "May 2026".
 *
 * Usage:
 *   node scripts/import-c25-sem2-results.mjs --dry-run
 *   node scripts/import-c25-sem2-results.mjs
 *   node scripts/import-c25-sem2-results.mjs --update-cgpa   # also write students.cgpa
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

const DRY_RUN = process.argv.includes("--dry-run")
const UPDATE_CGPA = process.argv.includes("--update-cgpa")
const SEM = 2
const SESSION = "May 2026"
const SCHEME = "C-25"

const BRANCH_FULL = {
  CE: "Civil Engineering",
  CS: "Computer Science and Engineering",
  EC: "Electronics and Communication Engineering",
  ME: "Mechanical Engineering",
}

/** Full subject credits (applied) from ledger when student passed. */
const SUBJECT_CREDITS = {
  // CE
  "25SC21I": 6,
  "25EE01I": 5,
  "25CE21I": 5,
  "25CE22I": 6,
  "25CE23T": 2,
  // CS / EC shared + branch
  "25EG01I": 6,
  "25ME02I": 5,
  "25CS21I": 6,
  "25CS22T": 2,
  "25EC21I": 6,
  "25EC22T": 2,
  // ME
  "25CS01I": 5,
  "25ME21I": 6,
  "25ME22T": 2,
}

const SUBJECT_NAMES = {
  "25SC21I": "Engineering Mathematics-II",
  "25EE01I": "Fundamentals of Electrical & Electronics Engineering",
  "25CE21I": "Civil Engineering Graphics and CAD",
  "25CE22I": "Basic Surveying",
  "25CE23T": "Indian Constitution",
  "25EG01I": "Essential English Communication",
  "25ME02I": "Computer Aided Engineering Graphics",
  "25CS21I": "Thinking Programming with Python",
  "25CS22T": "Indian Constitution",
  "25EC21I": "Applied Electronics-1",
  "25EC22T": "Indian Constitution",
  "25CS01I": "IT Skills",
  "25ME21I": "Concepts of Mechanical Engineering -II",
  "25ME22T": "Indian Constitution",
}

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
  // Prefer direct/unpooled for bulk writes (Neon pooler can idle-drop mid-import).
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
  return new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    query_timeout: 60000,
  })
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

/** Match PDF name to DB name: exact, containment, token overlap, or small edit distance (typos). */
function namesMatch(pdfName, dbName) {
  const a = normName(pdfName)
  const b = normName(dbName)
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true

  // Typo tolerance: e.g. MEHARWADE vs MEHAEWADE, VIANYAK vs VINAYAK
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

  // Token-wise: majority tokens exact or 1-edit close
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

function parseLedgerText(text, branchCode) {
  const blocks = text.split(/Register Number\s*:\s*/i)
  const students = []
  for (const block of blocks.slice(1)) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)

    // reg: 171 / CE / 25001  OR  171CE25001
    const parts = []
    for (const ln of lines) {
      if (/^Student Name/i.test(ln)) break
      if (/^\d{3}$/.test(ln) || /^[A-Z]{2}$/.test(ln) || /^\d{5}$/.test(ln) || /^\d{3}[A-Z]{2}\d{5}$/.test(ln)) {
        parts.push(ln)
      }
      if (parts.length >= 3) break
    }
    let reg = null
    if (parts.length >= 3 && /^\d{3}$/.test(parts[0]) && /^[A-Z]{2}$/.test(parts[1]) && /^\d{5}$/.test(parts[2])) {
      reg = parts[0] + parts[1] + parts[2]
    } else if (parts[0] && /^\d{3}[A-Z]{2}\d{5}$/.test(parts[0])) {
      reg = parts[0]
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
      const code = m[1]
      const tail = block.slice(m.index + m[0].length)
      const tlines = tail
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      const nameParts = []
      let j = 0
      while (
        j < tlines.length &&
        !/^\d+$/.test(tlines[j]) &&
        !/^[A-F]\+?$|^F$/.test(tlines[j])
      ) {
        if (/^Register Number/i.test(tlines[j]) || /^Student Name/i.test(tlines[j])) break
        if (/^May\s+\d{4}/i.test(tlines[j])) break
        if (/^Program\s*:/i.test(tlines[j])) break
        nameParts.push(tlines[j])
        j++
      }
      let credit = 0
      let grade = ""
      let result = ""
      if (j < tlines.length && /^\d+$/.test(tlines[j])) {
        credit = Number(tlines[j])
        j++
      }
      if (j < tlines.length && /^[A-F]\+?$|^F$/.test(tlines[j])) {
        grade = tlines[j]
        j++
      }
      if (j < tlines.length && /^(PASS|FAIL|NE)$/i.test(tlines[j])) {
        result = tlines[j].toUpperCase()
      }
      if (!grade) continue
      const sname =
        SUBJECT_NAMES[code] ||
        nameParts.join(" ").replace(/\s+/g, " ").replace(/\.+\s*$/, "").trim()
      subjects.push({
        code,
        name: sname,
        credit_earned: credit,
        credits: SUBJECT_CREDITS[code] ?? credit,
        grade,
        result: result || (grade === "F" ? "FAIL" : "PASS"),
      })
    }

    if (subjects.length) {
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
  const dir = path.join(projectRoot, "tmp-c25", "result-sheets")
  const tags = ["CE", "CS", "EC", "ME"]
  const all = []
  for (const tag of tags) {
    const p = path.join(dir, `${tag}_result.txt`)
    if (!existsSync(p)) {
      console.warn("Missing extract:", p)
      continue
    }
    const list = parseLedgerText(readFileSync(p, "utf8"), tag)
    console.log(`Parsed ${tag}: ${list.length} students`)
    all.push(...list)
  }
  return all
}

function overallResult(subjects) {
  const bad = subjects.some((s) => s.result === "FAIL" || s.result === "NE" || s.grade === "F")
  return bad ? "Fail" : "Pass"
}

async function main() {
  const records = loadAllFromExtracts()
  console.log(`Total ledger rows: ${records.length}`)

  const dbUrl = resolveDb()
  if (!dbUrl) {
    console.error("No DATABASE_URL found")
    process.exit(1)
  }

  let client = makeClient(dbUrl)
  await client.connect()
  console.log("DB connected")

  // Load all students once
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
  for (const rec of records) {
    const db = byReg.get(rec.reg)
    if (!db) {
      skipped.push({ ...rec, reason: "reg_not_found" })
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
    matched.push({ rec, db })
  }

  console.log(`Matched: ${matched.length}  Skipped: ${skipped.length}`)
  const byReason = {}
  for (const s of skipped) {
    byReason[s.reason] = (byReason[s.reason] || 0) + 1
  }
  console.log("Skip reasons:", byReason)

  const outDir = path.join(projectRoot, "tmp-c25", "result-sheets")
  mkdirSync(outDir, { recursive: true })
  const report = {
    session: SESSION,
    sem: SEM,
    dry_run: DRY_RUN,
    total_ledger: records.length,
    matched: matched.length,
    skipped: skipped.length,
    skip_reasons: byReason,
    matched_sample: matched.slice(0, 5).map(({ rec, db }) => ({
      reg: rec.reg,
      pdf_name: rec.name,
      db_name: db.name,
      sgpa: rec.sgpa,
      subjects: rec.subjects.length,
    })),
    skipped_sample: skipped.slice(0, 30).map((s) => ({
      reg: s.reg,
      pdf_name: s.name,
      db_name: s.db_name || null,
      reason: s.reason,
    })),
    subjects_catalog: SUBJECT_NAMES,
  }
  writeFileSync(
    path.join(outDir, `import-report-${DRY_RUN ? "dryrun" : "live"}-${Date.now()}.json`),
    JSON.stringify(report, null, 2),
    "utf8",
  )
  writeFileSync(path.join(outDir, "parsed-all.json"), JSON.stringify(records, null, 2), "utf8")

  if (DRY_RUN) {
    console.log("\n=== DRY RUN — no DB writes ===")
    console.log("Sample matches:")
    for (const { rec, db } of matched.slice(0, 8)) {
      console.log(
        `  ${rec.reg} | PDF: ${rec.name} | DB: ${db.name} | SGPA ${rec.sgpa} | ${overallResult(rec.subjects)} | ${rec.subjects.length} subjects`,
      )
    }
    if (skipped.length) {
      console.log("\nSample skips:")
      for (const s of skipped.slice(0, 15)) {
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
  const BATCH = 15

  console.log(`\n=== LIVE IMPORT (${matched.length} students, batch ${BATCH}, reconnect each batch) ===`)

  for (let start = 0; start < matched.length; start += BATCH) {
    const batch = matched.slice(start, start + BATCH)
    client = makeClient(dbUrl)
    await client.connect()
    try {
      await client.query("BEGIN")
      for (const { rec, db } of batch) {
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

        if (UPDATE_CGPA && rec.cgpa != null && !Number.isNaN(rec.cgpa)) {
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
  console.log({
    inserted,
    updated,
    subjectRows,
    cgpaUpdates,
    matched: matched.length,
    skipped: skipped.length,
  })
  writeFileSync(
    path.join(outDir, `import-live-summary.json`),
    JSON.stringify(
      {
        inserted,
        updated,
        subjectRows,
        cgpaUpdates,
        matched: matched.length,
        skipped: skipped.length,
        skipped_regs: skipped.map((s) => ({ reg: s.reg, name: s.name, reason: s.reason })),
        session: SESSION,
        scheme: SCHEME,
      },
      null,
      2,
    ),
    "utf8",
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
