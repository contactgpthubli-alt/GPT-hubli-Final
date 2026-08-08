/**
 * Signature stamp — permanent rule for GPT Hubli MIS.
 *
 * EVERY approve / reject / edit / transfer / delete / verify action MUST
 * record and display who did it: name + role + when.
 * Roles include: student, HOD, ACM, exam, principal, admin, faculty, etc.
 *
 * Use stampFromSession() on every write; return stamp fields in API JSON;
 * render with public/gpth-stamp.js (window.gpthStamp.html).
 */

export type StampAction =
  | "approved"
  | "rejected"
  | "edited"
  | "submitted"
  | "verified"
  | "created"
  | "updated"
  | "deleted"
  | "transferred"
  | "released"
  | "accepted"
  | "cancelled"
  | "paid"
  | "waived"
  | "removed"
  | "flagged"
  | string

export type SignatureStamp = {
  action: StampAction
  by_id: number | null
  by_name: string
  by_role: string
  by_role_label: string
  at: string // ISO
  note?: string | null
}

const ROLE_LABELS: Record<string, string> = {
  student: "Student",
  faculty: "Teaching Staff",
  teaching: "Teaching Staff",
  hod: "HOD",
  acm: "ACM",
  exam: "Exam Cell",
  principal: "Principal",
  admin: "Root Admin",
  registrar: "Registrar",
  est: "EST",
  library: "Library Staff",
  placement: "Placement Officer",
  nss: "NSS Officer",
  yrc: "Youth Red Cross",
  alumni: "Alumni Officer",
  sports: "Sports Officer",
  welfare: "Student Welfare Officer",
  cash: "Cash Officer",
  accounts: "Accounts",
  stores: "Stores",
  studentassoc: "Student Association",
}

export function roleLabel(role: string | null | undefined): string {
  const r = String(role || "").toLowerCase().trim()
  if (!r) return "Staff"
  return ROLE_LABELS[r] || role || "Staff"
}

export function actionVerb(action: StampAction): string {
  const a = String(action || "updated").toLowerCase()
  const map: Record<string, string> = {
    approved: "Approved by",
    rejected: "Rejected by",
    edited: "Edited by",
    submitted: "Submitted by",
    verified: "Verified by",
    created: "Created by",
    updated: "Updated by",
    deleted: "Deleted by",
    transferred: "Transferred by",
    released: "Released by",
    accepted: "Accepted by",
    cancelled: "Cancelled by",
    paid: "Marked paid by",
    waived: "Waived by",
    removed: "Removed by",
    flagged: "Flagged by",
  }
  return map[a] || `${a.charAt(0).toUpperCase()}${a.slice(1)} by`
}

export type SessionLike = {
  id?: number | null
  display_name?: string | null
  email?: string | null
  role?: string | null
  reg_no?: string | null
}

/** Build a stamp from the logged-in session (or any actor object). */
export function stampFromSession(
  user: SessionLike | null | undefined,
  action: StampAction,
  opts?: { at?: Date | string | null; note?: string | null; nameFallback?: string },
): SignatureStamp {
  const at =
    opts?.at instanceof Date
      ? opts.at.toISOString()
      : opts?.at
        ? String(opts.at)
        : new Date().toISOString()
  const name =
    String(user?.display_name || "").trim() ||
    String(opts?.nameFallback || "").trim() ||
    (user?.reg_no ? String(user.reg_no) : "") ||
    String(user?.email || "").trim() ||
    "Unknown"
  const role = String(user?.role || "staff").toLowerCase()
  return {
    action,
    by_id: user?.id != null ? Number(user.id) : null,
    by_name: name,
    by_role: role,
    by_role_label: roleLabel(role),
    at,
    note: opts?.note != null ? String(opts.note).slice(0, 500) : null,
  }
}

/** Flatten stamp for SQL columns / JSON merge. */
export function stampToColumns(stamp: SignatureStamp, prefix = ""): Record<string, unknown> {
  const p = prefix
  return {
    [`${p}by_id`]: stamp.by_id,
    [`${p}by_name`]: stamp.by_name,
    [`${p}by_role`]: stamp.by_role,
    [`${p}at`]: stamp.at,
    [`${p}action`]: stamp.action,
  }
}

/** Normalize loose API/DB fields into a SignatureStamp when present. */
export function coerceStamp(raw: unknown, fallbackAction: StampAction = "updated"): SignatureStamp | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const name = String(o.by_name || o.by || o.name || o.actor || o.approved_by_name || o.verified_by_name || o.edited_by_name || "").trim()
  if (!name) return null
  const role = String(o.by_role || o.role || o.actor_role || o.approved_by_role || o.verifier_role || "").toLowerCase()
  const at = String(o.at || o.when || o.approved_at || o.verified_at || o.edited_at || o.updated_at || new Date().toISOString())
  const action = String(o.action || fallbackAction) as StampAction
  return {
    action,
    by_id: o.by_id != null ? Number(o.by_id) : o.id != null ? Number(o.id) : null,
    by_name: name,
    by_role: role || "staff",
    by_role_label: roleLabel(role || "staff"),
    at,
    note: o.note != null ? String(o.note) : o.reason != null ? String(o.reason) : null,
  }
}

/** Plain-text one-liner for alerts / logs. */
export function stampPlain(stamp: SignatureStamp | null | undefined): string {
  if (!stamp) return ""
  const when = formatStampWhen(stamp.at)
  return `${actionVerb(stamp.action)} ${stamp.by_name} (${stamp.by_role_label || roleLabel(stamp.by_role)})${when ? ` · ${when}` : ""}`
}

export function formatStampWhen(iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ")
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return String(iso).slice(0, 16)
  }
}
