import type { MetadataRoute } from "next"
import { siteUrl } from "@/lib/seo"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/hls/", "/media/", "/browser/", "/rtc/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
