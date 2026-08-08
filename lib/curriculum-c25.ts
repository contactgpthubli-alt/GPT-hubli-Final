/**
 * C-25 diploma curriculum (admission 2025-26+).
 * Sem 1: EC from Nov/Dec 2025 ledger (ExamResult EC C25 DEC_2025).
 * Sem 2: official May 2026 Diploma Examination Result Ledger (CE / CS / EC / ME).
 * CE/CS/ME Sem 1 + Sem 3+ remain incomplete until official sheets are provided.
 */

import type { BranchCode, CurriculumSubject } from "./curriculum-c20"

function s(
  semester: number,
  code: string,
  name: string,
  extra: Partial<CurriculumSubject> = {},
): CurriculumSubject {
  return { code, name, semester, pathway: null, ...extra }
}

/**
 * Branch-wise C-25 subjects confirmed so far.
 * Credits (applied) from official result ledgers.
 */
export const C25_BY_BRANCH: Record<BranchCode, CurriculumSubject[]> = {
  CE: [
    // --- Semester II (May 2026 ledger) ---
    s(2, "25SC21I", "Engineering Mathematics-II", { year1_only: true }),
    s(2, "25EE01I", "Fundamentals of Electrical & Electronics Engineering", { year1_only: true }),
    s(2, "25CE21I", "Civil Engineering Graphics and CAD", { year1_only: true }),
    s(2, "25CE22I", "Basic Surveying", { year1_only: true }),
    s(2, "25CE23T", "Indian Constitution", { year1_only: true, is_audit: true }),
  ],
  CSE: [
    s(2, "25SC21I", "Engineering Mathematics-II", { year1_only: true }),
    s(2, "25EG01I", "Essential English Communication", { year1_only: true }),
    s(2, "25ME02I", "Computer Aided Engineering Graphics", { year1_only: true }),
    s(2, "25CS21I", "Thinking Programming with Python", { year1_only: true }),
    s(2, "25CS22T", "Indian Constitution", { year1_only: true, is_audit: true }),
  ],
  ECE: [
    // --- Semester I (Nov/Dec 2025 ledger) ---
    s(1, "25SC11I", "Engineering Mathematics-I", { year1_only: true }),
    s(1, "25CS01I", "IT Skills", { year1_only: true }),
    s(1, "25EE01I", "Fundamentals of Electrical & Electronics Engineering", { year1_only: true }),
    s(1, "25EC11I", "Digital Electronics-1", { year1_only: true }),
    s(1, "25EC12I", "Environmental Sustainability", { year1_only: true }),
    // --- Semester II (May 2026 ledger) ---
    s(2, "25SC21I", "Engineering Mathematics-II", { year1_only: true }),
    s(2, "25EG01I", "Essential English Communication", { year1_only: true }),
    s(2, "25ME02I", "Computer Aided Engineering Graphics", { year1_only: true }),
    s(2, "25EC21I", "Applied Electronics-1", { year1_only: true }),
    s(2, "25EC22T", "Indian Constitution", { year1_only: true, is_audit: true }),
  ],
  ME: [
    s(2, "25SC21I", "Engineering Mathematics-II", { year1_only: true }),
    s(2, "25CS01I", "IT Skills", { year1_only: true }),
    s(2, "25EE01I", "Fundamentals of Electrical & Electronics Engineering", { year1_only: true }),
    s(2, "25ME21I", "Concepts of Mechanical Engineering -II", { year1_only: true }),
    s(2, "25ME22T", "Indian Constitution", { year1_only: true, is_audit: true }),
  ],
}
