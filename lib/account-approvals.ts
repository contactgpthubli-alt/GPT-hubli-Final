/**
 * Who can approve pending accounts, and branch scoping for HOD.
 */
import { normalizeBranch, isOfficialBranch } from "@/lib/branches"

export type ApproverRole = "admin" | "principal" | "hod"

export function isAccountApproverRole(role: string | null | undefined): role is ApproverRole {
  const r = String(role || "").toLowerCase()
  return r === "admin" || r === "principal" || r === "hod"
}

/**
 * Branch code from a student register number (authoritative for 171xx).
 * 171CS… → CSE, 171CE… → CE, 171EC… → ECE, 171ME… → ME
 * DTE / other → null (use dept instead).
 */
export function branchCodeFromRegNo(reg: string | null | undefined): "CE" | "CSE" | "ECE" | "ME" | null {
  const r = String(reg || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  // Standard DTE college format: 171CS25001 / 171ME24006
  const m = r.match(/171(CS|CE|EC|ME)\d/)
  if (m) {
    if (m[1] === "CS") return "CSE"
    if (m[1] === "CE") return "CE"
    if (m[1] === "EC") return "ECE"
    if (m[1] === "ME") return "ME"
  }
  // Loose: any …CS25… / …ME24… style
  if (/(?:^|[^A-Z])CS\d{5}/.test(r) || /171CS/.test(r)) return "CSE"
  if (/(?:^|[^A-Z])CE\d{5}/.test(r) || /171CE/.test(r)) return "CE"
  if (/(?:^|[^A-Z])EC\d{5}/.test(r) || /171EC/.test(r)) return "ECE"
  if (/(?:^|[^A-Z])ME\d{5}/.test(r) || /171ME/.test(r)) return "ME"
  return null
}

/** Map official branch name / free text → CE | CSE | ECE | ME */
export function branchCodeFromLabel(label: string | null | undefined): "CE" | "CSE" | "ECE" | "ME" | null {
  if (!label) return null
  const lower = String(label).toLowerCase()
  if (lower.includes("computer") || lower === "cse" || lower === "cs") return "CSE"
  if (lower.includes("civil") || lower === "ce") return "CE"
  if (lower.includes("electron") || lower === "ece" || lower === "ec") return "ECE"
  if (lower.includes("mech") || lower === "me") return "ME"
  const u = String(label)
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
  if (u === "CSE" || u === "CS") return "CSE"
  if (u === "CE") return "CE"
  if (u === "ECE" || u === "EC") return "ECE"
  if (u === "ME") return "ME"
  return null
}

export function branchFullName(code: "CE" | "CSE" | "ECE" | "ME"): string {
  if (code === "CSE") return "Computer Science and Engineering"
  if (code === "CE") return "Civil Engineering"
  if (code === "ECE") return "Electronics and Communication Engineering"
  return "Mechanical Engineering"
}

/**
 * Official branch for an HOD account.
 * Resolves from users.branch, then email / reg_no / display_name (HODCS…, hodcsgpth@…).
 */
export function hodBranchOf(user: {
  branch?: string | null
  reg_no?: string | null
  display_name?: string | null
  email?: string | null
}): string | null {
  const fromField = normalizeBranch(user.branch)
  if (fromField && isOfficialBranch(fromField)) return fromField

  // Infer from email + username + display name (e.g. hodcsgpth@…, HODCSGPTH)
  const key = [user.email, user.reg_no, user.display_name]
    .map((x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .join("|")

  // Order matters: HODCE before HODCS would be wrong if we used includes("HODC") —
  // check longer/more specific tokens carefully.
  if (key.includes("HODCSE") || key.includes("HODCS") || key.includes("HODCOMPUTER")) {
    return "Computer Science and Engineering"
  }
  if (key.includes("HODCIVIL") || key.includes("HODCE")) {
    return "Civil Engineering"
  }
  if (key.includes("HODECE") || key.includes("HODEC") || key.includes("HODELECTRON")) {
    return "Electronics and Communication Engineering"
  }
  if (key.includes("HODMECH") || key.includes("HODME")) {
    return "Mechanical Engineering"
  }
  return fromField
}

/** HOD branch as short code for reg filtering. */
export function hodBranchCodeOf(user: {
  branch?: string | null
  reg_no?: string | null
  display_name?: string | null
  email?: string | null
}): "CE" | "CSE" | "ECE" | "ME" | null {
  const full = hodBranchOf(user)
  return branchCodeFromLabel(full)
}

/**
 * Whether student reg belongs to this HOD.
 * Primary rule (user-specified): reg contains CS→CSE, CE→Civil, EC→ECE, ME→ME.
 * DTE / other regs: fall back to dept name.
 */
export function studentBelongsToHod(
  studentReg: string,
  studentDept: string | null | undefined,
  hod: {
    branch?: string | null
    reg_no?: string | null
    display_name?: string | null
    email?: string | null
  },
): boolean {
  const want = hodBranchCodeOf(hod)
  if (!want) return false
  const fromReg = branchCodeFromRegNo(studentReg)
  if (fromReg) return fromReg === want
  const fromDept = branchCodeFromLabel(studentDept)
  return fromDept === want
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
