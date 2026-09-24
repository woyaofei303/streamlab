import type { Metadata } from "next"
import "./globals.css"
export const metadata: Metadata = {
  title: "StreamLab · 找到你的同频时刻",
  description:
    "Live moments. Real connections. A local livestream frontend playground.",
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
