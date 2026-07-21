import { query } from "@/lib/db"
import { getCurrentUser, unauthorized } from "@/lib/auth"
import { listUserNotifications, markUserNotificationsRead } from "@/lib/user-notifications"

export type AppNotification = {
  id: string
  title: string
  desc: string
  time: string
  unread: boolean
  kind: string
}

function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return String(iso)
  }
}

/**
 * Role-aware live notifications (no demo content).
 * - Admin/HOD: pending accounts, pending profile requests, open grievances, recent notices
 * - Student: own profile request status, open forms, cert requests, notices
 * - Other staff: notices + relevant pending counts where applicable
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const items: AppNotification[] = []

  // Official notices (everyone)
  try {
    const { rows: notices } = await query(
      `SELECT id, title, body, priority, created_at
         FROM notices
        ORDER BY created_at DESC
        LIMIT 8`,
    )
    for (const n of notices) {
      items.push({
        id: `notice-${n.id}`,
        title: n.priority === "emergency" || n.priority === "important" ? `📢 ${n.title}` : `📌 ${n.title}`,
        desc: n.body || "New notice published.",
        time: fmtTime(n.created_at),
        unread: true,
        kind: "notice",
      })
    }
  } catch {
    /* table may be empty */
  }

  if (user.role === "admin" || user.role === "hod") {
    // Pending account registrations (admin only)
    if (user.role === "admin") {
      const { rows: acc } = await query(
        `SELECT COUNT(*)::int AS n FROM users WHERE status = 'pending'`,
      )
      const n = acc[0]?.n || 0
      if (n > 0) {
        items.unshift({
          id: "pending-accounts",
          title: "⏳ Pending Account Registrations",
          desc: `${n} new account request${n === 1 ? "" : "s"} waiting under System → Account Approvals.`,
          time: "Now",
          unread: true,
          kind: "account_approval",
        })
      }
    }

    // Pending profile update requests
    const { rows: prCount } = await query(
      `SELECT COUNT(*)::int AS n FROM profile_requests WHERE status = 'pending'`,
    )
    const pn = prCount[0]?.n || 0
    if (pn > 0) {
      items.unshift({
        id: "pending-profiles",
        title: "✅ Pending Profile Updates",
        desc: `${pn} student/staff profile update request${pn === 1 ? "" : "s"} need review under Approvals.`,
        time: "Now",
        unread: true,
        kind: "profile_approval",
      })
    }

    // Recent profile requests (last 10, any status) for activity feed
    const { rows: recentPr } = await query(
      `SELECT pr.id, pr.status, pr.target_id, pr.created_at, pr.reviewed_at,
              u.display_name
         FROM profile_requests pr
         JOIN users u ON u.id = pr.requester_id
        ORDER BY COALESCE(pr.reviewed_at, pr.created_at) DESC
        LIMIT 6`,
    )
    for (const r of recentPr) {
      if (r.status === "pending") {
        items.push({
          id: `pr-${r.id}`,
          title: "📝 Profile Update Request",
          desc: `${r.display_name || "User"} (${r.target_id || "—"}) submitted a profile update.`,
          time: fmtTime(r.created_at),
          unread: true,
          kind: "profile_request",
        })
      } else if (r.status === "approved") {
        items.push({
          id: `pr-${r.id}-done`,
          title: "✅ Profile Update Approved",
          desc: `${r.display_name || "User"} (${r.target_id || "—"}) — changes saved.`,
          time: fmtTime(r.reviewed_at || r.created_at),
          unread: false,
          kind: "profile_approved",
        })
      } else if (r.status === "rejected") {
        items.push({
          id: `pr-${r.id}-rej`,
          title: "✕ Profile Update Rejected",
          desc: `${r.display_name || "User"} (${r.target_id || "—"}) — request rejected.`,
          time: fmtTime(r.reviewed_at || r.created_at),
          unread: false,
          kind: "profile_rejected",
        })
      }
    }

    // Open grievances (admin / principal-facing)
    if (user.role === "admin") {
      try {
        const { rows: gr } = await query(
          `SELECT COUNT(*)::int AS n FROM grievances WHERE status IS DISTINCT FROM 'Resolved'`,
        )
        const gn = gr[0]?.n || 0
        if (gn > 0) {
          items.push({
            id: "open-grievances",
            title: "📋 Open Grievances",
            desc: `${gn} grievance${gn === 1 ? "" : "s"} still open / in progress.`,
            time: "Now",
            unread: true,
            kind: "grievance",
          })
        }
      } catch {
        /* ignore */
      }
    }
  } else if (user.role === "student") {
    // Persistent in-app notifications (e.g. account approved)
    try {
      const mineNotifs = await listUserNotifications(Number(user.id), 15)
      for (const n of mineNotifs) {
        items.unshift({
          id: `un-${n.id}`,
          title: n.title,
          desc: n.body || "",
          time: fmtTime(n.created_at),
          unread: !n.read_at,
          kind: n.kind || "user",
        })
      }
    } catch {
      /* table may not exist yet */
    }

    // Fallback if audit exists but notification row was never written (older approvals)
    try {
      const { rows: audit } = await query(
        `SELECT approved_at, approved_by_name, approved_by_role, status
           FROM users WHERE id = $1`,
        [user.id],
      )
      const a = audit[0]
      if (a && a.status === "approved" && a.approved_at) {
        const already = items.some((i) => i.kind === "account_approved")
        if (!already) {
          const who = a.approved_by_name
            ? String(a.approved_by_name) +
              (a.approved_by_role ? ` (${a.approved_by_role})` : "")
            : "the office"
          items.unshift({
            id: "account-approved-audit",
            title: "✅ Account Approved",
            desc: `Your student account was approved by ${who}. You can use the app and portal.`,
            time: fmtTime(a.approved_at),
            unread: true,
            kind: "account_approved",
          })
        }
      }
    } catch {
      /* columns may not exist yet */
    }

    // Own profile requests
    const { rows: mine } = await query(
      `SELECT id, status, created_at, reviewed_at, remarks
         FROM profile_requests
        WHERE requester_id = $1
        ORDER BY created_at DESC
        LIMIT 8`,
      [user.id],
    )
    for (const r of mine) {
      if (r.status === "pending") {
        items.unshift({
          id: `my-pr-${r.id}`,
          title: "⏳ Profile Update Pending",
          desc: "Your profile update request is awaiting Admin/HOD approval.",
          time: fmtTime(r.created_at),
          unread: true,
          kind: "my_profile_pending",
        })
      } else if (r.status === "approved") {
        items.unshift({
          id: `my-pr-${r.id}`,
          title: "✅ Profile Update Approved",
          desc: "Your profile changes were approved and saved." + (r.remarks ? ` Note: ${r.remarks}` : ""),
          time: fmtTime(r.reviewed_at || r.created_at),
          unread: false,
          kind: "my_profile_approved",
        })
      } else if (r.status === "rejected") {
        items.unshift({
          id: `my-pr-${r.id}`,
          title: "✕ Profile Update Rejected",
          desc: "Your profile update was rejected." + (r.remarks ? ` Note: ${r.remarks}` : " Contact the office."),
          time: fmtTime(r.reviewed_at || r.created_at),
          unread: true,
          kind: "my_profile_rejected",
        })
      }
    }

    // Open forms not yet submitted by this student
    try {
      const { rows: forms } = await query(
        `SELECT f.id, f.title, f.created_at
           FROM forms f
          WHERE f.status = 'open'
            AND NOT EXISTS (
              SELECT 1 FROM form_responses fr
               WHERE fr.form_id = f.id AND fr.submitted_by = $1
            )
          ORDER BY f.created_at DESC
          LIMIT 5`,
        [user.id],
      )
      for (const f of forms) {
        items.push({
          id: `form-${f.id}`,
          title: "📝 Form Open — Action Needed",
          desc: `"${f.title}" is open. Please submit before it closes.`,
          time: fmtTime(f.created_at),
          unread: true,
          kind: "form",
        })
      }
    } catch {
      /* ignore */
    }

    // Certificate requests
    try {
      const { rows: certs } = await query(
        `SELECT id, req_code, cert_type, status, created_at
           FROM cert_requests
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        [user.id],
      )
      for (const c of certs) {
        const st = String(c.status || "").toLowerCase()
        items.push({
          id: `cert-${c.id}`,
          title:
            st.includes("ready") || st.includes("issued") || st.includes("approved")
              ? `📜 Certificate Ready — ${c.cert_type || "Request"}`
              : `📜 Certificate Request — ${c.cert_type || "Pending"}`,
          desc: `${c.req_code || "CERT"} · Status: ${c.status || "pending"}`,
          time: fmtTime(c.created_at),
          unread: !(st.includes("ready") || st.includes("issued") || st.includes("approved")),
          kind: "certificate",
        })
      }
    } catch {
      /* ignore */
    }

    // Force password change
    if (user.force_password_change) {
      items.unshift({
        id: "force-pw",
        title: "🔐 Change Your Password",
        desc: "For security, please change your default password under Profile.",
        time: "Now",
        unread: true,
        kind: "security",
      })
    }
  } else {
    // Other staff — light feed: open forms they may care about + notices already added
    try {
      const { rows: forms } = await query(
        `SELECT id, title, created_at FROM forms WHERE status = 'open' ORDER BY created_at DESC LIMIT 5`,
      )
      for (const f of forms) {
        items.push({
          id: `form-${f.id}`,
          title: "📝 Open Form",
          desc: `"${f.title}" is currently open.`,
          time: fmtTime(f.created_at),
          unread: false,
          kind: "form",
        })
      }
    } catch {
      /* ignore */
    }
  }

  // De-dupe by id, keep order, cap list
  const seen = new Set<string>()
  const unique = items.filter((it) => {
    if (seen.has(it.id)) return false
    seen.add(it.id)
    return true
  }).slice(0, 25)

  const unread = unique.filter((i) => i.unread).length

  return Response.json({
    notifications: unique,
    unread,
    total: unique.length,
  })
}

/** Mark own user_notifications as read. Body: { ids?: number[] } or all unread. */
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const b = await req.json().catch(() => ({}))
  const ids = Array.isArray(b?.ids)
    ? b.ids.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0)
    : undefined
  const n = await markUserNotificationsRead(Number(user.id), ids)
  return Response.json({ ok: true, marked: n })
}
