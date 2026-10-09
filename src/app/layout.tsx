import type { Metadata } from "next"
import { siteDescription, siteTitle, siteUrl } from "@/lib/seo"
import "./globals.css"
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: siteTitle, template: "%s · StreamLab" },
  description: siteDescription,
  applicationName: "StreamLab",
  robots: { index: false, follow: true },
}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
