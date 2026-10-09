import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { PageContent } from "@/components/app"
import { createState } from "@/lib/seed"
import { siteDescription, siteTitle, siteUrl } from "@/lib/seo"

type Props = {
  params: Promise<{ path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function pageTitle(path: string[]) {
  if (!path.length) return siteTitle
  if (path.length === 1) {
    const titles: Record<string, string> = {
      studio: "直播工作台",
      following: "正在关注",
      library: "我的空间",
      lab: "播放实验室",
    }
    if (Object.hasOwn(titles, path[0])) return titles[path[0]]
  }
  if (path.length === 2 && ["live", "channel"].includes(path[0])) {
    const channel = createState().channels.find((c) => c.id === path[1])
    if (channel)
      return `${channel.name} · ${path[0] === "live" ? "直播间" : "频道"}`
  }
  notFound()
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { path = [] } = await params
  const title = pageTitle(path)
  const query = await searchParams
  const canonical = `/${path.join("/")}`
  const index =
    !path.length &&
    !Object.keys(query).some((key) =>
      ["q", "category", "status", "language"].includes(key),
    )
  return {
    title: path.length ? title : { absolute: title },
    alternates: { canonical },
    robots: { index, follow: true },
    openGraph: {
      title,
      description: siteDescription,
      url: canonical,
      type: "website",
      locale: "zh_CN",
      siteName: "StreamLab",
      images: [
        {
          url: "/social-card.png",
          width: 1200,
          height: 630,
          alt: "StreamLab 直播学习与互动演示",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: siteDescription,
      images: ["/social-card.png"],
    },
  }
}

export default async function Page({ params }: Props) {
  const { path = [] } = await params
  pageTitle(path)
  return (
    <>
      <Suspense>
        <PageContent />
      </Suspense>
      {!path.length && (
        <footer className="border-t border-white/10 px-6 py-10 text-zinc-400 lg:px-9">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-xl font-semibold text-zinc-100">
              直播学习与互动演示
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7">
              {siteDescription}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-7">
              你可以通过 OBS 或 FFmpeg
              推送音视频，也可以在浏览器中开播。观看端支持 HLS 直播播放和 WebRTC
              实时音视频。账号、聊天、关注与观众数量均为浏览器内的演示数据。
            </p>
            <nav
              aria-label="直播体验入口"
              className="mt-5 flex flex-wrap gap-6 text-sm text-violet-300"
            >
              <Link href="/live/mei?source=local">观看推流演示</Link>
              <Link href="/studio">进入直播工作台</Link>
            </nav>
          </div>
          <script
            type="application/ld+json"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: static site data, with HTML delimiters escaped for JSON-LD
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: "StreamLab",
                url: siteUrl,
                description: siteDescription,
                inLanguage: "zh-CN",
              }).replace(/</g, "\\u003c"),
            }}
          />
        </footer>
      )}
    </>
  )
}
