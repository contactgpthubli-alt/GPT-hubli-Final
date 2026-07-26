/**
 * DB helpers for DTE academic year / study-year progression.
 */
import { query } from "@/lib/db"
import {
  academicYearStart,
  computeProgression,
  guessAdmissionYearFromReg,
  normalizeAcademicYear,
  parseAcademicStatus,
  parseDiplomaReg,
  parseStudyYear,
  studyYearLabel,
  type AcademicStatus,
  type EntryType,
  type StudyYear,
  inferAcademicYearFromDate,
  DEFAULT_ACADEMIC_START_MONTH,
} from "@/lib/academic-year"

export type InstituteAcademicSettings = {
  active_academic_year: string
  academic_year_start_month: number
  updated_at?: string | null
  updated_by?: number | null
}

let schemaReady = false

export async function ensureAcademicSchema() {
  if (schemaReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS institute_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
    )
  `)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_academic_year TEXT`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'regular'`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS entry_study_year INT DEFAULT 1`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS current_study_year INT`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_status TEXT DEFAULT 'active'`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS progress_locked BOOLEAN DEFAULT FALSE`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS pass_out_academic_year TEXT`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS needs_admission_year_review BOOLEAN DEFAULT FALSE`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_updated_at TIMESTAMPTZ`)

  await query(`
    CREATE TABLE IF NOT EXISTS student_academic_events (
      id BIGSERIAL PRIMARY KEY,
      reg_no TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_year INT,
      to_year INT,
      from_status TEXT,
      to_status TEXT,
      academic_year TEXT,
      reason TEXT,
      actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_student_academic_events_reg ON student_academic_events (reg_no, created_at DESC)`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_students_academic_status ON students (academic_status, current_study_year)`,
  )
  schemaReady = true
}

export async function getInstituteAcademicSettings(): Promise<InstituteAcademicSettings> {
  await ensureAcademicSchema()
  const { rows } = await query(
    `SELECT value, updated_at, updated_by FROM institute_settings WHERE key = 'academic' LIMIT 1`,
  )
  const val = (rows[0]?.value || {}) as Record<string, unknown>
  const ay =
    normalizeAcademicYear(val.active_academic_year as string) ||
    normalizeAcademicYear(String(val.active_academic_year || "")) ||
    inferAcademicYearFromDate(new Date(), DEFAULT_ACADEMIC_START_MONTH)
  const month = Number(val.academic_year_start_month)
  return {
    active_academic_year: ay,
    academic_year_start_month:
      Number.isFinite(month) && month >= 1 && month <= 12 ? month : DEFAULT_ACADEMIC_START_MONTH,
    updated_at: rows[0]?.updated_at ?? null,
    updated_by: rows[0]?.updated_by != null ? Number(rows[0].updated_by) : null,
  }
}

export async function setInstituteAcademicYear(
  activeAcademicYear: string,
  actorUserId: number,
  startMonth?: number,
): Promise<InstituteAcademicSettings> {
  await ensureAcademicSchema()
  const ay = normalizeAcademicYear(activeAcademicYear)
  if (!ay) throw new Error("Invalid academic year. Use format 2026-27")
  const month =
    startMonth != null && startMonth >= 1 && startMonth <= 12
      ? startMonth
      : DEFAULT_ACADEMIC_START_MONTH
  const value = {
    active_academic_year: ay,
    academic_year_start_month: month,
  }
  await query(
    `INSERT INTO institute_settings (key, value, updated_at, updated_by)
     VALUES ('academic', $1::jsonb, now(), $2)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(value), actorUserId],
  )
  return {
    active_academic_year: ay,
    academic_year_start_month: month,
    updated_by: actorUserId,
    updated_at: new Date().toISOString(),
  }
}

export async function logAcademicEvent(input: {
  reg_no: string
  event_type: string
  from_year?: number | null
  to_year?: number | null
  from_status?: string | null
  to_status?: string | null
  academic_year?: string | null
  reason?: string | null
  actor_user_id?: number | null
  meta?: Record<string, unknown>
}) {
  await ensureAcademicSchema()
  await query(
    `INSERT INTO student_academic_events
      (reg_no, event_type, from_year, to_year, from_status, to_status, academic_year, reason, actor_user_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::jsonb,'{}'::jsonb))`,
    [
      input.reg_no,
      input.event_type,
      input.from_year ?? null,
      input.to_year ?? null,
      input.from_status ?? null,
      input.to_status ?? null,
      input.academic_year ?? null,
      input.reason ?? null,
      input.actor_user_id ?? null,
      JSON.stringify(input.meta || {}),
    ],
  )
}

