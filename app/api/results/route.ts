import { query } from "@/lib/db"
import { getCurrentUser, requireRole, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES, RESULT_WRITERS } from "@/lib/roles"
import { hodBranchOf } from "@/lib/account-approvals"
import { branchCodeFromDept } from "@/lib/curriculum-c20"

async function fetchResults(where: string, params: unknown[]) {
  const { rows } = await query(
    `SELECT r.id, r.reg_no AS reg, r.name, r.branch, r.sem, r.session, r.sgpa::float AS sgpa, r.result,
            COALESCE(json_agg(json_build_object(
              'name', s.name, 'code', s.code, 'internal', s.internal,
              'external', s.external, 'credits', s.credits, 'grade', s.grade
            ) ORDER BY s.ord) FILTER (WHERE s.id IS NOT NULL), '[]') AS subjects
       FROM results r
       LEFT JOIN result_subjects s ON s.result_id = r.id
       ${where}
       GROUP BY r.id
       ORDER BY r.reg_no, r.sem`,
    params,
  )
  return rows
}

function hodBranchLike(user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null }) {
  if (user.role !== "hod") return null
  const my = hodBranchOf(user)
  if (!my) return null
  const code = branchCodeFromDept(my)
  if (code === "CSE") return "%computer%"
  if (code === "CE") return "%civil%"
  if (code === "ECE") return "%electron%"
  if (code === "ME") return "%mech%"
  return `%${String(my).toLowerCase()}%`
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (user.role === "student") {
    return Response.json({ results: await fetchResults("WHERE r.reg_no = $1", [user.reg_no]) })
  }
  if (!STAFF_ROLES.includes(user.role)) return unauthorized()
  // HOD: only own department results
  const like = hodBranchLike(user)
  if (like) {
    return Response.json({
      results: await fetchResults("WHERE lower(COALESCE(r.branch,'')) LIKE $1", [like]),
    })
  }
  return Response.json({ results: await fetchResults("", []) })
}

export async function POST(req: Request) {
  const user = await requireRole(...RESULT_WRITERS)
  if (!user) return unauthorized()
  const b = await req.json().catch(() => null)
  if (!b?.reg || !b?.sem || !b?.session || !Array.isArray(b.subjects)) {
    return badRequest("reg, sem, session and subjects[] are required")
  }
  const { rows } = await query(
    `INSERT INTO results (reg_no, name, branch, sem, session, sgpa, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (reg_no, sem, session) DO UPDATE SET
       name=EXCLUDED.name, branch=EXCLUDED.branch, sgpa=EXCLUDED.sgpa, result=EXCLUDED.result
     RETURNING id`,
    [b.reg, b.name ?? "", b.branch ?? "", b.sem, b.session, b.sgpa ?? null, b.result ?? "Pass"],
  )
  const resultId = rows[0].id
  await query("DELETE FROM result_subjects WHERE result_id = $1", [resultId])
  for (let i = 0; i < b.subjects.length; i++) {
    const s = b.subjects[i]
    await query(
      `INSERT INTO result_subjects (result_id, name, code, internal, external, credits, grade, ord)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [resultId, s.name ?? "", s.code ?? "", s.internal ?? 0, s.external ?? 0, s.credits ?? 0, s.grade ?? "", i + 1],
    )
  }
  return Response.json({ ok: true, id: resultId })
}
