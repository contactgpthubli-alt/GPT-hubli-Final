import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  ensureExamResultsSchema,
  loadStudentContext,
  staffCanAccessReg,
  curriculumForStudentWithPathway,
  effectiveSubjectStatus,
  computeCgpaFromAttempts,
  recomputeAndStoreStudentCgpa,
  type AttemptResult,
  type AttemptStatus,
  type ExamAttemptRow,
  EXAM_VERIFIERS,
} from "@/lib/exam-results"
import { hodBranchOf } from "@/lib/account-approvals"
import {
  inferAcademicYearFromDate,
  inferCurrentSemester,
  inferTermParityFromDate,
  termParityLabel,
} from "@/lib/academic-year"

function mapRow(r: Record<string, unknown>): ExamAttemptRow & {
  student_name?: string
  student_branch?: string
} {
  return {
    id: Number(r.id),
    reg_no: String(r.reg_no),
    scheme: String(r.scheme),
    branch_code: String(r.branch_code),
    semester: Number(r.semester),
    subject_code: String(r.subject_code),
    subject_name: String(r.subject_name),
    exam_session: String(r.exam_session),
    result: String(r.result) as AttemptResult,
    grade: String(r.grade || ""),
    cie_marks: r.cie_marks != null ? Number(r.cie_marks) : null,
    see_marks: r.see_marks != null ? Number(r.see_marks) : null,
    status: String(r.status) as AttemptStatus,
    reject_note: r.reject_note != null ? String(r.reject_note) : null,
    submitted_at: r.submitted_at ? String(r.submitted_at) : null,
    verified_at: r.verified_at ? String(r.verified_at) : null,
    verified_by_name: r.verified_by_name != null ? String(r.verified_by_name) : null,
    verifier_role: r.verifier_role != null ? String(r.verifier_role) : null,
    student_name:
      r.student_name != null && String(r.student_name).trim()
        ? String(r.student_name)
        : undefined,
    student_branch:
      r.student_branch != null && String(r.student_branch).trim()
        ? String(r.student_branch)
        : undefined,
  }
}

