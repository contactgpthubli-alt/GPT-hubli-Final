import { getPool, query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { branchesMatch, hodBranchOf } from "@/lib/account-approvals"
import { normalizeBranch } from "@/lib/branches"
import { stampFromSession } from "@/lib/signature-stamp"

type Subject = Record<string, unknown>

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS result_edit_requests (
      id BIGSERIAL PRIMARY KEY,
      result_id BIGINT NOT NULL,
      reg_no TEXT NOT NULL,
      proposed JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      requested_by_name TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_by_name TEXT,
      reviewed_by_role TEXT,
      reviewed_at TIMESTAMPTZ,
      review_stamp JSONB,
      remarks TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_result_edit_requests_status ON result_edit_requests(status, requested_at DESC);
  `)
}

function validProposed(value: unknown): value is { sgpa?: number | null; result?: string; subjects: Subject[] } {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.subjects) && v.subjects.every((s) => s && typeof s === "object")
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  await ensureSchema()
  const url = new URL(req.url)
  if (user.role === "student") {
    const { rows } = await query(
      `SELECT rer.*, r.sem, r.session FROM result_edit_requests rer JOIN results r ON r.id = rer.result_id WHERE rer.reg_no = $1 ORDER BY rer.requested_at DESC`,
      [user.reg_no],
    )
    return Response.json({ requests: rows })
  }
  if (!["admin", "principal", "hod"].includes(user.role)) return unauthorized()
  const params: unknown[] = []
  let where = "rer.status = 'pending'"
  if (user.role === "hod") {
    const branch = hodBranchOf(user)
    if (!branch) return Response.json({ requests: [] })
    params.push(`%${String(branch).toLowerCase().split(" ")[0]}%`)
    where += ` AND lower(COALESCE(r.branch, '')) LIKE $${params.length}`
  }
  const { rows } = await query(
    `SELECT rer.*, r.sem, r.session, r.branch FROM result_edit_requests rer JOIN results r ON r.id = rer.result_id WHERE ${where} ORDER BY rer.requested_at`,
    params,
  )
  return Response.json({ requests: rows })
}

export async function POST(req: Request) {
  const user = await requireRole("student")
  if (!user || !user.reg_no) return unauthorized()
  await ensureSchema()
  const body = await req.json().catch(() => null)
  const resultId = Number(body?.result_id)
  if (!Number.isFinite(resultId) || !validProposed(body?.proposed)) return badRequest("result_id and proposed result are required")
  const { rows: resultRows } = await query(`SELECT * FROM results WHERE id = $1 AND reg_no = $2`, [resultId, user.reg_no])
  if (!resultRows[0]) return badRequest("Published result not found for this student")
  const { rows: pending } = await query(`SELECT id FROM result_edit_requests WHERE result_id = $1 AND status = 'pending'`, [resultId])
  if (pending[0]) return Response.json({ error: "A result edit request is already pending" }, { status: 409 })
  const proposed = { ...body.proposed, result_id: resultId, reg: user.reg_no }
  const { rows } = await query(
    `INSERT INTO result_edit_requests (result_id, reg_no, proposed, requested_by, requested_by_name) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [resultId, user.reg_no, JSON.stringify(proposed), user.id, user.display_name],
  )
  return Response.json({ ok: true, request: rows[0] })
}

export async function PATCH(req: Request) {
  const user = await requireRole("admin", "hod")
  if (!user) return unauthorized()
  await ensureSchema()
  const body = await req.json().catch(() => null)
  const id = Number(body?.id)
  if (!Number.isFinite(id) || !["approved", "rejected"].includes(body?.action)) return badRequest("id and action (approved|rejected) are required")
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const { rows } = await client.query(
      `SELECT rer.*, r.reg_no AS result_reg, r.branch, r.name, r.sem, r.session FROM result_edit_requests rer JOIN results r ON r.id = rer.result_id WHERE rer.id = $1 AND rer.status = 'pending' FOR UPDATE`,
      [id],
    )
    const request = rows[0]
    if (!request) { await client.query("ROLLBACK"); return badRequest("Pending result edit request not found") }
    if (user.role === "hod") {
      const myBranch = hodBranchOf(user)
      if (!myBranch || !branchesMatch(myBranch, normalizeBranch(request.branch) || request.branch)) {
        await client.query("ROLLBACK")
        return unauthorized("This result is not in your branch")
      }
    }
    const stamp = stampFromSession(user, body.action === "approved" ? "approved" : "rejected", { note: body.remarks })
    await client.query(`UPDATE result_edit_requests SET status = $2, reviewed_by = $3, reviewed_by_name = $4, reviewed_by_role = $5, reviewed_at = $6, review_stamp = $7, remarks = $8 WHERE id = $1`, [id, body.action, user.id, user.display_name, user.role, stamp.at, JSON.stringify(stamp), body.remarks || null])
    if (body.action === "approved") {
      const proposed = request.proposed as { sgpa?: unknown; result?: unknown; subjects: Subject[] }
      await client.query(`UPDATE results SET sgpa = $2, result = $3 WHERE id = $1`, [request.result_id, proposed.sgpa ?? null, String(proposed.result || "Pass")])
      await client.query(`DELETE FROM result_subjects WHERE result_id = $1`, [request.result_id])
      for (let i = 0; i < proposed.subjects.length; i++) {
        const subject = proposed.subjects[i]
        await client.query(`INSERT INTO result_subjects (result_id, name, code, internal, external, credits, grade, ord) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [request.result_id, String(subject.name || ""), String(subject.code || ""), subject.internal ?? 0, subject.external ?? 0, subject.credits ?? 0, String(subject.grade || ""), i + 1])
      }
    }
    await client.query("COMMIT")
    return Response.json({ ok: true, status: body.action, stamp })
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}