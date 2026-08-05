/**
 * DTE Karnataka diploma academic-year helpers.
 * 3 academic years (I / II / III), hybrid auto-progress + detention / year-back / pass-out.
 */

export type StudyYear = 1 | 2 | 3
export type AcademicStatus = "active" | "detained" | "year_back" | "passed_out"
export type EntryType = "regular" | "lateral"

export type AcademicSnapshot = {
  admission_academic_year: string | null
  entry_type: EntryType
  entry_study_year: StudyYear
  current_study_year: StudyYear | null
  academic_status: AcademicStatus
  progress_locked: boolean
  pass_out_academic_year: string | null
  year_label: string
  needs_admission_year_review: boolean
}

export const STUDY_YEAR_LABELS: Record<StudyYear, string> = {
  1: "1st Year",
  2: "2nd Year",
  3: "3rd Year",
}

/** Default academic year start month (June) — DTE session style. */
export const DEFAULT_ACADEMIC_START_MONTH = 6

/** Normalize free text to `YYYY-YY` (e.g. 2026-27). */
export function normalizeAcademicYear(input: string | null | undefined): string | null {
  if (input == null) return null
  const raw = String(input).trim()
  if (!raw || raw === "—" || raw === "-") return null

  // 2026-27 / 2026–27 / 2026/27
  let m = raw.match(/^(20\d{2})\s*[-–—/]\s*(\d{2}|\d{4})$/)
  if (m) {
    const start = Number(m[1])
    let endTwo = m[2]
    if (endTwo.length === 4) endTwo = endTwo.slice(2)
    const expected = String((start + 1) % 100).padStart(2, "0")
    // Prefer canonical next-year suffix even if mistyped slightly
    return `${start}-${endTwo.length === 2 ? endTwo : expected}`
  }

  // Single year 2026 → 2026-27
  m = raw.match(/^(20\d{2})$/)
  if (m) {
    const start = Number(m[1])
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
  }

  return null
}

export function academicYearStart(ay: string): number | null {
  const n = normalizeAcademicYear(ay)
  if (!n) return null
  const y = Number(n.slice(0, 4))
  return Number.isFinite(y) ? y : null
}

export function academicYearOffset(admissionAy: string, activeAy: string): number | null {
  const a = academicYearStart(admissionAy)
  const b = academicYearStart(activeAy)
  if (a == null || b == null) return null
  return b - a
}

/** Infer current academic year label from calendar date (June start). */
export function inferAcademicYearFromDate(
  d: Date = new Date(),
  startMonth = DEFAULT_ACADEMIC_START_MONTH,
): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1 // 1-12
  const start = m >= startMonth ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
}

/**
 * DTE diploma term parity from calendar:
 * - June–December → odd semester term (Sem 1 / 3 / 5)
 * - January–May → even semester term (Sem 2 / 4 / 6)
 *
 * Academic year still flips in June (see inferAcademicYearFromDate).
 * Example: Jun 2026–Dec 2026 = AY 2026-27 odd; Jan 2027–May 2027 = AY 2026-27 even.
 */
export type TermParity = "odd" | "even"

export function inferTermParityFromDate(d: Date = new Date()): TermParity {
  const m = d.getMonth() + 1 // 1–12
  return m >= DEFAULT_ACADEMIC_START_MONTH ? "odd" : "even"
}

export function termParityLabel(parity: TermParity): string {
  return parity === "odd" ? "Odd semester (Jun–Dec)" : "Even semester (Jan–May)"
}

/**
 * Map study year + term → running semester (1–6).
 * Year 1 → 1/2 · Year 2 → 3/4 · Year 3 → 5/6
 */
export function semesterFromStudyYearAndTerm(
  studyYear: number | null | undefined,
  parity: TermParity = inferTermParityFromDate(),
): number | null {
  const y = Number(studyYear)
  if (y !== 1 && y !== 2 && y !== 3) return null
  return parity === "odd" ? 2 * y - 1 : 2 * y
}

