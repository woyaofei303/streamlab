// JD 实验：固定素材、每次新上下文并禁用 HTTP 缓存；记录基线/慢分片/限速，不能把结果外推成跨境收益。
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium } from "@playwright/test"

// Run against pnpm dev. Every measurement uses a new browser context and no HTTP cache.
const browser = await chromium.launch()
const results = []
try {
  for (const mode of [
    "normal",
    "normal",
    "normal",
    "slow",
    "slow",
    "slow",
    "bandwidth",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send("Network.enable")
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
    await page.goto("http://127.0.0.1:3000/lab")
    const source =
      mode === "normal"
        ? "/media/master.m3u8"
        : `/api/media/fault/master.m3u8?mode=${mode}`
    await page
      .getByRole("combobox", { name: "测试播放源", exact: true })
      .selectOption(source)
    await page.waitForFunction(
      () => document.querySelector("video")?.currentTime > 2,
      {},
      { timeout: 45000 },
    )
    if (mode === "bandwidth") await page.waitForTimeout(32000)
    else {
      await page.getByRole("button", { name: "Pause", exact: true }).click()
      await page
        .getByRole("slider", { name: "播放进度", exact: true })
        .press("ArrowRight")
      await page.waitForTimeout(500)
    }
    await page.getByRole("button", { name: "会话记录", exact: true }).click()
    const session = await page.evaluate(
      () => JSON.parse(localStorage.getItem("streamlab-playback"))[0],
    )
    assert(session.url === source, "The intended source must remain selected")
    const levels = session.events
      .filter((e) => e.type === "level_switch")
      .map((e) => e.value)
    if (mode === "bandwidth") {
      assert(
        levels.includes("360p"),
        "ABR must choose the lowest level under the cap",
      )
      assert(
        session.stalls > 0,
        "A cap below the lowest bitrate must cause real buffering",
      )
    } else
      assert.equal(session.stalls, 0, "Pause and seek must not count as stalls")
    results.push({
      mode,
      startupMs: session.startupMs,
      stalls: session.stalls,
      stallMs: Math.round(session.stallMs),
      levels,
      events: session.events,
    })
    await context.close()
  }
  const report = {
    at: new Date().toISOString(),
    browser: await browser.version(),
    cache:
      "Fresh context per run, HTTP cache disabled; identical media via static/slow/throttled endpoints",
    results,
  }
  await mkdir("output-tdd/playwright/streamlab", { recursive: true })
  await writeFile(
    "output-tdd/playwright/streamlab/playback-measurements.json",
    JSON.stringify(report, null, 2),
  )
  console.log(
    JSON.stringify(
      { ...report, results: results.map(({ events: _, ...r }) => r) },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
