import Script from 'next/script'
import { legacyBodyHtml } from '@/lib/legacy-body'

/**
 * Government Polytechnic Hubli — Management System
 *
 * Faithful port of the original single-file application.
 * - Markup (landing page, login modals, all dashboards) is server-rendered from lib/legacy-body.ts
 * - Styles live in app/legacy.css
 * - Application logic (auth, roles, results, attendance, fees, gallery, grievances, ...)
 *   runs from public/legacy-app.js, which exposes the global functions used by
 *   the inline event handlers in the markup.
 */
export default function Page() {
  return (
    <>
      {/* biome-ignore lint: faithful port of the original static HTML application */}
      {/* suppressHydrationWarning: browsers normalize the hand-written legacy markup,
          so it can't byte-match the server string. React intentionally never patches
          this subtree — all interactivity is handled by legacy-app.js. */}
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: legacyBodyHtml }} />
      {/* Bridge config must exist before the bridge script runs.
          Demo quick-login is opt-in via NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true. */}
      <Script id="bridge-config" strategy="afterInteractive">
        {`window.__GPT_CONFIG = { demoLoginEnabled: ${process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true'} };`}
      </Script>
      <Script src="/legacy-app.js" strategy="afterInteractive" />
      {/* legacy-bridge.js patches the legacy globals to persist via the API.
          Must load after legacy-app.js (same strategy preserves document order).
          afterInteractive — not lazyOnload — so auth is wired before the user clicks Login. */}
      <Script src="/legacy-bridge.js" strategy="afterInteractive" />
      {/* Transfer Certificate (ACM Issue TC / Register / Template) */}
      <Script src="/legacy-tc.js" strategy="afterInteractive" />
      {/* Study + Studying Certificates (ACM) */}
      <Script src="/legacy-acm-study.js" strategy="afterInteractive" />
    </>
  )
}
