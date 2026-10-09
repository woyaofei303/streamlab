import { type ChildProcess, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  disconnect,
  room,
  speakers,
  sweep,
  updateCallInputs,
} from "./call-server"

type Input = { path: string; audio: boolean; muted: boolean }
type MediaPath = {
  name: string
  ready: boolean
  tracks: string[]
  bytesReceived: number
  source?: { id: string }
}
export function mixerArgs(inputs: Input[], output: string) {
  // 同一墙钟 + isync 保留输入间的时间差；不能逐路 setpts=PTS-STARTPTS。
  const height = inputs.length <= 2 ? 720 : 360
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-nostdin",
    "-copyts",
    "-start_at_zero",
    "-filter_complex_threads",
    "1",
  ]
  const filters: string[] = []
  inputs.forEach((input, index) => {
    args.push(
      "-thread_queue_size",
      "64",
      "-fflags",
      "nobuffer",
      "-use_wallclock_as_timestamps",
      "1",
      "-isync",
      "0",
      "-rtsp_transport",
      "tcp",
      "-timeout",
      "5000000",
      "-analyzeduration",
      "0",
      "-probesize",
      "32768",
      "-threads",
      "1",
      "-i",
      `rtsp://127.0.0.1:8554/${input.path}`,
    )
    filters.push(
      `[${index}:v]fps=24,scale=640:${height}:force_original_aspect_ratio=increase,crop=640:${height},setsar=1[v${index}]`,
    )
    filters.push(
      input.audio
        ? `[${index}:a]aresample=48000:async=1:first_pts=0,volume=${input.muted ? 0 : 0.8}[a${index}]`
        : `anullsrc=r=48000:cl=stereo[a${index}]`,
    )
  })
  filters.push(
    `${inputs.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${inputs.length}:layout=${inputs.map((_, i) => `${(i % 2) * 640}_${Math.floor(i / 2) * height}`).join("|")}:fill=black,pad=1280:720:0:0[v]`,
  )
  filters.push(
    `${inputs.map((_, i) => `[a${i}]`).join("")}amix=inputs=${inputs.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95:level=0[a]`,
  )
  return [
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "baseline",
    "-b:v",
    "2500k",
    "-maxrate",
    "3000k",
    "-bufsize",
    "3000k",
    "-g",
    "24",
    "-c:a",
    "libopus",
    "-application",
    "lowdelay",
    "-b:a",
    "96k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "rtsp",
    "-rtsp_transport",
    "tcp",
    `rtsp://127.0.0.1:8554/call/${output}`,
  ]
}

type Worker = {
  timer?: ReturnType<typeof setInterval>
  busy: boolean
  child?: ChildProcess
  key: string
  output: string
  startedAt: number
  retryAt: number
}
const globals = globalThis as typeof globalThis & { callMixer?: Worker }
globals.callMixer ??= {
  busy: false,
  key: "",
  output: "",
  startedAt: 0,
  retryAt: 0,
}
const worker = globals.callMixer
// Replace the polling callback when Next reloads this module in development.
if (worker.timer) {
  clearInterval(worker.timer)
  worker.timer = undefined
}
async function stop() {
  const child = worker.child
  worker.child = undefined
  worker.key = ""
  worker.output = ""
  if (!child || child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 1500)
    child.once("close", () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill("SIGTERM")
  })
}
async function tick() {
  if (worker.busy) return
  worker.busy = true
  try {
    sweep()
    if (!room.host) {
      await stop()
      return
    }
    const response = await fetch("http://127.0.0.1:9997/v3/paths/list", {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) throw Error("媒体服务未连接")
    const { items } = (await response.json()) as { items: MediaPath[] }
    updateCallInputs(items)
    const ready = (path: string) =>
      items.find(
        (item) => item.name === path && item.ready && item.bytesReceived > 0,
      )
    for (const member of speakers()) {
      if (ready(`call/${member.id}`)) member.status = "joined"
      else if (member.status === "joined") disconnect(member)
    }
    const guests = speakers().filter((member) => member.status === "joined")
    const main = ready(room.source)
    if (!main || !guests.length) {
      await stop()
      room.mix = {
        state: guests.length ? "starting" : "idle",
        ...(!main
          ? {
              message:
                room.sourceMode === "auto"
                  ? "等待房主开启网页直播或 OBS 推流"
                  : room.source === "browser"
                    ? "等待房主开启网页直播"
                    : "等待房主在 OBS 开始推流",
            }
          : {}),
      }
      return
    }
    const members = [room.host, ...guests]
    const paths = [
      main,
      ...guests.map((m) => ready(`call/${m.id}`) as MediaPath),
    ]
    const inputs = paths.map((p, i) => ({
      path: p.name,
      audio: p.tracks.some((track) => /opus|audio|aac/i.test(track)),
      muted: members[i].muted,
    }))
    const key = JSON.stringify([
      paths.map((p) => [p.name, p.source?.id]),
      mixerArgs(inputs, ""),
    ])
    if (key !== worker.key) {
      if (Date.now() < worker.retryAt) return
      await stop()
      worker.key = key
      worker.output = randomUUID()
      worker.startedAt = Date.now()
      room.mix = { state: "starting", message: "正在更新连麦画面" }
      const child = spawn(
        /* turbopackIgnore: true */ "ffmpeg",
        mixerArgs(inputs, worker.output),
        { stdio: ["ignore", "ignore", "pipe"] },
      )
      worker.child = child
      let details = ""
      child.stderr?.on("data", (data) => {
        details = `${details}${data}`.slice(-2000)
      })
      const failed = () => {
        if (worker.child !== child) return
        worker.child = undefined
        worker.key = ""
        worker.retryAt = Date.now() + 5000
        room.mix = {
          state: "error",
          message: "合流暂时不可用，正在重试；本地请确认已安装 FFmpeg",
        }
        console.error("Call mixer stopped:", details.slice(-500))
      }
      child.once("error", failed)
      child.once("exit", failed)
    }
    if (ready(`call/${worker.output}`)) {
      room.mix = {
        state: "ready",
        url: process.env.NEXT_PUBLIC_MEDIA_HOST
          ? `/call/${worker.output}/whep`
          : `http://127.0.0.1:8889/call/${worker.output}/whep`,
      }
    } else if (Date.now() - worker.startedAt > 20000) {
      await stop()
      worker.retryAt = Date.now() + 5000
      room.mix = { state: "error", message: "合流连接超时，正在重试" }
    }
  } catch {
    updateCallInputs([])
    await stop()
    if (room.host)
      room.mix = { state: "error", message: "媒体服务未连接，请检查媒体服务" }
  } finally {
    worker.busy = false
  }
}
export function startCallWorker() {
  if (!worker.timer) {
    worker.timer = setInterval(() => void tick(), 1000)
    worker.timer.unref()
  }
}
