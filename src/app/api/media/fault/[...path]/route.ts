// 可复现媒体故障：真实延迟/拒绝/限速分片；固定 public/media 根目录和扩展名，避免读取任意文件。
import { readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params,
    url = new URL(request.url),
    mode = url.searchParams.get("mode"),
    root = resolve("public/media"),
    file = resolve(root, ...path)
  if (
    !file.startsWith(root + sep) ||
    !/^[-\w/]+\.(m3u8|ts)$/.test(path.join("/"))
  )
    return new Response("Invalid path", { status: 400 })
  if (mode === "slow" && file.endsWith(".ts"))
    await new Promise((r) => setTimeout(r, 1500))
  if (mode === "fail" && /segment_00[123]\.ts$/.test(file))
    return new Response("Injected segment failure", { status: 503 })
  try {
    const data = await readFile(file)
    // 每次 pull 发送 16KiB、间隔 250ms，约 0.52Mbps/请求；并发请求会各自限速，不是共享全局带宽。
    if (mode === "bandwidth" && file.endsWith(".ts")) {
      let offset = 0
      let canceled = false
      const body = new ReadableStream({
        async pull(controller) {
          if (offset >= data.length) {
            controller.close()
            return
          }
          await new Promise((r) => setTimeout(r, 250))
          if (canceled) return
          if (request.signal.aborted) {
            controller.close()
            return
          }
          controller.enqueue(
            new Uint8Array(data.subarray(offset, offset + 16384)),
          )
          offset += 16384
        },
        cancel() {
          canceled = true
        },
      })
      return new Response(body, {
        headers: { "Content-Type": "video/mp2t", "Cache-Control": "no-store" },
      })
    }
    // 改写相对 URI，使主清单→子清单→TS 都保留 mode。本测试素材无 KEY/MAP 等标签内 URI。
    if (file.endsWith(".m3u8")) {
      const playlist = data
        .toString()
        .split("\n")
        .map((line) => {
          if (!line || line.startsWith("#")) return line
          const segment = new URL(line, request.url)
          segment.searchParams.set("mode", mode ?? "normal")
          return segment.pathname + segment.search
        })
        .join("\n")
      return new Response(playlist, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
        },
      })
    }
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "video/mp2t", "Cache-Control": "no-store" },
    })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}