/** Current running semester for a student (calendar + their study year). */
export function inferCurrentSemester(
  studyYear: number | null | undefined,
  d: Date = new Date(),
): number | null {
  return semesterFromStudyYearAndTerm(studyYear, inferTermParityFromDate(d))
}

export function parseStudyYear(input: string | number | null | undefined): StudyYear | null {
  if (input == null || input === "") return null
  if (typeof input === "number") {
    if (input === 1 || input === 2 || input === 3) return input
    return null
  }
  const s = String(input).toUpperCase().replace(/\s+/g, " ").trim()
  if (!s || s === "—" || s === "-") return null
  if (/ALUMNI|PASSED\s*OUT|PASS\s*OUT|COMPLETED/.test(s)) return null

  // Longest first so III ≠ I
  if (/\bIII\b/.test(s) || s === "III" || s.includes("3RD") || s.includes("THIRD") || /^3\b/.test(s)) {
    return 3
  }
  if (/\bII\b/.test(s) || s === "II" || s.includes("2ND") || s.includes("SECOND") || /^2\b/.test(s)) {
    return 2
  }
  if (/\bI\b/.test(s) || s === "I" || s.includes("1ST") || s.includes("FIRST") || /^1\b/.test(s)) {
    return 1
  }
  if (s.includes("III") || s.includes("3")) return 3
  if (s.includes("II") || s.includes("2")) return 2
  if (s.includes("I") || s.includes("1")) return 1
  return null
}

export function studyYearLabel(y: StudyYear | null, status?: AcademicStatus | null): string {
  if (status === "passed_out") return "Alumni"
  if (y === 1 || y === 2 || y === 3) return STUDY_YEAR_LABELS[y]
  return "—"
}

export function parseAcademicStatus(input: string | null | undefined): AcademicStatus {
  const s = String(input || "")
    .toLowerCase()
    .trim()
  if (s === "detained" || s === "detain") return "detained"
  if (s === "year_back" || s === "yearback" || s === "year back") return "year_back"
  if (s === "passed_out" || s === "pass_out" || s === "alumni" || s === "passed out") return "passed_out"
  return "active"
}

/**
 * GPT Hubli / DTE diploma register number:
 *   171  + branch(2–4) + YY + roll
 * Example: 171CS15003 → college 171, CS, admitted 2015-16, roll 003
 *
 * Lateral markers in roll (3-digit tail):
 *   300–399  → ITI lateral entry (often 301…)
 *   700–799  → PUC lateral entry (often 702…)
 */
export type ParsedDiplomaReg = {
  college_code: string
  branch_code: string
  admission_yy: number
  admission_academic_year: string
  roll: number
  roll_raw: string
  entry_type: EntryType
  entry_study_year: StudyYear
  entry_source: "regular" | "lateral_puc" | "lateral_iti" | "unknown"
}

const BRANCH_CODE_MAP: Record<string, string> = {
  CE: "Civil Engineering",
  CS: "Computer Science and Engineering",
  CSE: "Computer Science and Engineering",
  EC: "Electronics and Communication Engineering",
  ECE: "Electronics and Communication Engineering",
  ME: "Mechanical Engineering",
  MECH: "Mechanical Engineering",
}

export function branchFromRegCode(code: string | null | undefined): string | null {
  if (!code) return null
  return BRANCH_CODE_MAP[String(code).toUpperCase()] || null
}

