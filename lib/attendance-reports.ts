/**
 * DTE-style attendance eligibility + aggregation helpers.
 *
 * Rules (GPT Hubli default):
 *  - ≥ 75%  → Eligible (auto)
 *  - < 75%  → HOD decision required (condonation / not eligible)
 *  - ≤ 65%  → Critical shortage (still HOD decides, flagged strongly)
 *
 * Counts use multi-period units (period_count): Present units / Held units.
 */

import {
  inferAcademicYearFromDate,
  inferTermParityFromDate,
  parseStudyYear,
  semesterFromStudyYearAndTerm,
  type TermParity,
} from "@/lib/academic-year"

export const ATT_MIN_ELIGIBLE = 75
export const ATT_CRITICAL_MAX = 65

export type AttEligibilityBand = "eligible" | "hod_decision" | "critical"

export type AttStatusCounts = {
  held: number
  present: number
  absent: number
  percent: number | null
  band: AttEligibilityBand
  band_label: string
}

export function periodWeight(period_count: unknown): number {
  const n = Number(period_count)
  if (Number.isFinite(n) && n >= 1) return Math.min(12, Math.floor(n))
  return 1
}

export function percentOf(present: number, held: number): number | null {
  if (!held || held <= 0) return null
  return Math.round((present / held) * 1000) / 10
}

export function eligibilityBand(pct: number | null): AttEligibilityBand {
  if (pct == null) return "hod_decision"
  if (pct >= ATT_MIN_ELIGIBLE) return "eligible"
  if (pct <= ATT_CRITICAL_MAX) return "critical"
  return "hod_decision"
}

export function bandLabel(band: AttEligibilityBand): string {
  if (band === "eligible") return `Eligible (≥${ATT_MIN_ELIGIBLE}%)`
  if (band === "critical") return `Critical (≤${ATT_CRITICAL_MAX}%) — HOD decides`
  return `Below ${ATT_MIN_ELIGIBLE}% — HOD decides`
}

export function statusFromCounts(held: number, present: number): AttStatusCounts {
  const absent = Math.max(0, held - present)
  const percent = percentOf(present, held)
  const band = eligibilityBand(percent)
  return {
    held,
    present,
    absent,
    percent,
    band,
    band_label: bandLabel(band),
  }
}

export function parseLocalDate(input: string | Date | null | undefined): Date {
  if (input instanceof Date && !isNaN(input.getTime())) return input
  const s = String(input || "").trim()
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date()
}

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Monday 00:00 of the week containing d (local). */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay() // 0 Sun
  const diff = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + diff)
  return x
}

export function endOfWeek(d: Date): Date {
  const s = startOfWeek(d)
  const e = new Date(s)
  e.setDate(e.getDate() + 6)
  return e
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

/** Infer diploma semester (1–6) from study year label + session date. */
export function semesterForSession(
  yearLabel: string | null | undefined,
  attDate: string | Date | null | undefined,
): number | null {
  const studyY = parseStudyYear(yearLabel)
  if (!studyY) return null
  const d = parseLocalDate(attDate)
  const parity: TermParity = inferTermParityFromDate(d)
  return semesterFromStudyYearAndTerm(studyY, parity)
}

export function academicYearForDate(attDate: string | Date | null | undefined): string {
  return inferAcademicYearFromDate(parseLocalDate(attDate))
}

export type RawAttSession = {
  id?: number | string
  att_date: string | Date
  branch?: string | null
  subject?: string | null
  year_label?: string | null
  year?: string | null
  entries?: unknown
  period_count?: unknown
  session_status?: string | null
  att_time?: string | null
}

export type NormalizedEntry = {
  reg: string
  name?: string
  status: "P" | "A" | "W" | string
}

export function normalizeEntries(raw: unknown): NormalizedEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => {
      const row = e as Record<string, unknown>
      const reg = String(row.reg || row.reg_no || "")
        .trim()
        .toUpperCase()
      if (!reg) return null
      let status = String(row.status || "")
        .trim()
        .toUpperCase()
      if (!status) {
        if (row.present === true) status = "P"
        else if (row.present === false) status = "A"
        else status = "A"
      }
      if (status === "PRESENT") status = "P"
      if (status === "ABSENT") status = "A"
      if (status === "WAIT") status = "W"
      if (!["P", "A", "W"].includes(status)) status = "A"
      return {
        reg,
        name: row.name != null ? String(row.name) : undefined,
        status,
      }
    })
    .filter(Boolean) as NormalizedEntry[]
}

export type StudentSubjectAgg = {
  reg: string
  name: string
  subject: string
  semester: number | null
  year_label: string | null
  held: number
  present: number
  absent: number
  percent: number | null
  band: AttEligibilityBand
  band_label: string
}

export type StudentSemAgg = {
  reg: string
  name: string
  semester: number | null
  year_label: string | null
  held: number
  present: number
  absent: number
  percent: number | null
  band: AttEligibilityBand
  band_label: string
  by_subject: StudentSubjectAgg[]
}

export type StudentOverallAgg = {
  reg: string
  name: string
  year_label: string | null
  held: number
  present: number
  absent: number
  percent: number | null
  band: AttEligibilityBand
  band_label: string
  by_semester: StudentSemAgg[]
  by_subject: StudentSubjectAgg[]
}

