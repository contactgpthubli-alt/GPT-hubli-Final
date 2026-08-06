import { query } from "@/lib/db"
import {
  verifyPassword,
  createSession,
  badRequest,
  isActiveApprovedAccount,
} from "@/lib/auth"
import { getStudentAcademicForUser, getInstituteAcademicSettings } from "@/lib/student-academic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.email || !body?.password) {
      return badRequest("Email and password are required")
    }

    const identifier = String(body.email).trim()
    const password = String(body.password)
    if (!identifier || !password) {
      return badRequest("Username/email and password are required")
    }

    // Accept full email, email local-part (username), staff username (reg_no),
    // student reg no (including branch-transfer aliases), or display_name.
    // Soft-deleted rows are excluded so they cannot authenticate.
    let { rows } = await query(
      `SELECT id, email, password_hash, role, display_name, reg_no, branch, status,
              force_password_change, is_demo, deleted_at
         FROM users
        WHERE deleted_at IS NULL
          AND status IS DISTINCT FROM 'deleted'
          AND (
            lower(email) = lower($1)
            OR lower(split_part(email, '@', 1)) = lower($1)
            OR (reg_no IS NOT NULL AND lower(reg_no) = lower($1))
            OR lower(display_name) = lower($1)
          )
        ORDER BY
          CASE
            WHEN lower(email) = lower($1) THEN 0
            WHEN lower(split_part(email, '@', 1)) = lower($1) THEN 1
            WHEN reg_no IS NOT NULL AND lower(reg_no) = lower($1) THEN 2
            ELSE 3
          END
        LIMIT 1`,
      [identifier],
    )

    // Dual login after branch transfer: old or new register number → same user
    if (!rows[0]) {
      try {
        const { rows: aliasRows } = await query(
          `SELECT u.id, u.email, u.password_hash, u.role, u.display_name, u.reg_no, u.branch, u.status,
                  u.force_password_change, u.is_demo, u.deleted_at
             FROM student_login_aliases a
             JOIN users u ON u.id = a.user_id
            WHERE a.active
              AND upper(a.alias_reg_no) = upper($1)
              AND u.deleted_at IS NULL
              AND u.status IS DISTINCT FROM 'deleted'
            LIMIT 1`,
          [identifier],
        )
        if (aliasRows[0]) rows = aliasRows
      } catch {
        /* table may not exist yet on first boot */
      }
    }

    const user = rows[0]
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return Response.json(
        { error: "Invalid username/email or password" },
        { status: 401 },
      )
    }

    const status = String(user.status || "")
      .trim()
      .toLowerCase()

    // New registrations stay pending until Root Admin approves them.
    // Login must never succeed for pending / rejected / inactive accounts.
    if (status === "pending") {
      return Response.json(
        {
          error:
            "Your account is awaiting Root Admin approval. Open Admin → Account Approvals, approve this account, then try login again.",
        },
        { status: 403 },
      )
    }
    if (status === "rejected") {
      return Response.json(
        { error: "Your registration was rejected. Contact the office." },
        { status: 403 },
      )
    }
    if (status === "deleted" || user.deleted_at) {
      return Response.json(
        {
          error:
            "This account has been deleted. Contact the Root Admin to restore it.",
        },
        { status: 403 },
      )
    }
    if (!isActiveApprovedAccount(user)) {
      return Response.json({ error: "Account is not active" }, { status: 403 })
    }

    await createSession(user.id)

    // First-time accounts (imported students, temp password) must update
    // email + password before full portal use. No OTP on this step.
    const requiresSetup = !!user.force_password_change

    let academic = null
    let academic_settings = null
    try {
      academic_settings = await getInstituteAcademicSettings()
      if (user.role === "student" && user.reg_no) {
        academic = await getStudentAcademicForUser(user.reg_no)
      }
    } catch {
      /* academic tables may not exist yet on first boot */
    }

    return Response.json({
      requires_setup: requiresSetup,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        display_name: user.display_name,
        reg_no: user.reg_no,
        branch: user.branch,
        force_password_change: user.force_password_change,
        is_demo: user.is_demo,
        requires_setup: requiresSetup,
        academic,
        is_alumni: academic?.is_alumni === true,
        read_only_portal: academic?.read_only_portal === true,
      },
      academic_settings,
    })

  } catch (err) {
    console.error("[login]", err)
    return Response.json(
      { error: "Login service unavailable. Check server/database configuration." },
      { status: 500 },
    )
  }
}
