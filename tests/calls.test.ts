import { spawnSync } from "node:child_process"
import { afterEach, expect, test, vi } from "vitest"
import { GET, POST } from "../src/app/api/calls/route"
import { mixerArgs } from "../src/lib/call-mixer"
import { updateCallInputs } from "../src/lib/call-server"

const request = (body: object, token = "") =>
  POST(
    new Request("http://localhost/api/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  )
const state = async (token = "") =>
  (
    await GET(
      new Request("http://localhost/api/calls", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    )
  ).json()
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0).each([2, 3, 4])(
  "%i mixed cameras fill equally sized tiles despite different input aspect ratios",
  (count) => {
    const inputs = [
      "red:s=640x480",
      "green:s=640x360",
      "blue:s=360x640",
      "yellow:s=640x360",
    ].slice(0, count)
    const args = mixerArgs(
      inputs.map((path) => ({ path, audio: false, muted: false })),
      "test",
    )
    // Keep synthetic sources finite on FFmpeg versions with different output scheduling.
    const graph = args[args.indexOf("-filter_complex") + 1].replaceAll(
      "anullsrc=r=48000:cl=stereo",
      "anullsrc=r=48000:cl=stereo:d=0.2",
    )
    const result = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-filter_complex_threads",
        "1",
        ...inputs.flatMap((color) => [
          "-f",
          "lavfi",
          "-i",
          `color=c=${color}:r=24:d=0.2`,
        ]),
        "-filter_complex",
        graph,
        "-map",
        "[v]",
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
        "-map",
        "[a]",
        "-t",
        "0.05",
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 4 * 1024 * 1024, timeout: 10000, killSignal: "SIGKILL" },
    )
    expect(result.status, result.stderr?.toString()).toBe(0)
    expect(result.stdout.length).toBe(1280 * 720 * 3)
    const height = count === 2 ? 720 : 360
    for (let i = 0; i < count; i++) {
      for (const x of [5, 635])
        for (const y of [5, height - 5]) {
          const offset =
            ((Math.floor(i / 2) * height + y) * 1280 + (i % 2) * 640 + x) * 3
          expect(
            Math.max(...result.stdout.subarray(offset, offset + 3)),
            `tile ${i} has a black edge`,
          ).toBeGreaterThan(80)
        }
    }
  },
)

test("host video follows the active broadcast and only the host can change it without removing guests", async () => {
  vi.stubEnv("PUBLISH_PASSWORD", "test-host-password")
  const response = await request({
    action: "open",
    password: "test-host-password",
    source: "auto",
  })
  expect(response.status).toBe(200)
  const host = await response.json()
  const browser = {
    name: "browser",
    ready: true,
    bytesReceived: 100,
    source: { id: "web-camera" },
  }
  const obs = {
    name: "live",
    ready: true,
    bytesReceived: 100,
    source: { id: "obs-camera" },
  }
  try {
    updateCallInputs([browser])
    expect(await state()).toMatchObject({
      sourceMode: "auto",
      source: "browser",
      input: { ready: true, sourceId: "web-camera" },
    })
    const guest = await (
      await request({ action: "request", name: "Camera guest", role: "观众" })
    ).json()
    await request({ action: "accept", id: guest.id }, host.token)
    const media = await import("../src/app/api/calls/media/[...path]/route")
    const fetchMock = vi.fn(async (url: string, options: RequestInit) =>
      options.method === "DELETE"
        ? new Response(null, { status: 204 })
        : new Response("answer", {
            status: 201,
            headers: { Location: `${url}/session` },
          }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const mainVideo = (token: string) =>
      media.POST(
        new Request("http://localhost/api/calls/media/main/whep", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
          },
          body: "v=0",
        }),
        { params: Promise.resolve({ path: ["main", "whep"] }) },
      )
    for (const token of [host.token, guest.token]) {
      expect((await mainVideo(token)).status).toBe(201)
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://127.0.0.1:8889/browser/whep",
        expect.objectContaining({ method: "POST" }),
      )
    }
    expect(
      (await request({ action: "source", source: "live" }, guest.token)).status,
    ).toBe(403)
    expect(
      (await request({ action: "source", source: "bad" }, host.token)).status,
    ).toBe(400)
    expect(
      (await request({ action: "source", source: "live" }, host.token)).status,
    ).toBe(200)
    updateCallInputs([browser])
    expect(await state()).toMatchObject({
      sourceMode: "live",
      source: "live",
      input: { ready: false },
    })
    expect((await state(guest.token)).self.status).toBe("accepted")
    expect((await mainVideo(guest.token)).status).toBe(201)
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8889/live/whep",
      expect.objectContaining({ method: "POST" }),
    )
    await request({ action: "source", source: "auto" }, host.token)
    updateCallInputs([browser, obs])
    expect((await state()).source).toBe("browser")
    updateCallInputs([obs])
    expect(await state()).toMatchObject({
      source: "live",
      input: { ready: true, sourceId: "obs-camera" },
    })
    updateCallInputs([])
    expect((await state()).input.ready).toBe(false)
  } finally {
    await request({ action: "close" }, host.token)
  }
})

