/**
 * Download HTML document as PDF (browser + Capacitor WebView).
 * Uses html2canvas + jsPDF — no system print dialog.
 */

export type DownloadPdfOptions = {
  filename?: string
  /** A4 portrait by default */
  orientation?: "portrait" | "landscape"
}

function sanitizeFilename(name: string): string {
  return (
    String(name || "document")
      .replace(/[^\w\-.\s]+/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "document"
  )
}

/**
 * Render a full HTML document string to a multi-page A4 PDF and trigger download.
 */
export async function downloadHtmlAsPdf(
  html: string,
  options: DownloadPdfOptions = {},
): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return

  const filename = sanitizeFilename(options.filename || "document") + ".pdf"
  const orientation = options.orientation || "portrait"

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ])

  // Off-screen host sized like A4 content width (~794px at 96dpi for 210mm)
  const host = document.createElement("div")
  host.setAttribute("aria-hidden", "true")
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1;pointer-events:none;"
  document.body.appendChild(host)

  const frame = document.createElement("iframe")
  frame.style.cssText = "width:794px;border:0;background:#fff;"
  host.appendChild(frame)

  const doc = frame.contentDocument || frame.contentWindow?.document
  if (!doc) {
    host.remove()
    throw new Error("Could not create PDF document")
  }

  // Ensure base href so relative assets resolve
  let full = html
  if (!/<base\s/i.test(full) && window.location?.origin) {
    full = full.replace(
      /<head([^>]*)>/i,
      `<head$1><base href="${window.location.origin}/">`,
    )
  }

  doc.open()
  doc.write(full)
  doc.close()

  // Wait for images
  await new Promise<void>((resolve) => {
    const imgs = Array.from(doc.images || [])
    if (!imgs.length) {
      resolve()
      return
    }
    let left = imgs.length
    const done = () => {
      left -= 1
      if (left <= 0) resolve()
    }
    imgs.forEach((img) => {
      if (img.complete) done()
      else {
        img.onload = done
        img.onerror = done
      }
    })
    setTimeout(resolve, 2500)
  })

  await new Promise((r) => setTimeout(r, 80))

  const body = doc.body
  // Expand iframe height to full content
  const contentH = Math.max(body.scrollHeight, body.offsetHeight, 1123)
  frame.style.height = contentH + "px"

  const canvas = await html2canvas(body, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false,
    windowWidth: 794,
    width: 794,
    height: contentH,
  })

  host.remove()

  const pdf = new jsPDF({
    orientation,
    unit: "mm",
    format: "a4",
    compress: true,
  })

  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const imgW = pageW
  const imgH = (canvas.height * imgW) / canvas.width

  // Slice long content across pages
  let heightLeft = imgH
  let position = 0
  const imgData = canvas.toDataURL("image/jpeg", 0.92)

  pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH, undefined, "FAST")
  heightLeft -= pageH

  while (heightLeft > 2) {
    position = heightLeft - imgH
    pdf.addPage()
    pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH, undefined, "FAST")
    heightLeft -= pageH
  }

  // Prefer share on mobile WebView if available
  try {
    const blob = pdf.output("blob")
    const file = new File([blob], filename, { type: "application/pdf" })
    const nav = navigator as Navigator & {
      canShare?: (d?: ShareData) => boolean
      share?: (d: ShareData) => Promise<void>
    }
    if (typeof nav.canShare === "function" && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: filename })
      return
    }
  } catch {
    /* fall through to save */
  }

  pdf.save(filename)
}
