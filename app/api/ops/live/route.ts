import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import { hodBranchOf } from "@/lib/account-approvals"
import { branchCodeFromDept } from "@/lib/curriculum-c20"
import {
  ensureStudentOpsSchema,
  canReadOps,
  loadStudentProfileSchema,
  isProfileComplete,
  currentRunningSemester,
  studentsWithVerifiedResultsForSem,
  feeExportFields,
  entryTypeLabel,
  parseOpsFlags,
} from "@/lib/student-ops"
import { inferAcademicYearFromDate, inferTermParityFromDate, termParityLabel } from "@/lib/academic-year"

function branchLike(user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null }) {
  if (user.role !== "hod") return null
  const my = hodBranchOf(user)
  if (!my) return "___none___"
  const code = branchCodeFromDept(my)
  if (code === "CSE") return "%computer%"
  if (code === "CE") return "%civil%"
  if (code === "ECE") return "%electron%"
  if (code === "ME") return "%mech%"
  return `%${my.toLowerCase()}%`
}

/**
 * GET /api/ops/live
 * Live lists: fees paid/unpaid, profile complete/incomplete, results filled/not (current sem).
 * Roles: admin, principal, exam, acm, hod (branch-scoped).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canReadOps(user.role)) return unauthorized()

  await ensureStudentOpsSchema()
  const url = new URL(req.url)
  const tab = (url.searchParams.get("tab") || "summary").trim()
  const branchQ = (url.searchParams.get("branch") || "").trim()
  // Default: regular 3-year diploma only (exclude lateral / alumni unless filters change)
  const entryF = (url.searchParams.get("entry") || "regular").trim().toLowerCase() // regular | lateral | all
  const yearF = (url.searchParams.get("year") || "").trim() // I | II | III | 1 | 2 | 3
  const admYearF = (url.searchParams.get("admission_year") || url.searchParams.get("batch") || "").trim()
  const statusF = (url.searchParams.get("status") || "active").trim().toLowerCase() // active | all

  const like = branchLike(user)
  const params: unknown[] = []
  let branchSql = ""
  if (like) {
    params.push(like)
    branchSql = ` AND (lower(COALESCE(s.dept,'')) LIKE $${params.length} OR lower(COALESCE(u.branch,'')) LIKE $${params.length})`
  } else if (branchQ) {
    params.push(`%${branchQ.toLowerCase()}%`)
    branchSql = ` AND (lower(COALESCE(s.dept,'')) LIKE $${params.length} OR lower(COALESCE(u.branch,'')) LIKE $${params.length})`
  }

  let entrySql = ""
  if (entryF === "regular") {
    // Regular 3-year: entry_type regular / empty / null; not lateral/iti/puc markers in entry_type
    entrySql = ` AND (
      s.entry_type IS NULL OR lower(trim(s.entry_type)) IN ('', 'regular', 'reg')
    )`
  } else if (entryF === "lateral") {
    entrySql = ` AND lower(COALESCE(s.entry_type,'')) IN ('lateral','iti','puc','iti_lateral','puc_lateral')`
  }

  let yearSql = ""
  if (yearF) {
    const yMap: Record<string, number> = {
      i: 1, "1": 1, "1st": 1, first: 1,
      ii: 2, "2": 2, "2nd": 2, second: 2,
      iii: 3, "3": 3, "3rd": 3, third: 3,
    }
    const n = yMap[yearF.toLowerCase().replace(/\s*year\s*/g, "").trim()]
    if (n) {
      const ordinal = n === 1 ? "%1st%" : n === 2 ? "%2nd%" : "%3rd%"
      const roman = n === 1 ? "i" : n === 2 ? "ii" : "iii"
      params.push(n)
      const iN = params.length
      params.push(ordinal)
      const iOrd = params.length
      params.push(roman)
      const iRom = params.length
      yearSql = ` AND (
        s.current_study_year = $${iN}
        OR lower(COALESCE(s.year,'')) LIKE $${iOrd}
        OR lower(trim(COALESCE(s.year,''))) = $${iRom}
        OR lower(trim(COALESCE(s.year,''))) = $${iN}::text
      )`
    }
  } else if (entryF === "regular") {
    // Default regular 3-year cohort: study year 1–3 only (drop alumni when known)
    yearSql = ` AND (
      s.current_study_year IS NULL
      OR s.current_study_year BETWEEN 1 AND 3
    )
    AND (s.academic_status IS NULL OR lower(s.academic_status) NOT IN ('passed_out','alumni','discontinued'))`
  }

  let admSql = ""
  if (admYearF) {
    params.push(admYearF)
    admSql = ` AND (
      COALESCE(s.admission_academic_year,'') = $${params.length}
      OR COALESCE(s.admission_academic_year,'') LIKE $${params.length} || '%'
    )`
  }

  let statusSql = ""
  if (statusF === "active") {
    statusSql = ` AND (s.academic_status IS NULL OR lower(s.academic_status) IN ('active','', 'regular'))`
  }

  const { rows: students } = await query(
    `SELECT s.reg_no, s.name, s.dept, s.year, s.father, s.extra, s.entry_type, s.current_study_year,
            s.academic_status, s.progress_locked, s.ops_flags, s.cgpa, s.admission_academic_year,
            u.branch AS user_branch, u.status AS user_status
       FROM students s
       LEFT JOIN users u ON u.reg_no = s.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
      WHERE (u.id IS NULL OR u.status = 'approved')
        AND (s.name IS NULL OR s.name NOT LIKE '[MOVED]%')
        ${branchSql}
        ${entrySql}
        ${yearSql}
        ${admSql}
        ${statusSql}
      ORDER BY s.dept, s.name
      LIMIT 5000`,
    params,
  )

  const regs = students.map((s) => String(s.reg_no).toUpperCase())
  const schema = await loadStudentProfileSchema()

  // Fees: latest payment per reg for cycle current
  const feeMap = new Map<string, Record<string, unknown>>()
  if (regs.length) {
    const { rows: fees } = await query(
      `SELECT DISTINCT ON (UPPER(reg_no))
              UPPER(reg_no) AS reg, status, fine_amount, challans, paid_marked_at, paid_marked_by_name, computed_total
         FROM exam_fee_payments
        WHERE exam_cycle = 'current' AND UPPER(reg_no) = ANY($1::text[])
        ORDER BY UPPER(reg_no), updated_at DESC NULLS LAST, id DESC`,
      [regs],
    )
    for (const f of fees) feeMap.set(String(f.reg).toUpperCase(), f)
  }

  // Results for each student's running semester (group by semester)
  const bySemRegs = new Map<number, string[]>()
  for (const s of students) {
    const sem = currentRunningSemester(
      s.current_study_year != null ? Number(s.current_study_year) : null,
    )
    if (sem == null) continue
    if (!bySemRegs.has(sem)) bySemRegs.set(sem, [])
    bySemRegs.get(sem)!.push(String(s.reg_no).toUpperCase())
  }
  const verifiedByReg = new Map<string, boolean>()
  for (const [sem, list] of bySemRegs) {
    const set = await studentsWithVerifiedResultsForSem(sem, list)
    for (const r of list) verifiedByReg.set(r, set.has(r))
  }

  type Row = {
    reg_no: string
    name: string
    branch: string
    year: string | null
    father: string | null
    entry_type_label: string
    academic_status: string | null
    study_year: number | null
    admission_year: string | null
    running_sem: number | null
    fees_paid: boolean
    profile_complete: boolean
    profile_missing: string[]
    results_filled: boolean
    fee_detail: ReturnType<typeof feeExportFields>
    ops_flags: ReturnType<typeof parseOpsFlags>
  }

  const rows: Row[] = students.map((s) => {
    const reg = String(s.reg_no).toUpperCase()
    const pay = feeMap.get(reg) || null
    const fee = feeExportFields(pay as never)
    const prof = isProfileComplete(
      {
        name: s.name,
        father: s.father,
        dept: s.dept,
        year: s.year,
        extra: s.extra,
      },
      schema,
    )
    const studyY = s.current_study_year != null ? Number(s.current_study_year) : null
    const runSem = currentRunningSemester(studyY)
    return {
      reg_no: reg,
      name: s.name,
      branch: s.dept || s.user_branch || "",
      year: s.year,
      father: s.father,
      entry_type_label: entryTypeLabel(s),
      academic_status: s.academic_status,
      study_year: studyY,
      admission_year: s.admission_academic_year != null ? String(s.admission_academic_year) : null,
      running_sem: runSem,
      fees_paid: fee.paid,
      profile_complete: prof.complete,
      profile_missing: prof.missing,
      results_filled: runSem != null ? !!verifiedByReg.get(reg) : false,
      fee_detail: fee,
      ops_flags: parseOpsFlags(s.ops_flags),
    }
  })

  const summary = {
    total: rows.length,
    fees_paid: rows.filter((r) => r.fees_paid).length,
    fees_unpaid: rows.filter((r) => !r.fees_paid).length,
    profile_complete: rows.filter((r) => r.profile_complete).length,
    profile_incomplete: rows.filter((r) => !r.profile_complete).length,
    results_filled: rows.filter((r) => r.results_filled).length,
    results_missing: rows.filter((r) => !r.results_filled).length,
  }

  const batches = [...new Set(rows.map((r) => r.admission_year).filter(Boolean) as string[])].sort().reverse()

  const parity = inferTermParityFromDate()
  const meta = {
    active_academic_year: inferAcademicYearFromDate(),
    term_parity: parity,
    term_label: termParityLabel(parity),
    note: "Default: regular 3-year students (active). Use filters for year (I/II/III), admission batch, lateral, or all. Fees Paid = Exam Section validated (status paid). Profile = all schema fields filled. Results = verified attempt or official result for running semester.",
    filters: {
      entry: entryF,
      year: yearF || null,
      admission_year: admYearF || null,
      status: statusF,
    },
    admission_years: batches,
  }

  if (tab === "summary") {
    return Response.json({ summary, meta, rows: rows.slice(0, 50) })
  }
  if (tab === "fees_paid") {
    return Response.json({ summary, meta, rows: rows.filter((r) => r.fees_paid) })
  }
  if (tab === "fees_unpaid") {
    return Response.json({ summary, meta, rows: rows.filter((r) => !r.fees_paid) })
  }
  if (tab === "profile_complete") {
    return Response.json({ summary, meta, rows: rows.filter((r) => r.profile_complete) })
  }
  if (tab === "profile_incomplete") {
    return Response.json({ summary, meta, rows: rows.filter((r) => !r.profile_complete) })
  }
  if (tab === "results_filled") {
    return Response.json({ summary, meta, rows: rows.filter((r) => r.results_filled) })
  }
  if (tab === "results_missing") {
    return Response.json({ summary, meta, rows: rows.filter((r) => !r.results_filled) })
  }
  if (tab === "all") {
    return Response.json({ summary, meta, rows })
  }
  return badRequest("tab must be summary|all|fees_paid|fees_unpaid|profile_complete|profile_incomplete|results_filled|results_missing")
}
