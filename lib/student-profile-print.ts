/**
 * Full student profile — professional multi-page A4 PDF (app + web).
 * Uses jsPDF text layout (not html2canvas) so pages are exact A4 and never blank.
 */

import { downloadHtmlAsPdf, deliverPdfBlob } from "./download-pdf"
import { blobToBase64Raw, isNativeAndroid, saveAndSharePdfNative } from "./native-android"

export type StudentProfilePrintInput = {
  name?: string | null
  reg_no?: string | null
  branch?: string | null
  year?: string | null
  father?: string | null
  mother?: string | null
  email?: string | null
  cgpa?: string | null
  attendance?: string | null
  photo?: string | null
  /** Flat field label → value (extra / schema fields) */
  fields?: Record<string, unknown> | null
}

const SKIP_KEYS = new Set([
  "profile_edit_locked",
  "imported_from_excel",
  "imported_at",
  "imported_missing_ece",
  "email_source",
  "Profile Photo",
  "profile_photo",
  "ProfilePhoto",
  "photo",
  "Photo",
  "Attendance Batch",
  "Parent Mobile",
  "Parent Name",
])

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function isDataImage(v: unknown): v is string {
  return typeof v === "string" && v.indexOf("data:image/") === 0
}

function displayVal(v: unknown): string {
  if (v == null) return "—"
  const s = String(v).replace(/\s+/g, " ").trim()
  if (!s) return "—"
  if (s.indexOf("data:image/") === 0) return "—"
  if (s.length > 220 && /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 60))) return "—"
  return s
}

/** Merge core + extra into ordered print rows. */
export function collectProfilePrintRows(
  input: StudentProfilePrintInput,
): Array<{ label: string; value: string }> {
  const fields = (input.fields && typeof input.fields === "object" ? input.fields : {}) as Record<
    string,
    unknown
  >
  const coreOrder = [
    ["Register Number", input.reg_no || fields["Register Number"]],
    [
      "Student Name",
      input.name || fields["Student (As per SSLC)"] || fields["Student (As per Aadhar)"],
    ],
    ["Student (As per SSLC)", fields["Student (As per SSLC)"]],
    ["Student (As per Aadhar)", fields["Student (As per Aadhar)"]],
    ["Father Name", input.father || fields["Father Name"]],
    ["Mother Name", input.mother || fields["Mother Name"]],
    ["Branch", input.branch || fields.Branch],
    ["Current Year", input.year || fields["Current Year"]],
    ["Date of Birth", fields["Date of Birth"]],
    ["Gender", fields.Gender],
    ["Category", fields.Category],
    ["Religion", fields.Religion],
    ["Caste", fields.Caste],
    ["Aadhar Number", fields["Aadhar Number"]],
    ["APAAR ID", fields["APAAR ID"]],
    ["SSP ID", fields["SSP ID"]],
    ["NSP ID", fields["NSP ID"]],
    ["Email", input.email || fields.Email || fields["Valid E-mail ID"]],
    ["Valid E-mail ID", fields["Valid E-mail ID"]],
    [
      "WhatsApp Number",
      fields["WhatsApp Number"] || fields["Student Mobile"] || fields["Aadhar Registered Mobile"],
    ],
    ["Parents Mobile Number", fields["Parents Mobile Number"] || fields["Parent Mobile"]],
    ["Home Address", fields["Home Address"]],
    ["Date of Admission", fields["Date of Admission"] || fields["Date and Year Of Admission"]],
    ["Year of Admission", fields["Year of Admission"] || fields["Year Of Admission"]],
    ["Staying in Hostel?", fields["Staying in Hostel?"] || fields["Are you staying in Hostel ?"]],
    ["Hostel Name", fields["Hostel Name"]],
    ["CGPA", input.cgpa],
    ["Attendance", input.attendance || fields.Attendance],
  ] as Array<[string, unknown]>

  const seen = new Set<string>()
  const rows: Array<{ label: string; value: string }> = []

  for (const [label, raw] of coreOrder) {
    if (seen.has(label.toLowerCase())) continue
    const val = displayVal(raw)
    const always =
      label === "Register Number" ||
      label === "Student Name" ||
      label === "Branch" ||
      label === "Current Year" ||
      label === "Email"
    if (val === "—" && !always) continue
    if (label === "Student (As per SSLC)" && val === displayVal(input.name)) continue
    if (label === "Valid E-mail ID" && val === displayVal(input.email)) continue
    seen.add(label.toLowerCase())
    rows.push({ label, value: val })
  }

  const extras = Object.keys(fields)
    .filter((k) => {
      if (SKIP_KEYS.has(k)) return false
      if (isDataImage(fields[k])) return false
      if (seen.has(k.toLowerCase())) return false
      if (displayVal(fields[k]) === "—") return false
      return true
    })
    .sort((a, b) => a.localeCompare(b))

  for (const k of extras) {
    seen.add(k.toLowerCase())
    rows.push({ label: k, value: displayVal(fields[k]) })
  }

  return rows
}

