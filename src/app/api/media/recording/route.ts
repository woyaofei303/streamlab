// 仅代理本机 live 回放，限制 start/duration（最多 1 小时），不给客户端传任意 URL，避免开放代理。
// 当前返回 MP4 body；未实现完整 Range 转发、分段长回放或生产鉴权。
export async function GET(request: Request) {
  const input = new URL(request.url),
    start = input.searchParams.get("start") ?? "",
    duration = Number(input.searchParams.get("duration"))
  if (
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 3600
  )
    return new Response("Invalid recording range", { status: 400 })
  const params = new URLSearchParams({
    path: "live",
    start,
    duration: String(duration),
    format: "mp4",
  })
  try {
    const response = await fetch(`http://127.0.0.1:9996/get?${params}`, {
      signal: AbortSignal.timeout(20000),
    })
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "video/mp4" },
    })
  } catch {
    return new Response("Recording service unavailable", { status: 503 })
  }
}
