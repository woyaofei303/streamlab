import { afterEach, expect, test, vi } from "vitest"
import { GET } from "../src/app/api/health/route"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test("an idle media server is healthy and reports the deployed revision", async () => {
  vi.stubEnv("APP_REVISION", "a".repeat(40))
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ items: [] })),
  )
  const response = await GET()
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(await response.json()).toEqual({
    status: "ok",
    revision: "a".repeat(40),
  })
})

test("unavailable or malformed media responses fail readiness", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({})),
  )
  for (let i = 0; i < 3; i++) {
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: "error",
      revision: "development",
    })
  }
})
