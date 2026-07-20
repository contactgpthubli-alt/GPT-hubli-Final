/**
 * Reliable HTML print for browsers + Capacitor Android WebView.
 *
 * Android WebView often no-ops window.print() on 0×0 iframes and blocks popups.
 * This helper:
 *  1) Opens a full-screen preview (so users always see the document)
 *  2) Prints via the main WebView (works better on Android than hidden iframes)
 *  3) Offers Share / Download when the system print dialog is unavailable
 */

export type PrintHtmlOptions = {
  title?: string
  filename?: string
  /** Auto-trigger system print after preview opens (default true on desktop, false on mobile app shell) */
  autoPrint?: boolean
}

const SHELL_ID = "gpth-print-shell"
const SURFACE_ID = "gpth-print-surface"
const STYLE_ID = "gpth-print-injected-style"
const PRINT_MODE_CLASS = "gpth-print-mode"

function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  try {
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true
  } catch {
    /* ignore */
  }
  // Heuristic: standalone WebView UA / app shell
  const ua = navigator.userAgent || ""
  if (/; wv\)/i.test(ua) || /Version\/[\d.]+.*Chrome\/[.0-9]* Mobile/i.test(ua)) {
    // Android WebView often includes "; wv)"
    if (/Android/i.test(ua) && /; wv\)/i.test(ua)) return true
  }
  return false
}

function isCoarseMobile(): boolean {
  if (typeof window === "undefined") return false
  if (isCapacitorNative()) return true
  return window.matchMedia?.("(pointer: coarse)").matches === true && window.innerWidth < 900
}

