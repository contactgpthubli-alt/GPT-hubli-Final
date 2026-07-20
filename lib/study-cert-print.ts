/**
 * Client-side Study / Studying certificate print HTML
 * (mirrors public/legacy-acm-study.js buildStudyPrintHtml for student self-print).
 */

import { printHtmlDocument } from "./print-html"

export type StudyCertForm = {
  cert_no?: string
  reg_no?: string
  student_name?: string
  father_name?: string
  mother_name?: string
  branch?: string
  character?: string
  purpose?: string
  semester?: string
  year?: string
  acad_year?: string
  from_year?: string
  to_year?: string
  period_note?: string
  photo?: string
  print_date?: string
  print_time?: string
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function buildStudyCertPrintHtml(
  kind: "study" | "studying",
  form: StudyCertForm,
): string {
  const isStudying = kind === "studying"
  const titleEn = isStudying ? "STUDYING CERTIFICATE" : "STUDY CERTIFICATE"
  const emblem = "/karnataka-emblem.png"

  let body: string
  if (isStudying) {
    body =
      "This is to certify that" +
      ` <strong>Sri / Kum. ${esc(form.student_name)}</strong> ` +
      "S/o / D/o" +
      ` <strong>${esc(form.father_name)}</strong>, ` +
      "bearing Register No." +
      ` <strong>${esc(form.reg_no)}</strong>, ` +
      "is a bonafide student of this institution presently studying in" +
      ` <strong>${esc(form.semester || "")}${form.year ? ` (${esc(form.year)})` : ""}</strong> ` +
      "of the Diploma course in" +
      ` <strong>${esc(form.branch)}</strong> ` +
      "during the academic year" +
      ` <strong>${esc(form.acad_year || "")}</strong>. ` +
      "His / Her character and conduct is" +
      ` <strong>${esc(form.character || "Satisfactory")}</strong>. ` +
      "This certificate is issued on his/her request for the purpose of" +
      ` <strong>${esc(form.purpose || "—")}</strong>. ` +
      "The above particulars are true and correct as per the records of this institution."
  } else {
    body =
      "This is to certify that" +
      ` <strong>Sri / Kum. ${esc(form.student_name)}</strong> ` +
      "S/o / D/o" +
      ` <strong>${esc(form.father_name)}</strong>, ` +
      "bearing Register No." +
      ` <strong>${esc(form.reg_no)}</strong>, ` +
      "was a bonafide student of this institution and has studied the Diploma course in" +
      ` <strong>${esc(form.branch)}</strong> ` +
      "during the academic year(s)" +
      ` <strong>${esc(form.from_year || "")}</strong> ` +
      "to" +
      ` <strong>${esc(form.to_year || "")}</strong>` +
      (form.period_note ? ` (${esc(form.period_note)})` : "") +
      ". " +
      "His / Her character and conduct during the period of study was" +
      ` <strong>${esc(form.character || "Satisfactory")}</strong>. ` +
      "This certificate is issued on his/her request for the purpose of" +
      ` <strong>${esc(form.purpose || "—")}</strong>. ` +
      "The above particulars are true and correct as per the records of this institution."
  }

  const photo =
    form.photo && String(form.photo).indexOf("data:image/") === 0 ? String(form.photo) : ""
  const photoBlock = photo
    ? `<div class="photo"><img src="${photo.replace(/"/g, "")}" alt="Student photo" /></div>`
    : ""

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titleEn)} - ${esc(form.reg_no)}</title>
<style>
@page{size:A4;margin:14mm;}
body{font-family:"Times New Roman",Times,serif;color:#000;margin:0;padding:8mm;line-height:1.65;}
.hdr{text-align:center;margin-bottom:10px;}
.hdr img.emblem{width:70px;height:70px;object-fit:contain;}
.meta-row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:12px 0 8px;font-size:13px;}
.photo{width:100px;height:120px;border:1px solid #000;overflow:hidden;flex-shrink:0;}
.photo img{width:100%;height:100%;object-fit:cover;display:block;}
.body{font-size:14px;text-align:justify;margin-top:28px;padding-top:6px;line-height:1.75;text-indent:2.5em;}
.body p{margin:0 0 12px 0;text-indent:2.5em;text-align:justify;}
.foot{display:flex;justify-content:space-between;margin-top:48px;font-size:12.5px;}
.sig{text-align:center;min-width:160px;}
.sig .line{border-top:1px solid #000;margin-top:48px;padding-top:4px;}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>
<div class="hdr">
<img class="emblem" src="${esc(emblem)}" alt="Emblem" />
<div style="font-size:14px;font-weight:700;">ಕರ್ನಾಟಕ ಸರ್ಕಾರ</div>
<div style="font-size:12px;font-weight:700;">GOVERNMENT OF KARNATAKA</div>
<div style="font-size:11px;">Department of Technical Education</div>
<div style="font-size:15px;font-weight:800;margin-top:4px;">GOVERNMENT POLYTECHNIC, HUBBALLI</div>
<div style="font-size:16px;font-weight:800;text-decoration:underline;margin-top:10px;">${esc(titleEn)}</div>
</div>
<div class="meta-row">
<div><strong>Certificate No.:</strong> ${esc(form.cert_no)}</div>
${photoBlock}
</div>
<div class="body"><p>${body}</p></div>
<div class="foot">
<div>Place: Hubballi<br><strong>Date:</strong> ${esc(form.print_date)}<br><strong>Time:</strong> ${esc(form.print_time)}</div>
<div class="sig"><div class="line">ಪ್ರಾಂಶುಪಾಲರು<br>Principal</div></div>
</div>
</body></html>`
}

/** Open print preview + system dialog (works in browser + Capacitor Android WebView). */
export function printStudyCertHtml(html: string): void {
  printHtmlDocument(html, {
    title: "Certificate",
    filename: "study-certificate.html",
  })
}

export function formFromAcmCert(c: {
  cert_kind?: string | null
  cert_no?: string | null
  reg_no?: string | null
  student_name?: string | null
  father_name?: string | null
  mother_name?: string | null
  branch?: string | null
  photo?: string | null
  form_data?: unknown
  printed_at?: string | null
  sent_to_student_at?: string | null
  issued_on?: string | null
}): { kind: "study" | "studying"; form: StudyCertForm } {
  const kind = String(c.cert_kind || "").toLowerCase().includes("studying")
    ? "studying"
    : "study"

  let fd: Record<string, unknown> = {}
  if (c.form_data && typeof c.form_data === "object") {
    fd = c.form_data as Record<string, unknown>
  } else if (typeof c.form_data === "string") {
    try {
      fd = JSON.parse(c.form_data) as Record<string, unknown>
    } catch {
      fd = {}
    }
  }

  const str = (v: unknown) => (v == null ? "" : String(v))

  const form: StudyCertForm = {
    cert_no: str(fd.cert_no || c.cert_no),
    reg_no: str(fd.reg_no || c.reg_no),
    student_name: str(fd.student_name || c.student_name),
    father_name: str(fd.father_name || c.father_name),
    mother_name: str(fd.mother_name || c.mother_name),
    branch: str(fd.branch || c.branch),
    character: str(fd.character || "Satisfactory"),
    purpose: str(fd.purpose || "—"),
    semester: str(fd.semester),
    year: str(fd.year),
    acad_year: str(fd.acad_year),
    from_year: str(fd.from_year),
    to_year: str(fd.to_year),
    period_note: str(fd.period_note),
    photo:
      (typeof fd.photo === "string" && fd.photo.indexOf("data:image/") === 0
        ? fd.photo
        : "") ||
      (typeof c.photo === "string" && c.photo.indexOf("data:image/") === 0 ? c.photo : ""),
  }

  const when = c.printed_at || c.sent_to_student_at || c.issued_on || Date.now()
  try {
    form.print_date = new Date(when).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  } catch {
    form.print_date = new Date().toLocaleDateString("en-IN")
  }
  form.print_time = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  return { kind, form }
}
