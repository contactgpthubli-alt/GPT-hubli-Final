import { query } from "@/lib/db"
import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/roles"

const ACM_STAFF = ["admin", "acm", "registrar", "principal"]
const KINDS = ["study", "studying"] as const

function canProcess(role: string) {
  return ACM_STAFF.includes(role)
}

function normalizeKind(k: unknown): "study" | "studying" | null {
  const s = String(k || "")
    .trim()
    .toLowerCase()
  if (!s) return null
  if (s === "studying" || s.includes("studying")) return "studying"
  if (s === "study" || s.includes("study")) return "study"
  return null
}

function photoFromExtra(extra: unknown): string {
  if (!extra || typeof extra !== "object") return ""
  const e = extra as Record<string, unknown>
  for (const k of ["Profile Photo", "profile_photo", "photo", "Photo"]) {
    const v = e[k]
    if (typeof v === "string" && v.indexOf("data:image/") === 0) return v
  }
  // case-insensitive scan
  for (const [k, v] of Object.entries(e)) {
    if (/profile\s*photo|^photo$/i.test(k) && typeof v === "string" && v.indexOf("data:image/") === 0) {
      return v
    }
  }
  return ""
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const kindParam = (searchParams.get("kind") || "register").trim()
  const certKind = normalizeKind(searchParams.get("cert_kind") || searchParams.get("type") || "")

  // Student: issued certificates released by ACM for self-print
  if (user.role === "student" || kindParam === "mine") {
    if (user.role !== "student") return unauthorized()
    const reg = String(user.reg_no || "").trim()
    if (!reg) return Response.json({ certificates: [] }, { headers: { "Cache-Control": "no-store" } })
    const { rows } = await query(
      `SELECT r.*, s.extra AS student_extra
         FROM acm_cert_register r
         LEFT JOIN students s ON upper(s.reg_no) = upper(r.reg_no)
        WHERE upper(r.reg_no) = upper($1)
          AND r.sent_to_student = true
          AND r.status = 'completed'
        ORDER BY COALESCE(r.sent_to_student_at, r.updated_at) DESC
        LIMIT 100`,
      [reg],
    )
    const certificates = rows.map((row) => {
      const form = (row.form_data && typeof row.form_data === "object" ? row.form_data : {}) as Record<
        string,
        unknown
      >
      const photo =
        (typeof form.photo === "string" && form.photo.indexOf("data:image/") === 0
          ? form.photo
          : "") || photoFromExtra(row.student_extra)
      // Don't send full student_extra / huge duplicate photo in two places
      const { student_extra: _se, ...rest } = row as Record<string, unknown>
      return { ...rest, photo }
    })
    return Response.json({ certificates }, { headers: { "Cache-Control": "no-store" } })
  }

  // Templates: staff can edit; students may read study/studying templates for self-print labels
  if (kindParam === "template") {
    if (!STAFF_ROLES.includes(user.role) && user.role !== "student") return unauthorized()
    const scope = certKind || "study"
    if (user.role === "student" && scope !== "study" && scope !== "studying") {
      return unauthorized()
    }
    const { rows } = await query(`SELECT * FROM tc_templates WHERE scope = $1 LIMIT 1`, [scope])
    return Response.json(
      { template: rows[0] || null },
      { headers: { "Cache-Control": "no-store" } },
    )
  }

  if (!STAFF_ROLES.includes(user.role)) return unauthorized()

  const status = (searchParams.get("status") || "").trim()
  const q = (searchParams.get("q") || "").trim()
  const where: string[] = []
  const params: unknown[] = []
  if (certKind) {
    params.push(certKind)
    where.push(`cert_kind = $${params.length}`)
  }
  if (status) {
    params.push(status)
    where.push(`status = $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    where.push(
      `(reg_no ILIKE $${params.length} OR student_name ILIKE $${params.length} OR cert_no ILIKE $${params.length})`,
    )
  }
  const sql = `
    SELECT * FROM acm_cert_register
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
    return await handleAcmCertPost(req, user)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[acm-certs POST]", msg)
    // Surface DB errors (e.g. missing column) so the UI is not a vague "500"
    return Response.json({ error: msg || "Server error" }, { status: 500 })
  }
}

async function handleAcmCertPost(req: Request, user: { id: number | string; role: string }) {
  const b = await req.json().catch(() => null)
  if (!b) return badRequest("Invalid body")

  const action = String(b.action || "save_draft").trim()
  // users.id may arrive as string from the driver — printed_by is bigint
  const printedById = Number(user.id)
  const printedByParam = Number.isFinite(printedById) ? printedById : null

  // Release certificate to student portal for self-print
  if (action === "send_to_student") {
    const id = Number(b.id)
    if (!Number.isFinite(id)) return badRequest("id is required")
    // Ensure send-to-student columns exist (migration 009 may not have been run)
    await query(
      `ALTER TABLE acm_cert_register
         ADD COLUMN IF NOT EXISTS sent_to_student BOOLEAN NOT NULL DEFAULT false`,
    )
    await query(
      `ALTER TABLE acm_cert_register
         ADD COLUMN IF NOT EXISTS sent_to_student_at TIMESTAMPTZ`,
    )
    const { rows: cur } = await query(`SELECT * FROM acm_cert_register WHERE id = $1`, [id])
    if (!cur.length) return badRequest("Register entry not found")
    // Study/Studying: allow send once issued (completed or printed_pending)
    const st = String(cur[0].status || "")
    if (st !== "completed" && st !== "printed_pending") {
      // Auto-promote draft → completed so ACM can send after filling the form
      if (st === "draft") {
        await query(
          `UPDATE acm_cert_register SET status = 'completed', updated_at = now() WHERE id = $1`,
          [id],
        )
      } else {
        return badRequest("Save / print the certificate first, then send to student")
      }
    }
    const { rows } = await query(
      `UPDATE acm_cert_register SET
         status = CASE WHEN status = 'draft' THEN 'completed' ELSE status END,
         sent_to_student = true,
         sent_to_student_at = now(),
         remarks = CASE
           WHEN remarks IS NULL OR remarks = '' THEN 'Released to student portal for print.'
           ELSE remarks || ' | Released to student portal for print.'
         END,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id],
    )
    if (rows[0].cert_request_id) {
      await query(
        `UPDATE cert_requests SET status = 'ready',
           remarks = 'Certificate ready. Available in student portal under Certificates → My Requests (Print).'
         WHERE id = $1`,
        [rows[0].cert_request_id],
      )
    }
    return Response.json({ ok: true, entry: rows[0] }, { headers: { "Cache-Control": "no-store" } })
  }

  if (action === "save_template") {
    if (user.role !== "admin") return unauthorized("Only admin can edit certificate templates")
    const scope = normalizeKind(b.certKind || b.scope)
    if (!scope) return badRequest("certKind must be study or studying")
    const labels = b.labels && typeof b.labels === "object" ? b.labels : {}
    const header = b.header && typeof b.header === "object" ? b.header : {}
    const footer = b.footer && typeof b.footer === "object" ? b.footer : {}
    const { rows } = await query(
      `INSERT INTO tc_templates (scope, labels, header, footer, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::bigint, now())
       ON CONFLICT (scope) DO UPDATE SET
         labels = EXCLUDED.labels,
         header = EXCLUDED.header,
         footer = EXCLUDED.footer,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [scope, JSON.stringify(labels), JSON.stringify(header), JSON.stringify(footer), printedByParam],
    )
    return Response.json({ ok: true, template: rows[0] })
  }

  const certKind = normalizeKind(b.certKind || b.cert_kind || b.type)
  if (!certKind) return badRequest("certKind must be study or studying")

  const regNo = String(b.regNo || b.reg_no || "").trim()
  if (!regNo) return badRequest("regNo is required")

  const formData = b.formData && typeof b.formData === "object" ? b.formData : {}
  const certNo = String(b.certNo || b.cert_no || formData.cert_no || "").trim()
  if (!certNo) return badRequest("Certificate No. is required")

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

  const sentCollege = String(b.sentToCollege || b.sent_to_college || formData.sent_to_college || "").trim()
  const sentDate = String(b.sentDate || b.sent_date || formData.tc_sent_date || formData.sent_date || "").trim()
  const poReceipt = String(b.postOfficeReceipt || b.post_office_receipt || formData.po_receipt || "").trim()

  // Study/Studying certificates do not use college/PO dispatch (unlike TC)
  const skipDispatch = b.skipDispatch === true || certKind === "study" || certKind === "studying"
  if (action === "complete" || status === "completed") {
    if (!skipDispatch && (!sentCollege || !sentDate || !poReceipt)) {
      return badRequest(
        "Sent to college, sent date, and Post Office Receipt Number are required to complete",
      )
    }
    status = "completed"
  }
  // Print for study/studying also marks completed so Send to Student works immediately
  if (action === "print") {
    status = skipDispatch ? "completed" : "printed_pending"
  }

  // Mark as printed when completing study/studying (Print A4 or Send saves as complete)
  const markPrinted =
    action === "print" ||
    status === "printed_pending" ||
    (skipDispatch && (action === "complete" || status === "completed"))

  const id = b.id ? Number(b.id) : null

  if (id && Number.isFinite(id)) {
    const { rows } = await query(
      `UPDATE acm_cert_register SET
         cert_kind = $2,
         cert_no = $3,
         reg_no = $4,
         student_name = $5,
         father_name = $6,
         mother_name = $7,
         branch = $8,
         form_data = $9::jsonb,
         cert_request_id = COALESCE($10::bigint, cert_request_id),
         printed_at = CASE WHEN $11::boolean THEN COALESCE(printed_at, now()) ELSE printed_at END,
         printed_by = CASE WHEN $11::boolean THEN COALESCE(printed_by, $12::bigint) ELSE printed_by END,
         sent_to_college = COALESCE(NULLIF($13, ''), sent_to_college),
         sent_date = COALESCE(NULLIF($14, ''), sent_date),
         post_office_receipt = COALESCE(NULLIF($15, ''), post_office_receipt),
         status = $16,
         remarks = COALESCE(NULLIF($17, ''), remarks),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        certKind,
        certNo,
        regNo.toUpperCase(),
        studentName,
        fatherName,
        motherName,
        branch,
        JSON.stringify(formData),
        certRequestId,
        markPrinted,
        printedByParam,
        sentCollege,
        sentDate,
        poReceipt,
        status,
        remarks,
      ],
    )
    if (!rows.length) return badRequest("Register entry not found")
    await syncCertRequest(rows[0], action, status, sentCollege, poReceipt, skipDispatch)
    return Response.json({ ok: true, entry: rows[0] }, { headers: { "Cache-Control": "no-store" } })
  }

  const { rows } = await query(
    `INSERT INTO acm_cert_register (
       cert_kind, cert_no, reg_no, student_name, father_name, mother_name, branch,
       form_data, cert_request_id, printed_at, printed_by,
       sent_to_college, sent_date, post_office_receipt, status, remarks
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::bigint,
       CASE WHEN $10::boolean THEN now() ELSE NULL END,
       CASE WHEN $10::boolean THEN $11::bigint ELSE NULL END,
       $12,$13,$14,$15,$16
     ) RETURNING *`,
    [
      certKind,
      certNo,
      regNo.toUpperCase(),
      studentName,
      fatherName,
      motherName,
      branch,
      JSON.stringify(formData),
      certRequestId,
      markPrinted,
      printedByParam,
      sentCollege,
      sentDate,
      poReceipt,
      status,
      remarks,
    ],
  )
  await syncCertRequest(rows[0], action, status, sentCollege, poReceipt, skipDispatch)
  return Response.json({ ok: true, entry: rows[0] }, { headers: { "Cache-Control": "no-store" } })
}

async function syncCertRequest(
  entry: { cert_request_id?: number | null; id?: number },
  action: string,
  status: string,
  sentCollege: string,
  poReceipt: string,
  skipDispatch = false,
) {
  if (!entry.cert_request_id) return
  if (action === "print" || status === "printed_pending") {
    await query(
      `UPDATE cert_requests SET status = 'processing',
         remarks = COALESCE(remarks, '') || ' | Certificate printed at ACM' ||
           CASE WHEN $2 THEN '.' ELSE ' (pending dispatch).' END
       WHERE id = $1 AND status IN ('pending', 'processing')`,
      [entry.cert_request_id, skipDispatch],
    )
  }
  if (status === "completed") {
    const remarks = skipDispatch
      ? "Study/Studying certificate issued at ACM. Use Send to Student for portal print."
      : `Certificate dispatched. Sent to: ${sentCollege || "—"} · PO: ${poReceipt || "—"}`
    await query(
      `UPDATE cert_requests SET status = 'ready', remarks = $2 WHERE id = $1`,
      [entry.cert_request_id, remarks],
    )
  }
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user || !canProcess(user.role)) return unauthorized()

  const b = await req.json().catch(() => null)
  if (!b?.id) return badRequest("id is required")

  const sentCollege = b.sentToCollege != null ? String(b.sentToCollege).trim() : null
  const sentDate = b.sentDate != null ? String(b.sentDate).trim() : null
  const poReceipt = b.postOfficeReceipt != null ? String(b.postOfficeReceipt).trim() : null
  const remarks = b.remarks != null ? String(b.remarks) : null
  let status = b.status != null ? String(b.status).trim() : null

  const { rows: cur } = await query(`SELECT * FROM acm_cert_register WHERE id = $1`, [b.id])
  if (!cur.length) return badRequest("Not found")
  const entry = cur[0]

  const nextCollege = sentCollege != null ? sentCollege : String(entry.sent_to_college || "")
  const nextDate = sentDate != null ? sentDate : String(entry.sent_date || "")
  const nextPo = poReceipt != null ? poReceipt : String(entry.post_office_receipt || "")

  const entryKind = String(entry.cert_kind || "")
  const skipDispatchPatch =
    b.skipDispatch === true || entryKind === "study" || entryKind === "studying"
  if (status === "completed" || b.action === "complete") {
    if (!skipDispatchPatch && (!nextCollege || !nextDate || !nextPo)) {
      return badRequest("College, sent date, and PO receipt are required to complete")
    }
    status = "completed"
  }

  // Optional: send to student in same PATCH after complete
  const sendToStudent = b.sendToStudent === true || b.action === "send_to_student"

  const { rows } = await query(
    `UPDATE acm_cert_register SET
       sent_to_college = COALESCE($2, sent_to_college),
       sent_date = COALESCE($3, sent_date),
       post_office_receipt = COALESCE($4, post_office_receipt),
       remarks = COALESCE($5, remarks),
       status = COALESCE($6, status),
       sent_to_student = CASE WHEN $7 THEN true ELSE sent_to_student END,
       sent_to_student_at = CASE WHEN $7 THEN now() ELSE sent_to_student_at END,
       form_data = CASE
         WHEN $2 IS NOT NULL OR $3 IS NOT NULL THEN
           form_data || jsonb_build_object(
             'sent_to_college', COALESCE($2, form_data->>'sent_to_college'),
             'sent_date', COALESCE($3, form_data->>'sent_date')
           )
         ELSE form_data
       END,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [b.id, sentCollege, sentDate, poReceipt, remarks, status, sendToStudent && (status === "completed" || entry.status === "completed")],
  )

  if (rows[0].status === "completed" && rows[0].cert_request_id) {
    await query(
      `UPDATE cert_requests SET status = 'ready',
         remarks = 'Certificate dispatched. Sent to: ' || $2 || ' on ' || $3 || ' · PO: ' || $4
       WHERE id = $1`,
      [rows[0].cert_request_id, rows[0].sent_to_college, rows[0].sent_date, rows[0].post_office_receipt],
    )
  }
  if (rows[0].sent_to_student && rows[0].cert_request_id) {
    await query(
      `UPDATE cert_requests SET status = 'ready',
         remarks = 'Certificate ready on student portal (Certificates → My Requests → Print).'
       WHERE id = $1`,
      [rows[0].cert_request_id],
    )
  }

  return Response.json({ ok: true, entry: rows[0] }, { headers: { "Cache-Control": "no-store" } })
}
