// 固定工具代理：查询 MediaMTX live 路径是否有真实输入；失败映射为 ready:false，不是业务场次状态。
export async function GET() {
  try {
    const r = await fetch("http://127.0.0.1:9997/v3/paths/list", {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    })
    if (!r.ok) throw Error("Media API unavailable")
    const data = await r.json()
    return Response.json({
      ready: !!data.items?.some(
        (p: { name: string; ready: boolean }) => p.name === "live" && p.ready,
      ),
    })
  } catch {
    return Response.json({ ready: false })
  }
}