/** Aggregate active sessions into per-student overall / subject / semester stats. */
export function aggregateAttendance(
  sessions: RawAttSession[],
  opts?: { from?: string | null; to?: string | null },
): {
  students: StudentOverallAgg[]
  subjects: { subject: string; held_units: number; student_count: number }[]
  kpis: {
    sessions: number
    students: number
    eligible: number
    hod_decision: number
    critical: number
    avg_percent: number | null
  }
} {
  const from = opts?.from ? parseLocalDate(opts.from) : null
  const to = opts?.to ? parseLocalDate(opts.to) : null

  type Acc = {
    name: string
    year_label: string | null
    held: number
    present: number
    subjects: Map<string, { held: number; present: number; semester: number | null; year_label: string | null }>
    semesters: Map<number, { held: number; present: number; year_label: string | null; subjects: Map<string, { held: number; present: number }> }>
  }

  const byReg = new Map<string, Acc>()
  const subjectHeld = new Map<string, number>()
  let sessionCount = 0

  for (const s of sessions) {
    if (String(s.session_status || "active") === "cancelled") continue
    const d = parseLocalDate(s.att_date)
    if (from && d < from) continue
    if (to && d > to) continue
    sessionCount++

    const w = periodWeight(s.period_count)
    const subject = String(s.subject || "—").trim() || "—"
    const yearLabel = String(s.year_label || s.year || "").trim() || null
    const sem = semesterForSession(yearLabel, s.att_date)
    subjectHeld.set(subject, (subjectHeld.get(subject) || 0) + w)

    const entries = normalizeEntries(s.entries)
    for (const e of entries) {
      if (e.status === "W") continue // incomplete wait — not counted
      if (e.status !== "P" && e.status !== "A") continue

      let acc = byReg.get(e.reg)
      if (!acc) {
        acc = {
          name: e.name || e.reg,
          year_label: yearLabel,
          held: 0,
          present: 0,
          subjects: new Map(),
          semesters: new Map(),
        }
        byReg.set(e.reg, acc)
      }
      if (e.name) acc.name = e.name
      if (yearLabel) acc.year_label = yearLabel

      acc.held += w
      if (e.status === "P") acc.present += w

      let sub = acc.subjects.get(subject)
      if (!sub) {
        sub = { held: 0, present: 0, semester: sem, year_label: yearLabel }
        acc.subjects.set(subject, sub)
      }
      sub.held += w
      if (e.status === "P") sub.present += w
      if (sem != null) sub.semester = sem

      if (sem != null) {
        let sm = acc.semesters.get(sem)
        if (!sm) {
          sm = { held: 0, present: 0, year_label: yearLabel, subjects: new Map() }
          acc.semesters.set(sem, sm)
        }
        sm.held += w
        if (e.status === "P") sm.present += w
        let ss = sm.subjects.get(subject)
        if (!ss) {
          ss = { held: 0, present: 0 }
          sm.subjects.set(subject, ss)
        }
        ss.held += w
        if (e.status === "P") ss.present += w
      }
    }
  }

  const students: StudentOverallAgg[] = []
  for (const [reg, acc] of byReg) {
    const overall = statusFromCounts(acc.held, acc.present)
    const by_subject: StudentSubjectAgg[] = []
    for (const [subject, sub] of acc.subjects) {
      const st = statusFromCounts(sub.held, sub.present)
      by_subject.push({
        reg,
        name: acc.name,
        subject,
        semester: sub.semester,
        year_label: sub.year_label,
        ...st,
      })
    }
    by_subject.sort((a, b) => a.subject.localeCompare(b.subject))

    const by_semester: StudentSemAgg[] = []
    for (const [semester, sm] of acc.semesters) {
      const st = statusFromCounts(sm.held, sm.present)
      const subList: StudentSubjectAgg[] = []
      for (const [subject, ss] of sm.subjects) {
        const sst = statusFromCounts(ss.held, ss.present)
        subList.push({
          reg,
          name: acc.name,
          subject,
          semester,
          year_label: sm.year_label,
          ...sst,
        })
      }
      subList.sort((a, b) => a.subject.localeCompare(b.subject))
      by_semester.push({
        reg,
        name: acc.name,
        semester,
        year_label: sm.year_label,
        ...st,
        by_subject: subList,
      })
    }
    by_semester.sort((a, b) => (a.semester || 0) - (b.semester || 0))

    students.push({
      reg,
      name: acc.name,
      year_label: acc.year_label,
      ...overall,
      by_semester,
      by_subject,
    })
  }

  students.sort((a, b) => {
    // Critical first, then hod_decision, then by % ascending
    const order = { critical: 0, hod_decision: 1, eligible: 2 }
    const oa = order[a.band]
    const ob = order[b.band]
    if (oa !== ob) return oa - ob
    const pa = a.percent ?? -1
    const pb = b.percent ?? -1
    if (pa !== pb) return pa - pb
    return a.name.localeCompare(b.name)
  })

  const subjects = [...subjectHeld.entries()]
    .map(([subject, held_units]) => ({
      subject,
      held_units,
      student_count: students.filter((s) => s.by_subject.some((x) => x.subject === subject)).length,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject))

  let eligible = 0
  let hod_decision = 0
  let critical = 0
  let pctSum = 0
  let pctN = 0
  for (const s of students) {
    if (s.band === "eligible") eligible++
    else if (s.band === "critical") critical++
    else hod_decision++
    if (s.percent != null) {
      pctSum += s.percent
      pctN++
    }
  }

  return {
    students,
    subjects,
    kpis: {
      sessions: sessionCount,
      students: students.length,
      eligible,
      hod_decision,
      critical,
      avg_percent: pctN ? Math.round((pctSum / pctN) * 10) / 10 : null,
    },
  }
}