export type StudentAcademicRow = {
  reg_no: string
  year: string | null
  admission_academic_year: string | null
  entry_type: string | null
  entry_study_year: number | null
  current_study_year: number | null
  academic_status: string | null
  progress_locked: boolean | null
  pass_out_academic_year: string | null
  needs_admission_year_review: boolean | null
  extra?: unknown
}

function asExtra(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {}
  return v as Record<string, unknown>
}

/** Ensure admission year exists (prefer reg-no structure; then column; then profile). */
export function resolveAdmissionYear(row: {
  reg_no?: string | null
  admission_academic_year?: string | null
  extra?: unknown
}): {
  admission: string | null
  needs_review: boolean
  entry_type?: EntryType
  entry_study_year?: StudyYear
  entry_source?: string
} {
  // Official structure from register number is authoritative for GPT Hubli
  const parsed = parseDiplomaReg(row.reg_no || null)
  if (parsed) {
    return {
      admission: parsed.admission_academic_year,
      needs_review: false,
      entry_type: parsed.entry_type,
      entry_study_year: parsed.entry_study_year,
      entry_source: parsed.entry_source,
    }
  }

  const fromCol = normalizeAcademicYear(row.admission_academic_year)
  if (fromCol) return { admission: fromCol, needs_review: true }

  const extra = asExtra(row.extra)
  const fromExtra =
    normalizeAcademicYear(extra["Admission Academic Year"] as string) ||
    normalizeAcademicYear(extra["Admission Year"] as string) ||
    normalizeAcademicYear(extra["Batch"] as string) ||
    normalizeAcademicYear(extra["Academic Year"] as string)
  if (fromExtra) return { admission: fromExtra, needs_review: true }

  const guessed = guessAdmissionYearFromReg(row.reg_no || null)
  if (guessed) return { admission: guessed, needs_review: true }
  return { admission: null, needs_review: true }
}

export async function applyProgressionToStudent(
  regNo: string,
  opts: {
    activeAcademicYear?: string
    actorUserId?: number | null
    force?: boolean
    eventType?: string
  } = {},
): Promise<{
  ok: boolean
  changed: boolean
  reason: string
  snapshot: ReturnType<typeof rowToSnapshot>
} | null> {
  await ensureAcademicSchema()
  const settings = opts.activeAcademicYear
    ? { active_academic_year: opts.activeAcademicYear }
    : await getInstituteAcademicSettings()
  const active = settings.active_academic_year

  const { rows } = await query(
    `SELECT reg_no, year, admission_academic_year, entry_type, entry_study_year,
            current_study_year, academic_status, progress_locked, pass_out_academic_year,
            needs_admission_year_review, extra
       FROM students WHERE reg_no = $1`,
    [regNo],
  )
  if (!rows[0]) return null
  const row = rows[0] as StudentAcademicRow

  const resolved = resolveAdmissionYear(row)
  const admission = resolved.admission
  const needs_review = resolved.needs_review
  // Prefer lateral markers from reg no when present
  const entryType: EntryType =
    resolved.entry_type ||
    (row.entry_type === "lateral" ? "lateral" : "regular")
  const entryYear = (resolved.entry_study_year ||
    parseStudyYear(row.entry_study_year) ||
    1) as StudyYear
  const status = parseAcademicStatus(row.academic_status)

  const result = computeProgression(
    {
      admission_academic_year: admission,
      entry_type: entryType,
      entry_study_year: entryYear,
      current_study_year: parseStudyYear(row.current_study_year ?? row.year),
      academic_status: status,
      progress_locked: !!row.progress_locked,
      pass_out_academic_year: row.pass_out_academic_year,
      year_label_hint: row.year,
    },
    active,
  )

  const admissionChanged = admission && admission !== row.admission_academic_year
  const needsReviewChanged = needs_review !== !!row.needs_admission_year_review
  const entryChanged =
    entryType !== (row.entry_type === "lateral" ? "lateral" : "regular") ||
    entryYear !== (parseStudyYear(row.entry_study_year) || 1)

  if (!result.changed && !admissionChanged && !needsReviewChanged && !entryChanged && !opts.force) {
    return {
      ok: true,
      changed: false,
      reason: result.reason,
      snapshot: rowToSnapshot({ ...row, admission_academic_year: admission }),
    }
  }

  await query(
    `UPDATE students SET
        admission_academic_year = COALESCE($2, admission_academic_year),
        entry_type = $9,
        entry_study_year = $10,
        current_study_year = $3,
        academic_status = $4,
        progress_locked = $5,
        pass_out_academic_year = $6,
        year = $7,
        needs_admission_year_review = $8,
        academic_updated_at = now(),
        extra = COALESCE(extra, '{}'::jsonb)
          || jsonb_build_object(
               'Current Year', $7::text,
               'Admission Academic Year', COALESCE($2, admission_academic_year, ''),
               'Entry Type', $9::text,
               'Entry Source', $11::text
             )
      WHERE reg_no = $1`,
    [
      regNo,
      admission,
      result.current_study_year,
      result.academic_status,
      result.progress_locked,
      result.pass_out_academic_year,
      result.year_label,
      needs_review,
      entryType,
      entryYear,
      resolved.entry_source || entryType,
    ],
  )

  if (result.changed) {
    await logAcademicEvent({
      reg_no: regNo,
      event_type: opts.eventType || result.reason || "auto_progress",
      from_year: parseStudyYear(row.current_study_year ?? row.year),
      to_year: result.current_study_year,
      from_status: status,
      to_status: result.academic_status,
      academic_year: active,
      actor_user_id: opts.actorUserId ?? null,
    })
  }

  const { rows: after } = await query(
    `SELECT reg_no, year, admission_academic_year, entry_type, entry_study_year,
            current_study_year, academic_status, progress_locked, pass_out_academic_year,
            needs_admission_year_review
       FROM students WHERE reg_no = $1`,
    [regNo],
  )
  return {
    ok: true,
    changed: true,
    reason: result.reason,
    snapshot: rowToSnapshot(after[0] || row),
  }
}

