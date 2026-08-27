import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { legacyBodyHtml } from '@/lib/legacy-body'
import { getCurrentUser } from '@/lib/auth'
import CmsLoginGate from './cms-login-gate'

export const metadata: Metadata = {
  title: 'Government Polytechnic Hubli — Management System',
  description:
    'Official management system of Government Polytechnic Hubli — student, faculty, admin and principal portals with results, attendance, fees, grievances and more. Developed by Akshay Uppar.',
  authors: [{ name: 'Akshay Uppar' }],
  creator: 'Akshay Uppar',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  themeColor: '#1a4fa0',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

function LegacyCmsPage() {
  return (
    <>
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: legacyBodyHtml }} />
      <Script
        id="bridge-config"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.__GPT_CONFIG = { demoLoginEnabled: ${process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true'} };`,
        }}
      />
      <Script src="/legacy-app.js?v=20260827hodfix" strategy="afterInteractive" />
      <Script src="/legacy-bridge.js?v=20260827hodfix" strategy="afterInteractive" />
    </>
  )
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const forceLegacy = params?.legacy === '1'
  const user = await getCurrentUser()

  // Logged in, or explicitly asked for the legacy path (e.g. registration modal,
  // which still lives inside the legacy bridge) — unchanged behaviour.
  if (user || forceLegacy) {
    return <LegacyCmsPage />
  }

  // Fast path: real React login screen, no legacy blob / legacy-app.js / legacy-bridge.js.
  return <CmsLoginGate />
}