/** Group attempt rows into per-student cards for staff verification UI. */
function groupAttemptsByStudent(
  attempts: Array<ExamAttemptRow & { student_name?: string; student_branch?: string }>,
) {
  const map = new Map<
    string,
    {
      reg_no: string
      name: string
      branch: string
      branch_code: string
      pending: number
      verified: number
      rejected: number
      total: number
      attempts: typeof attempts
    }
  >()
  for (const a of attempts) {
    let g = map.get(a.reg_no)
    if (!g) {
      g = {
        reg_no: a.reg_no,
        name: a.student_name || a.reg_no,
        branch: a.student_branch || a.branch_code || "",
        branch_code: a.branch_code || "",
        pending: 0,
        verified: 0,
        rejected: 0,
        total: 0,
        attempts: [],
      }
      map.set(a.reg_no, g)
    }
    if (a.student_name && g.name === g.reg_no) g.name = a.student_name
    if (a.student_branch) g.branch = a.student_branch
    g.attempts.push(a)
    g.total++
    if (a.status === "pending") g.pending++
    else if (a.status === "verified") g.verified++
    else if (a.status === "rejected") g.rejected++
  }
  return Array.from(map.values()).sort((a, b) => {
    // Pending-first, then name
    if (b.pending !== a.pending) return b.pending - a.pending
    return a.name.localeCompare(b.name) || a.reg_no.localeCompare(b.reg_no)
  })
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureExamResultsSchema()
  try {
    const { ensureMakeupExamSchema } = await import("@/lib/makeup-exam")
    await ensureMakeupExamSchema()
  } catch {
    /* optional makeup columns */
  }

  const url = new URL(req.url)
  const statusF = (url.searchParams.get("status") || "").trim()
  const branchF = (url.searchParams.get("branch") || "").trim()
  let reg = (url.searchParams.get("reg_no") || url.searchParams.get("reg") || "").trim()

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number on account")
    reg = user.reg_no
    const { rows } = await query(
      `SELECT * FROM student_exam_attempts WHERE reg_no = $1 ORDER BY semester, subject_code, id`,
      [reg],
    )
    const attempts = rows.map(mapRow)
    const ctx = await loadStudentContext(reg)
    let curriculum: unknown[] = []
    let pathway = null
    let pathway_note: string | null = null
    let pathway_required = false
    if (ctx) {
      const packed = await curriculumForStudentWithPathway({ ...ctx, reg_no: reg })
      curriculum = packed.subjects
      pathway = packed.pathway
      pathway_note = packed.pathway_note
      pathway_required = packed.pathway_required
    }
    const term_parity = inferTermParityFromDate()
    const active_academic_year = inferAcademicYearFromDate()
    const current_semester = ctx ? inferCurrentSemester(ctx.current_study_year) : null
    const cgpa_official = ctx
      ? computeCgpaFromAttempts(attempts, {
          branch_code: ctx.branch_code,
          scheme: ctx.scheme,
          entry_type: ctx.entry_type,
          provisional: false,
        })
      : null
    const cgpa_live = ctx
      ? computeCgpaFromAttempts(attempts, {
          branch_code: ctx.branch_code,
          scheme: ctx.scheme,
          entry_type: ctx.entry_type,
          provisional: true,
        })
      : null
    // Persist official (or provisional fallback) so dashboard KPI has data
    if (ctx) {
      try {
        await recomputeAndStoreStudentCgpa(reg)
      } catch {
        /* ignore store failures */
      }
    }
    return Response.json({
      attempts,
      effective: effectiveSubjectStatus(attempts),
      student: ctx,
      curriculum,
      pathway,
      pathway_note,
      pathway_required,
      // Calendar term: Jun–Dec = odd (1/3/5), Jan–May = even (2/4/6)
      term_parity,
      term_label: termParityLabel(term_parity),
      active_academic_year,
      current_semester,
      cgpa: cgpa_live?.label || cgpa_official?.label || null,
      cgpa_detail: {
        live: cgpa_live,
        official: cgpa_official,
      },
    })
  }

  if (!(EXAM_VERIFIERS as readonly string[]).includes(user.role) && user.role !== "faculty") {
    return unauthorized()
  }

  const params: unknown[] = []
  const where: string[] = []
  // regular | makeup | all — default regular for staff list (Result Verification regular tab)
  const kindRaw = url.searchParams.get("kind") ?? url.searchParams.get("attempt_kind")
  const kindF = (kindRaw != null ? String(kindRaw) : "regular").trim().toLowerCase() || "regular"
  if (reg) {
    params.push(reg)
    where.push(`a.reg_no = $${params.length}`)
    if (!(await staffCanAccessReg(user, reg))) return unauthorized("Not your branch")
  }
  if (statusF === "pending") {
    // Awaiting staff action: submitted pending + unsubmitted drafts
    where.push(`a.status IN ('pending', 'draft')`)
  } else if (statusF) {
    params.push(statusF)
    where.push(`a.status = $${params.length}`)
  }
  if (kindF === "makeup") {
    where.push(`(COALESCE(a.attempt_kind, 'regular') = 'makeup' OR a.makeup_cycle_id IS NOT NULL)`)
  } else if (kindF === "all") {
    /* no attempt_kind filter */
  } else {
    // regular (default)
    where.push(`(COALESCE(a.attempt_kind, 'regular') <> 'makeup' AND a.makeup_cycle_id IS NULL)`)
  }
  if (user.role === "hod") {
    const my = hodBranchOf(user)
    if (!my) return badRequest("HOD has no branch")
    const { branchCodeFromDept } = await import("@/lib/curriculum-c20")
    const code = branchCodeFromDept(my)
    if (!code) return badRequest("Could not map HOD branch to CE/CSE/ECE/ME")
    params.push(code)
    where.push(`a.branch_code = $${params.length}`)
  } else if (branchF) {
    const { branchCodeFromDept } = await import("@/lib/curriculum-c20")
    const code = branchCodeFromDept(branchF) || branchF.toUpperCase()
    params.push(code)
    where.push(`a.branch_code = $${params.length}`)
  }

  const sql = `SELECT a.*,
      COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(u.display_name), ''), a.reg_no) AS student_name,
      COALESCE(NULLIF(TRIM(s.dept), ''), NULLIF(TRIM(u.branch), ''), a.branch_code) AS student_branch
    FROM student_exam_attempts a
    LEFT JOIN students s ON s.reg_no = a.reg_no
    LEFT JOIN users u ON u.reg_no = a.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY a.status = 'pending' DESC, student_name, a.reg_no, a.semester, a.subject_code, a.id
    LIMIT 2000`
  const { rows } = await query(sql, params)
  const attempts = rows.map(mapRow)
  let student = null
  let curriculum: unknown[] = []
  let effective = null
  let pathway = null
  let pathway_note: string | null = null
  if (reg) {
    student = await loadStudentContext(reg)
    if (student) {
      const packed = await curriculumForStudentWithPathway({ ...student, reg_no: reg })
      curriculum = packed.subjects
      pathway = packed.pathway
      pathway_note = packed.pathway_note
    } else {
      curriculum = []
    }
    effective = effectiveSubjectStatus(attempts)
  }
  const by_student = groupAttemptsByStudent(attempts)
  return Response.json({
    attempts,
    by_student,
    student_count: by_student.length,
    pending_count: attempts.filter((a) => a.status === "pending").length,
    effective,
    student,
    curriculum,
    pathway,
    pathway_note,
  })
}