export function rowToSnapshot(row: Partial<StudentAcademicRow>) {
  const status = parseAcademicStatus(row.academic_status)
  const cur = parseStudyYear(row.current_study_year ?? row.year)
  return {
    admission_academic_year: row.admission_academic_year || null,
    entry_type: (row.entry_type === "lateral" ? "lateral" : "regular") as EntryType,
    entry_study_year: (parseStudyYear(row.entry_study_year) || 1) as StudyYear,
    current_study_year: cur,
    academic_status: status,
    progress_locked: !!row.progress_locked,
    pass_out_academic_year: row.pass_out_academic_year || null,
    year: row.year || studyYearLabel(cur, status),
    year_label: studyYearLabel(cur, status),
    needs_admission_year_review: !!row.needs_admission_year_review,
    is_alumni: status === "passed_out",
    read_only_portal: status === "passed_out",
  }
}

/** Bulk recompute for all students with a students row (set-based for scale). */
export async function applyProgressionBulk(actorUserId: number | null) {
  await ensureAcademicSchema()
  const settings = await getInstituteAcademicSettings()
  const active = settings.active_academic_year
  const activeStart = academicYearStart(active)
  if (activeStart == null) {
    return {
      active_academic_year: active,
      total: 0,
      advanced: 0,
      auto_alumni: 0,
      locked_skipped: 0,
      missing_admission_year: 0,
      unchanged: 0,
    }
  }

  // Rebuild admission + lateral from reg structure for all parseable rows
  await query(`
    WITH parsed AS (
      SELECT
        reg_no,
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
        END AS entry_study_year
      FROM parsed
      WHERE yy IS NOT NULL AND roll_raw IS NOT NULL
        AND yy::int BETWEEN 10 AND 40
    )
    UPDATE students s SET
      admission_academic_year = c.adm_ay,
      entry_type = c.entry_type,
      entry_study_year = c.entry_study_year,
      needs_admission_year_review = FALSE,
      academic_updated_at = now()
    FROM calc c
    WHERE s.reg_no = c.reg_no
  `)

  await query(`
    UPDATE students SET needs_admission_year_review = TRUE
    WHERE admission_academic_year IS NULL OR admission_academic_year = ''
  `)
  // Normalize bare years left in column
  await query(`
    UPDATE students SET
      admission_academic_year =
        substring(admission_academic_year from '^(20[0-9]{2})')
        || '-' ||
        lpad(((substring(admission_academic_year from '^(20[0-9]{2})')::int + 1) % 100)::text, 2, '0')
    WHERE admission_academic_year ~ '^20[0-9]{2}$'
  `)

  const { rowCount } = await query(
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
        extra,
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

  const { rows: stats } = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE academic_status = 'passed_out')::int AS alumni,
      COUNT(*) FILTER (WHERE academic_status IN ('detained','year_back') OR progress_locked)::int AS locked,
      COUNT(*) FILTER (WHERE admission_academic_year IS NULL OR admission_academic_year = '')::int AS missing,
      COUNT(*) FILTER (WHERE academic_status = 'active')::int AS active
    FROM students
  `)
  const s = stats[0] || {}

  await logAcademicEvent({
    reg_no: "*",
    event_type: "bulk_progress",
    academic_year: active,
    actor_user_id: actorUserId,
    reason: "Bulk progression apply",
    meta: { stats: s, updated: rowCount },
  }).catch(() => null)

  return {
    active_academic_year: active,
    total: Number(s.total || 0),
    advanced: Number(rowCount || 0),
    auto_alumni: Number(s.alumni || 0),
    locked_skipped: Number(s.locked || 0),
    missing_admission_year: Number(s.missing || 0),
    unchanged: Math.max(0, Number(s.total || 0) - Number(rowCount || 0)),
  }
}

export async function setStudentAcademicAction(
  regNo: string,
  action: "detain" | "year_back" | "unlock" | "pass_out" | "set_admission" | "set_year",
  opts: {
    actorUserId: number
    reason?: string | null
    target_year?: StudyYear | null
    admission_academic_year?: string | null
    entry_type?: EntryType | null
    entry_study_year?: StudyYear | null
  },
) {
  await ensureAcademicSchema()
  const settings = await getInstituteAcademicSettings()
  const { rows } = await query(
    `SELECT reg_no, year, admission_academic_year, entry_type, entry_study_year,
            current_study_year, academic_status, progress_locked, pass_out_academic_year,
            needs_admission_year_review, extra
       FROM students WHERE reg_no = $1`,
    [regNo],
  )
  if (!rows[0]) {
    // Create minimal row from users if needed
    const { rows: u } = await query(
      `SELECT display_name, reg_no, branch FROM users WHERE reg_no = $1 AND role = 'student' LIMIT 1`,
      [regNo],
    )
    if (!u[0]) throw new Error("Student not found")
    await query(
      `INSERT INTO students (reg_no, name, dept, year, academic_status, progress_locked)
       VALUES ($1, $2, COALESCE($3, 'Not set'), '1st Year', 'active', FALSE)
       ON CONFLICT (reg_no) DO NOTHING`,
      [regNo, u[0].display_name, u[0].branch],
    )
  }

  const { rows: again } = await query(
    `SELECT reg_no, year, admission_academic_year, entry_type, entry_study_year,
            current_study_year, academic_status, progress_locked, pass_out_academic_year,
            needs_admission_year_review, extra
       FROM students WHERE reg_no = $1`,
    [regNo],
  )
  const row = again[0] as StudentAcademicRow
  const fromYear = parseStudyYear(row.current_study_year ?? row.year)
  const fromStatus = parseAcademicStatus(row.academic_status)

  if (action === "detain") {
    const y = fromYear || 1
    await query(
      `UPDATE students SET
         academic_status = 'detained',
         progress_locked = TRUE,
         current_study_year = $2,
         year = $3,
         academic_updated_at = now(),
         extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('Current Year', $3::text)
       WHERE reg_no = $1`,
      [regNo, y, studyYearLabel(y, "detained")],
    )
    await logAcademicEvent({
      reg_no: regNo,
      event_type: "detain",
      from_year: fromYear,
      to_year: y,
      from_status: fromStatus,
      to_status: "detained",
      academic_year: settings.active_academic_year,
      reason: opts.reason || "Detained",
      actor_user_id: opts.actorUserId,
    })
  } else if (action === "year_back") {
    const base = fromYear || 1
    const target = (opts.target_year || Math.max(1, base - 1)) as StudyYear
    const y = Math.min(3, Math.max(1, target)) as StudyYear
    await query(
      `UPDATE students SET
         academic_status = 'year_back',
         progress_locked = TRUE,
         current_study_year = $2,
         year = $3,
         academic_updated_at = now(),
         extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('Current Year', $3::text)
       WHERE reg_no = $1`,
      [regNo, y, studyYearLabel(y, "year_back")],
    )
    await logAcademicEvent({
      reg_no: regNo,
      event_type: "year_back",
      from_year: fromYear,
      to_year: y,
      from_status: fromStatus,
      to_status: "year_back",
      academic_year: settings.active_academic_year,
      reason: opts.reason || "Year back",
      actor_user_id: opts.actorUserId,
    })
  } else if (action === "unlock") {
    await query(
      `UPDATE students SET
         progress_locked = FALSE,
         academic_status = CASE WHEN academic_status IN ('detained','year_back') THEN 'active' ELSE academic_status END,
         academic_updated_at = now()
       WHERE reg_no = $1`,
      [regNo],
    )
    await logAcademicEvent({
      reg_no: regNo,
      event_type: "unlock",
      from_year: fromYear,
      to_year: fromYear,
      from_status: fromStatus,
      to_status: "active",
      academic_year: settings.active_academic_year,
      reason: opts.reason || "Unlocked for progression",
      actor_user_id: opts.actorUserId,
    })
    await applyProgressionToStudent(regNo, {
      actorUserId: opts.actorUserId,
      force: true,
      eventType: "unlock_recompute",
    })
  } else if (action === "pass_out") {
    await query(
      `UPDATE students SET
         academic_status = 'passed_out',
         progress_locked = FALSE,
         current_study_year = COALESCE(current_study_year, 3),
         pass_out_academic_year = COALESCE($2, pass_out_academic_year),
         year = 'Alumni',
         academic_updated_at = now(),
         extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('Current Year', 'Alumni')
       WHERE reg_no = $1`,
      [regNo, settings.active_academic_year],
    )
    await logAcademicEvent({
      reg_no: regNo,
      event_type: "pass_out",
      from_year: fromYear,
      to_year: 3,
      from_status: fromStatus,
      to_status: "passed_out",
      academic_year: settings.active_academic_year,
      reason: opts.reason || "Marked pass-out",
      actor_user_id: opts.actorUserId,
    })
  } else if (action === "set_admission") {
    const ay = normalizeAcademicYear(opts.admission_academic_year || null)
    if (!ay) throw new Error("Valid admission_academic_year required (e.g. 2026-27)")
    const entryType = opts.entry_type === "lateral" ? "lateral" : "regular"
    const entryYear = opts.entry_study_year === 2 || opts.entry_study_year === 3 ? opts.entry_study_year : 1
    await query(
      `UPDATE students SET
         admission_academic_year = $2,
         entry_type = $3,
         entry_study_year = $4,
         needs_admission_year_review = FALSE,
         academic_updated_at = now(),
         extra = COALESCE(extra, '{}'::jsonb)
           || jsonb_build_object('Admission Academic Year', $2::text)
       WHERE reg_no = $1`,
      [regNo, ay, entryType, entryYear],
    )
    await logAcademicEvent({
      reg_no: regNo,
      event_type: "admission_set",
      from_year: fromYear,
      to_year: fromYear,
      from_status: fromStatus,
      to_status: fromStatus,
      academic_year: settings.active_academic_year,
      reason: opts.reason || `Admission year set to ${ay}`,
      actor_user_id: opts.actorUserId,
      meta: { admission_academic_year: ay, entry_type: entryType, entry_study_year: entryYear },
    })
    await applyProgressionToStudent(regNo, {
      actorUserId: opts.actorUserId,
      force: true,
      eventType: "admission_recompute",
    })
  } else if (action === "set_year") {
    const y = opts.target_year
    if (y !== 1 && y !== 2 && y !== 3) throw new Error("target_year must be 1, 2, or 3")
    await query(
      `UPDATE students SET
         current_study_year = $2,
         year = $3,
         academic_status = CASE WHEN academic_status = 'passed_out' THEN 'active' ELSE academic_status END,
         academic_updated_at = now(),
         extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('Current Year', $3::text)
       WHERE reg_no = $1`,
      [regNo, y, studyYearLabel(y, "active")],
    )
    await logAcademicEvent({
      reg_no: regNo,
      event_type: "set_year",
      from_year: fromYear,
      to_year: y,
      from_status: fromStatus,
      to_status: "active",
      academic_year: settings.active_academic_year,
      reason: opts.reason || `Study year set to ${y}`,
      actor_user_id: opts.actorUserId,
    })
  }

  const { rows: finalRows } = await query(
    `SELECT reg_no, year, admission_academic_year, entry_type, entry_study_year,
            current_study_year, academic_status, progress_locked, pass_out_academic_year,
            needs_admission_year_review
       FROM students WHERE reg_no = $1`,
    [regNo],
  )
  return rowToSnapshot(finalRows[0])
}

export async function getStudentAcademicForUser(regNo: string | null | undefined) {
  if (!regNo) return null
  await ensureAcademicSchema()
  // Light recompute on read
  await applyProgressionToStudent(regNo, { eventType: "login_recompute" }).catch(() => null)
  const { rows } = await query(
    `SELECT reg_no, year, admission_academic_year, entry_type, entry_study_year,
            current_study_year, academic_status, progress_locked, pass_out_academic_year,
            needs_admission_year_review
       FROM students WHERE reg_no = $1`,
    [regNo],
  )
  if (!rows[0]) return null
  const settings = await getInstituteAcademicSettings()
  return {
    ...rowToSnapshot(rows[0]),
    active_academic_year: settings.active_academic_year,
  }
}
