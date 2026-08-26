/**
 * Seed only CS Nov/Dec-2025 students still missing verified attempts.
 */
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
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

function mapResult(grade) {
  const g = String(grade || "").toUpperCase()
  if (["F", "F*", "F**", "AB", "NE", "W", "X"].includes(g) || grade === "Ab") return "fail"
  return "pass"
}

const env = { ...pe(path.join(root, ".env")), ...pe(path.join(root, ".env.local")) }
const url =
  env.DATABASE_URL_UNPOOLED ||
  env.POSTGRES_URL_NON_POOLING ||
  env.DATABASE_URL ||
  env.POSTGRES_URL

const c = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  keepAlive: true,
})
await c.connect()

const miss = await c.query(
  `SELECT r.id, r.reg_no, r.name
     FROM results r
    WHERE r.session = $1 AND r.sem = $2 AND UPPER(r.reg_no) LIKE '171CS25%'
      AND NOT EXISTS (
        SELECT 1 FROM student_exam_attempts a
         WHERE UPPER(a.reg_no) = UPPER(r.reg_no)
           AND a.exam_session = $1 AND a.semester = $2 AND a.status = 'verified'
      )
    ORDER BY r.reg_no`,
  [SESSION, SEM],
)
console.log(
  "missing",
  miss.rows.length,
  miss.rows.map((r) => r.reg_no),
)

let inserted = 0
await c.query("BEGIN")
try {
  for (const h of miss.rows) {
    const reg = String(h.reg_no).toUpperCase()
    const { rows: subs } = await c.query(
      `SELECT code, name, grade FROM result_subjects WHERE result_id = $1 ORDER BY ord`,
      [h.id],
    )
    for (const sub of subs) {
      const code = String(sub.code).toUpperCase()
      const grade = String(sub.grade || "").trim()
      await c.query(
        `INSERT INTO student_exam_attempts (
           reg_no, scheme, branch_code, semester, subject_code, subject_name,
           exam_session, result, grade, status,
           submitted_at, verified_at, verified_by_name, verifier_role
         ) VALUES (
           $1,'C-25','CSE',$2,$3,$4,
           $5,$6,$7,'verified',
           now(), now(), 'Official Result Ledger', 'exam'
         )`,
        [reg, SEM, code, String(sub.name || code), SESSION, mapResult(grade), grade],
      )
      inserted++
    }
    console.log("seeded", reg, subs.length)
  }
  await c.query("COMMIT")
} catch (e) {
  await c.query("ROLLBACK")
  throw e
}

const check = await c.query(
  `SELECT COUNT(*)::int AS n, COUNT(DISTINCT reg_no)::int AS students
     FROM student_exam_attempts
    WHERE exam_session = $1 AND semester = $2 AND status = 'verified'
      AND UPPER(reg_no) LIKE '171CS25%'`,
  [SESSION, SEM],
)
const still = await c.query(
  `SELECT COUNT(*)::int AS n
     FROM results r
    WHERE r.session = $1 AND r.sem = $2 AND UPPER(r.reg_no) LIKE '171CS25%'
      AND NOT EXISTS (
        SELECT 1 FROM student_exam_attempts a
         WHERE UPPER(a.reg_no) = UPPER(r.reg_no)
           AND a.exam_session = $1 AND a.semester = $2 AND a.status = 'verified'
      )`,
  [SESSION, SEM],
)
console.log({ inserted, verified: check.rows[0], still_missing: still.rows[0].n })
await c.end()
