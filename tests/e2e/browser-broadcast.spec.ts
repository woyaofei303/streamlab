import { expect, test } from "@playwright/test"

test("browser studio publishes to a viewer, survives studio tabs, and stops devices and the session", async ({
  page,
  context,
  browserName,
  request,
}) => {
  test.skip(browserName !== "chromium")
  test.skip(
    process.env.STREAMLAB_BROWSER_TEST !== "1",
    "Requires pnpm media:up",
  )
  test.setTimeout(90000)
  await page.addInitScript(() => {
    sessionStorage.setItem("streamlab-user", "creator")
  })
  await page.goto("/studio")
  await page.getByRole("button", { name: "设备预览", exact: true }).click()
  await page.getByRole("button", { name: "网页开播", exact: true }).click()
  await expect(page.getByTestId("broadcast-status")).toHaveText("网页直播中")
  const input = await (
    await request.get("/api/media/status?path=browser")
  ).json()
  expect(input).toMatchObject({
    online: true,
    ready: true,
    source: "webRTCSession",
  })

  const preview = await page
    .locator("video")
    .evaluateHandle((video) => (video as HTMLVideoElement).srcObject)
  const viewer = await context.newPage()
  // No source query: an ordinary room visit must select the creator's live feed.
  await viewer.goto("/live/mei")
  await expect(viewer.getByRole("combobox", { name: "播放来源" })).toHaveValue(
    "browser",
  )
  await expect
    .poll(() =>
      viewer
        .locator("video")
        .evaluate((v) => (v as HTMLVideoElement).videoWidth),
    )
    .toBeGreaterThan(0)
  await expect
    .poll(() =>
      viewer
        .locator("video")
        .evaluate((v) => (v as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0)
  expect(
    await viewer
      .locator("video")
      .evaluate(
        (v) =>
          ((v as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()
            .length,
      ),
  ).toBe(1)
  await page.screenshot({
    path: "output-tdd/playwright/browser-broadcast/studio.png",
    fullPage: true,
  })
  await viewer.screenshot({
    path: "output-tdd/playwright/browser-broadcast/viewer.png",
    fullPage: true,
  })

  const competing = await context.newPage()
  await competing.addInitScript(() =>
    sessionStorage.setItem("streamlab-user", "creator"),
  )
  await competing.goto("/studio")
  await competing.getByRole("button", { name: "网页开播", exact: true }).click()
  await expect(competing.getByRole("status")).toContainText("已有网页直播")
  await expect(page.getByTestId("broadcast-status")).toHaveText("网页直播中")
  await competing.close()

  await page.getByRole("button", { name: "直播设置", exact: true }).click()
  expect(
    (await (await request.get("/api/media/status?path=browser")).json()).ready,
  ).toBe(true)
  await page.getByRole("button", { name: "设备预览", exact: true }).click()
  await page.getByRole("button", { name: "停止网页直播", exact: true }).click()
  await expect(page.getByTestId("broadcast-status")).toHaveText("未开播")
  expect(
    await preview.evaluate((stream) =>
      (stream as MediaStream)
        .getTracks()
        .every((track) => track.readyState === "ended"),
    ),
  ).toBe(true)
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/media/status?path=browser")).json())
          .ready,
    )
    .toBe(false)
  await expect(viewer.getByTestId("live-input-status")).toHaveText(
    "等待网页开播",
  )
  await expect(viewer.locator("video")).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const state = await (await fetch("/api/v1/state")).json()
        return state.channels.find((c: { id: string }) => c.id === "mei").status
      }),
    )
    .toBe("ended")

  await page.getByRole("button", { name: "网页开播", exact: true }).click()
  await expect(page.getByTestId("broadcast-status")).toHaveText("网页直播中")
  await expect
    .poll(() =>
      viewer
        .locator("video")
        .evaluate((v) => (v as HTMLVideoElement).videoWidth),
    )
    .toBeGreaterThan(0)
  const oldStream = await viewer
    .locator("video")
    .evaluateHandle((v) => (v as HTMLVideoElement).srcObject)
  // Restart without waiting for a status poll: the input identity must rebuild the receiver.
  await page.getByRole("button", { name: "停止网页直播", exact: true }).click()
  await page.getByRole("button", { name: "网页开播", exact: true }).click()
  await expect(page.getByTestId("broadcast-status")).toHaveText("网页直播中")
  await expect
    .poll(() =>
      viewer.evaluate((old) => {
        const video = document.querySelector("video")
        return (
          !!video?.srcObject && video.srcObject !== old && video.videoWidth > 0
        )
      }, oldStream),
    )
    .toBe(true)
  await page.getByRole("link", { name: "播放实验室", exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/media/status?path=browser")).json())
          .ready,
    )
    .toBe(false)
  await expect(viewer.getByTestId("live-input-status")).toHaveText(
    "等待网页开播",
  )
})

test("a rejected publishing request releases capture and does not mark the room live", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium")
  await page.addInitScript(() =>
    sessionStorage.setItem("streamlab-user", "creator"),
  )
  await page.goto("/studio")
  await expect(page.getByLabel("推流密码（仅主播需要）")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "网页开播", exact: true }),
  ).toBeVisible()
  const capture = await page.evaluateHandle(() => {
    const original = window.fetch
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      )
      if (url.pathname === "/api/media/status")
        return Response.json({ online: true, ready: false })
      if (url.pathname === "/api/media/publish")
        return new Response("Injected service failure", { status: 503 })
      return original(input, init)
    }
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    )
    let stream: MediaStream | undefined
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      stream = await capture(constraints)
      return stream
    }
    return { tracks: () => stream?.getTracks().map((t) => t.readyState) }
  })
  await page.getByRole("button", { name: "网页开播", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("503")
  await expect(page.getByTestId("broadcast-status")).toHaveText("未开播")
  expect(await capture.evaluate((c) => c.tracks())).toEqual(["ended", "ended"])
  expect(
    await page.evaluate(async () => {
      const state = await (await fetch("/api/v1/state")).json()
      return state.channels.find((c: { id: string }) => c.id === "mei")
        .broadcastId
    }),
  ).toBeUndefined()
})