export function parseDiplomaReg(regNo: string | null | undefined): ParsedDiplomaReg | null {
  if (!regNo) return null
  const u = String(regNo).toUpperCase().replace(/[^A-Z0-9]/g, "")
  // 171 + branch + YY + roll (roll usually 3 digits; allow 3–4)
  const m = u.match(/^(171)([A-Z]{2,4})(\d{2})(\d{3,4})$/)
  if (!m) return null
  const college_code = m[1]
  const branch_code = m[2]
  const admission_yy = Number(m[3])
  const roll_raw = m[4]
  const roll = Number(roll_raw)
  if (!Number.isFinite(admission_yy) || admission_yy < 10 || admission_yy > 40) return null
  if (!Number.isFinite(roll)) return null

  const start = 2000 + admission_yy
  const admission_academic_year = `${start}-${String((start + 1) % 100).padStart(2, "0")}`

  // Lateral by roll band (DTE practice at this polytechnic)
  let entry_type: EntryType = "regular"
  let entry_study_year: StudyYear = 1
  let entry_source: ParsedDiplomaReg["entry_source"] = "regular"
  if (roll >= 700 && roll <= 799) {
    // PUC lateral — enter 2nd year
    entry_type = "lateral"
    entry_study_year = 2
    entry_source = "lateral_puc"
  } else if (roll >= 300 && roll <= 399) {
    // ITI lateral — enter 2nd year
    entry_type = "lateral"
    entry_study_year = 2
    entry_source = "lateral_iti"
  }

  return {
    college_code,
    branch_code,
    admission_yy,
    admission_academic_year,
    roll,
    roll_raw,
    entry_type,
    entry_study_year,
    entry_source,
  }
}

/** Guess admission academic year from diploma reg no (see parseDiplomaReg). */
export function guessAdmissionYearFromReg(regNo: string | null | undefined): string | null {
  const parsed = parseDiplomaReg(regNo)
  if (parsed) return parsed.admission_academic_year

  // Fallback: first 20xx in string
  const m = String(regNo || "").match(/(20\d{2})/)
  if (m) {
    const start = Number(m[1])
    if (start >= 2010 && start <= 2040) {
      return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
    }
  }
  return null
}

/** Force bare years / aliases to YYYY-YY only. */
export function canonicalizeAcademicYearLabel(input: string | null | undefined): string | null {
  const n = normalizeAcademicYear(input)
  if (n) return n
  if (!input) return null
  // "2025" already handled by normalize; reject garbage
  return null
}

export type ProgressInput = {
  admission_academic_year: string | null
  entry_type?: EntryType | null
  entry_study_year?: StudyYear | null
  current_study_year?: StudyYear | null
  academic_status?: AcademicStatus | null
  progress_locked?: boolean | null
  pass_out_academic_year?: string | null
  /** Existing display year for inference */
  year_label_hint?: string | null
}

export type ProgressResult = {
  current_study_year: StudyYear | null
  academic_status: AcademicStatus
  progress_locked: boolean
  pass_out_academic_year: string | null
  year_label: string
  changed: boolean
  reason: string
}

/**
 * Hybrid auto-progress for one student against the institute active academic year.
 * Locked (detained / year_back) students are not advanced.
 */
