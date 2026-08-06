/**
 * C-20 diploma curriculum subjects by branch (DTE Karnataka).
 * Only branch-relevant subjects are returned for a student.
 * C-25 (admission 2025-26+): subjects NOT loaded yet — empty until official key list is confirmed.
 */

import { inferAcademicYearFromDate } from "./academic-year"

export type CurriculumSubject = {
  code: string
  name: string
  semester: number
  is_audit?: boolean
  pathway?: "specialization" | "research" | "entrepreneurship" | null
  /** Lateral (ITI/PUC) students typically skip year-1; still list for reference if needed */
  year1_only?: boolean
}

export type BranchCode = "CE" | "CSE" | "ECE" | "ME"

const SHARED_Y1_BASE: Omit<CurriculumSubject, "semester">[] = [
  { code: "20SC01T", name: "Engineering Mathematics" },
  { code: "20SC02P", name: "Statistics and Analytics" },
  { code: "20EG01P", name: "Communication Skills" },
  { code: "20CS01P", name: "IT Skills" },
  { code: "20AU01T", name: "Environmental Sustainability", year1_only: true },
]

function s(
  semester: number,
  code: string,
  name: string,
  extra: Partial<CurriculumSubject> = {},
): CurriculumSubject {
  return { code, name, semester, pathway: null, ...extra }
}

