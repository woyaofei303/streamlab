import { afterEach, expect, test, vi } from "vitest"
import { createMediaSession } from "../src/lib/media-session"

afterEach(() => vi.unstubAllGlobals())

class Peer extends EventTarget {
  iceGatheringState = "complete"
  connectionState = "connected"
  localDescription = { sdp: "offer" }
  addTrack() {}
  getTransceivers() {
    return []
  }
  async createOffer() {
    return this.localDescription
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {}
}

test.each([
  ["/browser/whip/session-1", true],
  ["https://other.example.com/browser/whip/session-1", false],
  ["/api/media/status", false],
])(
  "authenticated WHIP only cleans up its own session: %s",
  async (location, valid) => {
    vi.stubGlobal("window", {
      location: { href: "https://live.example.com/studio" },
    })
    vi.stubGlobal("RTCPeerConnection", Peer)
    vi.stubGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs: [] }) })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("answer", {
          status: 201,
          headers: { Location: location },
        }),
      )
      .mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetch)
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const session = createMediaSession("/browser/whip", stream, "test-password")
    if (!valid) {
      await expect(session.connect()).rejects.toThrow(
        "Invalid media session URL",
      )
      expect(fetch).toHaveBeenCalledTimes(1)
      return
    }
    await session.connect()
    session.close()
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://live.example.com/browser/whip",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa("publisher:test-password")}`,
        }),
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://live.example.com/browser/whip/session-1",
      expect.objectContaining({
        method: "DELETE",
        credentials: "omit",
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa("publisher:test-password")}`,
        }),
      }),
    )
  },
)

test("a publish challenge returns an application error without browser-managed authentication", async () => {
  vi.stubGlobal("window", {
    location: { href: "https://live.example.com/studio" },
  })
  vi.stubGlobal("RTCPeerConnection", Peer)
  vi.stubGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs: [] }) })
  const fetch = vi.fn().mockResolvedValue(
    new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="mediamtx"' },
    }),
  )
  vi.stubGlobal("fetch", fetch)
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const session = createMediaSession("/browser/whip", stream)
  await expect(session.connect()).rejects.toThrow("401")
  expect(stop).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "https://live.example.com/browser/whip",
    expect.objectContaining({ credentials: "omit" }),
  )
})
