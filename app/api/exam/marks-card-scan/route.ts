/**
 * Student marks-card scan → auto-fill result fields.
 * Image is stored only temporarily and deleted after processing.
 */

import { getCurrentUser, unauthorized, badRequest } from "@/lib/auth"
import {
  curriculumForStudentWithPathway,
  loadStudentContext,
} from "@/lib/exam-results"
import {
  callXaiMarksCardVision,
  deleteTempMarksCard,
  loadAndConsumeTempMarksCard,
  matchExtractedToCurriculum,
  parseVisionJson,
  purgeExpiredMarksCardImages,
  storeTempMarksCard,
  type MarksCardExtract,
} from "@/lib/marks-card-scan"

export const maxDuration = 120

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB raw base64 budget ~6MB image

function stripDataUrl(dataUrl: string): { mime: string; b64: string; dataUrl: string } {
  const m = String(dataUrl || "").match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i)
  if (m) {
    const mime = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase()
    return { mime, b64: m[2], dataUrl: `data:${mime};base64,${m[2]}` }
  }
  // bare base64
  const b64 = String(dataUrl || "").replace(/\s+/g, "")
  return { mime: "image/jpeg", b64, dataUrl: `data:image/jpeg;base64,${b64}` }
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  if (user.role !== "student" || !user.reg_no) {
    return badRequest("Only students can scan their marks card")
  }

  await purgeExpiredMarksCardImages()

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return badRequest("JSON body required")

  const action = String(b.action || "scan").toLowerCase()

  // Optional: store only (rare) — we usually scan in one shot
  if (action === "store") {
    const img = stripDataUrl(String(b.image || b.data_url || ""))
    if (!img.b64 || img.b64.length < 100) return badRequest("Image required")
    if (img.b64.length > MAX_BYTES) {
      return badRequest("Image too large. Compress or retake a clearer photo under ~6 MB.")
    }
    const { id } = await storeTempMarksCard({
      reg_no: user.reg_no,
      mime: img.mime,
      image_b64: img.b64,
    })
    return Response.json({
      ok: true,
      temp_id: id,
      note: "Image stored temporarily (15 min). Call action=scan with temp_id, or it will be deleted after scan.",
    })
  }

  if (action === "discard") {
    const tid = Number(b.temp_id)
    if (tid) await deleteTempMarksCard(tid, user.reg_no)
    return Response.json({ ok: true, deleted: true })
  }

  // --- scan ---
  let dataUrl = ""
  let tempId: number | null = null
  let mime = "image/jpeg"

  if (b.temp_id != null) {
    tempId = Number(b.temp_id)
    const row = await loadAndConsumeTempMarksCard(tempId, user.reg_no)
    if (!row) {
      return badRequest("Temporary image not found or expired. Please upload again.")
    }
    mime = row.mime
    dataUrl = `data:${mime};base64,${row.image_b64}`
    // already deleted by loadAndConsume
    tempId = null
  } else {
    const img = stripDataUrl(String(b.image || b.data_url || ""))
    if (!img.b64 || img.b64.length < 100) {
      return badRequest("Upload a clear marks card image (JPEG/PNG).")
    }
    if (img.b64.length > MAX_BYTES) {
      return badRequest("Image too large. Upload a clearer, smaller photo (under ~6 MB).")
    }
    // Store then immediately consume so DB only holds it during processing window
    const stored = await storeTempMarksCard({
      reg_no: user.reg_no,
      mime: img.mime,
      image_b64: img.b64,
    })
    tempId = stored.id
    const row = await loadAndConsumeTempMarksCard(stored.id, user.reg_no)
    if (!row) {
      return badRequest("Could not process temporary image. Please re-upload.")
    }
    mime = row.mime
    dataUrl = `data:${mime};base64,${row.image_b64}`
    tempId = null
  }

  const ctx = await loadStudentContext(user.reg_no)
  if (!ctx) return badRequest("Student profile not found")
  if (ctx.scheme === "C-25") {
    return badRequest("C-25 marks-card scan is not available yet.")
  }

  const semesterHint =
    b.semester != null && Number(b.semester) >= 1 && Number(b.semester) <= 6
      ? Number(b.semester)
      : null

  const packed = await curriculumForStudentWithPathway({ ...ctx, reg_no: user.reg_no })
  let curriculum = packed.subjects || []
  if (semesterHint) {
    curriculum = curriculum.filter((s) => Number(s.semester) === semesterHint)
  }
  const hint = curriculum
    .map((s) => `Sem ${s.semester}: ${s.code} — ${s.name}`)
    .slice(0, 80)
    .join("\n")

  let raw = ""
  let model = ""
  try {
    const v = await callXaiMarksCardVision({
      dataUrl,
      expectedSem: semesterHint,
      expectedReg: user.reg_no,
      curriculumHint: hint || "(curriculum empty — extract all visible rows)",
    })
    raw = v.raw
    model = v.model
  } catch (e) {
    // Ensure no leftover temp
    if (tempId) await deleteTempMarksCard(tempId, user.reg_no)
    const msg = e instanceof Error ? e.message : "Scan failed"
    return Response.json(
      {
        ok: false,
        readable: false,
        error: msg,
        message:
          msg.includes("XAI_API_KEY")
            ? msg
            : "Could not read the image. Please upload a NEW clearer photo of the full marks card (good light, no blur, all grades visible).",
      },
      { status: 422 },
    )
  }

  const parsed = parseVisionJson(raw)
  if (!parsed) {
    return Response.json(
      {
        ok: false,
        readable: false,
        error: "Could not parse marks card data",
        message:
          "The marks card could not be read reliably. Please upload a NEW clearer image (straight-on, full card, good lighting).",
        raw_preview: raw.slice(0, 400),
      },
      { status: 422 },
    )
  }

  if (parsed.readable === false) {
    return Response.json(
      {
        ok: false,
        readable: false,
        unreadable_reason: parsed.unreadable_reason || "Image not clear enough",
        message:
          (parsed.unreadable_reason || "Some text is not visible on this image.") +
          " Please upload a NEW clearer marks card photo — full page, sharp focus, no glare.",
        image_deleted: true,
      },
      { status: 422 },
    )
  }

  const subjectsRaw = Array.isArray(parsed.subjects) ? parsed.subjects : []
  if (!subjectsRaw.length) {
    return Response.json(
      {
        ok: false,
        readable: false,
        message:
          "No subject rows were visible. Please upload a NEW clearer image of the full marks table.",
        image_deleted: true,
      },
      { status: 422 },
    )
  }

  const firstSess =
    subjectsRaw[0] && subjectsRaw[0].exam_session != null
      ? String(subjectsRaw[0].exam_session)
      : ""
  const defaultSession =
    (parsed.exam_session != null ? String(parsed.exam_session) : "") || firstSess || ""

  // Match against semester-filtered curriculum, else full
  let matchPool = curriculum
  const sem =
    parsed.semester != null && Number(parsed.semester) >= 1
      ? Number(parsed.semester)
      : semesterHint
  if (sem && !semesterHint) {
    matchPool = (packed.subjects || []).filter((s) => Number(s.semester) === sem)
    if (!matchPool.length) matchPool = packed.subjects || []
  }

  const matched = matchExtractedToCurriculum(
    subjectsRaw.map((s) => ({
      code: s.code != null ? String(s.code) : "",
      name: s.name != null ? String(s.name) : "",
      grade: s.grade != null ? String(s.grade) : "",
      result: s.result != null ? String(s.result) : "",
      exam_session:
        s.exam_session != null && String(s.exam_session).trim()
          ? String(s.exam_session)
          : defaultSession,
      confidence: s.confidence != null ? Number(s.confidence) : 0.8,
    })),
    matchPool,
    defaultSession,
  )

  const matchedOk = matched.filter((m) => m.matched && m.grade)
  const unmatched = matched.filter((m) => !m.matched)
  const lowConf = matchedOk.filter((m) => m.confidence < 0.55)

  const warnings = [
    ...(Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : []),
  ]
  if (unmatched.length) {
    warnings.push(
      `${unmatched.length} row(s) on the card could not be matched to your C-20 subjects — check codes or semester.`,
    )
  }
  if (lowConf.length) {
    warnings.push(`${lowConf.length} grade(s) had lower confidence — verify carefully before submit.`)
  }
  if (parsed.reg_no && user.reg_no) {
    const cardReg = String(parsed.reg_no).replace(/\s+/g, "").toUpperCase()
    const mine = user.reg_no.replace(/\s+/g, "").toUpperCase()
    if (cardReg && cardReg !== mine && !cardReg.includes(mine) && !mine.includes(cardReg)) {
      warnings.push(
        `Reg no on card (${parsed.reg_no}) differs from your login (${user.reg_no}). Double-check this is YOUR marks card.`,
      )
    }
  }

  const result: MarksCardExtract = {
    readable: true,
    unreadable_reason: null,
    semester: sem,
    exam_session: defaultSession || null,
    reg_no_on_card: parsed.reg_no ? String(parsed.reg_no) : null,
    subjects: matched,
    warnings,
    model,
  }

  return Response.json({
    ok: true,
    readable: true,
    image_deleted: true,
    message:
      matchedOk.length > 0
        ? `Filled ${matchedOk.length} subject(s) from your marks card. Review every field, then Save draft or Submit.`
        : "Card was readable but no subjects matched your curriculum. Check semester and try again.",
    fill: {
      semester: sem,
      exam_session: defaultSession || null,
      subjects: matchedOk.map((s) => ({
        subject_code: s.code,
        subject_name: s.name,
        grade: s.grade,
        result: s.result,
        exam_session: s.exam_session,
        confidence: s.confidence,
      })),
    },
    extract: result,
  })
}