/** Ensure relative asset URLs resolve to the live site origin. */
export function withPrintBase(html: string): string {
  if (typeof window === "undefined") return html
  const origin = window.location.origin
  if (!origin || html.includes("<base ")) return html
  // Inject <base> right after <head> (or at start of html)
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`)
  }
  return `<!DOCTYPE html><html><head><base href="${origin}/"><meta charset="utf-8"></head><body>${html}</body></html>`
}

function extractParts(html: string): { styles: string; body: string; title: string } {
  const styles: string[] = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    styles.push(m[1])
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const body = bodyMatch ? bodyMatch[1] : html
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "Print"
  return { styles: styles.join("\n"), body, title }
}

function removeShell(): void {
  document.getElementById(SHELL_ID)?.remove()
  document.getElementById(STYLE_ID)?.remove()
  document.body.classList.remove(PRINT_MODE_CLASS)
  document.documentElement.classList.remove(PRINT_MODE_CLASS)
}

function triggerDownload(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename.endsWith(".html") ? filename : `${filename}.html`
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

async function triggerShare(html: string, title: string, filename: string): Promise<boolean> {
  try {
    const file = new File([html], filename.endsWith(".html") ? filename : `${filename}.html`, {
      type: "text/html",
    })
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean
      share?: (data: ShareData) => Promise<void>
    }
    const data: ShareData = { files: [file], title, text: title }
    if (typeof nav.canShare === "function" && nav.canShare(data) && typeof nav.share === "function") {
      await nav.share(data)
      return true
    }
    if (typeof nav.share === "function") {
      // Some WebViews share text/url only
      await nav.share({ title, text: title })
      return true
    }
  } catch (err) {
    // User cancel or unsupported — fall through
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : ""
    if (name === "AbortError") return true
  }
  return false
}

function doMainWindowPrint(): void {
  document.body.classList.add(PRINT_MODE_CLASS)
  document.documentElement.classList.add(PRINT_MODE_CLASS)
  const cleanup = () => {
    document.body.classList.remove(PRINT_MODE_CLASS)
    document.documentElement.classList.remove(PRINT_MODE_CLASS)
    window.removeEventListener("afterprint", cleanup)
  }
  window.addEventListener("afterprint", cleanup)
  // Fallback cleanup if afterprint never fires (common on Android WebView)
  setTimeout(cleanup, 60_000)
  try {
    window.focus()
    window.print()
  } catch {
    cleanup()
  }
}

/**
 * Open print preview + system print / share for the given full HTML document.
 */
export function printHtmlDocument(html: string, options: PrintHtmlOptions = {}): void {
  if (typeof window === "undefined" || typeof document === "undefined") return

  const fullHtml = withPrintBase(html)
  const parts = extractParts(fullHtml)
  const title = options.title || parts.title || "Print"
  const filename =
    options.filename ||
    `${String(title)
      .replace(/[^\w\-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 48) || "document"}.html`
  const mobile = isCoarseMobile()
  const autoPrint = options.autoPrint ?? !mobile

  removeShell()

  const shell = document.createElement("div")
  shell.id = SHELL_ID
  shell.setAttribute("role", "dialog")
  shell.setAttribute("aria-modal", "true")
  shell.setAttribute("aria-label", title)

  shell.innerHTML = `
    <div class="gpth-print-toolbar" data-no-print="1">
      <button type="button" class="gpth-print-btn gpth-print-close" data-action="close" aria-label="Close">✕</button>
      <div class="gpth-print-title">${escapeText(title)}</div>
      <div class="gpth-print-actions">
        <button type="button" class="gpth-print-btn gpth-print-primary" data-action="print">🖨️ Print</button>
        <button type="button" class="gpth-print-btn" data-action="share">Share</button>
        <button type="button" class="gpth-print-btn" data-action="download">Save</button>
      </div>
    </div>
    <div class="gpth-print-hint" data-no-print="1">
      Preview below. Tap <strong>Print</strong> for the system dialog.
      On some phones use <strong>Share</strong> → open in Chrome → Print.
    </div>
    <div id="${SURFACE_ID}" class="gpth-print-surface"></div>
  `

  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
#${SHELL_ID}{
  position:fixed;inset:0;z-index:2147483000;
  display:flex;flex-direction:column;
  background:#0f172a;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
}
#${SHELL_ID} .gpth-print-toolbar{
  flex:0 0 auto;
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:10px 12px;padding-top:max(10px, env(safe-area-inset-top));
  background:#0f2d5c;color:#fff;
  box-shadow:0 2px 10px rgba(0,0,0,.25);
}
#${SHELL_ID} .gpth-print-title{
  flex:1 1 auto;min-width:0;
  font-size:14px;font-weight:700;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
#${SHELL_ID} .gpth-print-actions{display:flex;gap:6px;flex-wrap:wrap;}
#${SHELL_ID} .gpth-print-btn{
  appearance:none;border:1px solid rgba(255,255,255,.35);
  background:rgba(255,255,255,.12);color:#fff;
  border-radius:10px;padding:8px 12px;font-size:13px;font-weight:700;
  cursor:pointer;min-height:40px;
}
#${SHELL_ID} .gpth-print-btn.gpth-print-primary{
  background:#38bdf8;border-color:#38bdf8;color:#0f172a;
}
#${SHELL_ID} .gpth-print-btn.gpth-print-close{min-width:40px;padding:8px 10px;}
#${SHELL_ID} .gpth-print-hint{
  flex:0 0 auto;
  padding:8px 12px;font-size:12px;line-height:1.35;
  background:#1e293b;color:#e2e8f0;
}
#${SHELL_ID} .gpth-print-surface{
  flex:1 1 auto;overflow:auto;-webkit-overflow-scrolling:touch;
  background:#fff;color:#0f172a;
  padding:12px;margin:0;
}
#${SHELL_ID} .gpth-print-surface *{max-width:100%;}
/* Document styles from the printable HTML */
#${SHELL_ID} .gpth-print-doc{
  background:#fff;color:#0f172a;
  min-height:100%;
  max-width:210mm;margin:0 auto;
}
${scopeStyles(parts.styles, `#${SHELL_ID} .gpth-print-doc`)}

/* When printing: hide app chrome, show only document */
@media print{
  html.${PRINT_MODE_CLASS},
  body.${PRINT_MODE_CLASS}{
    background:#fff !important;
    margin:0 !important;padding:0 !important;
    height:auto !important;overflow:visible !important;
  }
  body.${PRINT_MODE_CLASS} > *:not(#${SHELL_ID}){
    display:none !important;
  }
  #${SHELL_ID}{
    position:static !important;inset:auto !important;
    display:block !important;
    background:#fff !important;
    height:auto !important;overflow:visible !important;
    z-index:auto !important;
  }
  #${SHELL_ID} [data-no-print="1"]{
    display:none !important;
  }
  #${SHELL_ID} .gpth-print-surface{
    overflow:visible !important;padding:0 !important;margin:0 !important;
    max-width:none !important;
  }
  #${SHELL_ID} .gpth-print-doc{
    max-width:none !important;margin:0 !important;
  }
}
`

  document.head.appendChild(style)
  document.body.appendChild(shell)

  const surface = shell.querySelector(`#${SURFACE_ID}`) as HTMLElement
  const docWrap = document.createElement("div")
  docWrap.className = "gpth-print-doc"
  docWrap.innerHTML = parts.body
  surface.appendChild(docWrap)

  const close = () => removeShell()

  shell.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement | null)?.closest?.("[data-action]") as HTMLElement | null
    if (!t) return
    const action = t.getAttribute("data-action")
    if (action === "close") close()
    if (action === "print") doMainWindowPrint()
    if (action === "download") triggerDownload(fullHtml, filename)
    if (action === "share") {
      void (async () => {
        const shared = await triggerShare(fullHtml, title, filename)
        if (!shared) triggerDownload(fullHtml, filename)
      })()
    }
  })

  // Escape key closes
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close()
      window.removeEventListener("keydown", onKey)
    }
  }
  window.addEventListener("keydown", onKey)

  // Auto print after layout (desktop / when requested)
  if (autoPrint) {
    setTimeout(() => doMainWindowPrint(), 400)
  } else {
    // On mobile app: still try once — if WebView supports it, dialog appears; preview stays open either way
    setTimeout(() => {
      try {
        doMainWindowPrint()
      } catch {
        /* preview remains */
      }
    }, 500)
  }
}

function escapeText(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Best-effort: prefix selectors so document print CSS applies inside our surface.
 * Leaves @page / @media rules intact (browser applies them globally).
 */
function scopeStyles(css: string, scope: string): string {
  if (!css.trim()) return ""
  // Strip @page (keep for print media block we control) — actually keep @page as-is
  try {
    // Very small CSS scoper: split on } and prefix simple rules
    const parts = css.split("}")
    const out: string[] = []
    for (const part of parts) {
      const chunk = part.trim()
      if (!chunk) continue
      if (chunk.startsWith("@")) {
        // @media / @page — leave mostly as-is; for @media print, still emit
        out.push(chunk + "}")
        continue
      }
      const idx = chunk.indexOf("{")
      if (idx === -1) {
        out.push(chunk + "}")
        continue
      }
      const selectors = chunk.slice(0, idx).trim()
      const body = chunk.slice(idx)
      const scoped = selectors
        .split(",")
        .map((sel) => {
          const s = sel.trim()
          if (!s) return s
          if (s === "html" || s === "body") return scope
          if (s.startsWith("html ") || s.startsWith("body ")) {
            return scope + " " + s.replace(/^(html|body)\s+/, "")
          }
          return `${scope} ${s}`
        })
        .join(", ")
      out.push(scoped + body + "}")
    }
    return out.join("\n")
  } catch {
    return css
  }
}
