/**
 * Seed verified student_exam_attempts for CS Nov/Dec-2025 Sem-1 only.
 * Safer than re-seeding all branches when connection is flaky.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DRY_RUN = process.argv.includes("--dry-run")
const SESSION = "Nov/Dec-2025"
const SEM = 1

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
  const env = { ...pe(path.join(root, ".env")), ...pe(path.join(root, ".env.local")), ...process.env }
  for (const k of ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_URL"]) {
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

function mapResult(grade) {
  const g = String(grade || "").toUpperCase()
  if (["F", "F*", "F**", "AB", "NE", "W", "X"].includes(g) || grade === "Ab") return "fail"
  return "pass"
}

const dbUrl = resolveDb()
if (!dbUrl) throw new Error("No DATABASE_URL")

let client = makeClient(dbUrl)
await client.connect()

const { rows: headers } = await client.query(
  `SELECT r.id, r.reg_no, r.name, r.branch, r.sem, r.session, r.sgpa, r.result AS overall,
          s.admission_academic_year, s.dept
     FROM results r
     LEFT JOIN students s ON UPPER(s.reg_no) = UPPER(r.reg_no)
    WHERE r.session = $1 AND r.sem = $2 AND UPPER(r.reg_no) LIKE '171CS25%'
    ORDER BY r.reg_no`,
  [SESSION, SEM],
)
console.log(`CS results to seed: ${headers.length}`)
await client.end().catch(() => {})

let inserted = 0
let updated = 0
let skipped = 0
const errors = []
const BATCH = 10

for (let i = 0; i < headers.length; i += BATCH) {
  const batch = headers.slice(i, i + BATCH)
  client = makeClient(dbUrl)
  await client.connect()
  try {
    if (!DRY_RUN) await client.query("BEGIN")
    for (const h of batch) {
      const reg = String(h.reg_no).toUpperCase()
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
        const resFinal = mapResult(grade)
        if (DRY_RUN) {
          inserted++
          continue
        }
        const existing = await client.query(
          `SELECT id FROM student_exam_attempts
            WHERE UPPER(reg_no) = $1 AND UPPER(subject_code) = $2 AND exam_session = $3
              AND status IS DISTINCT FROM 'rejected'
            ORDER BY id DESC LIMIT 1`,
          [reg, code, SESSION],
        )
        if (existing.rows.length) {
          await client.query(
            `UPDATE student_exam_attempts SET
               scheme = 'C-25',
               branch_code = 'CSE',
               semester = $2,
               subject_name = $3,
               result = $4,
               grade = $5,
               status = 'verified',
               reject_note = NULL,
               submitted_at = COALESCE(submitted_at, now()),
               verified_at = now(),
               verified_by_name = 'Official Result Ledger',
               verifier_role = 'exam',
               updated_at = now()
             WHERE id = $1`,
            [existing.rows[0].id, SEM, name, resFinal, grade],
          )
          updated++
        } else {
          await client.query(
            `INSERT INTO student_exam_attempts (
               reg_no, scheme, branch_code, semester, subject_code, subject_name,
               exam_session, result, grade, status,
               submitted_at, verified_at, verified_by_name, verifier_role
             ) VALUES (
               $1,'C-25','CSE',$2,$3,$4,
               $5,$6,$7,'verified',
               now(), now(), 'Official Result Ledger', 'exam'
             )`,
            [reg, SEM, code, name, SESSION, resFinal, grade],
          )
          inserted++
        }
      }
    }
    if (!DRY_RUN) await client.query("COMMIT")
    console.log(`  batch ${i + 1}-${i + batch.length} ok (ins ${inserted} upd ${updated})`)
  } catch (e) {
    if (!DRY_RUN) {
      try {
        await client.query("ROLLBACK")
      } catch {}
    }
    console.error(`  batch ${i + 1} FAIL:`, e.message || e)
    errors.push(String(e.message || e))
  }
  await client.end().catch(() => {})
}

client = makeClient(dbUrl)
await client.connect()
const { rows: check } = await client.query(
  `SELECT COUNT(*)::int AS n, COUNT(DISTINCT reg_no)::int AS students
     FROM student_exam_attempts
    WHERE exam_session = $1 AND semester = $2 AND status = 'verified'
      AND UPPER(reg_no) LIKE '171CS25%'`,
  [SESSION, SEM],
)
console.log({ dry_run: DRY_RUN, inserted, updated, skipped, verified: check[0], errors: errors.length })
const outDir = path.join(root, "tmp-c25/result-sheets/nov-dec-2025")
mkdirSync(outDir, { recursive: true })
writeFileSync(
  path.join(outDir, "seed-cs-attempts-summary.json"),
  JSON.stringify({ session: SESSION, sem: SEM, inserted, updated, skipped, verified: check[0], errors }, null, 2),
)
await client.end()
