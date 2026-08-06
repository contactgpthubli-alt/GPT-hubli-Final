import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Edge security layer:
 * - Strong browser headers (clickjacking, MIME sniff, referrer)
 * - Never cache authenticated HTML shells
 * - Block obvious probe paths
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Block common exploit probes early
  if (
    pathname.startsWith("/.env") ||
    pathname.startsWith("/wp-admin") ||
    pathname.startsWith("/wp-login") ||
    pathname.includes("phpmyadmin") ||
    pathname.endsWith(".php")
  ) {
    return new NextResponse("Not found", { status: 404 })
  }

  const res = NextResponse.next()

  res.headers.set("X-Frame-Options", "DENY")
  res.headers.set("X-Content-Type-Options", "nosniff")
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  res.headers.set("X-DNS-Prefetch-Control", "off")
  // Basic CSP: allow self + Google Fonts + images. Scripts are same-origin only.
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  )

  // Portal HTML must not be cached by shared browsers / CDN in a way that leaks a session view
  if (
    pathname === "/" ||
    pathname.startsWith("/student") ||
    pathname.startsWith("/api/")
  ) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
    res.headers.set("Pragma", "no-cache")
  }

  return res
}

export const config = {
  matcher: [
    /*
     * Run on all paths except static assets Next serves efficiently.
     */
    "/((?!_next/static|_next/image|favicon.ico|images/|icon|apple-icon|placeholder|karnataka-emblem|docs/).*)",
  ],
}
