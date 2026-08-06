/**
 * Live result analysis: semester / year (batch) / subject pass–fail %.
 * Sources: published results (+ subjects) and verified exam attempts.
 */
import { query } from "@/lib/db"
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/roles"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"
import { branchCodeFromDept } from "@/lib/curriculum-c20"
import { ensureExamResultsSchema } from "@/lib/exam-results"

const VIEWERS = ["admin", "principal", "hod", "exam", "acm"] as const

type AggRow = {
  key: string
  label: string
  total: number
  pass: number
  fail: number
  pass_pct: number
  fail_pct: number
  avg_sgpa?: number | null
  extra?: Record<string, unknown>
}

function pct(n: number, d: number) {
  if (!d) return 0
  return Math.round((n / d) * 1000) / 10
}

function isPassResult(result: string | null | undefined, grade?: string | null) {
  const r = String(result || "").toLowerCase()
  const g = String(grade || "").toUpperCase()
  if (r === "pass" || r === "p") return true
  if (r === "fail" || r === "f" || r === "absent" || r === "ab") return false
  if (["F", "F*", "F**", "AB", "NE", "W", "X"].includes(g)) return false
  if (g && !["F", "F*", "F**", "AB", "NE", "W", "X", ""].includes(g)) return true
  // overall class labels
  const o = String(result || "").toUpperCase()
  if (/FAIL/.test(o)) return false
  if (/PASS|DISTINCTION|FIRST|SECOND|CLASS/.test(o)) return true
  return false
}

function batchFromReg(reg: string): string {
  const m = String(reg || "").toUpperCase().match(/^\d{3}[A-Z]{2}(\d{2})/)
  if (!m) return "Unknown"
  const yy = Number(m[1])
  if (Number.isNaN(yy)) return "Unknown"
  const start = 2000 + yy
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
}

function studyYearLabel(v: unknown): string {
  const s = String(v || "").trim()
  if (!s) return "Unknown"
  if (/^1|1st/i.test(s)) return "1st Year"
  if (/^2|2nd/i.test(s)) return "2nd Year"
  if (/^3|3rd/i.test(s)) return "3rd Year"
  if (s === "1") return "1st Year"
  if (s === "2") return "2nd Year"
  if (s === "3") return "3rd Year"
  return s
}

function bump(
  map: Map<string, { label: string; total: number; pass: number; fail: number; sgpaSum: number; sgpaN: number; extra?: Record<string, unknown> }>,
  key: string,
  label: string,
  passed: boolean,
  sgpa?: number | null,
  extra?: Record<string, unknown>,
) {
  let row = map.get(key)
  if (!row) {
    row = { label, total: 0, pass: 0, fail: 0, sgpaSum: 0, sgpaN: 0, extra }
    map.set(key, row)
  }
  row.total++
  if (passed) row.pass++
  else row.fail++
  if (sgpa != null && !Number.isNaN(Number(sgpa))) {
    row.sgpaSum += Number(sgpa)
    row.sgpaN++
  }
  if (extra) row.extra = { ...(row.extra || {}), ...extra }
}

