// 可选服务端目录代理：凭据仅在 Node 环境读取、固定 OAuth/Helix 目标；默认首页仍使用种子数据。
let cached: { token: string; until: number } | undefined
export async function GET() {
  const clientId = process.env.TWITCH_CLIENT_ID,
    secret = process.env.TWITCH_CLIENT_SECRET
  if (!clientId || !secret)
    return Response.json(
      {
        connected: false,
        items: [],
        message: "Twitch credentials not configured",
      },
      { status: 503 },
    )
  try {
    if (!cached || cached.until < Date.now()) {
      const r = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: secret,
          grant_type: "client_credentials",
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) throw Error("Authentication failed")
      const data = await r.json()
      cached = {
        token: data.access_token,
        until: Date.now() + (data.expires_in - 60) * 1000,
      }
    }
    const r = await fetch("https://api.twitch.tv/helix/streams?first=12", {
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${cached.token}`,
      },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 60 },
    })
    if (!r.ok) throw Error("Twitch API unavailable")
    const data = await r.json()
    return Response.json({ connected: true, items: data.data })
  } catch {
    return Response.json(
      { connected: false, items: [], message: "Twitch connection unavailable" },
      { status: 502 },
    )
  }
}
