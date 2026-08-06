import { query } from "@/lib/db"
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/roles"
import { normalizeBranch } from "@/lib/branches"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"
import {
  ATT_CRITICAL_MAX,
  ATT_MIN_ELIGIBLE,
  academicYearForDate,
  aggregateAttendance,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  toISODate,
  parseLocalDate,
  type RawAttSession,
} from "@/lib/attendance-reports"

async function ensureEligibilitySchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS attendance_eligibility (
      scope_key       TEXT PRIMARY KEY,
      reg_no          TEXT NOT NULL,
      branch          TEXT,
      subject         TEXT NOT NULL DEFAULT '',
      semester        INT,
      academic_year   TEXT NOT NULL DEFAULT '',
      decision        TEXT NOT NULL DEFAULT 'pending',
      note            TEXT,
      decided_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
      decided_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_att_elig_reg_ay ON attendance_eligibility (reg_no, academic_year)`,
  )
}

function eligibilityScopeKey(
  reg: string,
  subject: string,
  semester: number | null,
  academicYear: string,
): string {
  return [
    String(reg || "").toUpperCase(),
    String(subject || "").trim(),
    semester == null || !Number.isFinite(semester) ? "" : String(semester),
    String(academicYear || "").trim(),
  ].join("|")
}

/**
 * GET /api/attendance/report
 *  ?branch=&year=&from=&to=&mode=dashboard|weekly|monthly
 *  ?reg= optional single student focus
 *
 * POST /api/attendance/report
 *  { reg_no, subject?, semester?, academic_year?, decision: eligible|not_eligible|pending, note? }
 *  HOD eligibility decision for students below 75%.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!STAFF_ROLES.includes(user.role) && user.role !== "student") return unauthorized()

  const url = new URL(req.url)
  const mode = String(url.searchParams.get("mode") || "dashboard").toLowerCase()
  let qBranch = normalizeBranch(url.searchParams.get("branch"))
  const qYear = String(url.searchParams.get("year") || "").trim()
  let from = url.searchParams.get("from")
  let to = url.searchParams.get("to")
  const qReg = String(url.searchParams.get("reg") || "")
    .trim()
    .toUpperCase()
  const qSubject = String(url.searchParams.get("subject") || "").trim()

  // Default range by mode
  const today = new Date()
  if (mode === "weekly") {
    if (!from) from = toISODate(startOfWeek(today))
    if (!to) to = toISODate(endOfWeek(today))
  } else if (mode === "monthly") {
    if (!from) from = toISODate(startOfMonth(today))
    if (!to) to = toISODate(endOfMonth(today))
  } else {
    // dashboard default: current academic term window (Jun→today or Jan→today)
    if (!from || !to) {
      const m = today.getMonth() + 1
      const y = today.getFullYear()
      if (m >= 6) {
        from = from || `${y}-06-01`
        to = to || toISODate(today)
      } else {
        from = from || `${y}-01-01`
        to = to || toISODate(today)
      }
    }
  }

  const hodBranch = user.role === "hod" ? hodBranchOf(user) : null
  if (user.role === "hod") {
    if (!hodBranch) {
      return Response.json({
        ok: false,
        error: "HOD account has no branch assigned",
        rules: { min_eligible: ATT_MIN_ELIGIBLE, critical_max: ATT_CRITICAL_MAX },
      })
    }
    qBranch = hodBranch
  }

  // Students: own reg only
  const focusReg = user.role === "student" ? String(user.reg_no || "").toUpperCase() : qReg

  const params: unknown[] = []
  const where: string[] = [`COALESCE(session_status, 'active') = 'active'`]
  if (qBranch) {
    params.push(qBranch)
    where.push(`(branch ILIKE $${params.length} OR branch ILIKE $${params.length + 1})`)
    params.push(`%${String(qBranch).split(" ")[0]}%`)
  }
  if (from) {
    params.push(from)
    where.push(`att_date >= $${params.length}::date`)
  }
  if (to) {
    params.push(to)
    where.push(`att_date <= $${params.length}::date`)
  }
  if (qYear) {
    // Accept I / II / III / 1st Year / 1 etc.
    const y = qYear.toUpperCase()
    let pattern = `%${qYear}%`
    if (y === "I" || y === "1" || y.indexOf("1ST") >= 0) pattern = "%1%"
    else if (y === "II" || y === "2" || y.indexOf("2ND") >= 0) pattern = "%2%"
    else if (y === "III" || y === "3" || y.indexOf("3RD") >= 0) pattern = "%3%"
    params.push(pattern)
    where.push(
      `(COALESCE(year_label,'') ILIKE $${params.length} OR COALESCE(year_label,'') ILIKE $${params.length + 1})`,
    )
    params.push(`%${qYear}%`)
  }
  if (qSubject) {
    params.push(`%${qSubject}%`)
    where.push(`subject ILIKE $${params.length}`)
  }

  const { rows } = await query(
    `SELECT id, att_date, branch, subject, year_label, entries, period_count,
            COALESCE(session_status, 'active') AS session_status, att_time
       FROM attendance
      WHERE ${where.join(" AND ")}
      ORDER BY att_date ASC, id ASC
      LIMIT 5000`,
    params,
  )

  const sessions = rows as RawAttSession[]
  let agg = aggregateAttendance(sessions, { from, to })

  if (focusReg) {
    agg = {
      ...agg,
      students: agg.students.filter((s) => s.reg === focusReg),
      kpis: {
        ...agg.kpis,
        students: agg.students.filter((s) => s.reg === focusReg).length,
      },
    }
  }

  // Attach HOD decisions if any
  await ensureEligibilitySchema().catch(() => null)
  const ay = academicYearForDate(to || from || new Date())
  let decisions: Record<string, { decision: string; note: string | null; subject: string; semester: number | null }> =
    {}
  try {
    const { rows: decRows } = await query(
      `SELECT reg_no, subject, semester, decision, note
         FROM attendance_eligibility
        WHERE academic_year = $1
          ${qBranch ? "AND (branch IS NULL OR branch ILIKE $2)" : ""}`,
      qBranch ? [ay, qBranch] : [ay],
    )
    for (const d of decRows) {
      const key = `${String(d.reg_no).toUpperCase()}|${d.subject || ""}|${d.semester ?? ""}`
      decisions[key] = {
        decision: String(d.decision || "pending"),
        note: d.note != null ? String(d.note) : null,
        subject: String(d.subject || ""),
        semester: d.semester != null ? Number(d.semester) : null,
      }
    }
  } catch {
    /* table may not exist yet on first fail */
  }

  const students = agg.students.map((s) => {
    const overallKey = `${s.reg}||`
    const overallDec = decisions[overallKey]
    return {
      ...s,
      hod_decision: overallDec?.decision || (s.band === "eligible" ? "eligible" : "pending"),
      hod_note: overallDec?.note || null,
      by_subject: s.by_subject.map((sub) => {
        const k = `${s.reg}|${sub.subject}|${sub.semester ?? ""}`
        const d = decisions[k] || decisions[`${s.reg}|${sub.subject}|`]
        return {
          ...sub,
          hod_decision: d?.decision || (sub.band === "eligible" ? "eligible" : "pending"),
          hod_note: d?.note || null,
        }
      }),
      by_semester: s.by_semester.map((sm) => {
        const k = `${s.reg}||${sm.semester ?? ""}`
        const d = decisions[k]
        return {
          ...sm,
          hod_decision: d?.decision || (sm.band === "eligible" ? "eligible" : "pending"),
          hod_note: d?.note || null,
        }
      }),
    }
  })

  return Response.json({
    ok: true,
    mode,
    filters: {
      branch: qBranch,
      year: qYear || null,
      from,
      to,
      subject: qSubject || null,
      reg: focusReg || null,
      academic_year: ay,
    },
    rules: {
      min_eligible: ATT_MIN_ELIGIBLE,
      critical_max: ATT_CRITICAL_MAX,
      note:
        `≥${ATT_MIN_ELIGIBLE}% = Eligible. Below ${ATT_MIN_ELIGIBLE}% = HOD decides eligibility. ` +
        `≤${ATT_CRITICAL_MAX}% is critical shortage (still HOD decision). Subject-wise and semester-wise.`,
    },
    kpis: {
      ...agg.kpis,
      eligible: students.filter((s) => s.band === "eligible").length,
      hod_decision: students.filter((s) => s.band === "hod_decision").length,
      critical: students.filter((s) => s.band === "critical").length,
    },
    subjects: agg.subjects,
    students,
  })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!["admin", "principal", "hod", "exam"].includes(user.role)) {
    return unauthorized()
  }

  await ensureEligibilitySchema()
  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON body required")

  const reg_no = String(b.reg_no || b.reg || "")
    .trim()
    .toUpperCase()
  if (!reg_no) return badRequest("reg_no required")

  const decision = String(b.decision || "pending").toLowerCase()
  if (!["eligible", "not_eligible", "pending"].includes(decision)) {
    return badRequest("decision must be eligible | not_eligible | pending")
  }

  let branch = normalizeBranch(b.branch) || null
  if (user.role === "hod") {
    const hb = hodBranchOf(user)
    if (!hb) return badRequest("HOD has no branch")
    if (branch && !branchesMatch(branch, hb)) {
      return badRequest("You can only decide for your branch")
    }
    branch = hb
  }

  const subject = String(b.subject || "").trim()
  const semester =
    b.semester != null && b.semester !== "" ? Number(b.semester) : null
  const academic_year =
    String(b.academic_year || "").trim() || academicYearForDate(new Date())
  const note = b.note != null ? String(b.note).trim() : null

  const scope_key = eligibilityScopeKey(reg_no, subject, semester, academic_year)
  await query(
    `INSERT INTO attendance_eligibility
       (scope_key, reg_no, branch, subject, semester, academic_year, decision, note, decided_by, decided_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
     ON CONFLICT (scope_key) DO UPDATE SET
       decision = EXCLUDED.decision,
       note = EXCLUDED.note,
       decided_by = EXCLUDED.decided_by,
       decided_at = now(),
       updated_at = now(),
       branch = COALESCE(EXCLUDED.branch, attendance_eligibility.branch)`,
    [scope_key, reg_no, branch, subject, semester, academic_year, decision, note, user.id],
  )

  return Response.json({
    ok: true,
    reg_no,
    subject,
    semester,
    academic_year,
    decision,
    note,
  })
}
