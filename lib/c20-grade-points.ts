/**
 * C-20 (DTE Karnataka) grade → grade-point mapping and CGPA helpers.
 * Source: C-20 curriculum marks-to-grades table (A+…D, F / F* / F**).
 */

import type { CurriculumSubject } from "@/lib/curriculum-c20"

/** Official C-20 grade points (+ common marksheet aliases). */
export const C20_GRADE_POINTS: Record<string, number> = {
  "A+": 10,
  S: 10, // outstanding on some marksheets
  O: 10,
  A: 9,
  "B+": 8,
  B: 7,
  "C+": 6,
  C: 5,
  D: 4,
  E: 4, // low pass / satisfactory on some cards
  P: 4,
  PASS: 4,
  F: 0,
  "F*": 0,
  "F**": 0,
  AB: 0,
  ABSENT: 0,
  W: 0,
  X: 0,
  FAIL: 0,
}

export function gradeToPoints(grade: string | null | undefined): number | null {
  if (grade == null) return null
  const g = String(grade).trim().toUpperCase().replace(/\s+/g, "")
  if (!g || g === "—" || g === "-") return null
  // normalize A+ etc.
  const key =
    g === "A+" || g === "APLUS"
      ? "A+"
      : g === "B+" || g === "BPLUS"
        ? "B+"
        : g === "C+" || g === "CPLUS"
          ? "C+"
          : g === "F*" || g === "FSTAR"
            ? "F*"
            : g === "F**" || g === "FSTARSTAR"
              ? "F**"
              : g
  if (key in C20_GRADE_POINTS) return C20_GRADE_POINTS[key]
  // bare letter matches
  if (C20_GRADE_POINTS[g] != null) return C20_GRADE_POINTS[g]
  return null
}

/** Exclude F* / F** from CGPA per C-20 rules. */
export function excludeFromCgpa(grade: string | null | undefined): boolean {
  const g = String(grade || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
  return g === "F*" || g === "F**" || g === "FSTAR" || g === "FSTARSTAR"
}

/**
 * Default credits when curriculum row has none (C-20 courses are typically 4;
 * audit = 0; long internships / major projects higher).
 */
export function defaultSubjectCredits(s: {
  code?: string
  name?: string
  is_audit?: boolean
  credits?: number | null
}): number {
  if (s.credits != null && Number.isFinite(Number(s.credits))) {
    return Math.max(0, Number(s.credits))
  }
  if (s.is_audit) return 0
  const blob = `${s.code || ""} ${s.name || ""}`.toUpperCase()
  if (/INTERNSHIP|PROJECT|MVP|INCUBATION|61[SRE]?\b/.test(blob)) return 12
  return 4
}

export type CgpaCourseInput = {
  subject_code: string
  subject_name?: string
  grade: string
  result?: string
  credits?: number
  semester?: number
}

export type CgpaResult = {
  cgpa: number | null
  label: string | null
  credits_earned: number
  credit_points: number
  courses_counted: number
  courses_excluded: number
  provisional: boolean
  by_semester: Record<
    number,
    { sgpa: number | null; credits: number; credit_points: number; courses: number }
  >
}

/**
 * CGPA = sum(CE * GP) / sum(CE) for courses with earned credits,
 * excluding F-star / F-star-star attendance-CIE fails.
 * Failed (F) courses earn 0 credits and do not enter the denominator.
 */
export function computeCgpaFromCourses(
  courses: CgpaCourseInput[],
  opts?: { provisional?: boolean },
): CgpaResult {
  let credit_points = 0
  let credits_earned = 0
  let courses_counted = 0
  let courses_excluded = 0
  const bySem = new Map<number, { cp: number; ce: number; n: number; ca: number; cpa: number }>()

  for (const c of courses) {
    if (excludeFromCgpa(c.grade)) {
      courses_excluded++
      continue
    }
    const gp = gradeToPoints(c.grade)
    if (gp == null) continue

    const res = String(c.result || "").toLowerCase()
    // Absent / fail → 0 credits earned
    const failed = res === "fail" || res === "absent" || gp === 0
    const fullCredits = Math.max(0, Number(c.credits) || 0)
    if (fullCredits <= 0) continue

    const ce = failed ? 0 : fullCredits
    if (ce <= 0) continue

    credit_points += ce * gp
    credits_earned += ce
    courses_counted++

    const sem = Number(c.semester) || 0
    if (sem >= 1 && sem <= 6) {
      const bucket = bySem.get(sem) || { cp: 0, ce: 0, n: 0, ca: 0, cpa: 0 }
      bucket.cp += ce * gp
      bucket.ce += ce
      bucket.ca += fullCredits
      bucket.cpa += fullCredits * gp // for SGPA use applied credits on pass only
      bucket.n++
      bySem.set(sem, bucket)
    }
  }

  const cgpa =
    credits_earned > 0 ? Math.round((credit_points / credits_earned) * 100) / 100 : null

  const by_semester: CgpaResult["by_semester"] = {}
  for (const [sem, b] of bySem) {
    by_semester[sem] = {
      sgpa: b.ce > 0 ? Math.round((b.cp / b.ce) * 100) / 100 : null,
      credits: b.ce,
      credit_points: b.cp,
      courses: b.n,
    }
  }

  return {
    cgpa,
    label: cgpa != null ? cgpa.toFixed(2) : null,
    credits_earned,
    credit_points,
    courses_counted,
    courses_excluded,
    provisional: !!opts?.provisional,
    by_semester,
  }
}

export function creditsMapFromCurriculum(subjects: CurriculumSubject[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of subjects) {
    m.set(s.code.toUpperCase(), defaultSubjectCredits(s))
  }
  return m
}
