/**
 * Copy official published results (results + result_subjects) into
 * student_exam_attempts as verified rows so the student "Results" UI shows them.
 *
 * Default: session "May 2026", sem 2 (C-25 ledger import).
 *
 * Usage:
 *   node scripts/seed-exam-attempts-from-results.mjs --dry-run
 *   node scripts/seed-exam-attempts-from-results.mjs
 *   node scripts/seed-exam-attempts-from-results.mjs --session "May 2026" --sem 2
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, "..")
const DRY_RUN = process.argv.includes("--dry-run")

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const SESSION = arg("--session", "May 2026")
const SEM = Number(arg("--sem", "2"))

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

function branchCodeFromDept(dept) {
  const d = String(dept || "").toLowerCase()
  if (d.includes("computer") || d.includes("cse") || /\bcs\b/.test(d)) return "CSE"
  if (d.includes("civil")) return "CE"
  if (d.includes("electron") || d.includes("ece") || d.includes("e&c")) return "ECE"
  if (d.includes("mech")) return "ME"
  // reg-based fallback later
  return null
}

function branchCodeFromReg(reg) {
  const m = String(reg).toUpperCase().match(/^171([A-Z]{2})/)
  if (!m) return null
  const x = m[1]
  if (x === "CS") return "CSE"
  if (x === "EC") return "ECE"
  if (x === "CE") return "CE"
  if (x === "ME") return "ME"
  return null
}

function schemeFromAy(ay) {
  const m = String(ay || "").match(/^(20\d{2})/)
  if (!m) return "C-25"
  const y = Number(m[1])
  if (y >= 2025) return "C-25"
  if (y >= 2020) return "C-20"
  return "C-25"
}

function mapResult(grade, overall) {
  const g = String(grade || "").toUpperCase()
  const o = String(overall || "").toUpperCase()
  if (g === "F" || o === "FAIL" || o === "NE" || o === "ABSENT") return "fail"
  if (o === "PASS" || (g && g !== "F")) return "pass"
  return "fail"
}

async function main() {
  const dbUrl = resolveDb()
  if (!dbUrl) throw new Error("No DATABASE_URL")
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  })
  await client.connect()

  const { rows: headers } = await client.query(
    `SELECT r.id, r.reg_no, r.name, r.branch, r.sem, r.session, r.sgpa, r.result AS overall,
            s.admission_academic_year, s.dept
       FROM results r
       LEFT JOIN students s ON UPPER(s.reg_no) = UPPER(r.reg_no)
      WHERE r.session = $1 AND r.sem = $2
      ORDER BY r.reg_no`,
    [SESSION, SEM],
  )
  console.log(`Found ${headers.length} published results for ${SESSION} sem ${SEM}`)

  let inserted = 0
  let updated = 0
  let skipped = 0
  const errors = []

  const BATCH = 20
  for (let i = 0; i < headers.length; i += BATCH) {
    const batch = headers.slice(i, i + BATCH)
    if (!DRY_RUN) await client.query("BEGIN")
    try {
      for (const h of batch) {
        const reg = String(h.reg_no).toUpperCase()
        const branchCode =
          branchCodeFromDept(h.dept || h.branch) || branchCodeFromReg(reg) || "CE"
        const scheme = schemeFromAy(h.admission_academic_year)
        const { rows: subs } = await client.query(
          `SELECT code, name, grade, credits, ord FROM result_subjects WHERE result_id = $1 ORDER BY ord`,
          [h.id],
        )
        if (!subs.length) {
          skipped++
          continue
        }
        for (const sub of subs) {
          const code = String(sub.code || "").trim().toUpperCase()
          const name = String(sub.name || code).trim()
          const grade = String(sub.grade || "").trim()
          const result = mapResult(grade, null)
          // Prefer grade F → fail
          const resFinal = grade.toUpperCase() === "F" ? "fail" : result === "pass" ? "pass" : "fail"

          if (DRY_RUN) {
            inserted++
            continue
          }

          // Upsert: if same reg+subject+session exists (non-rejected), update to verified official
          const existing = await client.query(
            `SELECT id, status FROM student_exam_attempts
              WHERE UPPER(reg_no) = $1 AND UPPER(subject_code) = $2 AND exam_session = $3
                AND status IS DISTINCT FROM 'rejected'
              ORDER BY id DESC LIMIT 1`,
            [reg, code, SESSION],
          )

          if (existing.rows.length) {
            await client.query(
              `UPDATE student_exam_attempts SET
                 scheme = $2,
                 branch_code = $3,
                 semester = $4,
                 subject_name = $5,
                 result = $6,
                 grade = $7,
                 status = 'verified',
                 reject_note = NULL,
                 submitted_at = COALESCE(submitted_at, now()),
                 verified_at = now(),
                 verified_by_name = 'Official Result Ledger',
                 verifier_role = 'exam',
                 updated_at = now()
               WHERE id = $1`,
              [existing.rows[0].id, scheme, branchCode, SEM, name, resFinal, grade],
            )
            updated++
          } else {
            await client.query(
              `INSERT INTO student_exam_attempts (
                 reg_no, scheme, branch_code, semester, subject_code, subject_name,
                 exam_session, result, grade, status,
                 submitted_at, verified_at, verified_by_name, verifier_role
               ) VALUES (
                 $1,$2,$3,$4,$5,$6,
                 $7,$8,$9,'verified',
                 now(), now(), 'Official Result Ledger', 'exam'
               )`,
              [reg, scheme, branchCode, SEM, code, name, SESSION, resFinal, grade],
            )
            inserted++
          }
        }
      }
      if (!DRY_RUN) await client.query("COMMIT")
      console.log(`  batch ${i + 1}-${i + batch.length} ok`)
    } catch (e) {
      if (!DRY_RUN) await client.query("ROLLBACK")
      console.error(`  batch ${i + 1} fail`, e.message)
      errors.push(String(e.message || e))
      // reconnect next batch
    }
  }

  // spot check
  const { rows: check } = await client.query(
    `SELECT COUNT(*)::int AS n FROM student_exam_attempts
      WHERE exam_session = $1 AND semester = $2 AND status = 'verified'`,
    [SESSION, SEM],
  )
  console.log({
    dry_run: DRY_RUN,
    inserted,
    updated,
    skipped,
    verified_in_db: check[0]?.n,
    errors: errors.length,
  })

  const outDir = path.join(projectRoot, "tmp-c25", "result-sheets")
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    path.join(outDir, "seed-attempts-summary.json"),
    JSON.stringify({ session: SESSION, sem: SEM, inserted, updated, skipped, verified_in_db: check[0]?.n, errors }, null, 2),
  )
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
