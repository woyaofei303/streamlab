import { expect, type Page, test } from "@playwright/test"
import type { Action, State } from "../../src/lib/types"

async function ready(page: Page, route = "/", id = "viewer") {
  await page.addInitScript((id) => {
    if (!sessionStorage.getItem("streamlab-user"))
      sessionStorage.setItem("streamlab-user", id)
  }, id)
  await page.goto(route)
  await expect(
    page.getByRole("button", { name: "通知", exact: true }),
  ).toBeVisible()
}
async function act(page: Page, a: Action) {
  return page.evaluate(async (a) => {
    const r = await fetch("/api/v1/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(a),
    })
    return { ok: r.ok, data: await r.json() }
  }, a)
}
async function state(page: Page): Promise<State> {
  return page.evaluate(() => fetch("/api/v1/state").then((r) => r.json()))
}

test("browse, URL filters, login and reservation survive refresh", async ({
  page,
}) => {
  await ready(page, "/", "")
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await page.getByRole("button", { name: /Alex.*观众/ }).click()
  await page.getByRole("textbox", { name: "搜索", exact: true }).fill("River")
  await page.getByRole("textbox", { name: "搜索", exact: true }).press("Enter")
  await expect(page).toHaveURL(/q=River/)
  await expect(page.getByRole("heading", { name: /搜索/ })).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("textbox", { name: "搜索", exact: true }),
  ).toHaveValue("River")
  await page.goto("/live/river")
  await page.getByRole("button", { name: "预约直播", exact: true }).click()
  await expect
    .poll(async () => (await state(page)).users[0].reservations)
    .toContain("river")
  await page.goto("/library?tab=reservations")
  await expect(page.getByText("River Sessions", { exact: true })).toBeVisible()
})

test("membership, credit purchase, gift, refund and expiry", async ({
  page,
}) => {
  await ready(page, "/live/mei")
  await page.getByRole("button", { name: "订阅", exact: true }).click()
  await page.getByRole("button", { name: "确认模拟支付", exact: true }).click()
  await expect(page.getByText("一切就绪", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "继续观看", exact: true }).click()
  let s = await state(page)
  expect(s.memberships).toHaveLength(1)
  expect(
    (
      await act(page, {
        type: "cancelMembership",
        userId: "viewer",
        channelId: "mei",
      })
    ).ok,
  ).toBe(true)
  expect((await state(page)).memberships[0].renew).toBe(false)
  await page.getByRole("button", { name: "送礼物", exact: true }).click()
  await page.getByRole("button", { name: "确认送出", exact: true }).click()
  await expect(page.getByText("一切就绪", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "继续观看", exact: true }).click()
  expect((await state(page)).users[0].credits).toBe(480)
  await page.goto("/library?tab=orders")
  await page.getByRole("button", { name: "申请退款", exact: true }).click()
  await page.getByRole("button", { name: "确认申请退款", exact: true }).click()
  await expect
    .poll(async () => (await state(page)).orders[0].status)
    .toBe("refunded")
  await act(page, {
    type: "purchase",
    userId: "viewer",
    channelId: "atlas",
    product: "ticket",
    key: "ticket",
    coupon: "WELCOME20",
  })
  s = await state(page)
  expect(s.orders[0].cents).toBe(239)
  await act(page, { type: "refund", userId: "viewer", orderId: s.orders[0].id })
  await act(page, {
    type: "purchase",
    userId: "viewer",
    channelId: "mei",
    product: "membership",
    key: "expire",
  })
  await act(page, { type: "clock", days: 31 })
  s = await state(page)
  expect(s.memberships.at(-1)?.renewalFailed).toBe(true)
})

