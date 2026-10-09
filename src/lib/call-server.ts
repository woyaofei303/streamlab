import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import type { CallPerson, CallSnapshot } from "./call-types"

type Member = CallPerson & { token: string; seenAt: number }
type Session = { url: string; token: string; memberId: string }
type Room = {
  host?: Member
  source: "live" | "browser"
  sourceMode: CallSnapshot["sourceMode"]
  inputs: Record<CallSnapshot["source"], CallSnapshot["input"]>
  members: Map<string, Member>
  sessions: Map<string, Session>
  mix: CallSnapshot["mix"]
}
// ponytail: 单进程、单直播间、4 麦位；多实例部署时再迁移共享状态和任务队列。
const globals = globalThis as typeof globalThis & { callRoom?: Room }
globals.callRoom ??= {
  source: "browser",
  sourceMode: "auto",
  inputs: { live: { ready: false }, browser: { ready: false } },
  members: new Map(),
  sessions: new Map(),
  mix: { state: "idle" },
}
export const room = globals.callRoom
// Keep an existing local call usable across a development hot reload.
room.sourceMode ??= "auto"
room.inputs ??= { live: { ready: false }, browser: { ready: false } }
function selectSource() {
  const previous = room.source
  if (room.sourceMode !== "auto") room.source = room.sourceMode
  else if (!room.inputs[room.source].ready) {
    if (room.inputs.browser.ready) room.source = "browser"
    else if (room.inputs.live.ready) room.source = "live"
  }
  if (previous !== room.source && room.host)
    room.mix = { state: "starting", message: "正在切换房主画面" }
}
export function updateCallInputs(
  paths: {
    name: string
    ready: boolean
    bytesReceived: number
    source?: { id: string }
  }[],
) {
  for (const source of ["live", "browser"] as const) {
    const path = paths.find(
      (p) => p.name === source && p.ready && p.bytesReceived > 0,
    )
    room.inputs[source] = { ready: Boolean(path), sourceId: path?.source?.id }
  }
  selectSource()
}
function setSourceMode(source: unknown) {
  if (source !== "auto" && source !== "live" && source !== "browser")
    fail("请选择自动识别、OBS 或网页开播")
  room.sourceMode = source
  selectSource()
}
const active = (member: CallPerson) =>
  member.status === "accepted" || member.status === "joined"
export const speakers = () => [...room.members.values()].filter(active)
const person = ({
  token: _token,
  seenAt: _seenAt,
  ...value
}: Member): CallPerson => value
export const bearer = (request: Request) =>
  request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status })
}
export async function readBody(request: Request, limit: number) {
  const reader = request.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      fail("Request too large", 413)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}
