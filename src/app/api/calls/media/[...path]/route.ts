import { randomUUID } from "node:crypto"
import {
  authorized,
  bearer,
  fail,
  readBody,
  room,
  sweep,
} from "../../../../../lib/call-server"

export const runtime = "nodejs"
type Context = { params: Promise<{ path: string[] }> }

async function handle(request: Request, context: Context) {
  let reservation = ""
  try {
    sweep()
    const token = bearer(request)
    const actor = authorized(token)
    if (!room.host || !actor || !["accepted", "joined"].includes(actor.status))
      fail("请先获得房主同意", 403)
    const { path } = await context.params
    const [id, protocol, sessionId] = path
    if (
      path.length < 2 ||
      path.length > 3 ||
      !["whip", "whep"].includes(protocol)
    )
      fail("Invalid media path")
    const target = id === room.host.id ? room.host : room.members.get(id)
    if (
      id !== "main" &&
      (!target || !["accepted", "joined"].includes(target.status))
    )
      fail("麦位已关闭", 404)
    if (protocol === "whip" && actor.id !== id) fail("无权发布到此麦位", 403)
    if (request.method === "DELETE") {
      const session = room.sessions.get(sessionId)
      if (
        !session ||
        session.token !== token ||
        !session.url.includes(`/${protocol}/`)
      )
        fail("会话不存在", 404)
      room.sessions.delete(sessionId)
      await fetch(session.url, {
        method: "DELETE",
        signal: AbortSignal.timeout(3000),
      }).catch(() => {})
      return new Response(null, { status: 204 })
    }
    if (
      sessionId ||
      !request.headers.get("content-type")?.startsWith("application/sdp")
    )
      fail("SDP required")
    if (
      [...room.sessions.values()].filter((s) => s.token === token).length >= 8
    )
      fail("连接过多，请退出后重试", 429)
    const sdp = await readBody(request, 64000)
    reservation = randomUUID()
    room.sessions.set(reservation, { url: "", token, memberId: actor.id })
    const endpoint = `http://127.0.0.1:8889/${id === "main" ? room.source : `call/${id}`}/${protocol}`
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: sdp,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) fail("媒体服务尚未就绪，请稍后重试", 502)
    const location = response.headers.get("Location")
    if (!location) fail("Missing media session", 502)
    const url = new URL(location, endpoint)
    if (
      url.origin !== new URL(endpoint).origin ||
      !url.pathname.startsWith(`${new URL(endpoint).pathname}/`)
    )
      fail("Invalid media session", 502)
    if (
      !room.host ||
      authorized(token) !== actor ||
      !["accepted", "joined"].includes(actor.status)
    ) {
      await fetch(url, {
        method: "DELETE",
        signal: AbortSignal.timeout(3000),
      }).catch(() => {})
      fail("麦位已关闭", 409)
    }
    const key = reservation
    reservation = ""
    room.sessions.set(key, { url: url.href, token, memberId: actor.id })
    return new Response(await response.text(), {
      status: 201,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store",
        Location: `/api/calls/media/${id}/${protocol}/${key}`,
      },
    })
  } catch (error) {
    if (reservation) room.sessions.delete(reservation)
    return Response.json(
      { error: error instanceof Error ? error.message : "媒体连接失败" },
      { status: (error as { status?: number }).status ?? 502 },
    )
  }
}
export const POST = handle
export const DELETE = handle
