/** 业务请求统一走 /api/v1；该路径由浏览器 MSW 处理，不是 Next.js 的真实业务路由。 */
import type { Action, State } from "./types"
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/v1/${path}`, {
    // 客户端超时只表示没有及时收到结果，不保证模拟事务失败；购买/送礼重试必须复用幂等键。
    signal: AbortSignal.timeout(8000),
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await r.json()
  if (!r.ok) throw Error(result.error ?? `HTTP ${r.status}`)
  return result
}
export const getState = () => api<State>("state")
export const action = (a: Action) => api("action", a)
export const chatUrl = () =>
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/chat`
