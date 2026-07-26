import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './legacy.css'

export const metadata: Metadata = {
  title: 'Government Polytechnic Hubli — Management System',
  description:
    'Official management system of Government Polytechnic Hubli — student, faculty, admin and principal portals with results, attendance, fees, grievances and more.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  themeColor: '#1a4fa0',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning: CMS login may set body/html classes before React hydrates
    // Default class cms-login-mode prevents flash of the old public landing page.
    <html lang="en" className="cms-login-mode" suppressHydrationWarning>
      <head>
        {/* Critical: hide marketing landing until CMS gate is ready (no FOUC) */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
html.cms-login-mode body, body.cms-login-mode { background:#0b1f38!important; min-height:100vh; }
html.cms-login-mode #landingPage > *:not(#cmsLoginGate),
body.cms-login-mode #landingPage > *:not(#cmsLoginGate) { display:none!important; }
html.cms-login-mode #landingPage, body.cms-login-mode #landingPage {
  display:block!important; min-height:100vh; background:transparent;
}
html.cms-login-mode .demo-bar, html.cms-login-mode #demoBar,
body.cms-login-mode .demo-bar, body.cms-login-mode #demoBar { display:none!important; }
html.cms-login-mode #dbAdmin:not(.show),
html.cms-login-mode #dbStudent:not(.show),
html.cms-login-mode #dbFaculty:not(.show),
html.cms-login-mode #dbPrincipal:not(.show) { display:none!important; }
/* Soft shell while scripts load */
#cmsLoginGate .cms-msg-loading { color:#64748b; font-weight:600; font-size:0.85rem; text-align:center; padding:8px 0 4px; }
`,
          }}
        />
        {/* Apply mode before first paint when possible */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.documentElement.classList.add('cms-login-mode');}catch(e){}})();`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="cms-login-mode" suppressHydrationWarning>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