/** Student save/submit attempts batch */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")

  const action = String(b.action || "save") // save | submit
  let regNo = String(b.reg_no || "").trim()

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("No reg number")
    regNo = user.reg_no
  } else if ((EXAM_VERIFIERS as readonly string[]).includes(user.role) || user.role === "admin") {
    if (!regNo) return badRequest("reg_no required")
    if (!(await staffCanAccessReg(user, regNo))) return unauthorized()
  } else {
    return unauthorized()
  }

  const ctx = await loadStudentContext(regNo)
  if (!ctx) return badRequest("Student not found")
  if (!ctx.branch_code) return badRequest("Student branch not set — cannot load subjects")
  // C-25 subjects are loaded (I/II Year). C-20 remains for final-year / older batches.
  if (ctx.scheme === "unknown") {
    return badRequest("Admission year missing — set Year of Admission / Admission Academic Year on profile (2020-21…2024-25 = C-20).")
  }

  const items = Array.isArray(b.attempts) ? b.attempts : []
  if (!items.length) return badRequest("attempts[] required")

  const wantStatus: AttemptStatus = action === "submit" ? "pending" : "draft"
  const saved: number[] = []
  const errors: string[] = []

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const it = raw as Record<string, unknown>
    const subject_code = String(it.subject_code || "").trim()
    const subject_name = String(it.subject_name || "").trim()
    const exam_session = String(it.exam_session || "").trim()
    const semester = Number(it.semester)
    const result = String(it.result || "fail").toLowerCase() as AttemptResult
    const grade = String(it.grade || "").trim()
    if (!subject_code || !exam_session || !semester) {
      errors.push("Missing subject_code / exam_session / semester")
      continue
    }
    if (!["pass", "fail", "absent"].includes(result)) {
      errors.push(`${subject_code}: invalid result`)
      continue
    }

    // Block edit of verified unless admin
    const { rows: existing } = await query(
      `SELECT id, status FROM student_exam_attempts
        WHERE reg_no = $1 AND subject_code = $2 AND exam_session = $3
        LIMIT 1`,
      [regNo, subject_code, exam_session],
    )
    if (existing[0]?.status === "verified" && user.role !== "admin") {
      errors.push(`${subject_code} (${exam_session}): verified — locked`)
      continue
    }
    if (existing[0]?.status === "pending" && user.role === "student" && action === "save") {
      // allow student to still edit pending? plan said pending until verified — allow re-save as pending
    }

    const cie = it.cie_marks != null && it.cie_marks !== "" ? Number(it.cie_marks) : null
    const see = it.see_marks != null && it.see_marks !== "" ? Number(it.see_marks) : null
    const status = existing[0]?.status === "verified" && user.role === "admin" ? "verified" : wantStatus

    if (existing[0]) {
      await query(
        `UPDATE student_exam_attempts SET
           subject_name = $1, semester = $2, result = $3, grade = $4,
           cie_marks = $5, see_marks = $6, status = $7,
           scheme = $8, branch_code = $9,
           submitted_at = CASE WHEN $7 = 'pending' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
           reject_note = CASE WHEN $7 = 'pending' THEN NULL ELSE reject_note END,
           updated_at = now()
         WHERE id = $10`,
        [
          subject_name || subject_code,
          semester,
          result,
          grade,
          Number.isFinite(cie as number) ? cie : null,
          Number.isFinite(see as number) ? see : null,
          status,
          ctx.scheme,
          ctx.branch_code,
          existing[0].id,
        ],
      )
      saved.push(Number(existing[0].id))
    } else {
      const { rows: ins } = await query(
        `INSERT INTO student_exam_attempts
          (reg_no, scheme, branch_code, semester, subject_code, subject_name,
           exam_session, result, grade, cie_marks, see_marks, status, submitted_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
           CASE WHEN $12 = 'pending' THEN now() ELSE NULL END, $13)
         RETURNING id`,
        [
          regNo,
          ctx.scheme,
          ctx.branch_code,
          semester,
          subject_code,
          subject_name || subject_code,
          exam_session,
          result,
          grade,
          Number.isFinite(cie as number) ? cie : null,
          Number.isFinite(see as number) ? see : null,
          status,
          user.id,
        ],
      )
      saved.push(Number(ins[0].id))
    }
  }

  const { rows } = await query(
    `SELECT * FROM student_exam_attempts WHERE reg_no = $1 ORDER BY semester, subject_code, id`,
    [regNo],
  )
  const mapped = rows.map(mapRow)
  let cgpa = null
  try {
    const detail = await recomputeAndStoreStudentCgpa(regNo)
    cgpa = detail?.label || null
  } catch {
    /* ignore */
  }
  return Response.json({
    ok: true,
    saved: saved.length,
    errors,
    attempts: mapped,
    effective: effectiveSubjectStatus(mapped),
    cgpa,
  })
}

