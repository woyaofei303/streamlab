import { afterEach, expect, test, vi } from "vitest"
import { DELETE, POST } from "../src/app/api/media/publish/[[...session]]/route"

const endpoint = "https://live.example.com/api/media/publish"
const upstream = "http://127.0.0.1:8889/browser/whip"
const sessionId = "d343ab0b-c670-4267-a7c1-4526c902f799"
const context = (session?: string[]) => ({
  params: Promise.resolve({ session }),
})
const publishRequest = () =>
  new Request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: "v=0\r\n",
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test("demo visitors publish and stop without providing server credentials", async () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("PUBLISH_PASSWORD", "server-only-password")
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("sdp-answer", {
        status: 201,
        headers: { Location: `${upstream}/${sessionId}` },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal("fetch", fetchMock)

  const response = await POST(publishRequest(), context())
  expect(response.status).toBe(201)
  expect(response.headers.get("Location")).toBe(
    `/api/media/publish/${sessionId}`,
  )
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(response.headers.has("WWW-Authenticate")).toBe(false)
  expect(await response.text()).toBe("sdp-answer")
  const headers = {
    Authorization: `Basic ${Buffer.from("publisher:server-only-password").toString("base64")}`,
  }
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    upstream,
    expect.objectContaining({
      method: "POST",
      headers: { ...headers, "Content-Type": "application/sdp" },
      body: "v=0\r\n",
      redirect: "error",
    }),
  )
  const stopped = await DELETE(
    new Request(`${endpoint}/${sessionId}`, { method: "DELETE" }),
    context([sessionId]),
  )
  expect(stopped.status).toBe(204)
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    `${upstream}/${sessionId}`,
    expect.objectContaining({ method: "DELETE", headers }),
  )
})

test("local development publishes without a configured password", async () => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("PUBLISH_PASSWORD", "")
  const fetchMock = vi.fn().mockResolvedValue(
    new Response("answer", {
      status: 201,
      headers: { Location: `/browser/whip/${sessionId}` },
    }),
  )
  vi.stubGlobal("fetch", fetchMock)
  const request = publishRequest()
  request.headers.set("Authorization", "Basic untrusted-client-credentials")
  expect((await POST(request, context())).status).toBe(201)
  expect(fetchMock.mock.calls[0][1].headers).toEqual({
    "Content-Type": "application/sdp",
  })
})

test("missing production configuration fails without contacting media", async () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("PUBLISH_PASSWORD", "")
  const fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  const response = await POST(publishRequest(), context())
  expect(response.status).toBe(503)
  expect(response.headers.has("WWW-Authenticate")).toBe(false)
  expect(fetchMock).not.toHaveBeenCalled()
})

test("only bounded SDP from this site can create a browser session", async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  for (const [headers, body, status] of [
    [{ Origin: "https://other.example.com" }, "v=0", 403],
    [{ "Content-Type": "text/plain" }, "v=0", 415],
    [{ "Content-Type": "application/sdp" }, "x".repeat(64001), 413],
  ] as const) {
    const response = await POST(
      new Request(endpoint, { method: "POST", headers, body }),
      context(),
    )
    expect(response.status).toBe(status)
  }
  expect(fetchMock).not.toHaveBeenCalled()
})

test("callers cannot publish to or delete arbitrary media paths", async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  expect((await POST(publishRequest(), context([sessionId]))).status).toBe(400)
  for (const path of [
    [],
    ["../live"],
    ["live", "whip"],
    ["a?b"],
    ["x".repeat(129)],
  ]) {
    const response = await DELETE(
      new Request(endpoint, { method: "DELETE" }),
      context(path),
    )
    expect(response.status).toBe(400)
  }
  expect(fetchMock).not.toHaveBeenCalled()
})

test.each([
  "https://other.example.com/browser/whip/session",
  "http://127.0.0.1:8889/live/whip/session",
  "/browser/whip/session/another",
  "/browser/whip/session?credentials=private",
  "/browser/whip/session#fragment",
  "http://publisher:private@127.0.0.1:8889/browser/whip/session",
  "",
])(
  "rejects unsafe or missing upstream session location: %s",
  async (location) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("answer", {
          status: 201,
          headers: { Location: location },
        }),
      ),
    )
    const response = await POST(publishRequest(), context())
    expect(response.status).toBe(502)
    expect(response.headers.has("Location")).toBe(false)
  },
)

test("media auth failures never expose credentials or a browser login challenge", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("sensitive upstream error", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="MediaMTX"' },
      }),
    ),
  )
  const response = await POST(publishRequest(), context())
  expect(response.status).toBe(502)
  expect(response.headers.has("WWW-Authenticate")).toBe(false)
  expect(await response.text()).not.toContain("sensitive")
})

test("stopping an expired session is harmless; service failures remain visible", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockRejectedValueOnce(new Error("private network details")),
  )
  for (const status of [204, 502, 502]) {
    const response = await DELETE(
      new Request(`${endpoint}/${sessionId}`, { method: "DELETE" }),
      context([sessionId]),
    )
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain("private")
  }
})
