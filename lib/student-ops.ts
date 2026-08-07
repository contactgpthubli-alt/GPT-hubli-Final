/**
 * Live academic ops: fees/profile/results dashboard, student categories,
 * branch transfer with dual reg login aliases.
 */
import { query } from "@/lib/db"
import { branchCodeFromDept, type BranchCode } from "@/lib/curriculum-c20"
import { normalizeBranch } from "@/lib/branches"
import {
  inferAcademicYearFromDate,
  inferCurrentSemester,
  inferTermParityFromDate,
} from "@/lib/academic-year"
import { parseChallans, challanTotal, type ChallanEntry } from "@/lib/exam-results"
import { setStudentAcademicAction } from "@/lib/student-academic"
import { hodBranchOf, branchesMatch } from "@/lib/account-approvals"

export const OPS_DASHBOARD_ROLES = ["admin", "principal", "exam", "acm", "hod"] as const
export const OPS_CATEGORY_ROLES = ["admin", "principal", "exam", "acm", "hod"] as const
/** ACM has the same write rights as HOD for student academic ops (documentation desk). */
export const OPS_TRANSFER_WRITE_ROLES = ["admin", "principal", "exam", "hod", "acm"] as const
export const OPS_TRANSFER_READ_ROLES = ["admin", "principal", "exam", "acm", "hod"] as const

export type OpsFlagKey =
  | "iti"
  | "puc"
  | "repeater"
  | "not_eligible"
  | "year_back"
  | "change_of_branch"

export type OpsFlags = Partial<Record<OpsFlagKey, boolean>> & { notes?: string }

export type BranchTransferStatus =
  | "draft"
  | "released" // outgoing HOD released
  | "accepted" // incoming HOD accepted — data moved
  | "cancelled"

let schemaReady = false

export async function ensureStudentOpsSchema(): Promise<void> {
  if (schemaReady) return

  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS ops_flags JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS previous_reg_no TEXT`)
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS alt_reg_no TEXT`)

  await query(`
    CREATE TABLE IF NOT EXISTS student_login_aliases (
      alias_reg_no   TEXT PRIMARY KEY,
      user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      primary_reg_no TEXT NOT NULL,
      reason         TEXT NOT NULL DEFAULT 'branch_transfer',
      transfer_id    BIGINT,
      active         BOOLEAN NOT NULL DEFAULT TRUE,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_login_aliases_user ON student_login_aliases(user_id) WHERE active`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_login_aliases_primary ON student_login_aliases(primary_reg_no)`,
  )

  await query(`
    CREATE TABLE IF NOT EXISTS branch_transfers (
      id              BIGSERIAL PRIMARY KEY,
      old_reg_no      TEXT NOT NULL,
      new_reg_no      TEXT NOT NULL,
      student_name    TEXT NOT NULL DEFAULT '',
      from_branch     TEXT NOT NULL,
      to_branch       TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'draft',
      notes           TEXT,
      created_by      BIGINT,
      created_by_name TEXT,
      released_by     BIGINT,
      released_by_name TEXT,
      released_at     TIMESTAMPTZ,
      accepted_by     BIGINT,
      accepted_by_name TEXT,
      accepted_at     TIMESTAMPTZ,
      cancelled_by    BIGINT,
      cancelled_by_name TEXT,
      cancelled_at    TIMESTAMPTZ,
      cancel_reason   TEXT,
      meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_branch_transfers_status ON branch_transfers(status, updated_at DESC)`,
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_branch_transfers_regs ON branch_transfers(old_reg_no, new_reg_no)`,
  )

  schemaReady = true
}

export function parseOpsFlags(raw: unknown): OpsFlags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: OpsFlags & {
    last_change?: unknown
    removed_from_list?: boolean
    removed_by?: string
    removed_at?: string
    removed_note?: string | null
  } = {}
  for (const k of [
    "iti",
    "puc",
    "repeater",
    "not_eligible",
    "year_back",
    "change_of_branch",
  ] as OpsFlagKey[]) {
    if (o[k] === true) out[k] = true
    if (o[k] === false) out[k] = false
  }
  if (typeof o.notes === "string") out.notes = o.notes
  // Preserve audit metadata for Student Management UI
  if (o.last_change && typeof o.last_change === "object") out.last_change = o.last_change
  if (o.removed_from_list === true) out.removed_from_list = true
  if (typeof o.removed_by === "string") out.removed_by = o.removed_by
  if (typeof o.removed_at === "string") out.removed_at = o.removed_at
  if (o.removed_note != null) out.removed_note = String(o.removed_note)
  return out as OpsFlags
}