/** Staff verify / reject / admin unlock */
export async function PATCH(req: Request) {
  const user = await requireRole(...EXAM_VERIFIERS)
  if (!user) return unauthorized()
  await ensureExamResultsSchema()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON required")
  const action = String(b.action || "").toLowerCase() // verify | reject | unlock
  const ids: number[] = Array.isArray(b.ids)
    ? b.ids.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0)
    : b.id
      ? [Number(b.id)]
      : []
  if (!ids.length) return badRequest("id or ids[] required")
  if (!["verify", "reject", "unlock"].includes(action)) {
    return badRequest("action must be verify | reject | unlock")
  }
  if (action === "unlock" && user.role !== "admin") {
    return unauthorized("Only Admin can unlock verified results")
  }

  const note = b.note != null ? String(b.note).trim() : null
  const results: { id: number; ok: boolean; error?: string }[] = []

  for (const id of ids) {
    const { rows } = await query(`SELECT * FROM student_exam_attempts WHERE id = $1`, [id])
    const row = rows[0]
    if (!row) {
      results.push({ id, ok: false, error: "Not found" })
      continue
    }
    if (!(await staffCanAccessReg(user, String(row.reg_no)))) {
      results.push({ id, ok: false, error: "Not authorized for this student" })
      continue
    }
    if (action === "verify") {
      if (row.status === "verified") {
        results.push({ id, ok: true })
        continue
      }
      await query(
        `UPDATE student_exam_attempts SET
           status = 'verified', verified_at = now(), verified_by = $1,
           verified_by_name = $2, verifier_role = $3, reject_note = NULL, updated_at = now()
         WHERE id = $4`,
        [user.id, user.display_name || user.email, user.role, id],
      )
      results.push({ id, ok: true })
    } else if (action === "reject") {
      await query(
        `UPDATE student_exam_attempts SET
           status = 'rejected', reject_note = $1, verified_at = now(),
           verified_by = $2, verified_by_name = $3, verifier_role = $4, updated_at = now()
         WHERE id = $5`,
        [note || "Rejected", user.id, user.display_name || user.email, user.role, id],
      )
      results.push({ id, ok: true })
    } else {
      // unlock → draft for re-edit
      await query(
        `UPDATE student_exam_attempts SET
           status = 'draft', verified_at = NULL, verified_by = NULL,
           verified_by_name = NULL, verifier_role = NULL, updated_at = now()
         WHERE id = $1`,
        [id],
      )
      results.push({ id, ok: true })
    }
  }

  // Recompute CGPA for affected students after verify/reject/unlock
  const regs = new Set<string>()
  for (const id of ids) {
    try {
      const { rows } = await query(`SELECT reg_no FROM student_exam_attempts WHERE id = $1`, [id])
      if (rows[0]?.reg_no) regs.add(String(rows[0].reg_no))
    } catch {
      /* ignore */
    }
  }
  for (const reg of regs) {
    try {
      await recomputeAndStoreStudentCgpa(reg)
    } catch {
      /* ignore */
    }
  }

  return Response.json({
    ok: results.some((r) => r.ok),
    updated: results.filter((r) => r.ok).length,
    results,
  })
}
