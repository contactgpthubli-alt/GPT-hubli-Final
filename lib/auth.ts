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

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, expiresAt])
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
  const { rows } = await query<SessionUser>(
    `SELECT u.id, u.email, u.role, u.display_name, u.reg_no, u.staff_id,
            u.status, u.force_password_change, u.is_demo
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  )
  return rows[0] ?? null
}

/** Returns the user if logged in with one of the allowed roles, else null. */
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