export function entryTypeLabel(row: {
  entry_type?: string | null
  ops_flags?: OpsFlags | unknown
}): string {
  const flags = parseOpsFlags(row.ops_flags)
  if (flags.repeater) return "Repeater"
  if (flags.iti) return "ITI"
  if (flags.puc) return "PUC"
  const et = String(row.entry_type || "regular").toLowerCase()
  if (et === "lateral") return "Lateral"
  return "Regular"
}

/** Latest paid challan + total fine from exam_fee_payments row. */
export function feeExportFields(pay: {
  status?: string | null
  fine_amount?: number | null
  challans?: unknown
  paid_marked_at?: string | Date | null
} | null): {
  paid: boolean
  k2_no: string
  k2_amount: number | null
  k2_date: string
  fine: number
} {
  if (!pay || String(pay.status) !== "paid") {
    return { paid: false, k2_no: "", k2_amount: null, k2_date: "", fine: Number(pay?.fine_amount) || 0 }
  }
  const challans = parseChallans(pay.challans)
  // Prefer challan with paid_on; else last in list
  let best: ChallanEntry | null = null
  for (const c of challans) {
    if (!best) best = c
    else if (c.paid_on && (!best.paid_on || String(c.paid_on) > String(best.paid_on))) best = c
    else if (!best.paid_on) best = c
  }
  if (!best && challans.length) best = challans[challans.length - 1]
  const paidAt = pay.paid_marked_at
    ? new Date(pay.paid_marked_at as string).toISOString().slice(0, 10)
    : best?.paid_on
      ? String(best.paid_on).slice(0, 10)
      : ""
  return {
    paid: true,
    k2_no: best?.receipt_no || "",
    k2_amount: best ? Number(best.amount) || 0 : challanTotal(challans),
    k2_date: paidAt,
    fine: Number(pay.fine_amount) || 0,
  }
}

type SchemaField = { label?: string; name?: string; key?: string; required?: boolean; type?: string }
type SchemaSection = { title?: string; fields?: SchemaField[] }

export async function loadStudentProfileSchema(): Promise<SchemaSection[]> {
  const { rows } = await query(
    `SELECT schema_json FROM profile_schemas WHERE key = 'student' LIMIT 1`,
  )
  const raw = rows[0]?.schema_json
  if (!Array.isArray(raw)) return []
  return raw as SchemaSection[]
}

function fieldKey(f: SchemaField): string {
  return String(f.label || f.name || f.key || "").trim()
}

function valuePresent(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === "string") return v.trim() !== "" && v.trim() !== "—"
  if (typeof v === "number") return true
  if (typeof v === "boolean") return true
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === "object") return Object.keys(v as object).length > 0
  return String(v).trim() !== ""
}

/** Profile complete = every schema field has a non-empty value (user rule). */
export function isProfileComplete(
  student: {
    name?: string | null
    father?: string | null
    dept?: string | null
    year?: string | null
    extra?: unknown
  },
  schema: SchemaSection[],
): { complete: boolean; missing: string[] } {
  const extra =
    student.extra && typeof student.extra === "object" && !Array.isArray(student.extra)
      ? (student.extra as Record<string, unknown>)
      : {}
  const bag: Record<string, unknown> = { ...extra }
  if (student.name) bag["Name"] = bag["Name"] ?? student.name
  if (student.father) {
    bag["Father Name"] = bag["Father Name"] ?? student.father
    bag["Father"] = bag["Father"] ?? student.father
  }
  if (student.dept) bag["Branch"] = bag["Branch"] ?? student.dept
  if (student.year) bag["Current Year"] = bag["Current Year"] ?? student.year

  const missing: string[] = []
  const fields: SchemaField[] = []
  for (const sec of schema) {
    if (Array.isArray(sec.fields)) fields.push(...sec.fields)
  }

  if (!fields.length) {
    // Fallback when no admin schema: base identity fields
    for (const [k, v] of [
      ["Name", student.name],
      ["Father Name", student.father || bag["Father Name"]],
      ["Branch", student.dept],
      ["Gender", bag["Gender"] || bag["gender"]],
    ] as const) {
      if (!valuePresent(v)) missing.push(k)
    }
    return { complete: missing.length === 0, missing }
  }

  for (const f of fields) {
    const key = fieldKey(f)
    if (!key) continue
    // Skip purely decorative / computed
    const t = String(f.type || "").toLowerCase()
    if (t === "heading" || t === "label" || t === "info") continue
    // User: ALL fields must be filled (not only required flag)
    const val =
      bag[key] ??
      bag[key.replace(/\s+/g, " ")] ??
      (key.toLowerCase() === "name" ? student.name : undefined) ??
      (key.toLowerCase().includes("father") ? student.father : undefined)
    if (!valuePresent(val)) missing.push(key)
  }
  return { complete: missing.length === 0, missing }
}

