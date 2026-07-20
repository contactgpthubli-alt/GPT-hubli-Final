/**
 * Full student profile printout — single A4 sheet (app + web).
 */

import { printHtmlDocument } from "./print-html"

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
export function collectProfilePrintRows(input: StudentProfilePrintInput): Array<{ label: string; value: string }> {
  const fields = (input.fields && typeof input.fields === "object" ? input.fields : {}) as Record<
    string,
    unknown
  >
  const coreOrder = [
    ["Register Number", input.reg_no || fields["Register Number"]],
    ["Student Name", input.name || fields["Student (As per SSLC)"] || fields["Student (As per Aadhar)"]],
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
    ["WhatsApp Number", fields["WhatsApp Number"] || fields["Student Mobile"] || fields["Aadhar Registered Mobile"]],
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
    // Prefer non-empty core slots; still show important empties for reg/name/branch
    const always =
      label === "Register Number" ||
      label === "Student Name" ||
      label === "Branch" ||
      label === "Current Year" ||
      label === "Email"
    if (val === "—" && !always) continue
    // Skip duplicate SSLC if same as Student Name
    if (label === "Student (As per SSLC)" && val === displayVal(input.name)) continue
    if (label === "Valid E-mail ID" && val === displayVal(input.email)) continue
    seen.add(label.toLowerCase())
    rows.push({ label, value: val })
  }

  // Remaining extra fields (stable alphabetical)
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
 * Compact single-page A4 HTML for student profile.
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

  // Two-column field grid for density on one page
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
@page{size:A4;margin:10mm 11mm;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  font-family:"Segoe UI",system-ui,-apple-system,"Times New Roman",serif;
  color:#0f172a;
  font-size:9.5pt;
  line-height:1.25;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
.sheet{width:100%;}
.hdr{
  display:flex;align-items:center;gap:10px;
  border-bottom:2px solid #0f2d5c;padding-bottom:6px;margin-bottom:8px;
}
.hdr img.logo{width:42px;height:42px;object-fit:contain;}
.hdr .titles{flex:1;text-align:center;}
.hdr .titles .gov{font-size:8.5pt;font-weight:700;color:#1e3a5f;letter-spacing:.02em;}
.hdr .titles .college{font-size:12pt;font-weight:800;color:#0f2d5c;margin-top:1px;}
.hdr .titles .sub{font-size:8pt;color:#475569;margin-top:1px;}
.hdr .titles .doc{font-size:10.5pt;font-weight:800;text-decoration:underline;margin-top:4px;color:#0f2d5c;}
.meta{
  display:flex;justify-content:space-between;align-items:flex-start;gap:12px;
  margin-bottom:8px;
}
.identity{flex:1;min-width:0;}
.identity h1{margin:0;font-size:13pt;color:#0f2d5c;}
.identity .line{margin-top:3px;font-size:9pt;color:#334155;font-family:ui-monospace,Consolas,monospace;}
.identity .chips{margin-top:5px;display:flex;flex-wrap:wrap;gap:4px;}
.chip{
  display:inline-block;padding:2px 7px;border-radius:999px;
  background:#e8f0fe;color:#1a4fa0;font-size:7.5pt;font-weight:700;
}
.photo{
  width:88px;height:105px;border:1.5px solid #0f2d5c;overflow:hidden;flex-shrink:0;background:#f8fafc;
}
.photo img{width:100%;height:100%;object-fit:cover;display:block;}
.photo.empty{display:flex;align-items:center;justify-content:center;font-size:8pt;color:#94a3b8;}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;width:100%;}
table.fields{width:100%;border-collapse:collapse;table-layout:fixed;}
table.fields td{padding:2.5px 4px;vertical-align:top;border-bottom:1px solid #e2e8f0;}
table.fields td.k{
  width:38%;font-size:7.5pt;font-weight:700;color:#1e3a5f;
  text-transform:uppercase;letter-spacing:.02em;
}
table.fields td.v{font-size:8.5pt;font-weight:600;color:#0f172a;word-wrap:break-word;}
.sec-title{
  grid-column:1/-1;font-size:8pt;font-weight:800;color:#0f2d5c;
  background:#e8f0fe;padding:3px 6px;margin:6px 0 2px;border-left:3px solid #1a4fa0;
}
.foot{
  margin-top:10px;padding-top:6px;border-top:1.5px solid #cbd5e1;
  display:flex;justify-content:space-between;gap:12px;font-size:7.5pt;color:#475569;
}
.sig{text-align:center;min-width:140px;}
.sig .line{border-top:1px solid #0f172a;margin-top:28px;padding-top:3px;font-weight:700;color:#0f172a;}
.note{font-style:italic;font-size:7pt;color:#64748b;margin-top:4px;}
@media print{
  body{margin:0;}
  .sheet{page-break-inside:avoid;}
}
</style></head><body>
<div class="sheet">
  <div class="hdr">
    <img class="logo" src="/images/college-logo.png" alt="Logo" onerror="this.src='/karnataka-emblem.png'" />
    <div class="titles">
      <div class="gov">GOVERNMENT OF KARNATAKA · Department of Technical Education</div>
      <div class="college">GOVERNMENT POLYTECHNIC, HUBBALLI</div>
      <div class="sub">Student Master Profile (Official Record Printout)</div>
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
  <div class="sec-title">Profile details (${rows.length} fields)</div>
  <div class="grid">
    <table class="fields">${colHtml(left)}</table>
    <table class="fields">${colHtml(right)}</table>
  </div>
  <div class="foot">
    <div>
      Printed from GPT Hubli Student Portal<br/>
      <strong>Date:</strong> ${esc(printDate)} &nbsp; <strong>Time:</strong> ${esc(printTime)}
      <div class="note">This is a system-generated profile printout for student records. Verify against college office if required.</div>
    </div>
    <div class="sig"><div class="line">Student / Office use</div></div>
  </div>
</div>
</body></html>`
}

/** Print via full-screen preview (browser + Capacitor Android WebView). */
export function printStudentProfileHtml(html: string): void {
  printHtmlDocument(html, {
    title: "Student Profile",
    filename: "student-profile.html",
  })
}
