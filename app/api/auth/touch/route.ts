import { touchSession, getCurrentUser } from "@/lib/auth"

/**
 * Sliding idle refresh — client calls this only on real user activity
 * (click / key / scroll / touch), throttled. Heartbeat /api/auth/me must
 * never extend the session or idle auto-logout would never fire.
 */
export async function POST() {
  const ok = await touchSession()
  if (!ok) {
    return Response.json(
      { ok: false, user: null, error: "Session expired due to inactivity" },
      { status: 401 },
    )
  }
  // Confirm account still approved / not soft-deleted
  const user = await getCurrentUser()
  if (!user) {
    return Response.json(
      { ok: false, user: null, error: "Session expired due to inactivity" },
      { status: 401 },
    )
  }
  return Response.json({
    ok: true,
    idle_minutes: 20,
    user: { id: user.id, role: user.role },
  })
}