export function currentRunningSemester(studyYear: number | null | undefined): number | null {
  if (studyYear == null) return null
  return inferCurrentSemester(studyYear, new Date())
}

/** Verified result exists for a semester: official results table OR verified exam attempts. */
export async function studentsWithVerifiedResultsForSem(
  semester: number,
  regFilter: string[] | null,
): Promise<Set<string>> {
  const set = new Set<string>()
  if (regFilter && !regFilter.length) return set

  if (regFilter) {
    const { rows: a } = await query(
      `SELECT DISTINCT UPPER(reg_no) AS reg FROM student_exam_attempts
        WHERE semester = $1 AND status = 'verified' AND UPPER(reg_no) = ANY($2::text[])`,
      [semester, regFilter.map((r) => r.toUpperCase())],
    )
    for (const r of a) set.add(String(r.reg).toUpperCase())
    const { rows: b } = await query(
      `SELECT DISTINCT UPPER(reg_no) AS reg FROM results
        WHERE sem = $1 AND UPPER(reg_no) = ANY($2::text[])`,
      [semester, regFilter.map((r) => r.toUpperCase())],
    )
    for (const r of b) set.add(String(r.reg).toUpperCase())
  } else {
    const { rows: a } = await query(
      `SELECT DISTINCT UPPER(reg_no) AS reg FROM student_exam_attempts
        WHERE semester = $1 AND status = 'verified'`,
      [semester],
    )
    for (const r of a) set.add(String(r.reg).toUpperCase())
    const { rows: b } = await query(
      `SELECT DISTINCT UPPER(reg_no) AS reg FROM results WHERE sem = $1`,
      [semester],
    )
    for (const r of b) set.add(String(r.reg).toUpperCase())
  }
  return set
}

/** Sem 1–6 cell: Passed or failed subject codes. */
export async function buildSemFailMap(
  regNos: string[],
): Promise<Map<string, Record<number, string>>> {
  const out = new Map<string, Record<number, string>>()
  if (!regNos.length) return out
  const regs = regNos.map((r) => r.toUpperCase())

  // Official published subjects
  const { rows: pub } = await query(
    `SELECT UPPER(r.reg_no) AS reg, r.sem, s.code, s.grade, r.result AS overall
       FROM results r
       LEFT JOIN result_subjects s ON s.result_id = r.id
      WHERE UPPER(r.reg_no) = ANY($1::text[])`,
    [regs],
  )
  // Verified attempts
  const { rows: att } = await query(
    `SELECT UPPER(reg_no) AS reg, semester AS sem, subject_code AS code, grade, result
       FROM student_exam_attempts
      WHERE status = 'verified' AND UPPER(reg_no) = ANY($1::text[])`,
    [regs],
  )

  type FailSet = Map<number, Set<string>>
  const fails = new Map<string, FailSet>()
  const hasAny = new Map<string, Set<number>>()

  function touch(reg: string, sem: number) {
    if (!fails.has(reg)) fails.set(reg, new Map())
    if (!hasAny.has(reg)) hasAny.set(reg, new Set())
    hasAny.get(reg)!.add(sem)
    if (!fails.get(reg)!.has(sem)) fails.get(reg)!.set(sem, new Set())
  }

  for (const r of pub) {
    const reg = String(r.reg).toUpperCase()
    const sem = Number(r.sem)
    if (!sem) continue
    touch(reg, sem)
    const grade = String(r.grade || "").toUpperCase()
    const overall = String(r.overall || "").toLowerCase()
    const code = String(r.code || "").trim()
    if (code && (grade === "F" || grade === "AB" || overall === "fail")) {
      fails.get(reg)!.get(sem)!.add(code.toUpperCase())
    }
  }
  for (const r of att) {
    const reg = String(r.reg).toUpperCase()
    const sem = Number(r.sem)
    if (!sem) continue
    touch(reg, sem)
    const res = String(r.result || "").toLowerCase()
    const grade = String(r.grade || "").toUpperCase()
    const code = String(r.code || "").trim().toUpperCase()
    if (code && (res === "fail" || res === "absent" || grade === "F")) {
      fails.get(reg)!.get(sem)!.add(code)
    }
  }

  for (const reg of regs) {
    const cells: Record<number, string> = {}
    for (let sem = 1; sem <= 6; sem++) {
      const had = hasAny.get(reg)?.has(sem)
      const fset = fails.get(reg)?.get(sem)
      if (!had) {
        cells[sem] = ""
      } else if (fset && fset.size) {
        cells[sem] = Array.from(fset).sort().join(", ")
      } else {
        cells[sem] = "Passed"
      }
    }
    out.set(reg, cells)
  }
  return out
}

