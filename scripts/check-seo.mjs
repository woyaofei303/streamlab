import assert from "node:assert/strict"

const base = process.argv[2] || "http://127.0.0.1:3000"
const origin = "https://live.sunshinedairy.net"
const response = await fetch(base, { signal: AbortSignal.timeout(15000) })
assert.equal(response.status, 200)
const html = await response.text()
assert.ok(html.includes("<title>StreamLab · 直播学习与互动演示</title>"))
assert.equal(
  new URL(html.match(/rel="canonical" href="([^"]+)"/)[1]).href,
  `${origin}/`,
)
assert.ok(html.includes("直播学习与互动演示</h2>"))
console.log("SEO: homepage title, canonical and server-rendered content passed")

assert.ok(html.includes('name="robots" content="index, follow"'))
assert.ok(
  html.includes(`property="og:image" content="${origin}/social-card.png"`),
)
assert.ok(html.includes('name="twitter:card" content="summary_large_image"'))
const structured = JSON.parse(
  html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1],
)
assert.equal(structured["@type"], "WebSite")
assert.equal(structured.url, origin)
for (const path of [
  "/studio",
  "/following",
  "/library",
  "/lab",
  "/live/mei?source=local",
  "/channel/mei",
  "/?q=music",
  "/?category=irl",
]) {
  const response = await fetch(new URL(path, base))
  assert.equal(response.status, 200, path)
  assert.ok(
    (await response.text()).includes('name="robots" content="noindex, follow"'),
    path,
  )
}
for (const path of [
  "/missing-seo-page",
  "/live/missing-channel",
  "/studio/extra",
]) {
  const response = await fetch(new URL(path, base))
  assert.equal(response.status, 404, path)
}
const robots = await (await fetch(new URL("/robots.txt", base))).text()
assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`))
assert.ok(
  !robots.includes("Disallow: /studio"),
  "Crawlers must be able to read noindex",
)
const sitemap = await (await fetch(new URL("/sitemap.xml", base))).text()
assert.deepEqual(
  [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]),
  [`${origin}/`],
)
for (const [path, mime] of [
  ["/favicon.ico", "image/"],
  ["/icon.svg", "image/svg+xml"],
  ["/apple-icon.png", "image/png"],
  ["/social-card.png", "image/png"],
]) {
  const response = await fetch(new URL(path, base))
  assert.equal(response.status, 200, path)
  assert.ok(response.headers.get("content-type")?.startsWith(mime), path)
  assert.ok((await response.arrayBuffer()).byteLength > 100, path)
}
assert.ok(html.includes('rel="icon" href="/favicon.ico'))
assert.ok(html.includes('rel="apple-touch-icon"'))
console.log(
  "SEO: indexing rules, 404s, sitemap, robots, social tags and icons passed",
)
