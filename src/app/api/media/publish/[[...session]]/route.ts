import { fail, readBody } from "../../../../../lib/call-server"

export const runtime = "nodejs"
const upstream = "http://127.0.0.1:8889/browser/whip"
const sessionPattern = /^[a-zA-Z0-9_-]{1,128}$/
type Context = { params: Promise<{ session?: string[] }> }

async function handle(request: Request, context: Context) {
  try {
    const origin = request.headers.get("origin")
    if (
      origin &&
      new URL(origin).host !==
        (request.headers.get("host") || new URL(request.url).host)
    )
      fail("请求来源不正确", 403)
    const { session = [] } = await context.params
    if (
      request.method === "DELETE"
        ? session.length !== 1 || !sessionPattern.test(session[0])
        : session.length !== 0
    )
      fail("Invalid media session", 400)
    const password = process.env.PUBLISH_PASSWORD
    if (!password && process.env.NODE_ENV === "production")
      fail("服务器尚未配置网页开播，请联系维护者", 503)
    // 公开演示只开放 browser 发布；共用推流密码始终留在服务器端。
    const headers: Record<string, string> = password
      ? {
          Authorization: `Basic ${Buffer.from(`publisher:${password}`).toString("base64")}`,
        }
      : {}
    if (request.method === "DELETE") {
      const response = await fetch(`${upstream}/${session[0]}`, {
        method: "DELETE",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok && response.status !== 404)
        fail("停止网页直播失败，请稍后重试", 502)
      return new Response(null, { status: 204 })
    }
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/sdp"
    )
      fail("SDP required", 415)
    const body = await readBody(request, 64000)
    const response = await fetch(upstream, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/sdp" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(7000),
    })
    if (!response.ok) fail("媒体服务拒绝开播，请确认配置或是否已有直播", 502)
    const location = response.headers.get("Location")
    if (!location) fail("Missing media session", 502)
    const url = new URL(location, upstream)
    const id = url.pathname.slice("/browser/whip/".length)
    if (
      url.origin !== new URL(upstream).origin ||
      !url.pathname.startsWith("/browser/whip/") ||
      !sessionPattern.test(id) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      fail("Invalid media session", 502)
    return new Response(await response.text(), {
      status: 201,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store",
        Location: `/api/media/publish/${id}`,
      },
    })
  } catch (error) {
    const status = (error as { status?: number }).status
    return Response.json(
      {
        error:
          status && error instanceof Error
            ? error.message
            : "媒体服务连接失败，请稍后重试",
      },
      { status: status ?? 502 },
    )
  }
}

export const POST = handle
export const DELETE = handle