/** Branch-wise C-20 subjects (semesters 1–6). Elective pathways listed as choose-one options. */
export const C20_BY_BRANCH: Record<BranchCode, CurriculumSubject[]> = {
  // CE Sem 1–4 from BTE Provisional Marks Cards (reg 171CE24041, Hubballi)
  CE: [
    // --- Semester I (Nov/Dec) ---
    s(1, "20CE11T", "Construction Materials", { year1_only: true }),
    s(1, "20EG01P", "Communication Skills", { year1_only: true }),
    s(1, "20SC02P", "Statistics and Analytics", { year1_only: true }),
    s(1, "20CS01P", "IT Skills", { year1_only: true }),
    s(1, "20AU01T", "Environmental Sustainability", { year1_only: true, is_audit: true }),
    // --- Semester II (Apr/May) ---
    s(2, "20SC01T", "Engineering Mathematics", { year1_only: true }),
    s(2, "20PM01T", "Project Management Skills", { year1_only: true }),
    s(2, "20CE21P", "Civil Engineering Graphics", { year1_only: true }),
    s(2, "20CE22P", "Basic Surveying", { year1_only: true }),
    s(2, "20EE01P", "Fundamentals of Electrical & Electronics Engg", { year1_only: true }),
    s(2, "20KA21T", "Sahithya Sinchana-1 / Balake Kannada-1", { is_audit: true, year1_only: true }),
    // --- Semester III ---
    s(3, "20CE31P", "Engineering Mechanics & Strength of Materials"),
    s(3, "20CE32P", "Modern Surveying"),
    s(3, "20CE33P", "Construction Techniques"),
    s(3, "20CE34P", "Building Drawing using CADD"),
    s(3, "20KA31T", "Sahithya Sinchana-2 / Balake Kannada-2", { is_audit: true }),
    // --- Semester IV ---
    s(4, "20CE41P", "Concrete Technology"),
    s(4, "20CE42P", "Building Estimating & Valuation"),
    s(4, "20CE43P", "Site Management"),
    s(4, "20CE44P", "Design & Detailing of RCC Structures"),
    s(4, "20CE45T", "Indian Constitution", { is_audit: true }),
    // --- Semester V–VI pathways ---
    s(5, "20CE51I", "Structural Engineering", { pathway: "specialization" }),
    s(5, "20CE52I", "Town Planning and Green Building", { pathway: "specialization" }),
    s(5, "20CE53I", "Transportation Engineering", { pathway: "specialization" }),
    s(5, "20CE54I", "Built Environment", { pathway: "specialization" }),
    s(5, "20SC51T", "Paper 1 – Applied Mathematics", { pathway: "research" }),
    s(5, "20SC52T", "Paper 2 – Applied Science", { pathway: "research" }),
    s(5, "20RM53T", "Paper 3 – Research Methodology", { pathway: "research" }),
    s(5, "20TW54P", "Paper 4 – Technical Writing", { pathway: "research" }),
    s(5, "20ET51I", "Entrepreneurship and Start-up", { pathway: "entrepreneurship" }),
    s(6, "20CE61S", "Specialisation pathway – Internship / Project", { pathway: "specialization" }),
    s(6, "20CE61R", "Science and Research Pathway – Research Project", { pathway: "research" }),
    s(6, "20CE61E", "Entrepreneurship pathway – MVP / Incubation", { pathway: "entrepreneurship" }),
  ],
  // CSE Sem 1–4 from official BTE Provisional Marks Cards (C-20)
  // Sem 5–6 remain pathway-based (HOD assigns per academic year)
  CSE: [
    // --- Semester I (Nov/Dec session subjects) ---
    s(1, "20SC01T", "Engineering Mathematics", { year1_only: true }),
    s(1, "20CS11T", "Fundamentals of Computer", { year1_only: true }),
    s(1, "20EC01P", "Fundamentals of Electrical & Electronics Engg", { year1_only: true }),
    s(1, "20CS01P", "IT Skills", { year1_only: true }),
    s(1, "20AU01T", "Environmental Sustainability", { year1_only: true }),
    // --- Semester II (Apr/May session subjects) ---
    s(2, "20PM01T", "Project Management Skills", { year1_only: true }),
    s(2, "20SC02P", "Statistics and Analytics", { year1_only: true }),
    s(2, "20EG01P", "Communication Skills", { year1_only: true }),
    s(2, "20ME02P", "Computer Aided Engineering Graphics", { year1_only: true }),
    s(2, "20CS21P", "Multimedia & Animation", { year1_only: true }),
    s(2, "20KA21T", "Sahithya Sinchana-1 / Balake Kannada-1", { is_audit: true, year1_only: true }),
    // --- Semester III ---
    s(3, "20CS31P", "Python Programming"),
    s(3, "20CS32P", "Computer Hardware, Maintenance & Administration"),
    s(3, "20CS33P", "Computer Networks"),
    s(3, "20CS34P", "Database System Concepts & PL/SQL"),
    s(3, "20KA31T", "Sahithya Sinchana-2 / Balake Kannada-2", { is_audit: true }),
    // --- Semester IV ---
    s(4, "20CS41P", "Data Structures with Python"),
    s(4, "20CS42P", "Operating System & Administration"),
    s(4, "20CS43P", "Object Oriented Programming & Design with Java"),
    s(4, "20CS44P", "Software Engineering Principles & Practices"),
    s(4, "20CS45T", "Indian Constitution", { is_audit: true }),
    // --- Semester V pathways (HOD offers / assigns each AY) ---
    s(5, "20CS51I", "Artificial Intelligence and Machine Learning", { pathway: "specialization" }),
    s(5, "20CS52I", "Full Stack Development", { pathway: "specialization" }),
    s(5, "20CS53I", "Cloud Computing", { pathway: "specialization" }),
    s(5, "20CS54I", "Cyber Security", { pathway: "specialization" }),
    s(5, "20SC51T", "Paper 1 – Applied Mathematics", { pathway: "research" }),
    s(5, "20SC52T", "Paper 2 – Applied Science", { pathway: "research" }),
    s(5, "20RM53T", "Paper 3 – Research Methodology", { pathway: "research" }),
    s(5, "20TW54P", "Paper 4 – Technical Writing", { pathway: "research" }),
    s(5, "20ET51I", "Entrepreneurship and Start-up", { pathway: "entrepreneurship" }),
    // --- Semester VI pathways ---
    s(6, "20CS61S", "Specialisation pathway – Internship / Project", { pathway: "specialization" }),
    s(6, "20CS61R", "Science and Research Pathway – Research Project", { pathway: "research" }),
    s(6, "20CS61E", "Entrepreneurship pathway – MVP / Incubation", { pathway: "entrepreneurship" }),
  ],
  ECE: [
    s(1, "20EC11T", "Digital Electronics", { year1_only: true }),
    ...SHARED_Y1_BASE.map((x) => s(1, x.code, x.name, { year1_only: true })),
    s(1, "20EC01P", "Fundamentals of Electrical & Electronics Engineering", { year1_only: true }),
    s(1, "20ME02P", "Computer Aided Engineering Graphics", { year1_only: true }),
    s(2, "20EC21P", "Electronics Components and Devices (ECD)", { year1_only: true }),
    s(2, "20PM01T", "Project Management Skills", { year1_only: true }),
    s(2, "20KA21T", "Sahitya Sinchana / Balake Kannada", { is_audit: true, year1_only: true }),
    s(3, "20EC31P", "Analog Electronics"),
    s(3, "20EC32P", "Logic Design using Verilog"),
    s(3, "20EC33P", "Communication Systems"),
    s(3, "20EC34P", "Electronic Measurements and Testing Techniques"),
    s(3, "20KA31T", "Sahitya Sinchana-II / Balake Kannada-II", { is_audit: true }),
    s(4, "20EC41P", "PCB Design & Fabrication"),
    s(4, "20EC42P", "Wireless Communication"),
    s(4, "20EC43P", "Embedded C Programming"),
    s(4, "20EC44P", "Industrial Automation"),
    s(4, "20EC45T", "Indian Constitution", { is_audit: true }),
    s(5, "20EC51I", "Drone Technologies", { pathway: "specialization" }),
    s(5, "20EC52I", "Industrial Internet of Things (IIoT)", { pathway: "specialization" }),
    s(5, "20EC53I", "Automation & Robotics", { pathway: "specialization" }),
    s(5, "20EC54I", "E-Mobility", { pathway: "specialization" }),
    s(5, "20SC51T", "Paper 1 – Applied Mathematics", { pathway: "research" }),
    s(5, "20SC52T", "Paper 2 – Applied Science", { pathway: "research" }),
    s(5, "20RM53T", "Paper 3 – Research Methodology", { pathway: "research" }),
    s(5, "20TW54P", "Paper 4 – Technical Writing", { pathway: "research" }),
    s(5, "20ET51I", "Entrepreneurship and Start-up", { pathway: "entrepreneurship" }),
    s(6, "20EC61S", "Specialisation pathway – Internship / Project", { pathway: "specialization" }),
    s(6, "20EC61R", "Science and Research Pathway – Research Project", { pathway: "research" }),
    s(6, "20EC61E", "Entrepreneurship pathway – MVP / Incubation", { pathway: "entrepreneurship" }),
  ],
  ME: [
    s(1, "20ME11T", "Materials for Engineering", { year1_only: true }),
    ...SHARED_Y1_BASE.map((x) => s(1, x.code, x.name, { year1_only: true })),
    s(1, "20EE01P", "Fundamentals of Electrical & Electronics Engineering", { year1_only: true }),
    s(1, "20ME12P", "Computer Aided Engineering Drawing", { year1_only: true }),
    s(2, "20ME21P", "Mechanical Workshop Practice-I", { year1_only: true }),
    s(2, "20PM01T", "Project Management Skills", { year1_only: true }),
    s(2, "20KA21T", "Sahitya Sinchana / Balake Kannada", { is_audit: true, year1_only: true }),
    s(3, "20ME31P", "Mechanics of Materials"),
    s(3, "20ME32P", "Machine Tool Technology"),
    s(3, "20ME33P", "Manufacturing Processes"),
    s(3, "20ME34P", "Fluid Power Engineering"),
    s(3, "20KA31T", "Sahitya Sinchana-II / Balake Kannada-II", { is_audit: true }),
    s(4, "20ME41P", "Operations Management"),
    s(4, "20ME42P", "CNC Programming and Machining"),
    s(4, "20ME43P", "Product Design and Development"),
    s(4, "20ME44P", "Elements of Industrial Automation"),
    s(4, "20ME45T", "Indian Constitution", { is_audit: true }),
    s(5, "20ME51I", "Automation and Robotics", { pathway: "specialization" }),
    s(5, "20ME52I", "Heating, Ventilation and Air Conditioning (HVAC)", { pathway: "specialization" }),
    s(5, "20ME53I", "Advanced Manufacturing Technologies", { pathway: "specialization" }),
    s(5, "20ME54I", "E-Mobility", { pathway: "specialization" }),
    s(5, "20SC51T", "Paper 1 – Applied Mathematics", { pathway: "research" }),
    s(5, "20SC52T", "Paper 2 – Applied Science", { pathway: "research" }),
    s(5, "20RM53T", "Paper 3 – Research Methodology", { pathway: "research" }),
    s(5, "20TW54P", "Paper 4 – Technical Writing", { pathway: "research" }),
    s(5, "20ET51I", "Entrepreneurship and Start-up", { pathway: "entrepreneurship" }),
    s(6, "20ME61S", "Specialisation pathway – Internship / Project", { pathway: "specialization" }),
    s(6, "20ME61R", "Science and Research Pathway – Research Project", { pathway: "research" }),
    s(6, "20ME61E", "Entrepreneurship pathway – MVP / Incubation", { pathway: "entrepreneurship" }),
  ],
}

