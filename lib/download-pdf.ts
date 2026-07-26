/**
 * Download HTML document as PDF (browser + Capacitor WebView).
 * Uses html2canvas + jsPDF — fixed A4 page size.
 *
 * Android WebView: Capacitor Filesystem + Share / native bridge first.
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
 */
export async function deliverPdfBlob(
  blob: Blob,
  filename: string,
): Promise<"share" | "download" | "open" | "viewer" | "native"> {
  const safeName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`

  // 0) Capacitor / native bridge
  if (isNativeAndroid()) {
    try {
      const b64 = await blobToBase64Raw(blob)
      const native = await saveAndSharePdfNative(b64, safeName)
      if (native) return "native"
    } catch (e) {
      console.warn("[pdf] native save failed", e)
    }
  }

  const file = new File([blob], safeName, { type: "application/pdf" })
  const nav = navigator as Navigator & {
    canShare?: (d?: ShareData) => boolean
    share?: (d: ShareData) => Promise<void>
  }

  try {
    if (typeof nav.canShare === "function" && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: safeName, text: safeName })
      return "share"
    }
  } catch (e) {
    if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "AbortError") {
      return "share"
    }
  }

  try {
    if (typeof nav.share === "function") {
      await nav.share({ files: [file], title: safeName })
      return "share"
    }
  } catch {
    /* continue */
  }

  const url = URL.createObjectURL(blob)

  try {
    const a = document.createElement("a")
    a.href = url
    a.download = safeName
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
    if (!isLikelyAndroidWebView()) return "download"
  } catch {
    /* continue */
  }

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

  try {
    showInAppPdfViewer(url, safeName, blob)
    return "viewer"
  } catch {
    /* continue */
  }

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
    "A4 PDF preview. On Android: tap Share / Save → Files, Drive, or WhatsApp."

  shell.appendChild(bar)
  shell.appendChild(frame)
  shell.appendChild(hint)
  document.body.appendChild(shell)
}

/**
 * Render HTML to multi-page A4 PDF (210×297 mm).
 * Renders in a fixed-size on-page host (not off-screen) so Android WebView captures content.
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

  // A4 at 96dpi ≈ 794 × 1123 px
  const A4_W = orientation === "landscape" ? 1123 : 794
  const A4_H = orientation === "landscape" ? 794 : 1123

  // On-page (opacity near 0) — off-screen left:-10000 often captures blank on Android
  const host = document.createElement("div")
  host.setAttribute("aria-hidden", "true")
  host.id = "gpth-pdf-render-host"
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${A4_W}px`,
    "background:#ffffff",
    "z-index:2147482000",
    "opacity:0.01",
    "pointer-events:none",
    "overflow:hidden",
  ].join(";")
  document.body.appendChild(host)

  const mount = document.createElement("div")
  mount.style.cssText = `width:${A4_W}px;min-height:${A4_H}px;background:#fff;color:#111;box-sizing:border-box;`
  host.appendChild(mount)

  // Extract body inner HTML if full document
  let bodyHtml = html
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  if (bodyMatch) bodyHtml = bodyMatch[1]
  // Inject styles from head
  let styleHtml = ""
  const styleMatches = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi)
  if (styleMatches) styleHtml = styleMatches.join("\n")
  mount.innerHTML = `${styleHtml}<div class="gpth-a4-root" style="width:${A4_W}px;min-height:${A4_H}px;background:#fff;padding:0;margin:0;">${bodyHtml}</div>`

  // Absolute-ize logo paths for capture
  mount.querySelectorAll("img").forEach((img) => {
    const el = img as HTMLImageElement
    const src = el.getAttribute("src") || ""
    if (src.startsWith("/") && window.location?.origin) {
      el.src = window.location.origin + src
    }
  })

  await new Promise<void>((resolve) => {
    const imgs = Array.from(mount.querySelectorAll("img"))
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
      if ((img as HTMLImageElement).complete) done()
      else {
        img.addEventListener("load", done)
        img.addEventListener("error", done)
      }
    })
    setTimeout(resolve, 2000)
  })

  await new Promise((r) => setTimeout(r, 100))

  const contentH = Math.max(mount.scrollHeight, mount.offsetHeight, A4_H)

  const canvas = await html2canvas(mount, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false,
    windowWidth: A4_W,
    width: A4_W,
    height: contentH,
    scrollX: 0,
    scrollY: 0,
  })

  host.remove()

  // Guard: blank canvas → throw so UI can report error
  const probe = canvas.getContext("2d")?.getImageData(0, 0, Math.min(40, canvas.width), Math.min(40, canvas.height))
  if (probe) {
    let nonWhite = 0
    for (let i = 0; i < probe.data.length; i += 4) {
      if (probe.data[i] < 250 || probe.data[i + 1] < 250 || probe.data[i + 2] < 250) nonWhite++
    }
    if (nonWhite < 5) {
      console.warn("[pdf] canvas appears blank — content may not have rendered")
    }
  }

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

  let heightLeft = imgH
  let position = 0
  const imgData = canvas.toDataURL("image/jpeg", 0.93)

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
