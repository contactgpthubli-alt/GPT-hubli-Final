import { query } from "@/lib/db"
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/roles"

const TC_STAFF = ["admin", "acm", "registrar", "principal"]

function canProcess(role: string) {
  return TC_STAFF.includes(role)
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (!STAFF_ROLES.includes(user.role) && user.role !== "admin") return unauthorized()

  const { searchParams } = new URL(req.url)
  const kind = (searchParams.get("kind") || "register").trim()

  if (kind === "template") {
    const { rows } = await query(
      `SELECT * FROM tc_templates WHERE scope = 'default' LIMIT 1`,
    )
    return Response.json(
      { template: rows[0] || null },
      { headers: { "Cache-Control": "no-store" } },
    )
  }

  // register list
  const status = (searchParams.get("status") || "").trim()
  const q = (searchParams.get("q") || "").trim()
  const where: string[] = []
  const params: unknown[] = []
  if (status) {
    params.push(status)
    where.push(`status = $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    where.push(
      `(reg_no ILIKE $${params.length} OR student_name ILIKE $${params.length} OR tc_no ILIKE $${params.length})`,
    )
  }
  const sql = `
    SELECT * FROM tc_register
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY
      CASE status WHEN 'printed_pending' THEN 0 WHEN 'draft' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
      COALESCE(printed_at, created_at) DESC
    LIMIT 500`
  const { rows } = await query(sql, params)
  return Response.json(
    { register: rows },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user || !canProcess(user.role)) return unauthorized()

  try {
    return await handleTcPost(req, user)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[tc POST]", msg)
    return Response.json({ error: msg || "Server error" }, { status: 500 })
  }
}

async function handleTcPost(req: Request, user: { id: number | string; role: string }) {
  const b = await req.json().catch(() => null)
  if (!b) return badRequest("Invalid body")

  const action = String(b.action || "save_draft").trim()
  // node-pg may return users.id as string; printed_by / updated_by are bigint
  const printedById = Number(user.id)
  const printedByParam = Number.isFinite(printedById) ? printedById : null

  if (action === "save_template") {
    if (user.role !== "admin") return unauthorized("Only admin can edit TC template")
    const labels = b.labels && typeof b.labels === "object" ? b.labels : {}
    const header = b.header && typeof b.header === "object" ? b.header : {}
    const footer = b.footer && typeof b.footer === "object" ? b.footer : {}
    const { rows } = await query(
      `INSERT INTO tc_templates (scope, labels, header, footer, updated_by, updated_at)
       VALUES ('default', $1::jsonb, $2::jsonb, $3::jsonb, $4::bigint, now())
       ON CONFLICT (scope) DO UPDATE SET
         labels = EXCLUDED.labels,
         header = EXCLUDED.header,
         footer = EXCLUDED.footer,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [JSON.stringify(labels), JSON.stringify(header), JSON.stringify(footer), printedByParam],
    )
    return Response.json({ ok: true, template: rows[0] })
  }

  // Create / update TC register entry
  const regNo = String(b.regNo || b.reg_no || "").trim()
  if (!regNo) return badRequest("regNo is required")

  const formData = b.formData && typeof b.formData === "object" ? b.formData : {}
  const tcNo = String(b.tcNo || b.tc_no || formData.tc_no || "").trim()
  if (!tcNo) return badRequest("Transfer Certificate No. is required")

  const admissionRegNo = String(
    b.admissionRegNo || b.admission_reg_no || formData.admission_reg_no || "",
  ).trim()

  const studentName = String(b.studentName || formData.student_name || "").trim()
  const fatherName = String(b.fatherName || formData.father_name || "").trim()
  const motherName = String(b.motherName || formData.mother_name || "").trim()
  const branch = String(b.branch || formData.branch || "").trim()
  const rawReqId = b.certRequestId ?? b.cert_request_id ?? null
  const certRequestId =
    rawReqId != null && String(rawReqId).trim() !== "" && Number.isFinite(Number(rawReqId))
      ? Number(rawReqId)
      : null
  const remarks = b.remarks != null ? String(b.remarks) : ""

  let status = String(b.status || "draft").trim()
  if (!["draft", "printed_pending", "completed"].includes(status)) status = "draft"

  const tcSent = String(b.tcSent || b.tc_sent || "").trim()
  const poReceipt = String(b.postOfficeReceipt || b.post_office_receipt || "").trim()

  // Complete only when dispatch fields filled (college · date + PO receipt)
  if (action === "complete" || status === "completed") {
    if (!tcSent || !poReceipt) {
      return badRequest(
        "TC sent to college, TC sent date, and Post Office Receipt Number are required to complete",
      )
    }
    status = "completed"
  }

  if (action === "print") {
    status = "printed_pending"
  }

  const id = b.id ? Number(b.id) : null
  const printFlag = action === "print" ? "print" : status

  if (id && Number.isFinite(id)) {
    const { rows } = await query(
      `UPDATE tc_register SET
         tc_no = $2,
         admission_reg_no = $3,
         reg_no = $4,
         student_name = $5,
         father_name = $6,
         mother_name = $7,
         branch = $8,
         form_data = $9::jsonb,
         cert_request_id = COALESCE($10::bigint, cert_request_id),
         printed_at = CASE WHEN $11 = 'print' OR $12 = 'printed_pending' THEN COALESCE(printed_at, now()) ELSE printed_at END,
         printed_by = CASE WHEN $11 = 'print' THEN $13::bigint ELSE printed_by END,
         tc_sent = COALESCE(NULLIF($14, ''), tc_sent),
         post_office_receipt = COALESCE(NULLIF($15, ''), post_office_receipt),
         status = $12,
         remarks = COALESCE(NULLIF($16, ''), remarks),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        tcNo,
        admissionRegNo,
        regNo.toUpperCase(),
        studentName,
        fatherName,
        motherName,
        branch,
        JSON.stringify(formData),
        certRequestId,
        action,
        status,
        printedByParam,
        tcSent,
        poReceipt,
        remarks,
      ],
    )
    if (!rows.length) return badRequest("Register entry not found")

    // If linked cert request and print/complete, advance request
    if (rows[0].cert_request_id && (action === "print" || status === "printed_pending")) {
      await query(
        `UPDATE cert_requests SET status = 'processing',
           remarks = COALESCE(remarks, '') || ' | TC form opened / printed at ACM.'
         WHERE id = $1 AND status IN ('pending', 'processing')`,
        [rows[0].cert_request_id],
      )
    }
    if (rows[0].cert_request_id && status === "completed") {
      await query(
        `UPDATE cert_requests SET status = 'ready',
           remarks = 'TC printed and dispatched. PO Receipt: ' || $2
         WHERE id = $1`,
        [rows[0].cert_request_id, poReceipt],
      )
    }

    return Response.json({ ok: true, entry: rows[0] }, { headers: { "Cache-Control": "no-store" } })
  }

  // Insert new
  const { rows } = await query(
    `INSERT INTO tc_register (
       tc_no, admission_reg_no, reg_no, student_name, father_name, mother_name, branch,
       form_data, cert_request_id, printed_at, printed_by, tc_sent, post_office_receipt, status, remarks
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::bigint,
       CASE WHEN $10 IN ('print','printed_pending') THEN now() ELSE NULL END,
       CASE WHEN $10 = 'print' THEN $11::bigint ELSE NULL END,
       $12,$13,$14,$15
     ) RETURNING *`,
    [
      tcNo,
      admissionRegNo,
      regNo.toUpperCase(),
      studentName,
      fatherName,
      motherName,
      branch,
      JSON.stringify(formData),
      certRequestId,
      printFlag,
      printedByParam,
      tcSent,
      poReceipt,
      status,
      remarks,
    ],
  )

  if (rows[0].cert_request_id && action === "print") {
    await query(
      `UPDATE cert_requests SET status = 'processing',
         remarks = COALESCE(remarks, '') || ' | TC printed at ACM (pending dispatch).'
       WHERE id = $1 AND status IN ('pending', 'processing')`,
      [rows[0].cert_request_id],
    )
  }

  return Response.json({ ok: true, entry: rows[0] }, { headers: { "Cache-Control": "no-store" } })
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user || !canProcess(user.role)) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b?.id) return badRequest("id is required")

  const tcSent = b.tcSent != null ? String(b.tcSent).trim() : null
  const poReceipt = b.postOfficeReceipt != null ? String(b.postOfficeReceipt).trim() : null
  const remarks = b.remarks != null ? String(b.remarks) : null
  let status = b.status != null ? String(b.status).trim() : null

  // Load current
  const { rows: cur } = await query(`SELECT * FROM tc_register WHERE id = $1`, [b.id])
  if (!cur.length) return badRequest("Not found")
  const entry = cur[0]

  const nextSent = tcSent != null ? tcSent : String(entry.tc_sent || "")
  const nextPo = poReceipt != null ? poReceipt : String(entry.post_office_receipt || "")

  if (status === "completed" || b.action === "complete") {
    if (!nextSent || !nextPo) {
      return badRequest(
        "TC sent to college, TC sent date, and Post Office Receipt Number are required before completed",
      )
    }
    status = "completed"
  }

  const { rows } = await query(
    `UPDATE tc_register SET
       tc_sent = COALESCE($2, tc_sent),
       post_office_receipt = COALESCE($3, post_office_receipt),
       remarks = COALESCE($4, remarks),
       status = COALESCE($5, status),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [b.id, tcSent, poReceipt, remarks, status],
  )

  if (rows[0].status === "completed" && rows[0].cert_request_id) {
    await query(
      `UPDATE cert_requests SET status = 'ready',
         remarks = 'TC dispatched. Sent: ' || $2 || ' · PO Receipt: ' || $3
       WHERE id = $1`,
      [rows[0].cert_request_id, rows[0].tc_sent, rows[0].post_office_receipt],
    )
  }

  return Response.json({ ok: true, entry: rows[0] }, { headers: { "Cache-Control": "no-store" } })
}