test("only the authenticated host can admit several speakers; guest tokens stay private", async () => {
  vi.stubEnv("PUBLISH_PASSWORD", "test-host-password")
  expect(
    (await request({ action: "open", password: "wrong", source: "live" }))
      .status,
  ).toBe(403)
  const host = await (
    await request({
      action: "open",
      password: "test-host-password",
      source: "live",
    })
  ).json()
  const guests = []
  for (const role of ["主播", "观众", "观众", "观众"]) {
    guests.push(
      await (
        await request({
          action: "request",
          name: `Guest ${guests.length}`,
          role,
        })
      ).json(),
    )
  }
  expect((await state(host.token)).pending).toHaveLength(4)
  expect(
    (await request({ action: "accept", id: guests[0].id }, guests[1].token))
      .status,
  ).toBe(403)
  for (const guest of guests.slice(0, 3))
    expect(
      (await request({ action: "accept", id: guest.id }, host.token)).status,
    ).toBe(200)
  expect(
    (await request({ action: "accept", id: guests[3].id }, host.token)).status,
  ).toBe(409)
  const publicState = await state()
  expect(publicState.participants).toHaveLength(4)
  expect(publicState.pending).toBeUndefined()
  expect(JSON.stringify(publicState)).not.toContain(guests[0].token)
  expect((await state(guests[0].token)).self.status).toBe("accepted")
  await request({ action: "leave", id: guests[0].id }, host.token)
  expect((await state(guests[0].token)).self.status).toBe("ended")
  await request({ action: "close" }, host.token)
})

test("expired requests and disconnected hosts release every seat", async () => {
  vi.useFakeTimers()
  vi.stubEnv("PUBLISH_PASSWORD", "test-host-password")
  const host = await (
    await request({
      action: "open",
      password: "test-host-password",
      source: "browser",
    })
  ).json()
  const guest = await (
    await request({ action: "request", name: "Late guest", role: "主播" })
  ).json()
  for (let i = 0; i < 4; i++) {
    vi.advanceTimersByTime(16000)
    await state(host.token)
  }
  expect((await state(guest.token)).self.status).toBe("expired")
  vi.advanceTimersByTime(31000)
  expect((await state()).enabled).toBe(false)
  expect(
    (await request({ action: "accept", id: guest.id }, host.token)).status,
  ).toBe(403)
  vi.useRealTimers()
})

test("media publishing needs approval and is restricted to the owner's slot", async () => {
  const media = await import("../src/app/api/calls/media/[...path]/route")
  vi.stubEnv("PUBLISH_PASSWORD", "test-host-password")
  const host = await (
    await request({
      action: "open",
      password: "test-host-password",
      source: "live",
    })
  ).json()
  const guest = await (
    await request({ action: "request", name: "Media guest", role: "观众" })
  ).json()
  const publish = (id: string, token = "") =>
    media.POST(
      new Request(`http://localhost/api/calls/media/${id}/whip`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp",
        },
        body: "v=0",
      }),
      { params: Promise.resolve({ path: [id, "whip"] }) },
    )
  expect((await publish(guest.id)).status).toBe(403)
  expect((await publish(guest.id, guest.token)).status).toBe(403)
  await request({ action: "accept", id: guest.id }, host.token)
  expect((await publish(host.id, guest.token)).status).toBe(403)
  const fetchMock = vi.fn().mockResolvedValue(
    new Response("answer", {
      status: 201,
      headers: { Location: `/call/${guest.id}/whip/server-session` },
    }),
  )
  vi.stubGlobal("fetch", fetchMock)
  const response = await publish(guest.id, guest.token)
  expect(response.status).toBe(201)
  expect(response.headers.get("Location")).toMatch(
    new RegExp(`^/api/calls/media/${guest.id}/whip/`),
  )
  await request({ action: "leave" }, guest.token)
  expect(fetchMock).toHaveBeenCalledWith(
    `http://127.0.0.1:8889/call/${guest.id}/whip/server-session`,
    expect.objectContaining({ method: "DELETE" }),
  )
  expect((await publish(guest.id, guest.token)).status).toBe(403)
  await request({ action: "close" }, host.token)
  vi.unstubAllGlobals()
})

test("loopback Host is respected behind Next and oversized payloads are rejected", async () => {
  const send = (origin: string, body: object) =>
    POST(
      new Request("http://localhost:3000/api/calls", {
        method: "POST",
        headers: {
          Host: "127.0.0.1:3000",
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    )
  const valid = await send("http://127.0.0.1:3000", { action: "close" })
  expect((await valid.json()).error).toContain("凭证已失效")
  expect((await send("https://evil.example", { action: "close" })).status).toBe(
    403,
  )
  expect(
    (await send("http://127.0.0.1:3000", { name: "x".repeat(3000) })).status,
  ).toBe(413)
})
