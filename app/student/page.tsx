import type { Metadata, Viewport } from "next"
import StudentApp from "./student-app"

export const metadata: Metadata = {
  title: "Student App — Government Polytechnic Hubli",
  description:
    "Mobile student portal for Government Polytechnic Hubli — results, attendance, forms, certificates and profile.",
  appleWebApp: {
    capable: true,
    title: "GPT Hubli Student",
    statusBarStyle: "default",
  },
  applicationName: "GPT Hubli Student",
  manifest: "/student-manifest.webmanifest",
}

export const viewport: Viewport = {
  themeColor: "#1a4fa0",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
}

export default function StudentPage() {
  return <StudentApp />
}
