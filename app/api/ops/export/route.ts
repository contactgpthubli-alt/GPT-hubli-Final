import { getCurrentUser, unauthorized } from "@/lib/auth"
import { query } from "@/lib/db"
import { hodBranchOf } from "@/lib/account-approvals"
import { branchCodeFromDept } from "@/lib/curriculum-c20"
import {
  ensureStudentOpsSchema,
  canReadOps,
  buildSemFailMap,
  feeExportFields,
  entryTypeLabel,
  exportFilename,
  parseOpsFlags,
} from "@/lib/student-ops"

function branchLike(user: { role: string; branch?: string | null; reg_no?: string | null; display_name?: string | null }) {
  if (user.role !== "hod") return null
  const my = hodBranchOf(user)
  if (!my) return "___none___"
  const code = branchCodeFromDept(my)
  if (code === "CSE") return "%computer%"
  if (code === "CE") return "%civil%"
  if (code === "ECE") return "%electron%"
  if (code === "ME") return "%mech%"
  return `%${my.toLowerCase()}%`
}

/**
 * GET /api/ops/export?branch=
 * Excel export: reg, name, father, branch, gender, sem1-6, type, K2, fine.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!canReadOps(user.role)) return unauthorized()
  await ensureStudentOpsSchema()

  const url = new URL(req.url)
  const branchQ = (url.searchParams.get("branch") || "").trim()
  const like = branchLike(user)
  const params: unknown[] = []
  let branchSql = ""
  if (like) {
    params.push(like)
    branchSql = ` AND (lower(COALESCE(s.dept,'')) LIKE $${params.length} OR lower(COALESCE(u.branch,'')) LIKE $${params.length})`
  } else if (branchQ) {
    params.push(`%${branchQ.toLowerCase()}%`)
    branchSql = ` AND (lower(COALESCE(s.dept,'')) LIKE $${params.length} OR lower(COALESCE(u.branch,'')) LIKE $${params.length})`
  }

  const { rows: students } = await query(
    `SELECT s.reg_no, s.name, s.dept, s.father, s.extra, s.entry_type, s.ops_flags,
            u.branch AS user_branch
       FROM students s
       LEFT JOIN users u ON u.reg_no = s.reg_no AND u.role = 'student' AND u.deleted_at IS NULL
      WHERE (s.name IS NULL OR s.name NOT LIKE '[MOVED]%')
        ${branchSql}
      ORDER BY s.dept, s.name
      LIMIT 8000`,
    params,
  )

  const regs = students.map((s) => String(s.reg_no).toUpperCase())
  const semMap = await buildSemFailMap(regs)

  const feeMap = new Map<string, Record<string, unknown>>()
  if (regs.length) {
    const { rows: fees } = await query(
      `SELECT DISTINCT ON (UPPER(reg_no))
              UPPER(reg_no) AS reg, status, fine_amount, challans, paid_marked_at
         FROM exam_fee_payments
        WHERE exam_cycle = 'current' AND UPPER(reg_no) = ANY($1::text[])
        ORDER BY UPPER(reg_no), updated_at DESC NULLS LAST, id DESC`,
      [regs],
    )
    for (const f of fees) feeMap.set(String(f.reg).toUpperCase(), f)
  }

  const headers = [
    "Reg. No",
    "Name",
    "Father Name",
    "Branch",
    "Gender",
    "Sem 1",
    "Sem 2",
    "Sem 3",
    "Sem 4",
    "Sem 5",
    "Sem 6",
    "Entry Type",
    "K2 Challan No",
    "K2 Amount Paid",
    "Amount Paid Date",
    "Fine Fees",
  ]

  const aoa: (string | number)[][] = [headers]
  for (const s of students) {
    const reg = String(s.reg_no).toUpperCase()
    const extra =
      s.extra && typeof s.extra === "object" && !Array.isArray(s.extra)
        ? (s.extra as Record<string, unknown>)
        : {}
    const gender = String(extra["Gender"] || extra["gender"] || extra["Sex"] || "").trim()
    const father = String(s.father || extra["Father Name"] || extra["Father"] || "").trim()
    const cells = semMap.get(reg) || {}
    const fee = feeExportFields(feeMap.get(reg) as never)
    aoa.push([
      reg,
      s.name || "",
      father,
      s.dept || s.user_branch || "",
      gender,
      cells[1] || "",
      cells[2] || "",
      cells[3] || "",
      cells[4] || "",
      cells[5] || "",
      cells[6] || "",
      entryTypeLabel({ entry_type: s.entry_type, ops_flags: parseOpsFlags(s.ops_flags) }),
      fee.paid ? fee.k2_no : "",
      fee.paid && fee.k2_amount != null ? fee.k2_amount : "",
      fee.paid ? fee.k2_date : "",
      fee.fine || 0,
    ])
  }

  let code: string | null = null
  if (user.role === "hod") {
    code = branchCodeFromDept(hodBranchOf(user) || "") || "HOD"
  } else if (branchQ) {
    code = branchCodeFromDept(branchQ) || branchQ.slice(0, 6).toUpperCase()
  } else {
    code = "ALL"
  }
  const filename = exportFilename(code)

  // Prefer xlsx package; fallback to CSV
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx")
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    XLSX.utils.book_append_sheet(wb, ws, "Students")
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch {
    const csv = aoa
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? "")
            if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
            return s
          })
          .join(","),
      )
      .join("\r\n")
    const csvName = filename.replace(/\.xlsx$/i, ".csv")
    return new Response("\uFEFF" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvName}"`,
        "Cache-Control": "no-store",
      },
    })
  }
}
