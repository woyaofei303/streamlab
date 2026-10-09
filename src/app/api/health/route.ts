export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const revision = process.env.APP_REVISION || "development"
  let healthy = false
  try {
    const response = await fetch("http://127.0.0.1:9997/v3/paths/list", {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    })
    healthy = response.ok && Array.isArray((await response.json()).items)
  } catch {
    healthy = false
  }
  return Response.json(
    { status: healthy ? "ok" : "error", revision },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  )
}