/**
 * Compact HTML for print/preview (still used as fallback).
 * Primary download path uses jsPDF A4 layout below.
 */
export function buildStudentProfilePrintHtml(input: StudentProfilePrintInput): string {
  const rows = collectProfilePrintRows(input)
  const name = displayVal(input.name)
  const reg = displayVal(input.reg_no)
  const branch = displayVal(input.branch)
  const year = displayVal(input.year)
  const photo = isDataImage(input.photo) ? input.photo : ""
  const now = new Date()
  const printDate = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  const printTime = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  })

  const mid = Math.ceil(rows.length / 2)
  const left = rows.slice(0, mid)
  const right = rows.slice(mid)

  function colHtml(list: Array<{ label: string; value: string }>) {
    return list
      .map(
        (r) =>
          `<tr><td class="k">${esc(r.label)}</td><td class="v">${esc(r.value)}</td></tr>`,
      )
      .join("")
  }

  const photoBlock = photo
    ? `<div class="photo"><img src="${photo.replace(/"/g, "")}" alt="Photo" /></div>`
    : `<div class="photo empty">No photo</div>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Student Profile — ${esc(reg)}</title>
<style>
@page{size:A4 portrait;margin:12mm 14mm;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;background:#fff;}
body{
  width:210mm;min-height:297mm;margin:0 auto;padding:12mm 14mm;
  font-family:"Times New Roman",Times,Georgia,serif;
  color:#111;font-size:10pt;line-height:1.35;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.sheet{width:100%;}
.hdr{display:flex;align-items:center;gap:12px;border-bottom:2.5px solid #0b3d6e;padding-bottom:8px;margin-bottom:10px;}
.hdr .logo{width:48px;height:48px;object-fit:contain;}
.hdr .titles{flex:1;text-align:center;}
.hdr .gov{font-size:9pt;font-weight:700;color:#0b3d6e;letter-spacing:.04em;text-transform:uppercase;}
.hdr .college{font-size:14pt;font-weight:800;color:#0b3d6e;margin-top:2px;}
.hdr .sub{font-size:9pt;color:#334155;margin-top:2px;}
.hdr .doc{font-size:12pt;font-weight:800;margin-top:6px;color:#0b3d6e;letter-spacing:.08em;}
.meta{display:flex;justify-content:space-between;gap:14px;margin-bottom:10px;align-items:flex-start;}
.identity{flex:1;}
.identity h1{margin:0;font-size:15pt;color:#0b3d6e;font-family:"Segoe UI",Arial,sans-serif;}
.identity .line{margin-top:4px;font-size:10pt;font-family:Consolas,monospace;color:#1e293b;}
.chips{margin-top:6px;display:flex;flex-wrap:wrap;gap:5px;}
.chip{display:inline-block;padding:3px 9px;border:1px solid #0b3d6e;border-radius:3px;font-size:8.5pt;font-weight:700;color:#0b3d6e;background:#f0f6fc;}
.photo{width:95px;height:115px;border:1.5px solid #0b3d6e;overflow:hidden;flex-shrink:0;background:#f8fafc;}
.photo img{width:100%;height:100%;object-fit:cover;display:block;}
.photo.empty{display:flex;align-items:center;justify-content:center;font-size:8pt;color:#94a3b8;}
.sec{font-size:9.5pt;font-weight:800;color:#fff;background:#0b3d6e;padding:5px 8px;margin:10px 0 6px;letter-spacing:.04em;}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;width:100%;}
table.fields{width:100%;border-collapse:collapse;table-layout:fixed;}
table.fields td{padding:4px 5px;vertical-align:top;border-bottom:1px solid #cbd5e1;}
table.fields td.k{width:40%;font-size:8pt;font-weight:700;color:#0b3d6e;font-family:"Segoe UI",Arial,sans-serif;}
table.fields td.v{font-size:9.5pt;font-weight:600;color:#0f172a;word-wrap:break-word;}
.foot{margin-top:14px;padding-top:8px;border-top:1.5px solid #94a3b8;display:flex;justify-content:space-between;gap:12px;font-size:8pt;color:#475569;}
.sig{text-align:center;min-width:150px;}
.sig .line{border-top:1px solid #0f172a;margin-top:32px;padding-top:3px;font-weight:700;color:#0f172a;}
.note{font-style:italic;font-size:7.5pt;color:#64748b;margin-top:4px;}
@media print{body{width:auto;min-height:auto;padding:0;}}
</style></head><body>
<div class="sheet">
  <div class="hdr">
    <img class="logo" src="/images/college-logo.png" alt="Logo" onerror="this.style.display='none'" />
    <div class="titles">
      <div class="gov">Government of Karnataka · Department of Technical Education</div>
      <div class="college">Government Polytechnic, Hubballi</div>
      <div class="sub">Student Master Record — Official Profile Printout</div>
      <div class="doc">STUDENT PROFILE</div>
    </div>
  </div>
  <div class="meta">
    <div class="identity">
      <h1>${esc(name)}</h1>
      <div class="line">${esc(reg)}</div>
      <div class="chips">
        <span class="chip">${esc(branch)}</span>
        <span class="chip">${esc(year)}</span>
      </div>
    </div>
    ${photoBlock}
  </div>
  <div class="sec">PROFILE DETAILS (${rows.length} fields)</div>
  <div class="grid">
    <table class="fields">${colHtml(left)}</table>
    <table class="fields">${colHtml(right)}</table>
  </div>
  <div class="foot">
    <div>
      Generated from GPT Hubli Student Portal<br/>
      <strong>Date:</strong> ${esc(printDate)} &nbsp; <strong>Time:</strong> ${esc(printTime)}
      <div class="note">System-generated official profile. Verify against college office records if required.</div>
    </div>
    <div class="sig"><div class="line">Student / Office use</div></div>
  </div>
</div>
</body></html>`
}

