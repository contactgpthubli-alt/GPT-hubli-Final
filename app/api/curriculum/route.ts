import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import {
  branchCodeFromDept,
  getCurriculumSubjects,
  schemeFromAdmissionYear,
  subjectsBySemester,
  type BranchCode,
} from "@/lib/curriculum-c20"
import { loadStudentContext, resolveStudentScheme } from "@/lib/exam-results"
import { normalizeBranch } from "@/lib/branches"

/**
 * GET ?scheme=C-20&branch=CSE
 * GET (student) — uses own branch + admission year for scheme
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  let scheme = (url.searchParams.get("scheme") || "").toUpperCase()
  let branchParam = (url.searchParams.get("branch") || "").toUpperCase() as BranchCode | ""
  let entryType = (url.searchParams.get("entry_type") || "regular").toLowerCase() as "regular" | "lateral"

  if (user.role === "student") {
    if (!user.reg_no) return badRequest("Student account has no registration number")
    const ctx = await loadStudentContext(user.reg_no)
    if (!ctx) return badRequest("Student profile not found")
    scheme = ctx.scheme === "unknown" ? "C-20" : ctx.scheme
    branchParam = (ctx.branch_code || "") as BranchCode | ""
    entryType = ctx.entry_type
    if (!branchParam) {
      return Response.json({
        scheme,
        branch: null,
        subjects: [],
        by_semester: {},
        note: "Branch not set on profile — contact HOD / Admin.",
        admission_academic_year: ctx.admission_academic_year,
        entry_type: entryType,
      })
    }
  } else {
    if (!scheme) scheme = "C-20"
    if (!branchParam) {
      const b = url.searchParams.get("dept")
      branchParam = (branchCodeFromDept(normalizeBranch(b) || b) || "") as BranchCode | ""
    }
  }

  if (scheme !== "C-20" && scheme !== "C-25") {
    return badRequest("scheme must be C-20 or C-25")
  }
  if (!branchParam || !["CE", "CSE", "ECE", "ME"].includes(branchParam)) {
    return badRequest("branch required: CE | CSE | ECE | ME")
  }

  const subjects = getCurriculumSubjects({
    scheme: scheme === "C-25" ? "C-25" : "C-20",
    branch: branchParam as BranchCode,
    entryType,
    includeYear1ForLateral: url.searchParams.get("include_y1") === "1",
  })

  return Response.json({
    scheme: scheme === "C-25" ? "C-25" : "C-20",
    branch: branchParam,
    subjects,
    by_semester: subjectsBySemester(subjects),
    entry_type: entryType,
    lateral_note:
      entryType === "lateral"
        ? "Lateral (ITI / PUC): Year-1 subjects hidden. Use include_y1=1 to show them."
        : null,
    scheme_rule:
      "Admission 2020-21 to 2024-25 → C-20; 2025-26 onwards → C-25. " +
      "C-25 Sem 1–2 loaded (all branches). Sem 3+ when official lists arrive. " +
      "C-20 inventory remains for final-year / older batches.",
    note:
      scheme === "C-25"
        ? subjects.length
          ? "C-25 Sem 1–2 subjects available for this branch. Sem 3+ will be added when official lists arrive."
          : "C-25 subjects for this branch are not listed yet — contact Exam Section."
        : null,
  })
}

/** Helper for staff testing */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  const ay = b?.admission_academic_year
  return Response.json({ ...resolveStudentScheme(ay), schemeFrom: schemeFromAdmissionYear(ay) })
}
