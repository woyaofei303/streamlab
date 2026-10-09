import { afterEach, expect, test, vi } from "vitest"
import { GET } from "../src/app/api/media/status/route"

afterEach(() => vi.unstubAllGlobals())

test("reports the real live input, ignoring other paths", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        items: [
          { name: "rtc", ready: true, tracks: ["Opus"] },
          {
            name: "live",
            ready: true,
            source: { type: "rtmpConn" },
            tracks: ["H264", "MPEG-4 Audio"],
            bytesReceived: 4096,
          },
        ],
      }),
    ),
  )
  expect(await (await GET()).json()).toEqual({
    online: true,
    ready: true,
    source: "rtmpConn",
    tracks: ["H264", "MPEG-4 Audio"],
    bytesReceived: 4096,
  })
})

test("distinguishes a receiver waiting for input from an unavailable service", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ items: [{ name: "rtc", ready: true }] }),
      )
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValueOnce(new Response(null, { status: 503 })),
  )
  expect(await (await GET()).json()).toEqual({
    online: true,
    ready: false,
    source: null,
    tracks: [],
    bytesReceived: 0,
  })
  for (let i = 0; i < 2; i++)
    expect(await (await GET()).json()).toEqual({ online: false, ready: false })
})

test("browser status is separate from RTMP and rejects unknown paths", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      items: [
        {
          name: "live",
          ready: true,
          source: { type: "rtmpConn" },
          bytesReceived: 999,
        },
        {
          name: "browser",
          ready: true,
          source: { type: "webRTCSession" },
          tracks: ["Opus", "H264"],
          bytesReceived: 500,
        },
      ],
    }),
  )
  vi.stubGlobal("fetch", fetch)
  expect(
    await (
      await GET(new Request("http://localhost/api/media/status?path=browser"))
    ).json(),
  ).toMatchObject({
    source: "webRTCSession",
    ready: true,
    bytesReceived: 500,
  })
  expect(
    (await GET(new Request("http://localhost/api/media/status?path=other")))
      .status,
  ).toBe(400)
  expect(fetch).toHaveBeenCalledTimes(1)
})
