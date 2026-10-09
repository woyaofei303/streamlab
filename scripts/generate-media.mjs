// 离线素材流水线：静态图+合成音 → H.264/AAC MP4 → 720/480/360 三档 HLS。它不是实际拍摄的直播内容。
// pnpm media:generate 只生成文件，不发送直播；media:fixture 才会把 demo.mp4 通过 RTMP 发给服务端。
// 分清「内容来自测试素材」与「传输是否真实」：测试视频也能经过真实推流、接收和播放。
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve("."),
  out = resolve("public/media")
mkdirSync(out, { recursive: true })
for (let i = 0; i < 3; i++) mkdirSync(`${out}/v${i}`, { recursive: true })
function ffmpeg(args) {
  // 用 Docker 中的 FFmpeg 处理素材，宿主机无需另装 FFmpeg；挂载目录让生成结果留在 public。
  const run = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${root}/public:/assets`,
      "jrottenberg/ffmpeg:7.1-alpine",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...args,
    ],
    { stdio: "inherit" },
  )
  if (run.status !== 0) process.exit(run.status ?? 1)
}
// 第一遍：把一张图片和合成声音编码为 60 秒 MP4。-vf/-af 分别是视频/音频滤镜。
// -c:v libx264 编码 H.264 视频，-c:a aac 编码 AAC 音频；MP4 是装这些数据的容器格式。
ffmpeg([
  "-loop",
  "1",
  "-i",
  "/assets/covers/tokyo.jpg",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=220:sample_rate=48000",
  "-t",
  "60",
  "-vf",
  "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00015,1.2)':d=1:s=1280x720:fps=24,format=yuv420p",
  "-af",
  "volume=0.04",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-b:v",
  "1800k",
  "-g",
  "48",
  "-keyint_min",
  "48",
  "-sc_threshold",
  "0",
  "-c:a",
  "aac",
  "-b:a",
  "96k",
  "-movflags",
  "+faststart",
  "/assets/media/demo.mp4",
])
// 24fps 配置下 GOP=48，即约 2 秒一个关键帧；固定 GOP、关闭场景切换插帧，便于三档分片对齐切换。
// 码率是编码目标，最终 master 清单 BANDWIDTH 以生成结果为准，不能把 1800k 当实际峰值。
// 第二遍：split/scale 生成三个分辨率，-map 为每档配上视频和音频；这一步才是转码。
// master.m3u8 列出各档入口；v0/v1/v2 的 index.m3u8 列出对应档位的 .ts 媒体分片。
// -hls_time 4 是分片目标秒数；vod 表示有限长度点播，不会像直播那样持续追加新内容。
ffmpeg([
  "-i",
  "/assets/media/demo.mp4",
  "-filter_complex",
  "[0:v]split=3[a][b][c];[a]scale=1280:720[v0];[b]scale=854:480[v1];[c]scale=640:360[v2]",
  "-map",
  "[v0]",
  "-map",
  "0:a",
  "-map",
  "[v1]",
  "-map",
  "0:a",
  "-map",
  "[v2]",
  "-map",
  "0:a",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-g",
  "48",
  "-keyint_min",
  "48",
  "-sc_threshold",
  "0",
  "-b:v:0",
  "1800k",
  "-b:v:1",
  "850k",
  "-b:v:2",
  "400k",
  "-c:a",
  "aac",
  "-b:a",
  "64k",
  "-var_stream_map",
  "v:0,a:0 v:1,a:1 v:2,a:2",
  "-hls_time",
  "4",
  "-hls_playlist_type",
  "vod",
  "-hls_flags",
  "independent_segments",
  "-master_pl_name",
  "master.m3u8",
  "-hls_segment_filename",
  "/assets/media/v%v/segment_%03d.ts",
  "/assets/media/v%v/index.m3u8",
])
writeFileSync(
  `${out}/master.m3u8`,
  `${readFileSync(`${out}/master.m3u8`, "utf8").trimEnd()}\n`,
)
writeFileSync(
  `${out}/captions.vtt`,
  "WEBVTT\n\n00:00.000 --> 00:10.000\nTokyo after dark. A moment to slow down.\n\n00:10.000 --> 00:20.000\nThis is a local HLS test, with three quality levels.\n\n00:20.000 --> 00:40.000\nOpen playback settings to switch quality.\n\n00:40.000 --> 01:00.000\nStreamLab: live moments, real connections.\n",
)
console.log(
  "Generated 60-second H.264/AAC video + 720p/480p/360p HLS and captions.",
)
