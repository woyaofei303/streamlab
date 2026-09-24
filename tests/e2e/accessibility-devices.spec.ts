import { expect, test } from "@playwright/test"

test("permission refusal leaves device preview safe and usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("streamlab-user", "creator")
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Camera permission denied", "NotAllowedError")
    }
  })
  await page.goto("/studio")
  await page.getByRole("button", { name: "设备预览", exact: true }).click()
  await page.getByRole("button", { name: "摄像头", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText(/denied|not allowed/i)
  await expect(
    page.getByRole("button", { name: "停止预览", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "摄像头", exact: true }),
  ).toBeEnabled()
  expect(
    await page
      .locator("video")
      .evaluate((v) => (v as HTMLVideoElement).srcObject),
  ).toBeNull()
})

test("dialog keyboard focus and language preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  const trigger = page.getByRole("button", { name: "登录", exact: true })
  await trigger.focus()
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect
    .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true)
  await page.keyboard.press("Shift+Tab")
  await expect
    .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true)
  await page.keyboard.press("Escape")
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await page
    .getByRole("button", { name: "Switch language", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible()
})
