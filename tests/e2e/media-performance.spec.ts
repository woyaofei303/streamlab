import { expect, type Page, test } from "@playwright/test"

async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(
    page.getByRole("button", { name: "通知", exact: true }),
  ).toBeVisible()
}

test("30 client-side room switches release player instances", async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== "chromium")
  test.setTimeout(120000)
  await open(page, "/live/mei")
  for (let i = 0; i < 30; i++) {
    await page
      .getByRole("link", {
        name: i % 2 === 0 ? /K Kai Studio creative/ : /M MEI irl/,
      })
      .click()
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((v) => (v as HTMLVideoElement).readyState),
      )
      .toBeGreaterThan(1)
  }
  await page.getByRole("link", { name: "播放实验室", exact: true }).click()
  await page.getByRole("button", { name: "会话记录", exact: true }).click()
  await expect(page.getByTestId("player-count")).toHaveText("0")
  await info.attach("lifecycle", {
    body: JSON.stringify({ switches: 30, remainingPlayers: 0 }),
    contentType: "application/json",
  })
})

test("100 messages per second for 60 seconds remains bounded and interactive", async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== "chromium")
  test.setTimeout(100000)
  await open(page, "/live/mei")
  const result = await page.evaluate(async () => {
    const longTasks: number[] = []
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push(e.duration)
    })
    observer.observe({ entryTypes: ["longtask"] })
    const started = performance.now()
    for (let n = 0; n < 60; n++) {
      await new Promise((r) =>
        setTimeout(r, Math.max(0, started + n * 1000 - performance.now())),
      )
      const response = await fetch("/api/v1/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "burst", channelId: "mei", count: 100 }),
      })
      if (!response.ok) throw Error(`Burst failed: ${response.status}`)
    }
    observer.disconnect()
    const state = await fetch("/api/v1/state").then((r) => r.json())
    return {
      sent: 6000,
      elapsedMs: Math.round(performance.now() - started),
      retainedMessages: state.messages.length,
      maxLongTaskMs: Math.round(Math.max(0, ...longTasks)),
      longTaskCount: longTasks.length,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
    }
  })
  expect(result.retainedMessages).toBeLessThanOrEqual(4000)
  const start = Date.now()
  await page.getByRole("button", { name: "投票", exact: true }).click()
  await expect(
    page.getByText("下一站，你想去哪里？", { exact: true }),
  ).toBeVisible()
  const responseMs = Date.now() - start
  await page.getByRole("button", { name: "聊天", exact: true }).click()
  expect(await page.getByRole("listitem").count()).toBeLessThan(60)
  await info.attach("message-load", {
    body: JSON.stringify({
      ...result,
      responseMs,
      renderedRows: await page.getByRole("listitem").count(),
    }),
    contentType: "application/json",
  })
})

test("real local RTMP input is playable through LL-HLS", async ({
  page,
  browserName,
  request,
}) => {
  test.skip(browserName !== "chromium")
  test.skip(
    process.env.STREAMLAB_MEDIA_TEST !== "1",
    "Requires pnpm media:fixture",
  )
  expect((await request.get("/api/media/status")).ok()).toBe(true)
  await open(page, "/lab")
  await page
    .getByRole("combobox", { name: "测试播放源", exact: true })
    .selectOption("http://127.0.0.1:8888/live/index.m3u8")
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluate((v) => (v as HTMLVideoElement).currentTime),
      { timeout: 25000 },
    )
    .toBeGreaterThan(0)
})

test("real WHIP publish and WHEP receive audio and video", async ({
  page,
  context,
  browserName,
}, info) => {
  test.skip(browserName !== "chromium")
  test.skip(process.env.STREAMLAB_MEDIA_TEST !== "1", "Requires pnpm media:up")
  test.setTimeout(60000)
  await open(page, "/lab#rtc")
  const receive = await context.newPage()
  await open(receive, "/lab#rtc")
  await page.getByRole("button", { name: "WHIP 发布", exact: true }).click()
  await expect(page.getByTestId("media-rtc-status")).toHaveText("connected")
  await receive.getByRole("button", { name: "WHEP 订阅", exact: true }).click()
  await expect(receive.getByTestId("media-rtc-status")).toHaveText("connected")
  await expect
    .poll(() =>
      receive
        .locator("video")
        .last()
        .evaluate((v) => (v as HTMLVideoElement).videoWidth),
    )
    .toBeGreaterThan(0)
  const tracks = await receive
    .locator("video")
    .last()
    .evaluate((v) =>
      (v as HTMLVideoElement).srcObject instanceof MediaStream
        ? ((v as HTMLVideoElement).srcObject as MediaStream)
            .getTracks()
            .map((t) => ({ kind: t.kind, readyState: t.readyState }))
        : [],
    )
  expect(
    tracks.some((t) => t.kind === "audio" && t.readyState === "live"),
  ).toBe(true)
  await info.attach("whip-whep", {
    body: JSON.stringify(tracks),
    contentType: "application/json",
  })
  await page.getByRole("button", { name: "停止", exact: true }).click()
})