export function computeProgression(
  input: ProgressInput,
  activeAcademicYear: string,
): ProgressResult {
  const active = normalizeAcademicYear(activeAcademicYear) || activeAcademicYear
  const admission = normalizeAcademicYear(input.admission_academic_year)
  const status = input.academic_status || "active"
  const locked = !!input.progress_locked || status === "detained" || status === "year_back"
  const entryYear: StudyYear = input.entry_study_year === 2 || input.entry_study_year === 3
    ? input.entry_study_year
    : 1

  let current: StudyYear | null =
    input.current_study_year === 1 || input.current_study_year === 2 || input.current_study_year === 3
      ? input.current_study_year
      : parseStudyYear(input.year_label_hint)

  // Already passed out — stable
  if (status === "passed_out") {
    return {
      current_study_year: current ?? 3,
      academic_status: "passed_out",
      progress_locked: false,
      pass_out_academic_year:
        normalizeAcademicYear(input.pass_out_academic_year) ||
        input.pass_out_academic_year ||
        null,
      year_label: "Alumni",
      changed: false,
      reason: "already_passed_out",
    }
  }

  // Detention / year-back: freeze
  if (locked) {
    const frozen = current ?? entryYear
    return {
      current_study_year: frozen,
      academic_status: status === "year_back" ? "year_back" : status === "detained" ? "detained" : "detained",
      progress_locked: true,
      pass_out_academic_year: input.pass_out_academic_year || null,
      year_label: studyYearLabel(frozen, status),
      changed: false,
      reason: "progress_locked",
    }
  }

  if (!admission) {
    // No admission year — keep current year label, mark needs review externally
    const y = current ?? entryYear
    return {
      current_study_year: y,
      academic_status: "active",
      progress_locked: false,
      pass_out_academic_year: null,
      year_label: studyYearLabel(y, "active"),
      changed: false,
      reason: "missing_admission_year",
    }
  }

  const offset = academicYearOffset(admission, active)
  if (offset == null) {
    const y = current ?? entryYear
    return {
      current_study_year: y,
      academic_status: "active",
      progress_locked: false,
      pass_out_academic_year: null,
      year_label: studyYearLabel(y, "active"),
      changed: false,
      reason: "invalid_years",
    }
  }

  // Before admission year → treat as 1st (data error edge)
  if (offset < 0) {
    const next: ProgressResult = {
      current_study_year: entryYear,
      academic_status: "active",
      progress_locked: false,
      pass_out_academic_year: null,
      year_label: studyYearLabel(entryYear, "active"),
      changed: current !== entryYear || status !== "active",
      reason: "before_admission",
    }
    return next
  }

  const computed = entryYear + offset

  if (computed >= 4) {
    return {
      current_study_year: 3,
      academic_status: "passed_out",
      progress_locked: false,
      pass_out_academic_year:
        normalizeAcademicYear(input.pass_out_academic_year) ||
        // Pass-out academic year ≈ last year of study = admission + (3 - entry)
        (() => {
          const start = academicYearStart(admission)
          if (start == null) return active
          const last = start + (3 - entryYear)
          return `${last}-${String((last + 1) % 100).padStart(2, "0")}`
        })(),
      year_label: "Alumni",
      changed: status !== "passed_out",
      reason: "auto_alumni",
    }
  }

  const study = Math.min(3, Math.max(1, computed)) as StudyYear
  const changed =
    current !== study || status !== "active" || !!input.progress_locked

  return {
    current_study_year: study,
    academic_status: "active",
    progress_locked: false,
    pass_out_academic_year: null,
    year_label: studyYearLabel(study, "active"),
    changed,
    reason: "auto_progress",
  }
}

export function asAcademicPayload(row: {
  admission_academic_year?: string | null
  entry_type?: string | null
  entry_study_year?: number | string | null
  current_study_year?: number | string | null
  academic_status?: string | null
  progress_locked?: boolean | null
  pass_out_academic_year?: string | null
  year?: string | null
  needs_admission_year_review?: boolean | null
}): AcademicSnapshot {
  const entryRaw = Number(row.entry_study_year)
  const entry_study_year: StudyYear =
    entryRaw === 2 || entryRaw === 3 ? (entryRaw as StudyYear) : 1
  const cur = parseStudyYear(row.current_study_year ?? row.year)
  const status = parseAcademicStatus(row.academic_status)
  return {
    admission_academic_year: normalizeAcademicYear(row.admission_academic_year) || row.admission_academic_year || null,
    entry_type: row.entry_type === "lateral" ? "lateral" : "regular",
    entry_study_year,
    current_study_year: cur,
    academic_status: status,
    progress_locked: !!row.progress_locked,
    pass_out_academic_year:
      normalizeAcademicYear(row.pass_out_academic_year) || row.pass_out_academic_year || null,
    year_label: studyYearLabel(cur, status),
    needs_admission_year_review: !!row.needs_admission_year_review,
  }
}
