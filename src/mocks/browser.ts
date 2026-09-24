/**
 * 模拟传输层：HTTP 负责业务动作，MSW WebSocket 负责聊天协议；两者最终共用 db.mutate。
 * WS 被浏览器拦截，没有监听 3000/chat 的真实业务服务端；真实媒体请求通过 bypass 放行。
 */
import { delay, HttpResponse, http, ws } from "msw"
import { setupWorker } from "msw/browser"
import { mutate, readState, resetState } from "@/lib/db"
import type { Action, ChatMessage } from "@/lib/types"

const chat = ws.link("ws://localhost:3000/chat")
export const worker = setupWorker(
  http.get("/api/v1/state", async () => HttpResponse.json(await readState())),
  http.get("/api/v1/messages", async ({ request }) => {
    const url = new URL(request.url)
    const s = await readState()
    return HttpResponse.json(
      s.messages.filter(
        (m) =>
          m.roomId === url.searchParams.get("roomId") &&
          m.seq > Number(url.searchParams.get("after") ?? 0),
      ),
    )
  }),
  http.post("/api/v1/action", async ({ request }) => {
    try {
      const a = (await request.json()) as Action
      const s = await readState()
      if (!["scenario", "clock"].includes(a.type)) {
        if (s.scenario === "slow") await delay(1800)
        else await delay(120)
        if (s.scenario === "error")
          return HttpResponse.json(
            { error: "模拟服务暂时不可用 / Simulated service unavailable" },
            { status: 503 },
          )
        if (s.scenario === "expired")
          return HttpResponse.json(
            { error: "登录已过期，请切换正常场景后重新登录 / Session expired" },
            { status: 401 },
          )
      }
      const result = await mutate(a)
      // 故意“先提交，后延迟 10 秒”：api.ts 8 秒就超时，以此验证结果未知时的安全重试。
      if (s.scenario === "timeout" && !["scenario", "clock"].includes(a.type)) {
        await mutate({ type: "scenario", value: "normal" })
        await delay(10000)
      }
      return new HttpResponse(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      })
    } catch (error) {
      return HttpResponse.json(
        { error: error instanceof Error ? error.message : "Request failed" },
        { status: 400 },
      )
    }
  }),
  http.post("/api/v1/reset", async () => {
    await resetState()
    return HttpResponse.json({ ok: true })
  }),
  chat.addEventListener("connection", ({ client }) => {
    let roomId = "",
      closed = false,
      lastSeq = 0
    const bus = new BroadcastChannel("streamlab-state")
    // join 的 after 游标用于补拉。当前模拟通道按批发送完整增量，不实现生产 IM 的缺口检测和持久消息日志。
    const sync = async () => {
      if (!roomId || closed) return
      const s = await readState()
      if (s.scenario === "disconnect") {
        client.close(1011, "Simulated disconnect")
        return
      }
      const reset = s.seq < lastSeq
      if (reset) lastSeq = 0
      const fresh = s.messages.filter(
        (m) => m.roomId === roomId && m.seq > lastSeq,
      )
      if (fresh.length) {
        lastSeq = Math.max(...fresh.map((m) => m.seq))
        client.send(
          JSON.stringify({
            type: reset ? "reset" : "messages",
            messages: fresh,
          }),
        )
      }
    }
    bus.onmessage = () => {
      void sync()
    }
    client.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(String(event.data))
        if (data.type === "join") {
          roomId = String(data.roomId)
          lastSeq = Number(data.after ?? 0)
          await sync()
          return
        }
        const s = await readState()
        if (s.scenario === "disconnect") {
          client.close(1011, "Simulated disconnect")
          return
        }
        if (data.type === "ping") {
          client.send(JSON.stringify({ type: "pong" }))
          return
        }
        if (data.type === "message") {
          if (s.scenario === "expired")
            throw Error("登录已过期 / Session expired")
          if (s.scenario === "error")
            throw Error("模拟发送失败 / Simulated send failure")
          if (s.scenario === "slow") await delay(2000)
          const message = (await mutate({
            ...data,
            channelId: roomId,
          })) as ChatMessage
          // 只有 mutate 提交成功才 ACK；消息可能同时由广播到达，客户端必须按 ID 合并。
          client.send(JSON.stringify({ type: "ack", message }))
          if (s.scenario === "duplicate")
            client.send(JSON.stringify({ type: "ack", message }))
          if (s.scenario === "reorder")
            client.send(
              JSON.stringify({
                type: "messages",
                messages: s.messages
                  .filter((m) => m.roomId === roomId)
                  .slice(-10)
                  .reverse(),
              }),
            )
        }
      } catch (error) {
        client.send(
          JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Message failed",
            id: (() => {
              try {
                return JSON.parse(String(event.data)).id
              } catch {
                return undefined
              }
            })(),
          }),
        )
      }
    })
    client.addEventListener("close", () => {
      closed = true
      bus.close()
    })
  }),
)

let started: Promise<unknown> | undefined
// 缓存启动 Promise，避免 Strict Mode 重复启动；等待 controller 接管当前标签后再渲染业务页面。
// wrapper 的 clients.claim 修复已有 worker 但新标签暂未受控的情况，不修改 MSW 生成文件。
export function startMocks() {
  started ??= (async () => {
    await navigator.serviceWorker.register("/streamlab-worker.js")
    const registration = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer)
          navigator.serviceWorker.removeEventListener(
            "controllerchange",
            claimed,
          )
        }
        const claimed = () => {
          cleanup()
          resolve()
        }
        const timer = setTimeout(() => {
          cleanup()
          reject(
            Error("Mock worker could not control this tab. Please reload."),
          )
        }, 8000)
        navigator.serviceWorker.addEventListener("controllerchange", claimed)
        registration.active?.postMessage("STREAMLAB_CLAIM")
      })
    }
    return worker.start({
      serviceWorker: { url: "/streamlab-worker.js" },
      onUnhandledRequest: "bypass",
      quiet: true,
    })
  })()
  return started
}
