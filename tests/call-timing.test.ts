import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdir, writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { expect, test } from "vitest"
import { mixerArgs } from "../src/lib/call-mixer"

// Opt-in: real loopback MediaMTX, synthetic wall-clock frames; no user cameras or room state.
test.skipIf(process.env.STREAMLAB_CALL_TIMING_TEST !== "1").each([2, 4])(
  "%i mixed videos stay synchronized and close to the live edge",
  async (count) => {
    const children: ReturnType<typeof spawn>[] = []
    const launch = (args: string[]) => {
      const child = spawn(
        "ffmpeg",
        ["-hide_banner", "-loglevel", "error", ...args],
        { stdio: ["ignore", "pipe", "pipe"] },
      )
      children.push(child)
      child.stderr?.on("data", (data) => process.stderr.write(data))
      return child
    }
    const paths = Array.from({ length: count }, () => `call/${randomUUID()}`)
    const output = randomUUID()
    const ready = async (names: string[]) => {
      for (let i = 0; i < 100; i++) {
        const { items } = await fetch(
          "http://127.0.0.1:9997/v3/paths/list",
        ).then((r) => r.json())
        if (
          names.every((name) =>
            items.some(
              (p: { name: string; ready: boolean; bytesReceived: number }) =>
                p.name === name && p.ready && p.bytesReceived > 0,
            ),
          )
        )
          return items.filter((p: { name: string }) => names.includes(p.name))
        await delay(200)
      }
      throw Error("Synthetic stream did not become ready")
    }
    try {
      for (const path of paths)
        launch([
          "-re",
          "-f",
          "lavfi",
          "-i",
          "nullsrc=s=2x2:r=24",
          "-re",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000",
          "-vf",
          "geq=lum='mod(floor(time(0)*10),128)+64':cb=128:cr=128,scale=1280:720:flags=neighbor",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          "-threads",
          "1",
          "-g",
          "24",
          "-c:a",
          "libopus",
          "-f",
          "rtsp",
          "-rtsp_transport",
          "tcp",
          `rtsp://127.0.0.1:8554/${path}`,
        ])
      await ready(paths)
      launch(
        mixerArgs(
          paths.map((path) => ({ path, audio: true, muted: false })),
          output,
        ),
      )
      const [mixed] = await ready([`call/${output}`])
      expect(mixed.tracks).toEqual(expect.arrayContaining(["H264", "Opus"]))
      expect(mixed.tracks2).toContainEqual(
        expect.objectContaining({
          codec: "H264",
          codecProps: expect.objectContaining({ width: 1280, height: 720 }),
        }),
      )
      const reader = launch([
        "-fflags",
        "nobuffer",
        "-analyzeduration",
        "0",
        "-probesize",
        "32768",
        "-rtsp_transport",
        "tcp",
        "-threads",
        "1",
        "-i",
        `rtsp://127.0.0.1:8554/call/${output}`,
        "-an",
        "-vf",
        "fps=5,scale=4:4:flags=area",
        "-frames:v",
        "35",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "rawvideo",
        "-flush_packets",
        "1",
        "pipe:1",
      ])
      let buffered = Buffer.alloc(0)
      const samples: { skewMs: number; latencyMs: number }[] = []
      reader.stdout?.on("data", (chunk) => {
        buffered = Buffer.concat([buffered, chunk])
        while (buffered.length >= 24) {
          const values = [0, 2, 8, 10]
            .slice(0, count)
            .map((offset) => buffered[offset] - 64)
          const left = values[0]
          const now = Math.floor(Date.now() / 100) % 128
          samples.push({
            skewMs:
              Math.max(
                ...values.map((value) =>
                  Math.abs(((left - value + 192) % 128) - 64),
                ),
              ) * 100,
            latencyMs: ((now - left + 128) % 128) * 100,
          })
          buffered = buffered.subarray(24)
        }
      })
      const [code] = await once(reader, "close")
      expect(code).toBe(0)
      const steady = samples.slice(10)
      expect(steady.length).toBe(25)
      const p90 = (key: keyof (typeof steady)[number]) =>
        steady.map((s) => s[key]).sort((a, b) => a - b)[
          Math.floor(steady.length * 0.9)
        ]
      const report = {
        skewP90Ms: p90("skewMs"),
        latencyP90Ms: p90("latencyMs"),
        samples: steady,
      }
      await mkdir("output-tdd/call-main", { recursive: true })
      await writeFile(
        `output-tdd/call-main/timing-${count}.json`,
        JSON.stringify(report, null, 2),
      )
      console.log(JSON.stringify(report))
      expect(report.skewP90Ms).toBeLessThanOrEqual(300)
      expect(report.latencyP90Ms).toBeLessThanOrEqual(1500)
    } finally {
      for (const child of children.reverse()) {
        if (child.exitCode !== null) continue
        const closed = once(child, "close")
        child.kill("SIGKILL")
        await closed
      }
    }
  },
  45000,
)
