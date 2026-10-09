import { expect, test } from "@playwright/test"

test("live entry waits for a real publisher and recovers when input arrives", async ({
  page,
}) => {
  // MSW passthrough bypasses Playwright routing; replace only this boundary before it starts.
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "test-media-status",
      JSON.stringify({ online: false, ready: false }),
    )
    const original = window.fetch
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      )
      if (url.pathname === "/api/media/status")
        return new Response(sessionStorage.getItem("test-media-status"), {
          headers: { "Content-Type": "application/json" },
        })
      return original(input, init)
    }
  })
  const setInput = (ready: boolean) =>
    page.evaluate((ready) => {
      sessionStorage.setItem(
        "test-media-status",
        JSON.stringify({
          online: true,
          ready,
          source: ready ? "rtmpConn" : null,
          tracks: ready ? ["H264", "MPEG-4 Audio"] : [],
          bytesReceived: ready ? 4096 : 0,
        }),
      )
    }, ready)
  await page.goto("/live/mei?source=local")
  await expect(page.getByTestId("live-input-status")).toHaveText(
    "媒体服务未连接",
  )
  await expect(page.locator("video")).toHaveCount(0)
  await setInput(false)
  await expect(page.getByTestId("live-input-status")).toHaveText(
    "等待 RTMP 推流",
  )
  await setInput(true)
  await expect(page.getByTestId("live-input-status")).toHaveText(
    "已接收真实直播流",
  )
  await expect(page.locator("video")).toHaveCount(1)
  await setInput(false)
  await expect(page.getByTestId("live-input-status")).toHaveText(
    "等待 RTMP 推流",
  )
  await expect(page.locator("video")).toHaveCount(0)
  await setInput(true)
  await expect(page.locator("video")).toHaveCount(1)
})

test("real RTMP bytes increase and the room decodes live video", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.STREAMLAB_MEDIA_TEST !== "1",
    "Requires pnpm media:fixture or OBS",
  )
  const before = await (await request.get("/api/media/status")).json()
  expect(before).toMatchObject({
    online: true,
    ready: true,
    source: "rtmpConn",
  })
  expect(before.tracks).toEqual(
    expect.arrayContaining(["H264", "MPEG-4 Audio"]),
  )
  await page.goto("/live/mei?source=local")
  await expect(page.getByTestId("live-input-status")).toHaveText(
    "已接收真实直播流",
  )
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluate((v) => (v as HTMLVideoElement).videoWidth),
      { timeout: 25000 },
    )
    .toBeGreaterThan(0)
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluate((v) => (v as HTMLVideoElement).currentTime),
      { timeout: 25000 },
    )
    .toBeGreaterThan(0)
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/media/status")).json()).bytesReceived,
    )
    .toBeGreaterThan(before.bytesReceived)
})
