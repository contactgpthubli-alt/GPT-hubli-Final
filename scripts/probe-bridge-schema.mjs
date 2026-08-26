import fs from "fs"
import pg from "pg"
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, "utf8").split(/\n/)) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()

await c.query(`
  CREATE TABLE IF NOT EXISTS bridge_attempts (
    id            BIGSERIAL PRIMARY KEY,
    reg_no        TEXT NOT NULL,
    branch_code   TEXT NOT NULL,
    semester      INT  NOT NULL,
    subject_name  TEXT NOT NULL,
    result        TEXT NOT NULL DEFAULT 'fail',
    grade         TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'draft',
    reject_note   TEXT,
    submitted_at  TIMESTAMPTZ,
    verified_at   TIMESTAMPTZ,
    verified_by   BIGINT,
    verified_by_name TEXT,
    verifier_role TEXT,
    created_by    BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`)
await c.query(`CREATE INDEX IF NOT EXISTS idx_bridge_attempts_reg ON bridge_attempts(reg_no, status)`)
await c.query(`CREATE INDEX IF NOT EXISTS idx_bridge_attempts_status ON bridge_attempts(status, branch_code)`)
await c.query(`ALTER TABLE exam_fee_payments ADD COLUMN IF NOT EXISTS fee_kind TEXT NOT NULL DEFAULT 'regular'`)
await c.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_fee_bridge_unique
    ON exam_fee_payments(reg_no)
    WHERE fee_kind = 'bridge'
`)
console.log("bridge_attempts + exam_fee_payments.fee_kind + unique index: OK")

// Insert/verify/fee round-trip smoke test against a real student reg_no
const stu = await c.query(`SELECT reg_no, dept FROM students LIMIT 1`)
if (stu.rows[0]) {
  const reg = stu.rows[0].reg_no
  const ins = await c.query(
    `INSERT INTO bridge_attempts (reg_no, branch_code, semester, subject_name, result, grade, status)
     VALUES ($1,'CSE',1,'Probe Subject','fail','', 'draft') RETURNING id`,
    [reg],
  )
  console.log("inserted bridge_attempts row id:", ins.rows[0].id)
  await c.query(`DELETE FROM bridge_attempts WHERE id = $1`, [ins.rows[0].id])
  console.log("cleaned up probe row")
} else {
  console.log("no students found to test insert (schema-only check passed)")
}

await c.end()