export function branchFilterSql(
  user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null },
  alias = "s",
): { sql: string; params: unknown[] } {
  if (user.role !== "hod") return { sql: "", params: [] }
  const my = hodBranchOf(user)
  if (!my) return { sql: " AND FALSE", params: [] }
  const code = branchCodeFromDept(my)
  const like =
    code === "CSE"
      ? "%computer%"
      : code === "CE"
        ? "%civil%"
        : code === "ECE"
          ? "%electron%"
          : code === "ME"
            ? "%mech%"
            : `%${my.toLowerCase()}%`
  return {
    sql: ` AND (lower(COALESCE(${alias}.dept,'')) LIKE $BR OR lower(COALESCE(u.branch,'')) LIKE $BR)`,
    params: [like],
  }
}

export function canWriteBranchTransfer(role: string): boolean {
  return (OPS_TRANSFER_WRITE_ROLES as readonly string[]).includes(role)
}

export function canReadOps(role: string): boolean {
  return (OPS_DASHBOARD_ROLES as readonly string[]).includes(role)
}

/** Apply ops flags; year_back / not_eligible freeze progression. */
export async function applyOpsFlags(
  regNo: string,
  flags: OpsFlags,
  actor: { id: number; role: string; display_name?: string | null },
  reason?: string | null,
): Promise<void> {
  await ensureStudentOpsSchema()
  const reg = regNo.toUpperCase()
  const { rows } = await query(`SELECT ops_flags, academic_status FROM students WHERE UPPER(reg_no)=$1`, [
    reg,
  ])
  if (!rows[0]) throw new Error("Student not found")
  const prev = parseOpsFlags(rows[0].ops_flags)
  const next: OpsFlags = { ...prev, ...flags }
  // Clean notes
  if (flags.notes != null) next.notes = flags.notes

  // Always record who changed category flags (shown in Student Management UI)
  const actorLabel = String(actor.display_name || actor.role || "staff").trim()
  const changedAt = new Date().toISOString()
  ;(next as OpsFlags & { last_change?: unknown }).last_change = {
    by: actorLabel,
    role: actor.role,
    at: changedAt,
    reason: reason || null,
    action: "category_flags",
  }

  await query(`UPDATE students SET ops_flags = $2::jsonb, academic_updated_at = now() WHERE UPPER(reg_no)=$1`, [
    reg,
    JSON.stringify(next),
  ])

  try {
    await query(
      `INSERT INTO student_academic_events
         (reg_no, event_type, reason, actor_user_id, meta)
       VALUES ($1,'ops_category',$2,$3,$4::jsonb)`,
      [
        reg,
        reason || "Category / flags updated",
        actor.id,
        JSON.stringify({
          actor: actorLabel,
          actor_role: actor.role,
          flags: next,
          at: changedAt,
        }),
      ],
    )
  } catch {
    /* audit table optional on first boot */
  }

  try {
    await query(
      `UPDATE students SET extra =
         COALESCE(extra, '{}'::jsonb) || $2::jsonb
       WHERE UPPER(reg_no) = $1`,
      [
        reg,
        JSON.stringify({
          category_last: {
            by: actorLabel,
            role: actor.role,
            at: changedAt,
            reason: reason || null,
          },
        }),
      ],
    )
  } catch {
    /* optional */
  }

  if (next.year_back) {
    await setStudentAcademicAction(reg, "year_back", {
      actorUserId: actor.id,
      reason: reason || "Marked Year Back (Ops)",
    })
  }
  if (next.not_eligible) {
    await query(
      `UPDATE students SET
         academic_status = 'not_eligible',
         progress_locked = TRUE,
         academic_updated_at = now()
       WHERE UPPER(reg_no) = $1`,
      [reg],
    )
    await query(
      `INSERT INTO student_academic_events
         (reg_no, event_type, from_status, to_status, reason, actor_user_id, meta)
       VALUES ($1,'not_eligible',$2,'not_eligible',$3,$4,$5::jsonb)`,
      [
        reg,
        rows[0].academic_status || "active",
        reason || "Marked Not Eligible (Ops)",
        actor.id,
        JSON.stringify({ by: actor.display_name, role: actor.role }),
      ],
    )
  }
  // Clear freeze if both flags off and was not_eligible
  if (flags.not_eligible === false && !next.year_back) {
    await query(
      `UPDATE students SET
         academic_status = CASE WHEN academic_status = 'not_eligible' THEN 'active' ELSE academic_status END,
         progress_locked = CASE WHEN academic_status = 'year_back' THEN progress_locked ELSE FALSE END,
         academic_updated_at = now()
       WHERE UPPER(reg_no) = $1 AND academic_status = 'not_eligible'`,
      [reg],
    )
  }
  if (flags.year_back === false && !next.not_eligible) {
    await setStudentAcademicAction(reg, "unlock", {
      actorUserId: actor.id,
      reason: reason || "Cleared Year Back (Ops)",
    }).catch(() => null)
  }

  // entry_type lateral when ITI/PUC
  if (next.iti || next.puc) {
    await query(
      `UPDATE students SET entry_type = 'lateral', entry_study_year = COALESCE(entry_study_year, 2), academic_updated_at = now()
       WHERE UPPER(reg_no) = $1`,
      [reg],
    )
  }
}

