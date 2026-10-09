import { expect, test, vi } from "vitest"
import { execute } from "../src/lib/domain"
import { captureCamera } from "../src/lib/media-config"
import { createState } from "../src/lib/seed"

test("camera capture requires 720p and falls back only for unsupported constraints", async () => {
  const media = { id: "camera-stream" }
  const getUserMedia = vi.fn().mockResolvedValue(media)
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } })
  try {
    const audio = { deviceId: { exact: "selected-mic" } }
    expect(await captureCamera(audio, "selected-camera")).toBe(media)
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({
      audio,
      video: {
        width: { exact: 1280 },
        height: { exact: 720 },
        deviceId: { exact: "selected-camera" },
      },
    })
    getUserMedia.mockClear()
    getUserMedia.mockRejectedValueOnce(
      new DOMException("Unsupported resolution", "OverconstrainedError"),
    )
    expect(await captureCamera(audio, "selected-camera")).toBe(media)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1][0]).toMatchObject({
      audio,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        deviceId: { exact: "selected-camera" },
      },
    })
    getUserMedia.mockClear()
    getUserMedia.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    )
    await expect(captureCamera()).rejects.toMatchObject({
      name: "NotAllowedError",
    })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  } finally {
    vi.unstubAllGlobals()
  }
})

test("a browser publication identifies its session and stale cleanup cannot end a newer broadcast", () => {
  const state = createState()
  const channel = state.channels[0]
  const action = { userId: "creator", channelId: "mei" }
  const first = crypto.randomUUID(),
    second = crypto.randomUUID()
  execute(state, { ...action, type: "start", broadcastId: first }, 1000)
  expect(channel).toMatchObject({ status: "live", broadcastId: first })
  execute(state, { ...action, type: "end", broadcastId: first }, 2000)
  execute(state, { ...action, type: "start", broadcastId: second }, 3000)
  execute(state, { ...action, type: "end", broadcastId: first }, 4000)
  expect(channel).toMatchObject({ status: "live", broadcastId: second })
  execute(state, { ...action, type: "end", broadcastId: second }, 5000)
  expect(channel.status).toBe("ended")
  expect(() =>
    execute(state, { ...action, type: "start", broadcastId: "invalid" }),
  ).toThrow()
  expect(() =>
    execute(state, {
      ...action,
      userId: "viewer",
      type: "start",
      broadcastId: first,
    }),
  ).toThrow()
})