export function branchCodeFromDept(dept: string | null | undefined): BranchCode | null {
  const d = String(dept || "").toLowerCase()
  if (!d || d === "—" || d === "-") return null
  if (d.includes("computer") || d.includes("cse") || /\bcs\b/.test(d)) return "CSE"
  if (d.includes("civil")) return "CE"
  if (d.includes("electron") || d.includes("ece") || d.includes("e&c") || d.includes("e and c")) return "ECE"
  if (d.includes("mech")) return "ME"
  return null
}

/**
 * Syllabus scheme from admission academic year:
 * 2020-21 … 2024-25 → C-20
 * 2025-26 onwards → C-25
 *
 * As of AY 2026-27: I & II Year are C-25; only final year (III) is still C-20.
 * From AY 2027-28, III Year also becomes C-25 (admission 2025-26 batch).
 */
export function schemeFromAdmissionYear(admissionAy: string | null | undefined): "C-20" | "C-25" | "unknown" {
  const raw = String(admissionAy || "").trim()
  const m = raw.match(/^(20\d{2})/)
  if (!m) return "unknown"
  const y = Number(m[1])
  if (y >= 2020 && y <= 2024) return "C-20"
  if (y >= 2025) return "C-25"
  return "unknown"
}

/**
 * Infer typical admission AY for a study year at a given calendar date.
 * Study year 1 ≈ current academic year start; year 2 ≈ start−1; year 3 ≈ start−2.
 */
