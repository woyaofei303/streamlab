import { spawn } from "node:child_process"
import { expect, test } from "@playwright/test"

test.beforeEach(() => {
  test.skip(
    process.env.STREAMLAB_CI_MEDIA !== "1",
    "Isolated production-image CI only",
  )
})

test("the production image receives RTMP and serves decodable HLS", async ({
  page,
  request,
}) => {
  await expect
    .poll(
      async () => (await (await request.get("/api/media/status")).json()).ready,
    )
    .toBe(true)
  await page.goto("/live/mei?source=local")
  await expect
    .poll(() =>
      page.locator("video").evaluate((v) => (v as HTMLVideoElement).videoWidth),
    )
    .toBeGreaterThan(0)
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v) => (v as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0)
})

test("browser publishing needs no password, reaches a viewer and stops", async ({
  page,
  context,
  request,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("streamlab-user", "creator"),
  )
  await page.goto("/studio")
  await page.getByRole("button", { name: "设备预览", exact: true }).click()
  await expect(page.getByLabel("推流密码（仅主播需要）")).toHaveCount(0)
  try {
    await page.getByRole("button", { name: "网页开播", exact: true }).click()
    await expect(page.getByTestId("broadcast-status")).toHaveText("网页直播中")
    const viewer = await context.newPage()
    await viewer.goto("/live/mei?source=browser")
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
  } finally {
    const stop = page.getByRole("button", { name: "停止网页直播", exact: true })
    if (await stop.isVisible()) await stop.click()
  }
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/media/status?path=browser")).json())
          .ready,
    )
    .toBe(false)
})

test("four-person composite is received over WHEP with 720p video", async ({
  page,
  request,
}) => {
  const checker = spawn(process.execPath, ["scripts/check-calls.mjs"], {
    env: { ...process.env, STREAMLAB_TEST_HOLD_MS: "30000" },
    stdio: "inherit",
  })
  const done = new Promise<number | null>((resolve, reject) => {
    checker.once("exit", resolve)
    checker.once("error", reject)
  })
  try {
    await expect
      .poll(
        async () => (await (await request.get("/api/calls")).json()).mix.state,
      )
      .toBe("ready")
    await page.goto("/live/mei?source=local")
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((v) => (v as HTMLVideoElement).videoWidth),
      )
      .toBe(1280)
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((v) => (v as HTMLVideoElement).videoHeight),
      )
      .toBe(720)
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((v) => (v as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(0)
  } finally {
    // Let the checker close its own call and synthetic publishers, including on assertion failure.
    expect(await done).toBe(0)
  }
})
