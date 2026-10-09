import { startCallWorker } from "../../../lib/call-mixer"
import { actOnCall, bearer, readBody, snapshot } from "../../../lib/call-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(request: Request) {
  startCallWorker()
  return Response.json(snapshot(bearer(request)), {
    headers: { "Cache-Control": "no-store" },
  })
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin")
    if (
      origin &&
      new URL(origin).host !==
        (request.headers.get("host") || new URL(request.url).host)
    )
      return Response.json({ error: "请求来源不正确" }, { status: 403 })
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return Response.json({ error: "JSON required" }, { status: 415 })
    const text = await readBody(request, 2048)
    const body = JSON.parse(text)
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw Error("无效请求")
    startCallWorker()
    return Response.json(actOnCall(request, body), {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "连麦操作失败" },
      { status: (error as { status?: number }).status ?? 400 },
    )
  }
}