/**
 * Build a real A4 PDF with jsPDF (exact 210×297 mm). Never blank.
 */
export async function buildStudentProfilePdfBlob(
  input: StudentProfilePrintInput,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf")
  const rows = collectProfilePrintRows(input)
  const name = displayVal(input.name)
  const reg = displayVal(input.reg_no)
  const branch = displayVal(input.branch)
  const year = displayVal(input.year)
  const photo = isDataImage(input.photo) ? input.photo : ""

  const now = new Date()
  const printDate = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  const printTime = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  })

  // Exact A4
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true })
  const pageW = 210
  const pageH = 297
  const mL = 14
  const mR = 14
  const mT = 12
  const mB = 14
  const contentW = pageW - mL - mR
  const navy: [number, number, number] = [11, 61, 110]
  const ink: [number, number, number] = [15, 23, 42]
  const muted: [number, number, number] = [71, 85, 105]

  let y = mT

  const ensureSpace = (need: number) => {
    if (y + need > pageH - mB) {
      drawFooter(false)
      pdf.addPage()
      y = mT
      // continuation header
      pdf.setFillColor(...navy)
      pdf.rect(0, 0, pageW, 8, "F")
      pdf.setTextColor(255, 255, 255)
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(8)
      pdf.text(`Student Profile (continued) — ${reg}`, mL, 5.5)
      y = 14
    }
  }

  const drawFooter = (firstPage: boolean) => {
    const fy = pageH - 10
    pdf.setDrawColor(148, 163, 184)
    pdf.setLineWidth(0.3)
    pdf.line(mL, fy - 4, pageW - mR, fy - 4)
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(7)
    pdf.setTextColor(...muted)
    pdf.text("GPT Hubli Student Portal · Government Polytechnic Hubballi", mL, fy)
    const pageNum = pdf.getNumberOfPages()
    pdf.text(`Page ${pageNum}`, pageW - mR, fy, { align: "right" })
    if (firstPage) {
      /* reserved */
    }
  }

  // Top navy bar
  pdf.setFillColor(...navy)
  pdf.rect(0, 0, pageW, 6, "F")
  y = 12

  // Header block
  pdf.setTextColor(...navy)
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(8.5)
  pdf.text("GOVERNMENT OF KARNATAKA  ·  DEPARTMENT OF TECHNICAL EDUCATION", pageW / 2, y, {
    align: "center",
  })
  y += 6
  pdf.setFontSize(14)
  pdf.text("GOVERNMENT POLYTECHNIC, HUBBALLI", pageW / 2, y, { align: "center" })
  y += 5
  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(9)
  pdf.setTextColor(...muted)
  pdf.text("Student Master Record — Official Profile Printout", pageW / 2, y, { align: "center" })
  y += 7
  pdf.setDrawColor(...navy)
  pdf.setLineWidth(0.8)
  pdf.line(mL, y, pageW - mR, y)
  y += 2
  pdf.setLineWidth(0.25)
  pdf.line(mL, y, pageW - mR, y)
  y += 8

  // Title band
  pdf.setFillColor(...navy)
  pdf.rect(mL, y - 4, contentW, 8, "F")
  pdf.setTextColor(255, 255, 255)
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(11)
  pdf.text("STUDENT PROFILE", pageW / 2, y + 1.5, { align: "center" })
  y += 12

  // Identity + photo box
  const photoW = 28
  const photoH = 34
  const textMaxW = contentW - photoW - 6

  pdf.setTextColor(...navy)
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(13)
  const nameLines = pdf.splitTextToSize(name === "—" ? "Student" : name, textMaxW)
  pdf.text(nameLines, mL, y)
  let idY = y + nameLines.length * 5.5

  pdf.setFont("courier", "bold")
  pdf.setFontSize(10)
  pdf.setTextColor(...ink)
  pdf.text(reg, mL, idY)
  idY += 6

  // Chips
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(8)
  const chip1 = branch
  const chip2 = year
  const c1w = pdf.getTextWidth(chip1) + 6
  pdf.setDrawColor(...navy)
  pdf.setFillColor(240, 246, 252)
  pdf.roundedRect(mL, idY - 3.5, c1w, 6, 1, 1, "FD")
  pdf.setTextColor(...navy)
  pdf.text(chip1, mL + 3, idY)
  const c2w = pdf.getTextWidth(chip2) + 6
  pdf.roundedRect(mL + c1w + 3, idY - 3.5, c2w, 6, 1, 1, "FD")
  pdf.text(chip2, mL + c1w + 6, idY)
  idY += 8

  // Photo frame (right)
  const photoX = pageW - mR - photoW
  const photoY = y - 2
  pdf.setDrawColor(...navy)
  pdf.setLineWidth(0.5)
  pdf.setFillColor(248, 250, 252)
  pdf.rect(photoX, photoY, photoW, photoH, "FD")
  if (photo) {
    try {
      const fmt = photo.indexOf("image/png") >= 0 ? "PNG" : "JPEG"
      pdf.addImage(photo, fmt, photoX + 0.6, photoY + 0.6, photoW - 1.2, photoH - 1.2)
    } catch {
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(7)
      pdf.setTextColor(148, 163, 184)
      pdf.text("Photo", photoX + photoW / 2, photoY + photoH / 2, { align: "center" })
    }
  } else {
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(7)
    pdf.setTextColor(148, 163, 184)
    pdf.text("No photo", photoX + photoW / 2, photoY + photoH / 2, { align: "center" })
  }

  y = Math.max(idY, photoY + photoH + 4)

  // Section header
  ensureSpace(12)
  pdf.setFillColor(...navy)
  pdf.rect(mL, y, contentW, 7, "F")
  pdf.setTextColor(255, 255, 255)
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(9)
  pdf.text(`PROFILE DETAILS  ·  ${rows.length} fields`, mL + 3, y + 4.8)
  y += 10

  // Two-column field table
  const colGap = 4
  const colW = (contentW - colGap) / 2
  const labelW = colW * 0.42
  const valueW = colW * 0.58
  const rowH = 6.2

  const drawField = (x: number, label: string, value: string, rowY: number) => {
    // zebra
    pdf.setFillColor(248, 250, 252)
    pdf.rect(x, rowY - 3.8, colW, rowH, "F")
    pdf.setDrawColor(203, 213, 225)
    pdf.setLineWidth(0.15)
    pdf.line(x, rowY + 2.2, x + colW, rowY + 2.2)

    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(7)
    pdf.setTextColor(...navy)
    const lab = pdf.splitTextToSize(label, labelW - 2)
    pdf.text(lab[0] || label, x + 1, rowY)

    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(8.5)
    pdf.setTextColor(...ink)
    const valLines = pdf.splitTextToSize(value || "—", valueW - 2)
    pdf.text(valLines[0] || "—", x + labelW, rowY)
    // If value wraps more, we still show first line for density; long addresses get full row below
    if (valLines.length > 1 && value.length > 40) {
      return valLines
    }
    return [valLines[0] || "—"]
  }

  // Address / long fields get full width rows
  const shortRows: Array<{ label: string; value: string }> = []
  const longRows: Array<{ label: string; value: string }> = []
  for (const r of rows) {
    if (r.value.length > 55 || /address|remark|note/i.test(r.label)) longRows.push(r)
    else shortRows.push(r)
  }

  // Short fields in 2 columns
  const mid = Math.ceil(shortRows.length / 2)
  const left = shortRows.slice(0, mid)
  const right = shortRows.slice(mid)
  const maxPairs = Math.max(left.length, right.length)

  for (let i = 0; i < maxPairs; i++) {
    ensureSpace(rowH + 1)
    if (left[i]) drawField(mL, left[i].label, left[i].value, y)
    if (right[i]) drawField(mL + colW + colGap, right[i].label, right[i].value, y)
    y += rowH
  }

  // Long fields full width
  if (longRows.length) {
    y += 3
    ensureSpace(10)
    pdf.setFillColor(11, 61, 110)
    pdf.rect(mL, y, contentW, 6.5, "F")
    pdf.setTextColor(255, 255, 255)
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(8.5)
    pdf.text("ADDITIONAL DETAILS", mL + 3, y + 4.4)
    y += 9

    for (const r of longRows) {
      const lines = pdf.splitTextToSize(r.value || "—", contentW - 4)
      const blockH = 5 + lines.length * 4.2 + 2
      ensureSpace(blockH)
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(7.5)
      pdf.setTextColor(...navy)
      pdf.text(r.label.toUpperCase(), mL + 1, y)
      y += 4
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(9)
      pdf.setTextColor(...ink)
      pdf.text(lines, mL + 1, y)
      y += lines.length * 4.2 + 3
      pdf.setDrawColor(226, 232, 240)
      pdf.line(mL, y - 1.5, pageW - mR, y - 1.5)
    }
  }

  // Signature / attestation
  y += 6
  ensureSpace(28)
  pdf.setDrawColor(...navy)
  pdf.setLineWidth(0.4)
  pdf.line(mL, y, pageW - mR, y)
  y += 6
  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(8)
  pdf.setTextColor(...muted)
  pdf.text(`Printed: ${printDate}  ${printTime}`, mL, y)
  pdf.text("System-generated profile — verify with college office if required.", mL, y + 4.5)

  // Signature lines
  const sigY = y + 4
  pdf.setDrawColor(...ink)
  pdf.setLineWidth(0.3)
  pdf.line(pageW - mR - 55, sigY + 12, pageW - mR, sigY + 12)
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(8)
  pdf.setTextColor(...ink)
  pdf.text("Student / Office use", pageW - mR - 27.5, sigY + 16, { align: "center" })

  drawFooter(true)

  return pdf.output("blob")
}

/** Download profile as professional A4 PDF. */
export async function downloadStudentProfilePdf(
  htmlOrIgnored: string,
  regNo?: string,
  input?: StudentProfilePrintInput,
): Promise<void> {
  const name = regNo ? `profile-${regNo}` : "student-profile"
  const filename = `${name}.pdf`

  // Prefer structured A4 when input provided
  if (input) {
    const blob = await buildStudentProfilePdfBlob(input)
    // Native path first on APK
    if (isNativeAndroid()) {
      try {
        const b64 = await blobToBase64Raw(blob)
        const ok = await saveAndSharePdfNative(b64, filename)
        if (ok) return
      } catch {
        /* fall through */
      }
    }
    await deliverPdfBlob(blob, filename)
    return
  }

  // Fallback: HTML path (improved renderer)
  await downloadHtmlAsPdf(htmlOrIgnored, { filename: name })
}

/** @deprecated Use downloadStudentProfilePdf */
export async function printStudentProfileHtml(html: string): Promise<void> {
  await downloadHtmlAsPdf(html, { filename: "student-profile" })
}
