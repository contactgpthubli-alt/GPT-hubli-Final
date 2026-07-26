/**
 * Download HTML document as PDF (browser + Capacitor WebView).
 * Uses html2canvas + jsPDF — no system print dialog.
 *
 * Android WebView often blocks `pdf.save()` (no download listener / storage
 * permission). Order:
 * 1) Capacitor Filesystem + Share (native APK)
 * 2) Web Share API
 * 3) <a download>
 * 4) Open / in-app viewer
 */

import { isNativeAndroid, saveAndSharePdfNative, blobToBase64Raw } from "./native-android"

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

function isLikelyAndroidWebView(): boolean {
  if (typeof window === "undefined") return false
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true
  } catch {
    /* ignore */
  }
  const ua = navigator.userAgent || ""
  return /Android/i.test(ua) && (/wv\)/i.test(ua) || /Version\/\d+\.\d+/i.test(ua))
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const r = String(reader.result || "")
      const i = r.indexOf(",")
      resolve(i >= 0 ? r.slice(i + 1) : r)
    }
    reader.onerror = () => reject(new Error("Could not read PDF"))
    reader.readAsDataURL(blob)
  })
}

/**
 * Deliver a PDF blob to the user on desktop + Android WebView.
 * Returns which path succeeded for UI messaging.
 */
export async function deliverPdfBlob(
  blob: Blob,
  filename: string,
): Promise<"share" | "download" | "open" | "viewer" | "native"> {
  // 0) Capacitor Filesystem + Share (new APK) — most reliable on Android
  if (isNativeAndroid()) {
    try {
      const b64 = await blobToBase64Raw(blob)
      const native = await saveAndSharePdfNative(b64, filename)
      if (native) return "native"
    } catch (e) {
      console.warn("[pdf] native save failed", e)
    }
  }

  const file = new File([blob], filename, { type: "application/pdf" })
  const nav = navigator as Navigator & {
    canShare?: (d?: ShareData) => boolean
    share?: (d: ShareData) => Promise<void>
  }

  // 1) Web Share API with file
  try {
    if (typeof nav.canShare === "function" && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: filename, text: filename })
      return "share"
    }
  } catch (e) {
    // User cancel should not fall through as error if AbortError
    if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "AbortError") {
      return "share"
    }
  }

  // 2) Share without canShare (some WebViews)
  try {
    if (typeof nav.share === "function") {
      await nav.share({ files: [file], title: filename })
      return "share"
    }
  } catch {
    /* continue */
  }

  const url = URL.createObjectURL(blob)

  // 3) Anchor download (Chrome desktop / some WebViews)
  try {
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.rel = "noopener"
    a.style.display = "none"
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      try {
        a.remove()
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }, 60_000)
    // On Android WebView this often no-ops; still try open below if native
    if (!isLikelyAndroidWebView()) return "download"
  } catch {
    /* continue */
  }

  // 4) Open blob URL — user can Save/Share from the system PDF viewer
  try {
    const w = window.open(url, "_blank")
    if (w) {
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url)
        } catch {
          /* ignore */
        }
      }, 120_000)
      return "open"
    }
  } catch {
    /* continue */
  }

  // 5) Full-screen in-app PDF viewer with Save/Share actions (WebView-safe)
  try {
    showInAppPdfViewer(url, filename, blob)
    return "viewer"
  } catch {
    /* continue */
  }

  // 6) Data-URL navigation last resort
  try {
    const b64 = await blobToBase64(blob)
    const dataUrl = `data:application/pdf;base64,${b64}`
    window.location.href = dataUrl
    return "open"
  } catch {
    URL.revokeObjectURL(url)
    throw new Error("Could not save or open PDF on this device")
  }
}

function showInAppPdfViewer(blobUrl: string, filename: string, blob: Blob) {
  const existing = document.getElementById("gpth-pdf-viewer-shell")
  if (existing) existing.remove()

  const shell = document.createElement("div")
  shell.id = "gpth-pdf-viewer-shell"
  shell.setAttribute("role", "dialog")
  shell.setAttribute("aria-label", "PDF preview")
  shell.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;background:#0f172a;display:flex;flex-direction:column;font-family:system-ui,sans-serif;"

  const bar = document.createElement("div")
  bar.style.cssText =
    "display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 12px;background:#1e293b;color:#fff;"
  bar.innerHTML = `<strong style="flex:1;font-size:0.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${filename.replace(
    /[<>&"]/g,
    "",
  )}</strong>`

  const mkBtn = (label: string, primary?: boolean) => {
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = label
    b.style.cssText = primary
      ? "padding:8px 12px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;font-size:0.82rem;"
      : "padding:8px 12px;border:1px solid #64748b;border-radius:8px;background:transparent;color:#fff;font-weight:600;font-size:0.82rem;"
    return b
  }

  const shareBtn = mkBtn("Share / Save", true)
  const openBtn = mkBtn("Open")
  const closeBtn = mkBtn("Close")

  shareBtn.onclick = async () => {
    try {
      const file = new File([blob], filename, { type: "application/pdf" })
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
      if (nav.share) {
        await nav.share({ files: [file], title: filename })
        return
      }
    } catch {
      /* ignore */
    }
    try {
      const a = document.createElement("a")
      a.href = blobUrl
      a.download = filename
      a.click()
    } catch {
      window.open(blobUrl, "_blank")
    }
  }
  openBtn.onclick = () => {
    window.open(blobUrl, "_blank")
  }
  closeBtn.onclick = () => {
    try {
      URL.revokeObjectURL(blobUrl)
    } catch {
      /* ignore */
    }
    shell.remove()
  }

  bar.appendChild(shareBtn)
  bar.appendChild(openBtn)
  bar.appendChild(closeBtn)

  const frame = document.createElement("iframe")
  frame.src = blobUrl
  frame.title = filename
  frame.style.cssText = "flex:1;width:100%;border:0;background:#fff;"

  const hint = document.createElement("div")
  hint.style.cssText =
    "padding:8px 12px;background:#334155;color:#e2e8f0;font-size:0.78rem;line-height:1.4;"
  hint.textContent =
    "On Android: tap Share / Save → Drive, Files, or WhatsApp. If the preview is blank, tap Open."

  shell.appendChild(bar)
  shell.appendChild(frame)
  shell.appendChild(hint)
  document.body.appendChild(shell)
}

/**
 * Render a full HTML document string to a multi-page A4 PDF and deliver it.
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

  const blob = pdf.output("blob")
  await deliverPdfBlob(blob, filename)
}