test("two tabs chat, moderation, duplicates and reconnect recovery", async ({
  page,
  context,
}) => {
  await ready(page, "/live/mei")
  const host = await context.newPage()
  await ready(host, "/studio", "creator")
  await page
    .getByRole("textbox", { name: "发送消息", exact: true })
    .fill("Hello host unique")
  await page.getByRole("button", { name: "发送", exact: true }).click()
  await expect(
    host.getByText("Hello host unique", { exact: true }),
  ).toBeVisible()
  const message = (await state(page)).messages.find(
    (m) => m.text === "Hello host unique",
  )
  if (!message) throw Error("Missing acknowledged message")
  await host
    .getByRole("button", { name: `Message actions ${message.id}`, exact: true })
    .click()
  await host.getByRole("button", { name: "置顶消息", exact: true }).click()
  await expect(page.getByText("📌 Alex Chen: Hello host unique")).toBeVisible()
  await act(host, {
    type: "moderate",
    userId: "creator",
    channelId: "mei",
    operation: "mute",
    target: "viewer",
  })
  await page
    .getByRole("textbox", { name: "发送消息", exact: true })
    .fill("muted attempt")
  await page.getByRole("button", { name: "发送", exact: true }).click()
  await expect(page.getByText("失败，点击重试")).toBeVisible()
  await act(host, {
    type: "moderate",
    userId: "creator",
    channelId: "mei",
    operation: "mute",
    target: "viewer",
  })
  await act(page, { type: "scenario", value: "duplicate" })
  await page.getByText("失败，点击重试").click()
  await expect
    .poll(
      async () =>
        (await state(page)).messages.filter((m) => m.text === "muted attempt")
          .length,
    )
    .toBe(1)
  await act(page, { type: "scenario", value: "disconnect" })
  await expect(page.getByText("重连中", { exact: true })).toBeVisible({
    timeout: 20000,
  })
  await act(host, {
    type: "message",
    userId: "creator",
    channelId: "mei",
    id: "during-disconnect",
    text: "Backfill marker",
  })
  await expect(
    page.getByText("Backfill marker", { exact: true }),
  ).not.toBeVisible()
  await act(page, { type: "scenario", value: "normal" })
  await expect(page.getByText("Backfill marker", { exact: true })).toBeVisible()
  await page.evaluate(() => fetch("/api/v1/reset", { method: "POST" }))
  await expect(
    page.getByText("Backfill marker", { exact: true }),
  ).not.toBeVisible()
  await host.close()
})

test("HLS playback, controls, real quality levels and cleanup", async ({
  page,
}) => {
  await ready(page, "/live/mei")
  const video = page.locator("video")
  await expect
    .poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0)
  await page
    .getByRole("button", { name: "Player settings", exact: true })
    .click()
  await expect(
    page.getByRole("option", { name: "720p", exact: true }),
  ).toBeAttached()
  await page.getByRole("combobox", { name: /清晰度|Quality/ }).selectOption("2")
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  expect(await video.evaluate((v) => (v as HTMLVideoElement).paused)).toBe(true)
  await page.goto("/lab")
  await page.getByRole("button", { name: "会话记录", exact: true }).click()
  await expect(page.getByTestId("player-count")).toHaveText("0")
})

test("responsive pages at all required widths", async ({ page }, info) => {
  await ready(page, "/")
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 950 })
    for (const route of ["/", "/live/mei", "/library", "/studio"]) {
      await page.evaluate(
        (id) => sessionStorage.setItem("streamlab-user", id),
        route === "/studio" ? "creator" : "viewer",
      )
      await page.goto(route)
      await expect(
        page.getByRole("button", { name: "通知", exact: true }),
      ).toBeVisible()
      const sizes = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        view: innerWidth,
      }))
      expect(sizes.scroll, `${route} at ${width}`).toBeLessThanOrEqual(
        sizes.view,
      )
      if (info.project.name === "chromium")
        await page.screenshot({
          path: `output-tdd/playwright/streamlab/${route.replaceAll("/", "_") || "home"}-${width}.png`,
          fullPage: true,
        })
    }
  }
})

test("real two-tab RTC call releases both streams", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Fake-device RTC test is configured for Chromium",
  )
  await ready(page, "/lab#rtc")
  const other = await context.newPage()
  await ready(other, "/lab#rtc", "creator")
  await page.getByRole("button", { name: "发起邀请", exact: true }).click()
  await other.getByRole("button", { name: "接听", exact: true }).click()
  await expect(page.getByTestId("rtc-status")).toHaveText("connected")
  await expect(other.getByTestId("rtc-status")).toHaveText("connected")
  await expect
    .poll(() =>
      other
        .locator("video")
        .nth(1)
        .evaluate((v) => (v as HTMLVideoElement).videoWidth),
    )
    .toBeGreaterThan(0)
  await page.getByRole("button", { name: "挂断", exact: true }).click()
  await expect(other.getByTestId("rtc-status")).toHaveText("idle")
  expect(
    await page
      .locator("video")
      .first()
      .evaluate((v) => (v as HTMLVideoElement).srcObject),
  ).toBeNull()
})