export async function resolveUserIdByRegOrAlias(reg: string): Promise<{
  user_id: number
  primary_reg: string
} | null> {
  await ensureStudentOpsSchema()
  const r = reg.toUpperCase()
  const { rows: u } = await query(
    `SELECT id, reg_no FROM users WHERE deleted_at IS NULL AND role='student' AND UPPER(reg_no)=$1 LIMIT 1`,
    [r],
  )
  if (u[0]) return { user_id: Number(u[0].id), primary_reg: String(u[0].reg_no) }
  const { rows: a } = await query(
    `SELECT user_id, primary_reg_no FROM student_login_aliases WHERE active AND UPPER(alias_reg_no)=$1 LIMIT 1`,
    [r],
  )
  if (a[0]) return { user_id: Number(a[0].user_id), primary_reg: String(a[0].primary_reg_no) }
  return null
}

export async function acceptBranchTransfer(
  transferId: number,
  actor: { id: number; role: string; display_name?: string | null; branch?: string | null },
): Promise<void> {
  await ensureStudentOpsSchema()
  const { rows } = await query(`SELECT * FROM branch_transfers WHERE id = $1`, [transferId])
  const t = rows[0]
  if (!t) throw new Error("Transfer not found")
  if (t.status !== "released") throw new Error("Transfer must be released by outgoing HOD first")

  const oldReg = String(t.old_reg_no).toUpperCase()
  const newReg = String(t.new_reg_no).toUpperCase()
  const toBranch = normalizeBranch(t.to_branch) || String(t.to_branch)

  // HOD may only accept into their branch
  if (actor.role === "hod") {
    const my = hodBranchOf(actor)
    if (!my || !branchesMatch(my, toBranch)) {
      throw new Error("You can only accept transfers into your branch")
    }
  }

  // Ensure new reg not already another student
  const { rows: clash } = await query(
    `SELECT reg_no FROM students WHERE UPPER(reg_no)=$1 AND UPPER(reg_no) <> $2`,
    [newReg, oldReg],
  )
  if (clash[0]) throw new Error(`Register ${newReg} already exists for another student`)

  const { rows: userRows } = await query(
    `SELECT id, reg_no FROM users WHERE role='student' AND deleted_at IS NULL AND UPPER(reg_no)=$1 LIMIT 1`,
    [oldReg],
  )
  const userId = userRows[0] ? Number(userRows[0].id) : null

  // Move student PK: insert new if needed then reassign FKs
  // Strategy: update students.reg_no is hard (PK). Use:
  // 1) UPDATE students SET dept, previous_reg_no, alt_reg_no, ops_flags
  // 2) If newReg != oldReg: create students row with new reg copying data, alias both, update users.reg_no to newReg, re-key dependent tables

  if (newReg === oldReg) {
    await query(
      `UPDATE students SET
         dept = $2,
         ops_flags = COALESCE(ops_flags,'{}'::jsonb) || '{"change_of_branch":true}'::jsonb,
         academic_updated_at = now()
       WHERE UPPER(reg_no) = $1`,
      [oldReg, toBranch],
    )
    if (userId) {
      await query(`UPDATE users SET branch = $2 WHERE id = $1`, [userId, toBranch])
    }
  } else {
    // Copy student to new reg
    await query(
      `INSERT INTO students (
         reg_no, name, dept, year, cgpa, att, father, extra,
         admission_academic_year, entry_type, entry_study_year, current_study_year,
         academic_status, progress_locked, pass_out_academic_year, needs_admission_year_review,
         academic_updated_at, attendance_batch, parent_name, parent_mobile, ops_flags,
         previous_reg_no, alt_reg_no
       )
       SELECT
         $2, name, $3, year, cgpa, att, father, extra,
         admission_academic_year, entry_type, entry_study_year, current_study_year,
         academic_status, progress_locked, pass_out_academic_year, needs_admission_year_review,
         now(), attendance_batch, parent_name, parent_mobile,
         COALESCE(ops_flags,'{}'::jsonb) || '{"change_of_branch":true}'::jsonb,
         $1, $2
       FROM students WHERE UPPER(reg_no) = $1
       ON CONFLICT (reg_no) DO UPDATE SET
         dept = EXCLUDED.dept,
         previous_reg_no = EXCLUDED.previous_reg_no,
         alt_reg_no = EXCLUDED.alt_reg_no,
         ops_flags = EXCLUDED.ops_flags,
         academic_updated_at = now()`,
      [oldReg, newReg, toBranch],
    )

    // Re-key common tables from old → new (best effort)
    const tables = [
      ["results", "reg_no"],
      ["student_exam_attempts", "reg_no"],
      ["exam_fee_payments", "reg_no"],
      ["attendance", "reg_no"],
      ["student_academic_events", "reg_no"],
      ["grievances", "student_reg"],
      ["cert_requests", "reg_no"],
    ] as const
    for (const [table, col] of tables) {
      try {
        await query(
          `UPDATE ${table} SET ${col} = $2 WHERE UPPER(${col}) = $1`,
          [oldReg, newReg],
        )
      } catch {
        /* table/col may not exist */
      }
    }

    if (userId) {
      await query(`UPDATE users SET reg_no = $2, branch = $3, display_name = COALESCE(display_name, $2) WHERE id = $1`, [
        userId,
        newReg,
        toBranch,
      ])
      // Aliases: both old and new login
      await query(
        `INSERT INTO student_login_aliases (alias_reg_no, user_id, primary_reg_no, reason, transfer_id, active)
         VALUES ($1,$2,$3,'branch_transfer',$4,TRUE)
         ON CONFLICT (alias_reg_no) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           primary_reg_no = EXCLUDED.primary_reg_no,
           active = TRUE,
           transfer_id = EXCLUDED.transfer_id`,
        [oldReg, userId, newReg, transferId],
      )
      await query(
        `INSERT INTO student_login_aliases (alias_reg_no, user_id, primary_reg_no, reason, transfer_id, active)
         VALUES ($1,$2,$3,'branch_transfer',$4,TRUE)
         ON CONFLICT (alias_reg_no) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           primary_reg_no = EXCLUDED.primary_reg_no,
           active = TRUE,
           transfer_id = EXCLUDED.transfer_id`,
        [newReg, userId, newReg, transferId],
      )
    }

    // Soft-archive old student row name marker (keep for history, avoid PK conflict already handled)
    await query(
      `UPDATE students SET
         name = CASE WHEN name NOT LIKE '[MOVED]%' THEN '[MOVED] ' || name ELSE name END,
         dept = $2,
         previous_reg_no = $1,
         alt_reg_no = $3,
         academic_status = COALESCE(academic_status,'active'),
         academic_updated_at = now()
       WHERE UPPER(reg_no) = $1`,
      [oldReg, toBranch, newReg],
    )
  }

  await query(
    `UPDATE branch_transfers SET
       status = 'accepted',
       accepted_by = $2,
       accepted_by_name = $3,
       accepted_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [transferId, actor.id, actor.display_name || actor.role],
  )
}

export function exportFilename(branchCode: string | null, d = new Date()): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const mon = months[d.getMonth()]
  const year = d.getFullYear()
  const code = (branchCode || "ALL").toUpperCase().replace(/[^A-Z0-9]/g, "")
  return `${code}students-exam-${mon}-${year}.xlsx`
}

export function academicMonthYearLabel(d = new Date()): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[d.getMonth()]}-${d.getFullYear()}`
}

export { inferAcademicYearFromDate, inferTermParityFromDate, branchCodeFromDept }
export type { BranchCode }
