// 查询 MediaMTX 的真实输入状态。这里返回 JSON，视频走独立的媒体连接。
export async function GET(request?: Request) {
  const path = request
    ? (new URL(request.url).searchParams.get("path") ?? "live")
    : "live"
  // 只接受已知流名，不允许客户端指定任意上游地址。
  if (path !== "live" && path !== "browser")
    return Response.json({ error: "Unknown media path" }, { status: 400 })
  try {
    const response = await fetch("http://127.0.0.1:9997/v3/paths/list", {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    })
    if (!response.ok) throw Error("Media API unavailable")
    const data = await response.json()
    const input = data.items?.find(
      (input: { name: string }) => input.name === path,
    )
    return Response.json({
      // 服务可访问不代表这条流已有输入。
      online: true,
      ready: !!input?.ready,
      source: input?.source?.type ?? null,
      tracks: input?.tracks ?? [],
      // 累计字节，不是每秒网速。
      bytesReceived: input?.bytesReceived ?? 0,
      ...(path === "browser" ? { sourceId: input?.source?.id ?? null } : {}),
    })
  } catch {
    // 服务离线也是可展示的状态，调用方需检查 online，不能只看 HTTP 200。
    return Response.json({ online: false, ready: false })
  }
}
