// 读取实际 live 路径的录制列表；尚未按业务 sessionId 精确绑定，每个房间独立录制需扩展路径模型。
export async function GET() {
  try {
    const r = await fetch("http://127.0.0.1:9996/list?path=live", {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    })
    if (!r.ok) return Response.json({ items: [] })
    const data = await r.json()
    return Response.json({
      items: (Array.isArray(data) ? data : []).map(
        (item: { start: string; duration: number }) => ({
          ...item,
          url: `/api/media/recording?start=${encodeURIComponent(item.start)}&duration=${item.duration}`,
        }),
      ),
    })
  } catch {
    return Response.json({ items: [] })
  }
}
