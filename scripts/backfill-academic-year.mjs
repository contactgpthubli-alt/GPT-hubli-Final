/**
 * Rebuild admission year + lateral entry + study year from register numbers.
 *
 * Reg format (GPT Hubli):
 *   171 + branch(CS/CE/EC/ME) + YY + roll
 *   e.g. 171CS15003 → college 171, CS, admitted 2015-16, roll 003
 * Lateral roll bands:
 *   300–399 ITI lateral → 2nd year entry
 *   700–799 PUC lateral → 2nd year entry
 *
 * Usage: node scripts/backfill-academic-year.mjs
 * Optional: ACTIVE_AY=2026-27 node scripts/backfill-academic-year.mjs
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

function loadEnv() {
  const envPath = path.join(root, ".env.local")
  const env = { ...process.env }
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2]
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1)
      }
      if (env[m[1]] == null) env[m[1]] = v
    }
  }
  return env
}

function normalizeAcademicYear(input) {
  if (!input) return null
  const raw = String(input).trim()
  let m = raw.match(/^(20\d{2})\s*[-–—/]\s*(\d{2}|\d{4})$/)
  if (m) {
    const start = Number(m[1])
    let endTwo = m[2]
    if (endTwo.length === 4) endTwo = endTwo.slice(2)
    return `${start}-${endTwo}`
  }
  m = raw.match(/^(20\d{2})$/)
  if (m) {
    const start = Number(m[1])
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
  }
  return null
}

function inferActiveAy() {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const start = m >= 6 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
}

async function main() {
  const env = loadEnv()
  const conn =
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    env.POSTGRES_PRISMA_URL ||
    env.DATABASE_URL_UNPOOLED
  if (!conn) {
    console.error("Missing DATABASE_URL")
    process.exit(1)
  }
  const client = new pg.Client({
    connectionString: conn,
    ssl: conn.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 30000,
    query_timeout: 300000,
  })
  await client.connect()
  console.log("Connected")

  for (const sql of [
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_academic_year TEXT`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'regular'`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS entry_study_year INT DEFAULT 1`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS current_study_year INT`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_status TEXT DEFAULT 'active'`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS progress_locked BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS pass_out_academic_year TEXT`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS needs_admission_year_review BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_updated_at TIMESTAMPTZ`,
    `CREATE TABLE IF NOT EXISTS institute_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by BIGINT
    )`,
  ]) {
    await client.query(sql)
  }

  const active = normalizeAcademicYear(env.ACTIVE_AY) || inferActiveAy()
  const activeStart = Number(String(active).slice(0, 4))
  await client.query(
    `INSERT INTO institute_settings (key, value, updated_at)
     VALUES ('academic', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET
       value = jsonb_set(COALESCE(institute_settings.value, '{}'::jsonb), '{active_academic_year}', to_jsonb($2::text), true),
       updated_at = now()`,
    [JSON.stringify({ active_academic_year: active, academic_year_start_month: 6 }), active],
  )
  console.log("Active academic year:", active)

  // 1) Parse reg: 171 + branch + YY + roll → admission year + lateral
  //    roll 300-399 = ITI lateral, 700-799 = PUC lateral
  const r1 = await client.query(`
    WITH parsed AS (
      SELECT
        reg_no,
        upper(regexp_replace(reg_no, '[^A-Za-z0-9]', '', 'g')) AS clean,
        substring(upper(regexp_replace(reg_no, '[^A-Za-z0-9]', '', 'g'))
          from '^171[A-Z]{2,4}([0-9]{2})[0-9]{3,4}$') AS yy,
        substring(upper(regexp_replace(reg_no, '[^A-Za-z0-9]', '', 'g'))
          from '^171[A-Z]{2,4}[0-9]{2}([0-9]{3,4})$') AS roll_raw
      FROM students
      WHERE upper(regexp_replace(reg_no, '[^A-Za-z0-9]', '', 'g'))
            ~ '^171[A-Z]{2,4}[0-9]{2}[0-9]{3,4}$'
    ),
    calc AS (
      SELECT
        reg_no,
        yy::int AS yy_n,
        roll_raw::int AS roll_n,
        ('20' || yy || '-' || lpad(((yy::int + 1) % 100)::text, 2, '0')) AS adm_ay,
        CASE
          WHEN roll_raw::int BETWEEN 700 AND 799 THEN 'lateral'
          WHEN roll_raw::int BETWEEN 300 AND 399 THEN 'lateral'
          ELSE 'regular'
        END AS entry_type,
        CASE
          WHEN roll_raw::int BETWEEN 700 AND 799 THEN 2
          WHEN roll_raw::int BETWEEN 300 AND 399 THEN 2
          ELSE 1
        END AS entry_study_year,
        CASE
          WHEN roll_raw::int BETWEEN 700 AND 799 THEN 'lateral_puc'
          WHEN roll_raw::int BETWEEN 300 AND 399 THEN 'lateral_iti'
          ELSE 'regular'
        END AS entry_source
      FROM parsed
      WHERE yy IS NOT NULL AND roll_raw IS NOT NULL
        AND yy::int BETWEEN 10 AND 40
    )
    UPDATE students s SET
      admission_academic_year = c.adm_ay,
      entry_type = c.entry_type,
      entry_study_year = c.entry_study_year,
      needs_admission_year_review = FALSE,
      academic_updated_at = now(),
      extra = COALESCE(s.extra, '{}'::jsonb)
        || jsonb_build_object(
             'Admission Academic Year', c.adm_ay,
             'Entry Type', c.entry_type,
             'Entry Source', c.entry_source
           )
        - 'Admission Year'
        - 'Year of Admission'
        - 'Year Of Admission'
        - 'Batch'
    FROM calc c
    WHERE s.reg_no = c.reg_no
  `)
  console.log("Parsed reg → admission/lateral:", r1.rowCount)

  // 2) Normalize any bare-year leftovers still in admission_academic_year
  const r2 = await client.query(`
    UPDATE students SET
      admission_academic_year =
        substring(admission_academic_year from '^(20[0-9]{2})')
        || '-' ||
        lpad(((substring(admission_academic_year from '^(20[0-9]{2})')::int + 1) % 100)::text, 2, '0')
    WHERE admission_academic_year ~ '^20[0-9]{2}$'
  `)
  console.log("Normalized bare years:", r2.rowCount)

  // 3) Progression (respect detain/year_back locks)
  const r3 = await client.query(
    `
    WITH base AS (
      SELECT
        reg_no,
        COALESCE(NULLIF(entry_study_year, 0), 1) AS entry_y,
        NULLIF(substring(admission_academic_year from '^(20[0-9]{2})'), '')::int AS adm_start,
        COALESCE(progress_locked, FALSE) AS locked,
        COALESCE(academic_status, 'active') AS st,
        current_study_year,
        year,
        pass_out_academic_year,
        admission_academic_year
      FROM students
      WHERE admission_academic_year IS NOT NULL AND admission_academic_year <> ''
    ),
    calc AS (
      SELECT
        *,
        CASE WHEN adm_start IS NULL THEN NULL ELSE entry_y + ($1::int - adm_start) END AS computed
      FROM base
    )
    UPDATE students s SET
      current_study_year = CASE
        WHEN c.locked OR c.st IN ('detained','year_back') THEN COALESCE(s.current_study_year, LEAST(3, GREATEST(1, c.entry_y)))
        WHEN c.st = 'passed_out' THEN COALESCE(s.current_study_year, 3)
        WHEN c.computed IS NULL THEN COALESCE(s.current_study_year, 1)
        WHEN c.computed >= 4 THEN 3
        WHEN c.computed < 1 THEN c.entry_y
        ELSE LEAST(3, GREATEST(1, c.computed))
      END,
      academic_status = CASE
        WHEN c.locked OR c.st IN ('detained','year_back') THEN c.st
        WHEN c.st = 'passed_out' THEN 'passed_out'
        WHEN c.computed IS NOT NULL AND c.computed >= 4 THEN 'passed_out'
        ELSE 'active'
      END,
      progress_locked = CASE
        WHEN c.st IN ('detained','year_back') OR c.locked THEN TRUE
        ELSE FALSE
      END,
      pass_out_academic_year = CASE
        WHEN (NOT c.locked AND c.st NOT IN ('detained','year_back') AND c.computed IS NOT NULL AND c.computed >= 4)
          OR c.st = 'passed_out'
        THEN COALESCE(
          s.pass_out_academic_year,
          (c.adm_start + (3 - c.entry_y))::text || '-' ||
          lpad(((c.adm_start + (3 - c.entry_y) + 1) % 100)::text, 2, '0')
        )
        ELSE NULL
      END,
      year = CASE
        WHEN c.locked OR c.st IN ('detained','year_back') THEN
          CASE COALESCE(s.current_study_year, LEAST(3, GREATEST(1, c.entry_y)))
            WHEN 1 THEN '1st Year' WHEN 2 THEN '2nd Year' WHEN 3 THEN '3rd Year' ELSE COALESCE(s.year, '1st Year') END
        WHEN c.st = 'passed_out' OR (c.computed IS NOT NULL AND c.computed >= 4 AND NOT c.locked) THEN 'Alumni'
        WHEN c.computed IS NULL THEN COALESCE(s.year, '1st Year')
        WHEN LEAST(3, GREATEST(1, c.computed)) = 1 THEN '1st Year'
        WHEN LEAST(3, GREATEST(1, c.computed)) = 2 THEN '2nd Year'
        ELSE '3rd Year'
      END,
      academic_updated_at = now(),
      extra = COALESCE(s.extra, '{}'::jsonb)
        || jsonb_build_object(
             'Current Year',
             CASE
               WHEN c.st = 'passed_out' OR (c.computed IS NOT NULL AND c.computed >= 4 AND NOT c.locked) THEN 'Alumni'
               WHEN c.computed IS NOT NULL AND LEAST(3, GREATEST(1, c.computed)) = 1 THEN '1st Year'
               WHEN c.computed IS NOT NULL AND LEAST(3, GREATEST(1, c.computed)) = 2 THEN '2nd Year'
               WHEN c.computed IS NOT NULL THEN '3rd Year'
               ELSE COALESCE(s.year, '1st Year')
             END,
             'Admission Academic Year', s.admission_academic_year
           )
    FROM calc c
    WHERE s.reg_no = c.reg_no
    `,
    [activeStart],
  )
  console.log("Progression rows:", r3.rowCount)

  const stats = await client.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE academic_status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE academic_status = 'passed_out')::int AS alumni,
      COUNT(*) FILTER (WHERE entry_type = 'lateral')::int AS lateral,
      COUNT(*) FILTER (WHERE entry_type = 'lateral' AND entry_study_year = 2)::int AS lateral_y2,
      COUNT(*) FILTER (WHERE current_study_year = 1 AND COALESCE(academic_status,'active') <> 'passed_out')::int AS y1,
      COUNT(*) FILTER (WHERE current_study_year = 2 AND COALESCE(academic_status,'active') <> 'passed_out')::int AS y2,
      COUNT(*) FILTER (WHERE current_study_year = 3 AND COALESCE(academic_status,'active') <> 'passed_out')::int AS y3,
      COUNT(*) FILTER (WHERE admission_academic_year IS NULL OR admission_academic_year = '')::int AS missing_adm,
      COUNT(*) FILTER (WHERE admission_academic_year ~ '^[0-9]{4}$')::int AS bare_year
    FROM students
  `)
  console.log("Stats:", stats.rows[0])

  const latSample = await client.query(`
    SELECT reg_no, admission_academic_year, entry_type, entry_study_year, year, academic_status
      FROM students
     WHERE entry_type = 'lateral'
     ORDER BY reg_no
     LIMIT 15
  `)
  console.log("Lateral samples:", latSample.rows)

  await client.end()
  console.log("Done")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