test("screen publishing includes microphone audio and ending screen sharing ends the broadcast", async ({
  page,
  browserName,
  request,
}) => {
  test.skip(browserName !== "chromium")
  test.skip(
    process.env.STREAMLAB_BROWSER_TEST !== "1",
    "Requires pnpm media:up",
  )
  await page.addInitScript(() => {
    sessionStorage.setItem("streamlab-user", "creator")
    // Synthetic screen input; browser WebRTC transmission and the microphone are real APIs.
    navigator.mediaDevices.getDisplayMedia = () =>
      navigator.mediaDevices.getUserMedia({ video: true })
  })
  await page.goto("/studio")
  await page.getByRole("button", { name: "共享屏幕", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "停止预览", exact: true }),
  ).toBeEnabled()
  await page.getByRole("button", { name: "网页开播", exact: true }).click()
  await expect(page.getByTestId("broadcast-status")).toHaveText("网页直播中")
  const stream = await page
    .locator("video")
    .evaluateHandle(
      (video) => (video as HTMLVideoElement).srcObject as MediaStream,
    )
  expect(
    await stream.evaluate((s) =>
      s
        .getTracks()
        .map((t) => t.kind)
        .sort(),
    ),
  ).toEqual(["audio", "video"])
  await page.getByRole("button", { name: "静音", exact: true }).click()
  expect(await stream.evaluate((s) => s.getAudioTracks()[0].enabled)).toBe(
    false,
  )
  await stream.evaluate((s) =>
    s.getVideoTracks()[0].dispatchEvent(new Event("ended")),
  )
  await expect(page.getByTestId("broadcast-status")).toHaveText("未开播")
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/media/status?path=browser")).json())
          .ready,
    )
    .toBe(false)
  expect(
    await stream.evaluate((s) =>
      s.getTracks().every((t) => t.readyState === "ended"),
    ),
  ).toBe(true)
})

test("denying or canceling camera permission never publishes and releases late devices", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium")
  await page.addInitScript(() => {
    sessionStorage.setItem("streamlab-user", "creator")
    const originalFetch = window.fetch
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      )
      if (url.pathname === "/api/media/status")
        return Response.json({ online: true, ready: false })
      return originalFetch(input, init)
    }
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Camera permission denied", "NotAllowedError")
    }
  })
  await page.goto("/studio")
  await page.getByRole("button", { name: "网页开播", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("denied")
  await expect(page.getByTestId("broadcast-status")).toHaveText("未开播")
  const capture = await page.evaluateHandle(() => {
    const canvas = document.createElement("canvas")
    const stream = canvas.captureStream()
    let release: (stream: MediaStream) => void = () => {}
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        release = resolve
      })
    return { stream, release: () => release(stream) }
  })
  await page.getByRole("button", { name: "网页开播", exact: true }).click()
  await expect(page.getByTestId("broadcast-status")).toHaveText(
    "正在连接并确认输入…",
  )
  await page.getByRole("button", { name: "停止网页直播", exact: true }).click()
  await capture.evaluate((c) => c.release())
  await expect
    .poll(() => capture.evaluate((c) => c.stream.getTracks()[0].readyState))
    .toBe("ended")
  await expect(page.getByTestId("broadcast-status")).toHaveText("未开播")
  expect(
    await page.evaluate(async () => {
      const state = await (await fetch("/api/v1/state")).json()
      return state.channels.find((c: { id: string }) => c.id === "mei")
        .broadcastId
    }),
  ).toBeUndefined()
})
