import { randomBytes } from "crypto"
import { cookies } from "next/headers"
import bcrypt from "bcryptjs"
import { query } from "./db"

const SESSION_COOKIE = "gpth_session"
const SESSION_DAYS = 7

export interface SessionUser {
  id: number
  email: string
  role: string
  display_name: string
  reg_no: string | null
  staff_id: number | null
  status: string
  force_password_change: boolean
  is_demo: boolean
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/** True only when the account may use the portal (approved + not soft-deleted). */
export function isActiveApprovedAccount(user: {
  status?: string | null
  deleted_at?: unknown
}): boolean {
  const status = String(user?.status || "")
    .trim()
    .toLowerCase()
  if (status !== "approved") return false
  if (user?.deleted_at) return false
  return true
}

/** Drop every live session for a user (e.g. after reject / deactivate / delete). */
export async function clearUserSessions(userId: number): Promise<void> {
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return
  await query(`DELETE FROM sessions WHERE user_id = $1`, [uid])
}

export async function createSession(userId: number): Promise<void> {
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Error("Invalid user id for session")
  }

  // Defense in depth: never issue a session for pending/rejected/deleted accounts
  const { rows } = await query(
    `SELECT id, status, deleted_at FROM users WHERE id = $1`,
    [uid],
  )
  const row = rows[0]
  if (!row || !isActiveApprovedAccount(row)) {
    throw new Error("Cannot create session for inactive or unapproved account")
  }

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [
    token,
    uid,
    expiresAt,
  ])
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  })
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await query("DELETE FROM sessions WHERE token = $1", [token])
    cookieStore.delete(SESSION_COOKIE)
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null
  const { rows } = await query<SessionUser & { deleted_at?: unknown }>(
    `SELECT u.id, u.email, u.role, u.display_name, u.reg_no, u.staff_id,
            u.status, u.force_password_change, u.is_demo, u.deleted_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  )
  const user = rows[0]
  if (!user) return null

  // Pending / rejected / deleted accounts must not stay signed in
  if (!isActiveApprovedAccount(user)) {
    await query(`DELETE FROM sessions WHERE token = $1`, [token])
    cookieStore.delete(SESSION_COOKIE)
    return null
  }

  // Do not leak deleted_at on the session user object
  const { deleted_at: _d, ...safe } = user as SessionUser & { deleted_at?: unknown }
  return safe as SessionUser
}

/** Returns the user if logged in with an approved account and one of the allowed roles. */
export async function requireRole(...roles: string[]): Promise<SessionUser | null> {
  const user = await getCurrentUser()
  if (!user) return null
  if (roles.length > 0 && !roles.includes(user.role)) return null
  return user
}

export function unauthorized(message = "Not authorized") {
  return Response.json({ error: message }, { status: 401 })
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 })
}
