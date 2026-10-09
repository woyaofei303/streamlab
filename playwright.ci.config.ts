import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "production.spec.ts",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  outputDir: "output-tdd/playwright/ci",
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:8080",
    permissions: ["camera", "microphone"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
})
