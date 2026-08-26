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
const url = env.DATABASE_URL || env.POSTGRES_URL
const reg = process.argv[2] || "171CE25013"
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const r = await c.query("SELECT * FROM results WHERE UPPER(reg_no)=$1", [reg.toUpperCase()])
console.log("results", r.rows)
if (r.rows[0]) {
  const s = await c.query("SELECT code,name,grade,credits FROM result_subjects WHERE result_id=$1 ORDER BY ord", [
    r.rows[0].id,
  ])
  console.log("subjects", s.rows)
}
const a = await c.query(
  "SELECT id,subject_code,grade,result,status,semester,exam_session FROM student_exam_attempts WHERE UPPER(reg_no)=$1",
  [reg.toUpperCase()],
)
console.log("attempts", a.rows)
const st = await c.query(
  "SELECT reg_no,name,dept,year,admission_academic_year,current_study_year FROM students WHERE UPPER(reg_no)=$1",
  [reg.toUpperCase()],
)
console.log("student", st.rows)
const u = await c.query("SELECT id,email,reg_no,branch,role FROM users WHERE UPPER(reg_no)=$1", [reg.toUpperCase()])
console.log("user", u.rows)
await c.end()