export function inferAdmissionYearForStudyYear(
  studyYear: number | null | undefined,
  d: Date = new Date(),
): string | null {
  const y = Number(studyYear)
  if (y !== 1 && y !== 2 && y !== 3) return null
  const ay = inferAcademicYearFromDate(d)
  const start = Number(String(ay).split("-")[0])
  if (!Number.isFinite(start)) return null
  const adm = start - (y - 1)
  return `${adm}-${String((adm + 1) % 100).padStart(2, "0")}`
}

/** Scheme for a class year on a date (auto-rolls: I/II → C-25 now; III → C-20 until 2027-28). */
export function schemeForStudyYear(
  studyYear: number | null | undefined,
  d: Date = new Date(),
): "C-20" | "C-25" | "unknown" {
  return schemeFromAdmissionYear(inferAdmissionYearForStudyYear(studyYear, d))
}

export function getCurriculumSubjects(opts: {
  scheme: string
  branch: BranchCode
  /** lateral / ITI / PUC — hide pure year-1 subjects by default */
  entryType?: "regular" | "lateral"
  includeYear1ForLateral?: boolean
}): CurriculumSubject[] {
  const scheme = String(opts.scheme || "").toUpperCase()
  // C-25 subject key list not confirmed yet — return empty (free-type / wait for official list).
  if (scheme !== "C-20") return []
  let list = C20_BY_BRANCH[opts.branch] || []
  if (opts.entryType === "lateral" && !opts.includeYear1ForLateral) {
    list = list.filter((x) => !x.year1_only)
  }
  return list.slice()
}

export function subjectsBySemester(list: CurriculumSubject[]): Record<number, CurriculumSubject[]> {
  const out: Record<number, CurriculumSubject[]> = {}
  for (const s of list) {
    if (!out[s.semester]) out[s.semester] = []
    out[s.semester].push(s)
  }
  return out
}
