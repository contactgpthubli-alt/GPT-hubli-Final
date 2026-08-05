/**
 * Temporary marks-card image store + C-20 field matching.
 * Images are deleted immediately after scan (or on expiry cleanup).
 */

import { query } from "@/lib/db"
import type { CurriculumSubject } from "@/lib/curriculum-c20"

let schemaReady = false

export async function ensureMarksCardScanSchema(): Promise<void> {
  if (schemaReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS exam_marks_card_temp (
      id           BIGSERIAL PRIMARY KEY,
      reg_no       TEXT NOT NULL,
      mime         TEXT NOT NULL DEFAULT 'image/jpeg',
      image_b64    TEXT NOT NULL,
      byte_size    INT  NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
      consumed_at  TIMESTAMPTZ
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_exam_marks_card_temp_reg ON exam_marks_card_temp(reg_no, created_at DESC)`,
  )
  schemaReady = true
}

/** Purge expired + consumed rows (best-effort). */
export async function purgeExpiredMarksCardImages(): Promise<void> {
  try {
    await ensureMarksCardScanSchema()
    await query(
      `DELETE FROM exam_marks_card_temp
        WHERE expires_at < now()
           OR consumed_at IS NOT NULL
           OR created_at < now() - interval '1 hour'`,
    )
  } catch {
    /* ignore */
  }
}

export async function storeTempMarksCard(input: {
  reg_no: string
  mime: string
  image_b64: string
}): Promise<{ id: number }> {
  await ensureMarksCardScanSchema()
  await purgeExpiredMarksCardImages()
  const b64 = input.image_b64.replace(/^data:image\/\w+;base64,/, "")
  const byte_size = Math.floor((b64.length * 3) / 4)
  const { rows } = await query(
    `INSERT INTO exam_marks_card_temp (reg_no, mime, image_b64, byte_size, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '15 minutes')
     RETURNING id`,
    [input.reg_no.toUpperCase(), input.mime || "image/jpeg", b64, byte_size],
  )
  return { id: Number(rows[0].id) }
}

export async function loadAndConsumeTempMarksCard(
  id: number,
  regNo: string,
): Promise<{ mime: string; image_b64: string } | null> {
  await ensureMarksCardScanSchema()
  const { rows } = await query(
    `SELECT id, mime, image_b64 FROM exam_marks_card_temp
      WHERE id = $1 AND UPPER(reg_no) = UPPER($2)
        AND consumed_at IS NULL AND expires_at > now()
      LIMIT 1`,
    [id, regNo],
  )
  const row = rows[0]
  if (!row) return null
  // Delete immediately after read — temporary only
  await query(`DELETE FROM exam_marks_card_temp WHERE id = $1`, [id])
  return { mime: String(row.mime), image_b64: String(row.image_b64) }
}

export async function deleteTempMarksCard(id: number, regNo?: string): Promise<void> {
  await ensureMarksCardScanSchema()
  if (regNo) {
    await query(`DELETE FROM exam_marks_card_temp WHERE id = $1 AND UPPER(reg_no) = UPPER($2)`, [
      id,
      regNo,
    ])
  } else {
    await query(`DELETE FROM exam_marks_card_temp WHERE id = $1`, [id])
  }
}

export type ExtractedSubject = {
  code: string
  name: string
  grade: string
  result: "pass" | "fail" | "absent"
  exam_session: string
  confidence: number
  matched: boolean
  match_note?: string
}

export type MarksCardExtract = {
  readable: boolean
  unreadable_reason: string | null
  semester: number | null
  exam_session: string | null
  reg_no_on_card: string | null
  subjects: ExtractedSubject[]
  warnings: string[]
  model: string
}

function normCode(c: string): string {
  return String(c || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function normName(n: string): string {
  return String(n || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function normalizeGrade(g: string): string {
  const raw = String(g || "").trim()
  if (!raw) return ""
  const u = raw.toUpperCase().replace(/\s+/g, "")
  if (u === "APLUS" || u === "A+") return "A+"
  if (u === "BPLUS" || u === "B+") return "B+"
  if (u === "CPLUS" || u === "C+") return "C+"
  if (["S", "O", "A", "B", "C", "D", "E", "F", "P", "W", "X", "AB"].includes(u)) return u === "AB" ? "Ab" : u
  if (u === "ABSENT" || u === "AB.") return "Ab"
  return raw
}

function normalizeResult(r: string, grade: string): "pass" | "fail" | "absent" {
  const s = String(r || "").toLowerCase()
  if (s.includes("absent") || s === "ab" || grade === "Ab") return "absent"
  if (s.includes("fail") || grade === "F" || grade === "F*" || grade === "F**") return "fail"
  if (s.includes("pass") || s.includes("promot")) return "pass"
  const g = grade.toUpperCase()
  if (["F", "AB", "W", "X"].includes(g)) return g === "AB" ? "absent" : "fail"
  if (g) return "pass"
  return "fail"
}

function normalizeSession(sess: string | null | undefined): string {
  if (!sess) return ""
  let s = String(sess).trim()
  // Common BTE forms → our dropdown labels
  s = s.replace(/\s+/g, " ")
  const m = s.match(/(20\d{2})\s*[-–/]\s*(\d{2}).*(nov|dec|april|apr|may|oct)/i)
  if (m) {
    const ay = `${m[1]}-${m[2]}`
    const mon = m[3].toLowerCase()
    if (mon.startsWith("nov") || mon.startsWith("dec") || mon.startsWith("oct")) {
      return `${ay} November`
    }
    return `${ay} April`
  }
  // already like 2024-25 November
  if (/20\d{2}-\d{2}\s+(November|April)/i.test(s)) {
    return s.replace(/november/i, "November").replace(/april/i, "April")
  }
  return s
}

/** Match extracted rows onto C-20 curriculum subjects for the semester. */
export function matchExtractedToCurriculum(
  extracted: Array<{
    code?: string
    name?: string
    grade?: string
    result?: string
    exam_session?: string
    confidence?: number
  }>,
  curriculum: CurriculumSubject[],
  defaultSession: string,
): ExtractedSubject[] {
  const used = new Set<string>()
  const out: ExtractedSubject[] = []

  for (const raw of extracted) {
    const grade = normalizeGrade(raw.grade || "")
    const result = normalizeResult(raw.result || "", grade)
    const session = normalizeSession(raw.exam_session) || defaultSession
    const conf = Math.max(0, Math.min(1, Number(raw.confidence) || 0.7))
    const codeN = normCode(raw.code || "")
    const nameN = normName(raw.name || "")

    let hit: CurriculumSubject | undefined
    let note = ""

    if (codeN) {
      hit = curriculum.find((c) => normCode(c.code) === codeN && !used.has(c.code))
      if (!hit) {
        hit = curriculum.find(
          (c) => normCode(c.code).includes(codeN) || codeN.includes(normCode(c.code)),
        )
        if (hit && used.has(hit.code)) hit = undefined
      }
    }
    if (!hit && nameN) {
      hit = curriculum.find((c) => {
        if (used.has(c.code)) return false
        const cn = normName(c.name)
        return cn === nameN || cn.includes(nameN) || nameN.includes(cn)
      })
      if (hit) note = "Matched by subject name"
    }

    if (hit) {
      used.add(hit.code)
      out.push({
        code: hit.code,
        name: hit.name,
        grade,
        result,
        exam_session: session,
        confidence: conf,
        matched: true,
        match_note: note || undefined,
      })
    } else {
      out.push({
        code: raw.code || "",
        name: raw.name || "",
        grade,
        result,
        exam_session: session,
        confidence: conf,
        matched: false,
        match_note: "Not found in your branch C-20 subjects for this semester",
      })
    }
  }

  return out
}

export function parseVisionJson(text: string): {
  readable: boolean
  unreadable_reason?: string
  semester?: number | null
  exam_session?: string | null
  reg_no?: string | null
  subjects?: Array<Record<string, unknown>>
  warnings?: string[]
} | null {
  if (!text) return null
  let t = text.trim()
  // Strip markdown fences
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  // First { ... } block
  const start = t.indexOf("{")
  const end = t.lastIndexOf("}")
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  try {
    return JSON.parse(t) as {
      readable: boolean
      unreadable_reason?: string
      semester?: number | null
      exam_session?: string | null
      reg_no?: string | null
      subjects?: Array<Record<string, unknown>>
      warnings?: string[]
    }
  } catch {
    return null
  }
}

export async function callXaiMarksCardVision(input: {
  dataUrl: string
  expectedSem?: number | null
  expectedReg?: string | null
  curriculumHint: string
}): Promise<{ raw: string; model: string }> {
  const apiKey = process.env.XAI_API_KEY || process.env.XAI_KEY || ""
  if (!apiKey) {
    throw new Error(
      "Marks-card scan is not configured (missing XAI_API_KEY on server). Contact Admin.",
    )
  }
  const model = process.env.XAI_VISION_MODEL || process.env.XAI_MODEL || "grok-4.5"

  const prompt = `You are reading a Karnataka DTE / BTE diploma PROVISIONAL MARKS CARD or semester marksheet (C-20 scheme).

Expected student reg (if known): ${input.expectedReg || "unknown"}
Expected semester (if known): ${input.expectedSem != null ? input.expectedSem : "unknown"}
Known C-20 subject codes/names for this student (match carefully):
${input.curriculumHint}

TASK:
1. If the image is blurry, cropped, glare-covered, too dark, not a marks card, or any subject grade/code is unreadable, set readable=false and explain in unreadable_reason. Tell the student to upload a NEW clearer photo of the FULL marks card.
2. If readable, extract EVERY subject row with code, name, grade, result (pass/fail/absent), and exam session if printed.
3. Use exact grades as printed (A+, A, B+, B, C, D, E, F, S, Ab, etc.).
4. exam_session format prefer: "YYYY-YY November" or "YYYY-YY April" (e.g. "2024-25 November").
5. Do NOT invent subjects not visible. Prefer matching the known codes list.
6. Return ONLY valid JSON (no markdown) with this shape:
{
  "readable": true,
  "unreadable_reason": null,
  "semester": 1,
  "exam_session": "2024-25 November",
  "reg_no": "171CS24055",
  "subjects": [
    {
      "code": "20CS31P",
      "name": "Subject name",
      "grade": "A+",
      "result": "pass",
      "exam_session": "2024-25 November",
      "confidence": 0.95
    }
  ],
  "warnings": []
}`

  const body = {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_image", image_url: input.dataUrl, detail: "high" },
          { type: "input_text", text: prompt },
        ],
      },
    ],
  }

  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    // Vision can be slow
    signal: AbortSignal.timeout(120_000),
  })

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const msg =
      (data && (data.error as { message?: string } | string)) ||
      `Vision API HTTP ${res.status}`
    const text =
      typeof msg === "string"
        ? msg
        : msg && typeof msg === "object" && "message" in msg
          ? String((msg as { message?: string }).message)
          : `Vision API HTTP ${res.status}`
    throw new Error(text)
  }

  // responses API: output_text or nested output
  let raw = ""
  if (data && typeof data.output_text === "string") raw = data.output_text
  if (!raw && data && Array.isArray(data.output)) {
    for (const item of data.output as Array<Record<string, unknown>>) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content as Array<Record<string, unknown>>) {
          if (c.type === "output_text" && typeof c.text === "string") raw += c.text
          if (typeof c.text === "string") raw += c.text
        }
      }
      if (typeof item.text === "string") raw += item.text
    }
  }
  if (!raw && data && typeof data.content === "string") raw = data.content

  if (!raw) {
    // chat.completions fallback shape
    const choices = data?.choices as Array<{ message?: { content?: string } }> | undefined
    if (choices?.[0]?.message?.content) raw = choices[0].message.content
  }

  if (!raw) throw new Error("Vision model returned empty response. Try a clearer image.")
  return { raw, model }
}
