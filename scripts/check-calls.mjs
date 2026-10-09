// Local integration check: three synthetic guests + the existing OBS/browser source.
// Requires pnpm dev, MediaMTX and FFmpeg; never opens a camera or microphone.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

const base = "http://127.0.0.1:3000"
const children = []
let host
async function action(body, token = "") {
  const response = await fetch(`${base}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  assert.equal(response.status, 200, result.error)
  return result
}
async function status() {
  return (
    await fetch(`${base}/api/calls`, {
      headers: { Authorization: `Bearer ${host.token}` },
    })
  ).json()
}
const guests = []
let heartbeat
try {
  const existing = await (await fetch(`${base}/api/calls`)).json()
  assert.equal(
    existing.enabled,
    false,
    "Close the existing call before testing",
  )
  host = await action({
    action: "open",
    source: process.argv[2] === "browser" ? "browser" : "live",
    password: process.env.STREAMLAB_TEST_PASSWORD,
  })
  heartbeat = setInterval(() => {
    void status()
    for (const guest of guests)
      void fetch(`${base}/api/calls`, {
        headers: { Authorization: `Bearer ${guest.token}` },
      })
  }, 5000)
  for (const [index, color] of ["red", "green", "blue"].entries()) {
    const guest = await action({
      action: "request",
      name: `Test ${color}`,
      role: index ? "观众" : "主播",
    })
    guests.push(guest)
    await action({ action: "accept", id: guest.id }, host.token)
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=640x360:r=24`,
        "-re",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${440 + index * 220}:sample_rate=48000`,
        "-t",
        "120",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "24",
        "-c:a",
        "libopus",
        "-f",
        "rtsp",
        "-rtsp_transport",
        "tcp",
        `rtsp://127.0.0.1:8554/call/${guest.id}`,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    )
    children.push(child)
  }
  let state
  for (let i = 0; i < 35; i++) {
    state = await status()
    if (state.mix.state === "ready" && state.participants.length === 4) break
    await delay(1000)
  }
  assert.equal(state.mix.state, "ready", JSON.stringify(state.mix))
  assert.equal(state.participants.length, 4)
  const mixPath = new URL(state.mix.url, base).pathname.replace(/\/whep$/, "")
  const inspect = spawn(
    "ffprobe",
    [
      "-v",
      "error",
      "-rtsp_transport",
      "tcp",
      "-show_entries",
      "stream=codec_name,width,height",
      "-of",
      "json",
      `rtsp://127.0.0.1:8554${mixPath}`,
    ],
    { stdio: ["ignore", "pipe", "inherit"], timeout: 15000 },
  )
  children.push(inspect)
  let output = ""
  inspect.stdout.on("data", (data) => {
    output += data
  })
  const code = await new Promise((resolve, reject) => {
    inspect.on("close", resolve)
    inspect.on("error", reject)
  })
  assert.equal(code, 0)
  const streams = JSON.parse(output).streams
  assert(
    streams.some(
      (s) => s.codec_name === "h264" && s.width === 1280 && s.height === 720,
    ),
  )
  assert(streams.some((s) => s.codec_name === "opus"))
  const hold = Number(process.env.STREAMLAB_TEST_HOLD_MS || 0)
  assert(Number.isFinite(hold) && hold >= 0 && hold <= 30000)
  if (hold) await delay(hold)
  const initialUrl = state.mix.url
  await action({ action: "leave", id: guests[2].id }, host.token)
  for (let i = 0; i < 30; i++) {
    state = await status()
    if (state.mix.state === "ready" && state.mix.url !== initialUrl) break
    await delay(1000)
  }
  assert.equal(state.participants.length, 3)
  assert.equal(state.mix.state, "ready")
  assert.notEqual(state.mix.url, initialUrl)
  console.log(
    "PASS: 4 speakers, 1280×720 H.264/Opus composite for WebRTC, removal rebuilds the live stream",
  )
} finally {
  clearInterval(heartbeat)
  for (const child of children) child.kill("SIGTERM")
  if (host) await action({ action: "close" }, host.token)
}
