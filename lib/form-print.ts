/**
 * A4 PDF for verified form responses.
 */

import { fieldLabel, parseFormFields } from "@/lib/forms-shared"
import { deliverPdfBlob } from "@/lib/download-pdf"
import { blobToBase64Raw, isNativeAndroid, saveAndSharePdfNative } from "@/lib/native-android"

export type FormPrintInput = {
  form_title: string
  form_description?: string
  fields?: unknown
  answers: Record<string, unknown>
  submitter_name?: string
  submitter_reg?: string
  submitter_email?: string
  submitted_at?: string | null
  status?: string
  verified_by_name?: string | null
  verified_at?: string | null
  verifier_note?: string | null
}

function display(v: unknown): string {
  if (v == null) return "—"
  if (Array.isArray(v)) return v.map(String).join(", ") || "—"
  const s = String(v).trim()
  return s || "—"
}

function fmtWhen(iso?: string | null): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return String(iso)
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return String(iso)
  }
}

export async function buildFormResponsePdfBlob(input: FormPrintInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf")
  const fields = parseFormFields(input.fields)
  const answers = input.answers || {}

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true })
  const pageW = 210
  const pageH = 297
  const mL = 14
  const mR = 14
  const mB = 14
  const navy: [number, number, number] = [11, 61, 110]
  const ink: [number, number, number] = [15, 23, 42]
  const muted: [number, number, number] = [71, 85, 105]
  let y = 12

  const ensure = (need: number) => {
    if (y + need > pageH - mB) {
      pdf.setFontSize(7)
      pdf.setTextColor(...muted)
      pdf.text(`Page ${pdf.getNumberOfPages()}`, pageW - mR, pageH - 8, { align: "right" })
      pdf.addPage()
      y = 14
    }
  }

  pdf.setFillColor(...navy)
  pdf.rect(0, 0, pageW, 6, "F")
  y = 14
  pdf.setTextColor(...navy)
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(9)
  pdf.text("GOVERNMENT POLYTECHNIC, HUBBALLI", pageW / 2, y, { align: "center" })
  y += 5
  pdf.setFontSize(8)
  pdf.setFont("helvetica", "normal")
  pdf.setTextColor(...muted)
  pdf.text("Official Form / Survey Response", pageW / 2, y, { align: "center" })
  y += 6
  pdf.setDrawColor(...navy)
  pdf.setLineWidth(0.6)
  pdf.line(mL, y, pageW - mR, y)
  y += 8

  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(13)
  pdf.setTextColor(...navy)
  const titleLines = pdf.splitTextToSize(input.form_title || "Form", pageW - mL - mR)
  pdf.text(titleLines, mL, y)
  y += titleLines.length * 6 + 2

  if (input.form_description) {
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(9)
    pdf.setTextColor(...muted)
    const dLines = pdf.splitTextToSize(String(input.form_description), pageW - mL - mR)
    pdf.text(dLines, mL, y)
    y += dLines.length * 4.2 + 4
  }

  // Meta box
  ensure(28)
  pdf.setFillColor(240, 246, 252)
  pdf.roundedRect(mL, y, pageW - mL - mR, 24, 2, 2, "F")
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(8)
  pdf.setTextColor(...navy)
  pdf.text("Submitted by", mL + 3, y + 6)
  pdf.setFont("helvetica", "normal")
  pdf.setTextColor(...ink)
  pdf.setFontSize(9)
  pdf.text(display(input.submitter_name), mL + 3, y + 11)
  pdf.setFontSize(8)
  pdf.setTextColor(...muted)
  pdf.text(
    [input.submitter_reg, input.submitter_email].filter(Boolean).join(" · ") || "—",
    mL + 3,
    y + 16,
  )
  pdf.setFont("helvetica", "bold")
  pdf.setTextColor(...navy)
  pdf.text("Submitted", pageW / 2 + 4, y + 6)
  pdf.setFont("helvetica", "normal")
  pdf.setTextColor(...ink)
  pdf.text(fmtWhen(input.submitted_at), pageW / 2 + 4, y + 11)
  const st = String(input.status || "pending").toUpperCase()
  pdf.setFont("helvetica", "bold")
  pdf.setTextColor(st === "VERIFIED" ? 4 : st === "REJECTED" ? 185 : 180, st === "VERIFIED" ? 120 : 28, st === "VERIFIED" ? 87 : 28)
  pdf.text(st, pageW / 2 + 4, y + 17)
  y += 30

  // Answers
  const rows: Array<{ label: string; value: string }> = []
  if (fields.length) {
    for (const f of fields) {
      if (String(f.type || "").toLowerCase() === "section") {
        rows.push({ label: `— ${fieldLabel(f)} —`, value: "" })
        continue
      }
      const key = fieldLabel(f)
      const val = answers[key] ?? (f.id ? answers[f.id] : undefined)
      rows.push({ label: key, value: display(val) })
    }
  } else {
    for (const [k, v] of Object.entries(answers)) {
      rows.push({ label: k, value: display(v) })
    }
  }

  for (const r of rows) {
    if (r.value === "" && r.label.startsWith("—")) {
      ensure(10)
      pdf.setFillColor(...navy)
      pdf.rect(mL, y, pageW - mL - mR, 7, "F")
      pdf.setTextColor(255, 255, 255)
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(9)
      pdf.text(r.label.replace(/^—\s*|\s*—$/g, ""), mL + 3, y + 4.8)
      y += 10
      continue
    }
    const valLines = pdf.splitTextToSize(r.value, pageW - mL - mR - 4)
    const blockH = 5 + valLines.length * 4.2 + 3
    ensure(blockH)
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(8)
    pdf.setTextColor(...navy)
    pdf.text(r.label, mL + 1, y)
    y += 4.5
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(9.5)
    pdf.setTextColor(...ink)
    pdf.text(valLines, mL + 1, y)
    y += valLines.length * 4.2 + 2
    pdf.setDrawColor(226, 232, 240)
    pdf.line(mL, y, pageW - mR, y)
    y += 3
  }

  // Verification stamp
  if (String(input.status).toLowerCase() === "verified") {
    ensure(22)
    y += 4
    pdf.setDrawColor(...navy)
    pdf.setLineWidth(0.4)
    pdf.rect(mL, y, pageW - mL - mR, 18)
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(9)
    pdf.setTextColor(4, 120, 87)
    pdf.text("✓ VERIFIED", mL + 4, y + 7)
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(8)
    pdf.setTextColor(...ink)
    pdf.text(
      `By ${display(input.verified_by_name)} · ${fmtWhen(input.verified_at)}`,
      mL + 4,
      y + 13,
    )
    if (input.verifier_note) {
      y += 20
      ensure(12)
      pdf.setTextColor(...muted)
      pdf.text(`Note: ${display(input.verifier_note)}`, mL + 1, y)
    }
  }

  pdf.setFontSize(7)
  pdf.setTextColor(...muted)
  pdf.text("GPT Hubli Student Portal · System-generated form copy", mL, pageH - 8)
  pdf.text(`Page ${pdf.getNumberOfPages()}`, pageW - mR, pageH - 8, { align: "right" })

  return pdf.output("blob")
}

export async function downloadFormResponsePdf(input: FormPrintInput, filename?: string): Promise<void> {
  const blob = await buildFormResponsePdfBlob(input)
  const safe =
    (filename || `form-${(input.form_title || "response").replace(/[^\w\-]+/g, "_").slice(0, 40)}`).replace(
      /\.pdf$/i,
      "",
    ) + ".pdf"

  if (isNativeAndroid()) {
    try {
      const b64 = await blobToBase64Raw(blob)
      const ok = await saveAndSharePdfNative(b64, safe)
      if (ok) return
    } catch {
      /* fall through */
    }
  }
  await deliverPdfBlob(blob, safe)
}