function finalize(map: Map<string, { label: string; total: number; pass: number; fail: number; sgpaSum: number; sgpaN: number; extra?: Record<string, unknown> }>): AggRow[] {
  return [...map.entries()]
    .map(([key, r]) => ({
      key,
      label: r.label,
      total: r.total,
      pass: r.pass,
      fail: r.fail,
      pass_pct: pct(r.pass, r.total),
      fail_pct: pct(r.fail, r.total),
      avg_sgpa: r.sgpaN ? Math.round((r.sgpaSum / r.sgpaN) * 100) / 100 : null,
      extra: r.extra,
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!STAFF_ROLES.includes(user.role) || !VIEWERS.includes(user.role as (typeof VIEWERS)[number])) {
    return unauthorized("Only Exam / ACM / HOD / Principal / Admin can view analysis")
  }
  await ensureExamResultsSchema()

  const url = new URL(req.url)
  const session = (url.searchParams.get("session") || "").trim()
  const branchQ = (url.searchParams.get("branch") || "").trim()
  const semQ = url.searchParams.get("sem")
  const sem = semQ != null && semQ !== "" ? Number(semQ) : null
  if (sem != null && (Number.isNaN(sem) || sem < 1 || sem > 6)) return badRequest("sem must be 1–6")
  const scheme = (url.searchParams.get("scheme") || "").trim().toUpperCase()
  const source = (url.searchParams.get("source") || "both").trim().toLowerCase() // published | verified | both

  const hodBranch = user.role === "hod" ? hodBranchOf(user) : null

  // Infer scheme from subject codes: 25* = C-25, 20* = C-20
  function schemeSqlOnResult(alias: string, params: unknown[]): string {
    if (scheme === "C-25") {
      return ` AND EXISTS (
        SELECT 1 FROM result_subjects _rs
         WHERE _rs.result_id = ${alias}.id
           AND UPPER(COALESCE(_rs.code,'')) LIKE '25%'
      )`
    }
    if (scheme === "C-20") {
      return ` AND (
        EXISTS (
          SELECT 1 FROM result_subjects _rs
           WHERE _rs.result_id = ${alias}.id
             AND UPPER(COALESCE(_rs.code,'')) LIKE '20%'
        )
        OR NOT EXISTS (SELECT 1 FROM result_subjects _rs2 WHERE _rs2.result_id = ${alias}.id)
      )`
    }
    return ""
  }

  // ---- Published results (student × sem × session) ----
  const resParams: unknown[] = []
  const resWhere: string[] = []
  if (session) {
    resParams.push(session)
    resWhere.push(`r.session = $${resParams.length}`)
  }
  if (sem != null) {
    resParams.push(sem)
    resWhere.push(`r.sem = $${resParams.length}`)
  }
  let resWhereSql = resWhere.length ? "WHERE " + resWhere.join(" AND ") : ""
  const schemeRes = schemeSqlOnResult("r", resParams)
  if (schemeRes) {
    resWhereSql = resWhereSql
      ? resWhereSql + schemeRes
      : "WHERE " + schemeRes.replace(/^\s*AND\s+/, "")
  }
  const resSql = `
    SELECT r.reg_no, r.name, r.branch, r.sem, r.session, r.sgpa::float AS sgpa, r.result,
           s.current_study_year, s.year AS study_year_label, s.admission_academic_year
      FROM results r
      LEFT JOIN students s ON UPPER(s.reg_no) = UPPER(r.reg_no)
     ${resWhereSql}
     ORDER BY r.session, r.sem, r.reg_no`
  const { rows: published } = await query(resSql, resParams)

  // ---- Verified subject attempts ----
  const attParams: unknown[] = []
  const attWhere: string[] = [`a.status = 'verified'`]
  if (session) {
    attParams.push(session)
    attWhere.push(`a.exam_session = $${attParams.length}`)
  }
  if (sem != null) {
    attParams.push(sem)
    attWhere.push(`a.semester = $${attParams.length}`)
  }
  if (scheme === "C-20" || scheme === "C-25") {
    attParams.push(scheme)
    attWhere.push(`UPPER(a.scheme) = $${attParams.length}`)
  }
  const attSql = `
    SELECT a.reg_no, a.scheme, a.branch_code, a.semester, a.subject_code, a.subject_name,
           a.exam_session, a.result, a.grade,
           s.name AS student_name, s.dept, s.current_study_year, s.year AS study_year_label,
           s.admission_academic_year
      FROM student_exam_attempts a
      LEFT JOIN students s ON UPPER(s.reg_no) = UPPER(a.reg_no)
     WHERE ${attWhere.join(" AND ")}
     ORDER BY a.exam_session, a.semester, a.subject_code`
  const { rows: attempts } = await query(attSql, attParams)

  // ---- Published subject lines (when we want subject stats from ledgers) ----
  let pubSubjects: {
    reg_no: string
    branch: string
    sem: number
    session: string
    code: string
    name: string
    grade: string
    result: string
  }[] = []
  if (source === "published" || source === "both") {
    const psParams: unknown[] = []
    const psWhere: string[] = []
    if (session) {
      psParams.push(session)
      psWhere.push(`r.session = $${psParams.length}`)
    }
    if (sem != null) {
      psParams.push(sem)
      psWhere.push(`r.sem = $${psParams.length}`)
    }
    if (scheme === "C-25") {
      psWhere.push(`UPPER(COALESCE(rs.code,'')) LIKE '25%'`)
    } else if (scheme === "C-20") {
      psWhere.push(`UPPER(COALESCE(rs.code,'')) LIKE '20%'`)
    }
    const { rows } = await query(
      `SELECT r.reg_no, r.branch, r.sem, r.session, rs.code, rs.name, rs.grade, r.result AS overall
         FROM result_subjects rs
         JOIN results r ON r.id = rs.result_id
        ${psWhere.length ? "WHERE " + psWhere.join(" AND ") : ""}`,
      psParams,
    )
    pubSubjects = rows.map((x) => ({
      reg_no: String(x.reg_no),
      branch: String(x.branch || ""),
      sem: Number(x.sem),
      session: String(x.session),
      code: String(x.code || "").toUpperCase(),
      name: String(x.name || ""),
      grade: String(x.grade || ""),
      result: isPassResult(null, String(x.grade || "")) ? "pass" : "fail",
    }))
  }

  function matchesBranchFilter(value: string, filter: string) {
    if (!filter) return true
    if (branchesMatch(value, filter)) return true
    const v = value.toUpperCase()
    const f = filter.toUpperCase()
    if (v.includes(f) || f.includes(v)) return true
    const vc = (branchCodeFromDept(value) || value).toUpperCase()
    const fc = (branchCodeFromDept(filter) || filter).toUpperCase()
    return vc === fc || vc.includes(fc) || fc.includes(vc)
  }

  function branchOk(branchOrCode: string | null | undefined, dept?: string | null) {
    const candidates = [String(branchOrCode || ""), String(dept || "")].filter(Boolean)
    if (!candidates.length) {
      // unknown branch — only allow for non-HOD when no explicit branch filter
      if (hodBranch) return false
      return !branchQ
    }
    if (hodBranch) {
      const okHod = candidates.some((c) => matchesBranchFilter(c, String(hodBranch)))
      if (!okHod) return false
    }
    if (branchQ) {
      return candidates.some((c) => matchesBranchFilter(c, branchQ))
    }
    return true
  }

  // Filter published by HOD / branch
  const pubFiltered = published.filter((r) => branchOk(String(r.branch), null))
  const attFiltered = attempts.filter((r) =>
    branchOk(String(r.branch_code || ""), String(r.dept || "")),
  )
  const pubSubFiltered = pubSubjects.filter((r) => branchOk(r.branch, null))

  // ---- Student-level aggregates (prefer published results) ----
  const bySem = new Map()
  const byBatch = new Map()
  const byStudyYear = new Map()
  const byBranch = new Map()
  const bySession = new Map()
  let passN = 0
  let failN = 0
  let sgpaSum = 0
  let sgpaN = 0
  const studentKeys = new Set<string>()

  if (source !== "verified") {
    for (const r of pubFiltered) {
      const passed = isPassResult(String(r.result))
      const sgpa = r.sgpa != null ? Number(r.sgpa) : null
      const batch = r.admission_academic_year
        ? String(r.admission_academic_year)
        : batchFromReg(String(r.reg_no))
      const sy = studyYearLabel(r.current_study_year ?? r.study_year_label)
      const br = String(r.branch || "Unknown")
      const sess = String(r.session || "Unknown")
      const semKey = String(r.sem)

      studentKeys.add(`${String(r.reg_no).toUpperCase()}|${r.sem}|${sess}`)
      if (passed) passN++
      else failN++
      if (sgpa != null && !Number.isNaN(sgpa)) {
        sgpaSum += sgpa
        sgpaN++
      }

      bump(bySem, semKey, `Sem ${r.sem}`, passed, sgpa)
      bump(byBatch, batch, batch, passed, sgpa)
      bump(byStudyYear, sy, sy, passed, sgpa)
      bump(byBranch, br, br, passed, sgpa)
      bump(bySession, sess, sess, passed, sgpa)
    }
  }

  // If only verified (or no published rows), derive student×sem from attempts
  if (source === "verified" || (source === "both" && pubFiltered.length === 0)) {
    type Key = string
    const group = new Map<Key, { reg: string; sem: number; session: string; fail: boolean; branch: string; batch: string; sy: string }>()
    for (const a of attFiltered) {
      const k = `${String(a.reg_no).toUpperCase()}|${a.semester}|${a.exam_session}`
      const passed = isPassResult(String(a.result), String(a.grade))
      let g = group.get(k)
      if (!g) {
        g = {
          reg: String(a.reg_no),
          sem: Number(a.semester),
          session: String(a.exam_session),
          fail: false,
          branch: String(a.dept || a.branch_code || "Unknown"),
          batch: a.admission_academic_year ? String(a.admission_academic_year) : batchFromReg(String(a.reg_no)),
          sy: studyYearLabel(a.current_study_year ?? a.study_year_label),
        }
        group.set(k, g)
      }
      if (!passed) g.fail = true
    }
    for (const g of group.values()) {
      const passed = !g.fail
      studentKeys.add(`${g.reg.toUpperCase()}|${g.sem}|${g.session}`)
      if (passed) passN++
      else failN++
      bump(bySem, String(g.sem), `Sem ${g.sem}`, passed, null)
      bump(byBatch, g.batch, g.batch, passed, null)
      bump(byStudyYear, g.sy, g.sy, passed, null)
      bump(byBranch, g.branch, g.branch, passed, null)
      bump(bySession, g.session, g.session, passed, null)
    }
  }

  // ---- Subject-level (prefer verified attempts; merge published if both) ----
  const bySubject = new Map()
  const gradeDist = new Map<string, number>()

  function subjectKey(code: string, session: string, sem: number, branch: string) {
    return `${code}|${session}|${sem}|${branch}`
  }

  if (source !== "published") {
    for (const a of attFiltered) {
      const code = String(a.subject_code || "").toUpperCase()
      if (!code) continue
      const passed = isPassResult(String(a.result), String(a.grade))
      const br = String(a.branch_code || branchCodeFromDept(String(a.dept || "")) || "?")
      const k = subjectKey(code, String(a.exam_session), Number(a.semester), br)
      bump(bySubject, k, `${code} — ${a.subject_name || code}`, passed, null, {
        code,
        name: a.subject_name,
        semester: Number(a.semester),
        session: a.exam_session,
        branch: br,
        scheme: a.scheme,
      })
      const g = String(a.grade || (passed ? "P" : "F")).toUpperCase() || "?"
      gradeDist.set(g, (gradeDist.get(g) || 0) + 1)
    }
  }

  if (source === "published" || (source === "both" && bySubject.size === 0)) {
    for (const s of pubSubFiltered) {
      if (!s.code) continue
      const passed = s.result === "pass"
      const br = branchCodeFromDept(s.branch) || s.branch || "?"
      const k = subjectKey(s.code, s.session, s.sem, br)
      bump(bySubject, k, `${s.code} — ${s.name || s.code}`, passed, null, {
        code: s.code,
        name: s.name,
        semester: s.sem,
        session: s.session,
        branch: br,
      })
      const g = String(s.grade || (passed ? "P" : "F")).toUpperCase() || "?"
      gradeDist.set(g, (gradeDist.get(g) || 0) + 1)
    }
  } else if (source === "both") {
    // fill subjects that only exist in published
    for (const s of pubSubFiltered) {
      if (!s.code) continue
      const br = branchCodeFromDept(s.branch) || s.branch || "?"
      const k = subjectKey(s.code, s.session, s.sem, br)
      if (bySubject.has(k)) continue
      const passed = s.result === "pass"
      bump(bySubject, k, `${s.code} — ${s.name || s.code}`, passed, null, {
        code: s.code,
        name: s.name,
        semester: s.sem,
        session: s.session,
        branch: br,
      })
    }
  }

  // Distinct sessions for filter dropdown
  const { rows: sessionRows } = await query(
    `SELECT session AS s FROM results
     UNION
     SELECT exam_session AS s FROM student_exam_attempts WHERE status='verified'
     ORDER BY 1 DESC`,
  )

  const total = passN + failN
  const subjectRows = finalize(bySubject).map((r) => ({
    ...r,
    code: r.extra?.code,
    name: r.extra?.name,
    semester: r.extra?.semester,
    session: r.extra?.session,
    branch: r.extra?.branch,
    scheme: r.extra?.scheme,
  }))

  return Response.json({
    ok: true,
    live_at: new Date().toISOString(),
    filters: {
      session: session || null,
      branch: branchQ || (hodBranch ? String(hodBranch) : null),
      sem: sem,
      scheme: scheme || null,
      source,
      hod_locked_branch: !!hodBranch,
      applied: {
        session: session || "All",
        sem: sem != null ? String(sem) : "All",
        scheme: scheme || "All",
        source,
        published_matched: pubFiltered.length,
        attempts_matched: attFiltered.length,
      },
    },
    sessions: sessionRows.map((r) => String(r.s)).filter(Boolean),
    summary: {
      student_result_rows: total,
      distinct_students: new Set([...studentKeys].map((k) => k.split("|")[0])).size,
      pass: passN,
      fail: failN,
      pass_pct: pct(passN, total),
      fail_pct: pct(failN, total),
      avg_sgpa: sgpaN ? Math.round((sgpaSum / sgpaN) * 100) / 100 : null,
      subject_rows: subjectRows.reduce((n, r) => n + r.total, 0),
      published_rows_scanned: pubFiltered.length,
      verified_attempts_scanned: attFiltered.length,
    },
    by_semester: finalize(bySem).sort((a, b) => Number(a.key) - Number(b.key)),
    by_admission_year: finalize(byBatch).sort((a, b) => a.label.localeCompare(b.label)),
    by_study_year: finalize(byStudyYear),
    by_branch: finalize(byBranch),
    by_session: finalize(bySession),
    by_subject: subjectRows,
    by_grade: [...gradeDist.entries()]
      .map(([grade, count]) => ({ grade, count }))
      .sort((a, b) => b.count - a.count),
  })
}
