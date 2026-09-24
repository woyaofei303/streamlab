import { expect, test } from "@playwright/test"

test("initial missing HLS manifest reaches a bounded retry UI", async ({
  page,
}) => {
  await page.goto("/lab")
  await page
    .getByRole("combobox", { name: "测试播放源", exact: true })
    .selectOption("/api/media/fault/missing.m3u8")
  await expect(
    page.getByRole("button", { name: "重新加载", exact: true }),
  ).toBeVisible({ timeout: 20000 })
})
test("switching WHIP to WHEP does not let the canceled request kill the new one", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium")
  let whip = false,
    whep = false
  await context.route("http://localhost:8889/rtc/*", async (route) => {
    if (route.request().url().endsWith("/whip")) {
      whip = true
      await new Promise((r) => setTimeout(r, 5000))
    } else whep = true
    await route.fulfill({ status: 503, body: "Injected test response" })
  })
  await page.goto("/lab#rtc")
  await page.getByRole("button", { name: "WHIP 发布", exact: true }).click()
  await expect.poll(() => whip).toBe(true)
  await page.getByRole("button", { name: "WHEP 订阅", exact: true }).click()
  await expect.poll(() => whep).toBe(true)
})
test("ended creator session offers a viewer recording", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("streamlab-user", "creator")
    // Browser-level fixture: service-worker passthrough requests bypass routing in Firefox/WebKit.
    const original = window.fetch
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      )
      if (url.pathname === "/api/media/recordings")
        return Response.json({
          items: [
            {
              start: new Date().toISOString(),
              duration: 60,
              url: "/media/demo.mp4",
            },
          ],
        })
      return original(input, init)
    }
  })
  await page.goto("/live/mei")
  await expect(
    page.getByRole("button", { name: "通知", exact: true }),
  ).toBeVisible()
  await page.evaluate(() =>
    fetch("/api/v1/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "end",
        userId: "creator",
        channelId: "mei",
      }),
    }),
  )
  await page
    .getByRole("combobox", { name: "本场录制回放", exact: true })
    .selectOption("/media/demo.mp4")
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v) => (v as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0)
})