export function authorized(token: string) {
  if (!token) return undefined
  return room.host?.token === token
    ? room.host
    : [...room.members.values()].find((member) => member.token === token)
}
export function disconnect(member: Member, status: Member["status"] = "ended") {
  member.status = status
  member.expiresAt = Date.now() + 120000
  for (const [key, session] of room.sessions) {
    if (session.memberId !== member.id) continue
    room.sessions.delete(key)
    if (!session.url) continue
    void fetch(session.url, {
      method: "DELETE",
      signal: AbortSignal.timeout(3000),
    }).catch(() => {})
  }
}
export function closeRoom() {
  if (room.host) disconnect(room.host)
  room.host = undefined
  for (const member of room.members.values())
    if (member.status === "pending" || active(member)) disconnect(member)
  room.mix = { state: "idle" }
}
export function sweep() {
  const now = Date.now()
  if (room.host && now - room.host.seenAt > 30000) closeRoom()
  for (const [id, member] of room.members) {
    if (
      (member.status === "pending" || member.status === "accepted") &&
      member.expiresAt <= now
    )
      disconnect(member, "expired")
    if (member.status === "joined" && now - member.seenAt > 30000)
      disconnect(member, "expired")
    if (
      !active(member) &&
      member.status !== "pending" &&
      member.expiresAt <= now
    )
      room.members.delete(id)
  }
}
export function snapshot(token = ""): CallSnapshot {
  sweep()
  const member = authorized(token)
  if (member && (active(member) || member.status === "pending"))
    member.seenAt = Date.now()
  return {
    enabled: Boolean(room.host),
    source: room.source,
    sourceMode: room.sourceMode,
    input: room.inputs[room.source],
    capacity: 4,
    participants: [...(room.host ? [room.host] : []), ...speakers()].map(
      person,
    ),
    ...(member === room.host && room.host
      ? {
          pending: [...room.members.values()]
            .filter((m) => m.status === "pending")
            .map(person),
        }
      : {}),
    ...(member ? { self: person(member) } : {}),
    mix: room.mix,
  }
}
const attempts = new Map<string, { count: number; until: number }>()
function throttle(request: Request) {
  const key =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local"
  for (const [ip, value] of attempts)
    if (value.until < Date.now()) attempts.delete(ip)
  const value = attempts.get(key) ?? { count: 0, until: Date.now() + 60000 }
  if (value.count >= 12 || attempts.size > 1000)
    fail("操作太频繁，请一分钟后再试", 429)
  value.count++
  attempts.set(key, value)
}
function makeMember(
  name: string,
  role: Member["role"],
  status: Member["status"],
): Member {
  return {
    id: randomUUID(),
    token: randomBytes(32).toString("hex"),
    name,
    role,
    status,
    muted: false,
    expiresAt: Date.now() + 60000,
    seenAt: Date.now(),
  }
}
export function actOnCall(request: Request, body: Record<string, unknown>) {
  sweep()
  const token = bearer(request)
  const actor = authorized(token)
  if (body.action === "open") {
    throttle(request)
    const expected = process.env.PUBLISH_PASSWORD
    if (expected) {
      const given = Buffer.from(
        typeof body.password === "string" ? body.password : "",
      )
      const secret = Buffer.from(expected)
      if (given.length !== secret.length || !timingSafeEqual(given, secret))
        fail("推流密码不正确", 403)
    } else if (
      process.env.NODE_ENV !== "development" ||
      !["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)
    ) {
      fail("服务器未配置连麦管理密码", 503)
    }
    if (room.host) fail("连麦已在其他开播页开启，请先关闭或等待离线释放", 409)
    setSourceMode(body.source)
    room.host = makeMember("房主", "房主", "joined")
    return { token: room.host.token, id: room.host.id }
  }
  if (body.action === "request") {
    throttle(request)
    if (!room.host) fail("主播尚未开启连麦", 409)
    if (
      [...room.members.values()].filter((m) => m.status === "pending").length >=
        12 ||
      room.members.size >= 80
    )
      fail("申请队列已满，请稍后再试", 429)
    if (actor && (active(actor) || actor.status === "pending"))
      return { token: actor.token, id: actor.id }
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > 30 ||
      !["主播", "观众"].includes(String(body.role))
    )
      fail("请填写昵称和连麦身份")
    const member = makeMember(
      body.name.trim(),
      body.role as "主播" | "观众",
      "pending",
    )
    room.members.set(member.id, member)
    return { token: member.token, id: member.id }
  }
  if (!actor || !room.host || (!active(actor) && actor.status !== "pending"))
    fail("连麦凭证已失效，请重新申请", 403)
  actor.seenAt = Date.now()
  const isHost = actor === room.host
  if (body.action === "source") {
    if (!isHost) fail("只有房主可以切换主画面", 403)
    setSourceMode(body.source)
    return {}
  }
  if (body.action === "close") {
    if (!isHost) fail("只有房主可以关闭连麦", 403)
    closeRoom()
    return {}
  }
  const target =
    typeof body.id === "string"
      ? body.id === room.host.id
        ? room.host
        : room.members.get(body.id)
      : actor
  if (!target) fail("申请已失效", 404)
  if (
    !isHost &&
    (target !== actor || !["leave", "mute"].includes(String(body.action)))
  )
    fail("只有房主可以处理申请", 403)
  switch (body.action) {
    case "accept":
      if (target.status !== "pending") fail("申请已处理", 409)
      if (speakers().length >= 3) fail("4 个麦位已满，请先移出一位嘉宾", 409)
      target.status = "accepted"
      target.expiresAt = Date.now() + 45000
      break
    case "reject":
      if (target.status !== "pending") fail("申请已处理", 409)
      disconnect(target, "rejected")
      break
    case "leave":
      if (target === room.host) closeRoom()
      else disconnect(target)
      break
    case "mute":
      if (!active(target) || typeof body.muted !== "boolean")
        fail("无效静音操作")
      // 房主只强制静音；重新开麦须由本人操作。
      if (isHost && target !== actor && !body.muted)
        fail("请由嘉宾自行开启麦克风", 403)
      target.muted = body.muted
      break
    default:
      fail("未知连麦操作")
  }
  return {}
}
