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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
