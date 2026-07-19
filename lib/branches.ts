/** Official diploma branches at Government Polytechnic Hubli. */
export const OFFICIAL_BRANCHES = [
  "Civil Engineering",
  "Computer Science and Engineering",
  "Electronics and Communication Engineering",
  "Mechanical Engineering",
] as const

export type OfficialBranch = (typeof OFFICIAL_BRANCHES)[number]

/** Normalize free-text / legacy branch labels to an official branch when possible. */
export function normalizeBranch(input: string | null | undefined): string | null {
  if (!input) return null
  const raw = String(input).replace(/\s+/g, " ").trim()
  if (!raw || raw === "Not set" || raw === "—") return null

  const lower = raw.toLowerCase()
  if (OFFICIAL_BRANCHES.includes(raw as OfficialBranch)) return raw

  // Common aliases / older labels
  if (lower.includes("civil")) return "Civil Engineering"
  if (
    lower.includes("computer") ||
    lower === "cse" ||
    lower.includes("cs &") ||
    lower.includes("cs and")
  ) {
    return "Computer Science and Engineering"
  }
  if (
    lower.includes("electron") ||
    lower.includes("ece") ||
    lower.includes("e&c") ||
    lower.includes("e & c")
  ) {
    return "Electronics and Communication Engineering"
  }
  if (lower.includes("mech")) return "Mechanical Engineering"

  return raw // unknown — keep as-is for display, filters still use official list
}

export function isOfficialBranch(input: string | null | undefined): boolean {
  if (!input) return false
  return OFFICIAL_BRANCHES.includes(String(input).trim() as OfficialBranch)
}
