/**
 * Student register-number helpers for registration / login identity.
 * Official diploma format at GPT Hubli is typically:
 *   171CS25001  → college(3) + branch(2–4) + YY(2) + roll(3–4)
 * Transfers may use another 3-digit college code (e.g. 167EC22038).
 */

export function normalizeStudentRegNo(raw: string | null | undefined): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

/** True if the value looks like an email, not a register number. */
export function looksLikeEmail(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim()
  if (!s) return false
  if (s.includes("@")) return true
  // common mistype without @ detection is weak; only flag clear email shapes
  return /^[A-Z0-9._%+-]+\.[A-Z]{2,}$/i.test(s) && s.includes(".")
}

/**
 * Accept only diploma-style register numbers (not emails or free text).
 * Pattern: 3-digit college + 2–4 letter branch + 5–6 trailing digits (year+roll).
 */
export function isValidStudentRegNo(raw: string | null | undefined): boolean {
  const original = String(raw || "").trim()
  if (!original) return false
  if (looksLikeEmail(original)) return false
  // No spaces, @, dots, or other punctuation in the typed value
  if (/[^A-Za-z0-9]/.test(original)) return false
  const u = normalizeStudentRegNo(original)
  if (u.length < 9 || u.length > 14) return false
  return /^\d{3}[A-Z]{2,4}\d{5,6}$/.test(u)
}

/** Synthetic unique email when students no longer supply an email on sign-up. */
export function studentSyntheticEmail(regNo: string): string {
  const n = normalizeStudentRegNo(regNo).toLowerCase()
  return `${n}@student.gpthubli.ac.in`
}
