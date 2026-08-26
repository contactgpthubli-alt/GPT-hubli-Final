/**
 * Verify C-25 CS Nov/Dec-2025 Sem-1 results + attempts vs CS_parsed.json
 */
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
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
const env = { ...pe(path.join(root, ".env")), ...pe(path.join(root, ".env.local")) }
const url =
  env.DATABASE_URL_UNPOOLED ||
  env.POSTGRES_URL_NON_POOLING ||
  env.DATABASE_URL ||
  env.POSTGRES_URL

const SESSION = "Nov/Dec-2025"
const SEM = 1
const parsed = JSON.parse(
  readFileSync(path.join(root, "tmp-c25/result-sheets/nov-dec-2025/CS_parsed.json"), "utf8"),
)

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const pub = await c.query(
  `SELECT COUNT(*)::int AS n,
          COUNT(*) FILTER (WHERE result ILIKE 'pass')::int AS pass,
          COUNT(*) FILTER (WHERE result ILIKE 'fail')::int AS fail
     FROM results
    WHERE session = $1 AND sem = $2 AND UPPER(reg_no) LIKE '171CS25%'`,
  [SESSION, SEM],
)
console.log("CS published results:", pub.rows[0])

const att = await c.query(
  `SELECT COUNT(*)::int AS n, COUNT(DISTINCT reg_no)::int AS students
     FROM student_exam_attempts
    WHERE exam_session = $1 AND semester = $2 AND status = 'verified'
      AND UPPER(reg_no) LIKE '171CS25%'`,
  [SESSION, SEM],
)
console.log("CS verified attempts:", att.rows[0])

const miss = await c.query(
  `SELECT r.reg_no, r.name
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
console.log("CS results missing attempts:", miss.rows.length)

const gradeMismatches = []
const sgpaMismatches = []
for (const s of parsed) {
  const { rows } = await c.query(
    `SELECT r.reg_no, r.name, r.sgpa, r.result,
            (SELECT json_agg(json_build_object('code', rs.code, 'grade', rs.grade, 'credits', rs.credits)
                             ORDER BY rs.ord)
               FROM result_subjects rs WHERE rs.result_id = r.id) AS subjects
       FROM results r
      WHERE UPPER(r.reg_no) = $1 AND r.session = $2 AND r.sem = $3`,
    [s.reg, SESSION, SEM],
  )
  if (!rows.length) {
    gradeMismatches.push({ reg: s.reg, reason: "missing_result_row" })
    continue
  }
  const db = rows[0]
  if (Number(db.sgpa) !== Number(s.sgpa)) {
    sgpaMismatches.push({ reg: s.reg, pdf: s.sgpa, db: db.sgpa })
  }
  const dbMap = new Map((db.subjects || []).map((x) => [String(x.code).toUpperCase(), x]))
  for (const sub of s.subjects) {
    const d = dbMap.get(sub.code)
    if (!d || String(d.grade) !== String(sub.grade)) {
      gradeMismatches.push({
        reg: s.reg,
        code: sub.code,
        pdf: sub.grade,
        db: d?.grade ?? null,
      })
    }
  }
}

console.log("SGPA mismatches vs PDF JSON:", sgpaMismatches.length, sgpaMismatches.slice(0, 5))
console.log("Grade mismatches vs PDF JSON:", gradeMismatches.length, gradeMismatches.slice(0, 10))

const samples = ["171CS25001", "171CS25003", "171CS25008", "171CS25801"]
for (const reg of samples) {
  const { rows } = await c.query(
    `SELECT r.reg_no, r.name, r.sgpa, r.result,
            (SELECT string_agg(rs.code || ':' || rs.grade, ', ' ORDER BY rs.ord)
               FROM result_subjects rs WHERE rs.result_id = r.id) AS subjects
       FROM results r WHERE UPPER(r.reg_no)=$1 AND session=$2 AND sem=$3`,
    [reg, SESSION, SEM],
  )
  console.log("SAMPLE", rows[0])
}

await c.end()
