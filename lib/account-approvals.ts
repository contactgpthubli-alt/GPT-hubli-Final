/**
 * Who can approve pending accounts, and branch scoping for HOD.
 */
import { normalizeBranch, isOfficialBranch } from "@/lib/branches"

export type ApproverRole = "admin" | "principal" | "hod"

export function isAccountApproverRole(role: string | null | undefined): role is ApproverRole {
  const r = String(role || "").toLowerCase()
  return r === "admin" || r === "principal" || r === "hod"
}

/** Official branch for an HOD account (users.branch). */
export function hodBranchOf(user: { branch?: string | null; reg_no?: string | null; display_name?: string | null }): string | null {
  const fromField = normalizeBranch(user.branch)
  if (fromField && isOfficialBranch(fromField)) return fromField

  // Fallback: infer from username patterns HODCEGPTH / HODCSGPTH / …
  const key = String(user.reg_no || user.display_name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  if (key.includes("HODCE") || key.includes("HODCIVIL")) return "Civil Engineering"
  if (key.includes("HODCS") || key.includes("HODCSE")) return "Computer Science and Engineering"
  if (key.includes("HODEC") || key.includes("HODECE")) return "Electronics and Communication Engineering"
  if (key.includes("HODME") || key.includes("HODMECH")) return "Mechanical Engineering"
  return fromField
}

export function branchesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeBranch(a)
  const nb = normalizeBranch(b)
  if (!na || !nb) return false
  return na.toLowerCase() === nb.toLowerCase()
}

/**
 * Whether `actor` may approve/reject the pending target account.
 * - admin / principal: any pending account
 * - hod: only student accounts in their official branch
 */
export function canApproveTarget(
  actor: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null },
  target: { role?: string | null; branch?: string | null; status?: string | null },
): { ok: true } | { ok: false; error: string } {
  const role = String(actor.role || "").toLowerCase()
  if (role === "admin" || role === "principal") return { ok: true }

  if (role === "hod") {
    if (String(target.role || "").toLowerCase() !== "student") {
      return { ok: false, error: "HOD can only approve student accounts for their branch" }
    }
    const myBranch = hodBranchOf(actor)
    if (!myBranch) {
      return { ok: false, error: "Your HOD account has no branch assigned. Contact Root Admin." }
    }
    if (!branchesMatch(myBranch, target.branch)) {
      return {
        ok: false,
        error: `This student is not in your branch (${myBranch}).`,
      }
    }
    return { ok: true }
  }

  return { ok: false, error: "Not authorized to approve accounts" }
}
